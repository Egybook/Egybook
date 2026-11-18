import { neon } from "@neondatabase/serverless";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
  "Access-Control-Expose-Headers": "ETag, Content-Range, Accept-Ranges",
};

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });


// Hovod private-playback bridge.
// Ticket issuance and refresh are delegated to the Supabase Edge Function,
// which owns the trusted playback_id -> post_id mapping and audience checks.
async function callPlaybackAuthorization(env, {
  playbackId,
  authorization = '',
  refreshSecret = '',
  userId = '',
  currentTicket = '',
  currentTicketId = '',
}) {
  if (!env.EGYBOOK_PLAYBACK_AUTH_URL) {
    throw new Error('EgyBook playback authorization URL is not configured');
  }

  const headers = { 'content-type': 'application/json' };
  if (authorization) headers.Authorization = authorization;
  if (refreshSecret) headers['x-hovod-refresh-secret'] = refreshSecret;

  const body = refreshSecret
    ? { playbackId, userId, currentTicket, currentTicketId }
    : { playbackId };

  const response = await fetch(env.EGYBOOK_PLAYBACK_AUTH_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return false;
  const result = await response.json().catch(() => null);
  if (!result || typeof result.ticket !== 'string' || !result.ticket ||
      !Number.isInteger(result.expiresAt) || !Number.isInteger(result.refreshAfterSec)) {
    return false;
  }
  return result;
}

function timingSafeSecretEqual(expected, supplied) {
  if (typeof expected !== 'string' || !expected || typeof supplied !== 'string' ||
      expected.length !== supplied.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return diff === 0;
}

async function handleHovodTicket(request, env) {
  const user = await getUser(request, env);
  if (!user) return json({ error: 'Unauthorized' }, 401, { 'Cache-Control': 'no-store' });
  const body = await request.json().catch(() => null);
  const playbackId = typeof body?.playbackId === 'string' ? body.playbackId.trim() : '';
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(playbackId)) return json({ error: 'Invalid playbackId' }, 400);

  try {
    const issued = await callPlaybackAuthorization(env, {
      playbackId,
      authorization: request.headers.get('Authorization') || '',
    });
    if (!issued) return json({ error: 'Playback is not authorized' }, 403, { 'Cache-Control': 'no-store' });
    return json({ ok: true, playbackId, ...issued }, 200, {
      'Cache-Control': 'no-store, private, max-age=0',
      'Pragma': 'no-cache',
      'Referrer-Policy': 'no-referrer',
    });
  } catch {
    return json({ error: 'Playback authorization service unavailable' }, 503, { 'Cache-Control': 'no-store' });
  }
}

async function handleHovodRefresh(request, env) {
  const expected = env.EGYBOOK_HOVOD_REFRESH_SECRET;
  const supplied = request.headers.get('x-hovod-refresh-secret') || '';
  if (!timingSafeSecretEqual(expected, supplied)) {
    return json({ error: 'Unauthorized' }, 401, { 'Cache-Control': 'no-store' });
  }

  const body = await request.json().catch(() => null);
  const playbackId = typeof body?.playbackId === 'string' ? body.playbackId.trim() : '';
  const userId = typeof body?.userId === 'string' ? body.userId : '';
  const currentTicket = typeof body?.currentTicket === 'string' ? body.currentTicket : '';
  const currentTicketId = typeof body?.currentTicketId === 'string' ? body.currentTicketId : '';
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(playbackId) || !userId || !currentTicket || !currentTicketId) {
    return json({ error: 'Invalid refresh request' }, 400, { 'Cache-Control': 'no-store' });
  }

  try {
    // Supabase verifies the current HMAC ticket and rechecks the post audience
    // before minting a replacement ticket. The Worker does not mint tickets.
    const issued = await callPlaybackAuthorization(env, {
      playbackId,
      userId,
      currentTicket,
      currentTicketId,
      refreshSecret: supplied,
    });
    if (!issued) return json({ error: 'Playback is no longer authorized' }, 403, { 'Cache-Control': 'no-store' });
    return json(issued, 200, {
      'Cache-Control': 'no-store, private, max-age=0',
      'Pragma': 'no-cache',
      'Referrer-Policy': 'no-referrer',
    });
  } catch {
    return json({ error: 'Playback authorization service unavailable' }, 503, { 'Cache-Control': 'no-store' });
  }
}

async function getUser(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ") || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;

  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: auth,
    },
  });
  if (!response.ok) return null;

  const user = await response.json();
  return user?.id ? user : null;
}

function safeFilename(name) {
  const cleaned = String(name || "media.bin")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(-100);
  return cleaned || "media.bin";
}

function isSafeObjectKey(key) {
  return Boolean(
    key &&
      !key.startsWith("/") &&
      !key.includes("\\") &&
      !key.split("/").some((part) => !part || part === "." || part === "..")
  );
}

function parseSingleByteRange(header, size) {
  if (!header) return null;
  // Multiple ranges are intentionally ignored; browsers normally request one.
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return { invalid: true };
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { invalid: true };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) {
    return { invalid: true };
  }
  return { start, end: Math.min(end, size - 1) };
}

async function serveMedia(key, env, request, headOnly = false) {
  if (!isSafeObjectKey(key)) return json({ error: "Invalid media key" }, 400);

  // Existing reel objects remain in the old reels bucket.
  // Posts and profile media are served from the general media bucket.
  const isReel = key.startsWith("reels/");
  const bucket = isReel ? env.REELS_BUCKET : env.MEDIA_BUCKET;
  if (!bucket) return json({ error: "Storage binding is not configured" }, 503);

  const metadata = await bucket.head(key);
  if (!metadata) return json({ error: "Media not found" }, 404);
  const headers = new Headers(CORS);
  metadata.writeHttpMetadata(headers);
  headers.set("ETag", metadata.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Length", String(metadata.size));
  if (headOnly) return new Response(null, { status: 200, headers });

  const range = parseSingleByteRange(request.headers.get("Range"), metadata.size);
  if (range?.invalid) {
    headers.set("Content-Range", `bytes */${metadata.size}`);
    return new Response(null, { status: 416, headers });
  }

  const options = range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : undefined;
  const object = await bucket.get(key, options);
  if (!object) return json({ error: "Media not found" }, 404);
  if (range) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${metadata.size}`);
    headers.set("Content-Length", String(range.end - range.start + 1));
  }
  return new Response(object.body, { status: range ? 206 : 200, headers });
}

async function hasDatabaseReference(mediaUrl, env, authorization) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new Error("Supabase reference-check configuration is missing");
  }
  const response = await fetch(
    `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/egybook_media_url_is_referenced`,
    {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_media_url: mediaUrl }),
    }
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Supabase reference check failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  const result = await response.json();
  if (typeof result !== "boolean") throw new Error("Unexpected Supabase reference-check response");
  return result;
}

async function deleteMedia(key, env, user, request, url) {
  if (!isSafeObjectKey(key)) return json({ error: "Invalid media key" }, 400);

  // R2 buckets stay separated. Existing media objects are never bulk-deleted.
  const isReel = key.startsWith("reels/");
  // Reel records live in Neon. Deletion is intentionally disabled until the
  // Neon-side reference check and deletion workflow is implemented separately.
  if (isReel) {
    return json({ error: "Reel deletion is paused until Neon integration is ready" }, 409);
  }
  const bucket = env.MEDIA_BUCKET;
  if (!bucket) return json({ error: "Storage binding is not configured" }, 503);

  const object = await bucket.head(key);
  if (!object) return json({ error: "Media not found" }, 404);

  // Legacy objects without owner metadata are deliberately retained.
  if (object.customMetadata?.owner !== user.id) {
    return json({ error: "Forbidden: object ownership is not verified" }, 403);
  }

  // The database check runs with the caller's JWT but through a SECURITY DEFINER
  // function, so RLS cannot hide references owned by other users. Fail closed.
  const mediaUrl = `${url.origin}/media/${key}`;
  let referenced;
  try {
    referenced = await hasDatabaseReference(
      mediaUrl,
      env,
      request.headers.get("Authorization") || ""
    );
  } catch (error) {
    console.error("Media reference check failed; retaining object:", error);
    return json({ error: "Could not verify media references; file was kept" }, 503);
  }
  if (referenced) {
    return json({ error: "Media is still referenced and was kept" }, 409);
  }

  await bucket.delete(key);
  const remaining = await bucket.head(key);
  if (remaining) return json({ error: "Media deletion verification failed" }, 500);
  return json({ ok: true, deleted: true, key });
}

async function uploadMedia(request, env, user, url) {
  if (!env.MEDIA_BUCKET) {
    return json({ error: "MEDIA_BUCKET binding is not configured" }, 503);
  }

  const form = await request.formData();
  const file = form.get("file");
  const folder = String(form.get("folder") || "posts");

  if (!(file instanceof File)) {
    return json({ error: "File field is required" }, 400);
  }
  if (!["posts", "profile"].includes(folder)) {
    return json({ error: "Invalid folder" }, 400);
  }
  if (!file.type || !/^(image|video|audio)\//i.test(file.type)) {
    return json({ error: "Only image, video, and audio files are allowed" }, 415);
  }
  if (file.size <= 0) return json({ error: "Empty file" }, 400);
  if (file.type.startsWith("video/")) {
    return json({ error: "Video uploads must use the multipart endpoint" }, 413);
  }
  const directLimit = file.type.startsWith("image/") ? 12 * 1024 * 1024 : 50 * 1024 * 1024;
  if (file.size > directLimit) {
    return json({ error: file.type.startsWith("image/") ? "Maximum image size is 12 MB" : "Maximum audio size is 50 MB" }, 413);
  }

  // One root folder per Supabase account, then a media category.
  const filename = safeFilename(file.name);
  const key = `${user.id}/${folder}/${crypto.randomUUID()}-${filename}`;

  await env.MEDIA_BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: {
      owner: user.id,
      folder,
      originalName: filename,
      uploadedAt: new Date().toISOString(),
    },
  });

  const saved = await env.MEDIA_BUCKET.head(key);
  if (!saved || saved.size !== file.size) {
    await env.MEDIA_BUCKET.delete(key);
    return json({ error: "Upload verification failed" }, 500);
  }

  return json(
    {
      ok: true,
      key,
      owner_id: user.id,
      folder,
      size: saved.size,
      url: `${url.origin}/media/${key}`,
    },
    201
  );
}


const MAX_VIDEO_BYTES = 300 * 1024 * 1024;
const VIDEO_PART_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_PARTS = Math.ceil(MAX_VIDEO_BYTES / VIDEO_PART_BYTES);

function multipartBucket(kind, env) {
  return kind === "reels" ? env.REELS_BUCKET : env.MEDIA_BUCKET;
}

function multipartPrefixes(kind, userId) {
  return kind === "reels" ? [`reels/${userId}/`] : [`${userId}/posts/`, `${userId}/variants/`];
}

async function initVideoMultipart(request, env, user, url, kind) {
  const bucket = multipartBucket(kind, env);
  if (!bucket) return json({ error: "Storage binding is not configured" }, 503);
  const body = await request.json().catch(() => null);
  if (!body || !Number.isSafeInteger(Number(body.size))) return json({ error: "Invalid upload details" }, 400);
  const size = Number(body.size);
  const contentType = String(body.contentType || "");
  if (!contentType.startsWith("video/")) return json({ error: "Only video files are allowed" }, 415);
  if (size <= 0 || size > MAX_VIDEO_BYTES) return json({ error: "Maximum video size is 300 MB" }, 413);
  const filename = safeFilename(body.fileName || "video.mp4");
  const folder = kind === "reels" ? "reels" : (body.folder === "variants" ? "variants" : "posts");
  if (kind !== "reels" && body.folder && !["posts", "variants"].includes(body.folder)) return json({ error: "Invalid upload folder" }, 400);
  const key = kind === "reels"
    ? `reels/${user.id}/${crypto.randomUUID()}-${filename}`
    : `${user.id}/${folder}/${crypto.randomUUID()}-${filename}`;
  const metadata = {
    owner: user.id,
    folder,
    originalName: filename,
    declaredSize: String(size),
    uploadedAt: new Date().toISOString(),
  };
  if (kind === "reels") metadata.caption = String(body.caption || "").slice(0, 2000);
  try {
    const upload = await bucket.createMultipartUpload(key, {
      httpMetadata: { contentType },
      customMetadata: metadata,
    });
    return json({ ok: true, key, uploadId: upload.uploadId, partSize: VIDEO_PART_BYTES, totalParts: Math.ceil(size / VIDEO_PART_BYTES) }, 201);
  } catch (error) {
    console.error("Multipart initialization failed:", error);
    return json({ error: "Could not start multipart upload" }, 500);
  }
}

function validateMultipartOwnership(key, uploadId, user, kind) {
  return Boolean(
    typeof key === "string" && isSafeObjectKey(key) &&
    typeof uploadId === "string" && uploadId.length > 0 && uploadId.length <= 512 &&
    multipartPrefixes(kind, user.id).some((prefix) => key.startsWith(prefix))
  );
}

async function uploadVideoPart(request, env, user, url, kind) {
  const key = url.searchParams.get("key");
  const uploadId = url.searchParams.get("uploadId");
  const partNumber = Number(url.searchParams.get("partNumber"));
  const fileSize = Number(url.searchParams.get("fileSize"));
  if (!validateMultipartOwnership(key, uploadId, user, kind)) return json({ error: "Invalid upload ownership" }, 403);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_VIDEO_PARTS) return json({ error: "Invalid part number" }, 400);
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > MAX_VIDEO_BYTES) return json({ error: "Invalid video size" }, 400);
  const expectedParts = Math.ceil(fileSize / VIDEO_PART_BYTES);
  if (partNumber > expectedParts) return json({ error: "Part number exceeds declared file size" }, 400);
  if (!request.body) return json({ error: "Part body is required" }, 400);
  const expectedPartSize = partNumber === expectedParts ? fileSize - ((expectedParts - 1) * VIDEO_PART_BYTES) : VIDEO_PART_BYTES;
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength && declaredLength !== expectedPartSize) return json({ error: "Part size does not match declared file size" }, 413);
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength !== expectedPartSize) return json({ error: "Part size does not match declared file size" }, 413);
  const bucket = multipartBucket(kind, env);
  if (!bucket) return json({ error: "Storage binding is not configured" }, 503);
  try {
    const upload = bucket.resumeMultipartUpload(key, uploadId);
    const part = await upload.uploadPart(partNumber, buffer);
    return json({ ok: true, partNumber: part.partNumber, etag: part.etag });
  } catch (error) {
    console.error("Multipart part upload failed:", error);
    return json({ error: "Could not upload this video part" }, 400);
  }
}

async function completeVideoMultipart(request, env, user, url, kind) {
  const body = await request.json().catch(() => null);
  const key = body?.key;
  const uploadId = body?.uploadId;
  const fileSize = Number(body?.fileSize);
  const parts = body?.parts;
  if (!validateMultipartOwnership(key, uploadId, user, kind)) return json({ error: "Invalid upload ownership" }, 403);
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > MAX_VIDEO_BYTES) return json({ error: "Invalid video size" }, 400);
  const expectedParts = Math.ceil(fileSize / VIDEO_PART_BYTES);
  if (!Array.isArray(parts) || parts.length !== expectedParts) return json({ error: "Some video parts are missing" }, 400);
  const normalized = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    const partNumber = Number(part?.partNumber);
    const etag = String(part?.etag || "");
    if (partNumber !== index + 1 || !etag || etag.length > 256) return json({ error: "Invalid multipart part list" }, 400);
    normalized.push({ partNumber, etag });
  }
  const bucket = multipartBucket(kind, env);
  if (!bucket) return json({ error: "Storage binding is not configured" }, 503);
  try {
    const upload = bucket.resumeMultipartUpload(key, uploadId);
    const completed = await upload.complete(normalized);
    const saved = await bucket.head(key);
    if (!saved || saved.size !== fileSize || saved.customMetadata?.owner !== user.id) {
      console.error("Multipart object verification failed", { key, expected: fileSize, actual: saved?.size });
      return json({ error: "Uploaded video verification failed; original object was retained" }, 500);
    }
    const videoUrl = `${url.origin}/media/${key}`;
    if (kind === "reels") {
      const sql = neon(env.NEON_DATABASE_URL);
      try {
        const caption = String(body.caption || saved.customMetadata?.caption || "").slice(0, 2000);
        const rows = await sql`
          INSERT INTO reels (user_id, video_url, caption)
          VALUES (${user.id}, ${videoUrl}, ${caption})
          RETURNING id, user_id, video_url, thumbnail_url, caption, created_at
        `;
        return json({ ok: true, reel: rows[0], url: videoUrl, size: completed.size }, 201);
      } catch (error) {
        console.error("Reel record creation failed; uploaded object retained for safety:", error);
        return json({ error: "Video uploaded but the Reel record could not be created; object was retained" }, 500);
      }
    }
    return json({ ok: true, key, size: saved.size, url: videoUrl }, 201);
  } catch (error) {
    console.error("Multipart completion failed:", error);
    return json({ error: "Could not complete video upload" }, 400);
  }
}

async function abortVideoMultipart(request, env, user, url, kind) {
  const key = url.searchParams.get("key");
  const uploadId = url.searchParams.get("uploadId");
  if (!validateMultipartOwnership(key, uploadId, user, kind)) return json({ error: "Invalid upload ownership" }, 403);
  const bucket = multipartBucket(kind, env);
  if (!bucket) return json({ error: "Storage binding is not configured" }, 503);
  try {
    await bucket.resumeMultipartUpload(key, uploadId).abort();
    return json({ ok: true, aborted: true });
  } catch (error) {
    console.warn("Multipart abort could not be confirmed:", error);
    return json({ error: "Could not abort multipart upload" }, 400);
  }
}

async function routeVideoMultipart(request, env, user, url, path, kind) {
  const base = kind === "reels" ? "/reels/multipart" : "/media/multipart";
  if (path === `${base}/init` && request.method === "POST") return initVideoMultipart(request, env, user, url, kind);
  if (path === `${base}/part` && request.method === "PUT") return uploadVideoPart(request, env, user, url, kind);
  if (path === `${base}/complete` && request.method === "POST") return completeVideoMultipart(request, env, user, url, kind);
  if (path === `${base}/abort` && request.method === "DELETE") return abortVideoMultipart(request, env, user, url, kind);
  return null;
}


async function variantManifestKey(sourceKey) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sourceKey));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const owner = sourceKey.split("/")[0];
  return `${owner}/variants/${hex}.json`;
}

async function handleVariantManifest(request, env, user, url) {
  const requestBody = request.method === "POST" ? await request.json().catch(() => null) : null;
  const sourceKey = request.method === "GET"
    ? String(url.searchParams.get("sourceKey") || "")
    : String(requestBody?.sourceKey || "");
  if (!isSafeObjectKey(sourceKey) || !/^[0-9a-f-]{20,40}\/posts\//i.test(sourceKey)) {
    return json({ error: "Invalid source media key" }, 400);
  }
  const bucket = env.MEDIA_BUCKET;
  if (!bucket) return json({ error: "Storage binding is not configured" }, 503);
  const manifestKey = await variantManifestKey(sourceKey);

  if (request.method === "GET") {
    const manifest = await bucket.get(manifestKey);
    if (!manifest) return json({ ready: false, variants: [] }, 200, { "Cache-Control": "no-store" });
    const body = await manifest.json().catch(() => null);
    if (!body || body.sourceKey !== sourceKey || !Array.isArray(body.variants)) return json({ error: "Invalid variant manifest" }, 500);
    return json({ ready: true, variants: body.variants }, 200, { "Cache-Control": "public, max-age=60" });
  }

  if (!user) return json({ error: "Unauthorized" }, 401);
  if (!sourceKey.startsWith(`${user.id}/posts/`)) return json({ error: "Source ownership mismatch" }, 403);
  const source = await bucket.head(sourceKey);
  if (!source || source.customMetadata?.owner !== user.id) return json({ error: "Original video ownership could not be verified" }, 403);
  const variants = requestBody?.variants;
  if (!Array.isArray(variants) || variants.length < 1 || variants.length > 3) return json({ error: "Invalid variants list" }, 400);
  const normalized = [];
  const seen = new Set();
  for (const item of variants) {
    const quality = Number(item?.quality);
    const key = String(item?.key || "");
    if (![360, 480, 720].includes(quality) || seen.has(quality) || !key.startsWith(`${user.id}/variants/`) || !isSafeObjectKey(key)) {
      return json({ error: "Invalid variant entry" }, 400);
    }
    const object = await bucket.head(key);
    if (!object || object.customMetadata?.owner !== user.id || object.customMetadata?.folder !== "variants") {
      return json({ error: "Variant ownership could not be verified" }, 403);
    }
    seen.add(quality);
    normalized.push({ quality, key, url: `${url.origin}/media/${key}`, size: object.size });
  }
  normalized.sort((a, b) => a.quality - b.quality);
  const document = { sourceKey, variants: normalized, updatedAt: new Date().toISOString() };
  await bucket.put(manifestKey, JSON.stringify(document), {
    httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: "public, max-age=60" },
    customMetadata: { owner: user.id, sourceKey, type: "video-variants-manifest" },
  });
  return json({ ok: true, ready: true, variants: normalized }, 201);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, "") || "/";

      if (path === "/hovod/playback/ticket" && request.method === "POST") {
        return handleHovodTicket(request, env);
      }
      if (path === "/hovod/playback/refresh" && request.method === "POST") {
        return handleHovodRefresh(request, env);
      }

      if (path === "/" && request.method === "GET") {
        return json({
          ok: true,
          service: "egybook-media-api",
          mediaBucket: "egybook-media",
          reelsBucket: "egybook-reels",
        });
      }

      if (path === "/media/variants/manifest" && (request.method === "GET" || request.method === "POST")) {
        const manifestUser = request.method === "POST" ? await getUser(request, env) : null;
        if (request.method === "POST" && !manifestUser) return json({ error: "Unauthorized" }, 401);
        return handleVariantManifest(request, env, manifestUser, url);
      }

      if (path.startsWith("/media/") && (request.method === "GET" || request.method === "HEAD" || request.method === "DELETE")) {
        let key;
        try {
          key = decodeURIComponent(path.slice(7));
        } catch {
          return json({ error: "Invalid media key" }, 400);
        }
        if (request.method === "GET" || request.method === "HEAD") return serveMedia(key, env, request, request.method === "HEAD");

        const deletingUser = await getUser(request, env);
        if (!deletingUser) return json({ error: "Unauthorized" }, 401);
        return deleteMedia(key, env, deletingUser, request, url);
      }

      const user =
        request.method === "GET" ? null : await getUser(request, env);
      if (request.method !== "GET" && !user) {
        return json({ error: "Unauthorized" }, 401);
      }

      const mediaMultipart = await routeVideoMultipart(request, env, user, url, path, "media");
      if (mediaMultipart) return mediaMultipart;
      const reelsMultipart = await routeVideoMultipart(request, env, user, url, path, "reels");
      if (reelsMultipart) return reelsMultipart;

      if (path === "/media" && request.method === "POST") {
        return uploadMedia(request, env, user, url);
      }

      const sql = neon(env.NEON_DATABASE_URL);

      if (path === "/reels" && request.method === "GET") {
        const limit = Math.min(
          Math.max(Number(url.searchParams.get("limit") || 20), 1),
          50
        );
        const rows = await sql`
          SELECT r.id, r.user_id, r.video_url, r.thumbnail_url, r.caption, r.created_at,
            (SELECT COUNT(*)::int FROM reel_likes l WHERE l.reel_id = r.id) AS likes_count,
            (SELECT COUNT(*)::int FROM reel_comments c WHERE c.reel_id = r.id) AS comments_count
          FROM reels r ORDER BY r.created_at DESC LIMIT ${limit}
        `;
        return json({ reels: rows });
      }

      if (path === "/reels" && request.method === "POST") {
        const form = await request.formData();
        const file = form.get("video");
        const caption = String(form.get("caption") || "").slice(0, 2000);
        if (!(file instanceof File)) {
          return json({ error: "Video field is required" }, 400);
        }
        if (!file.type.startsWith("video/")) {
          return json({ error: "Only video files are allowed" }, 415);
        }
        if (file.size > 100 * 1024 * 1024) {
          return json({ error: "Maximum video size is 100 MB" }, 413);
        }
        if (!env.REELS_BUCKET) {
          return json({ error: "REELS_BUCKET binding is not configured" }, 503);
        }

        const filename = safeFilename(file.name || "video.mp4");
        const key = `reels/${user.id}/${crypto.randomUUID()}-${filename}`;
        await env.REELS_BUCKET.put(key, file.stream(), {
          httpMetadata: { contentType: file.type },
          customMetadata: { owner: user.id },
        });
        const videoUrl = `${url.origin}/media/${key}`;

        try {
          const rows = await sql`
            INSERT INTO reels (user_id, video_url, caption)
            VALUES (${user.id}, ${videoUrl}, ${caption})
            RETURNING id, user_id, video_url, thumbnail_url, caption, created_at
          `;
          return json({ reel: rows[0] }, 201);
        } catch (error) {
          await env.REELS_BUCKET.delete(key);
          throw error;
        }
      }

      const like = path.match(/^\/reels\/(\d+)\/like$/);
      if (like && request.method === "POST") {
        const rows = await sql`
          INSERT INTO reel_likes (reel_id, user_id)
          VALUES (${Number(like[1])}, ${user.id})
          ON CONFLICT (reel_id, user_id) DO NOTHING
          RETURNING id
        `;
        return json({ liked: true, created: rows.length > 0 });
      }
      if (like && request.method === "DELETE") {
        await sql`
          DELETE FROM reel_likes
          WHERE reel_id = ${Number(like[1])} AND user_id = ${user.id}
        `;
        return json({ liked: false });
      }

      const comments = path.match(/^\/reels\/(\d+)\/comments$/);
      if (comments && request.method === "GET") {
        const rows = await sql`
          SELECT id, reel_id, user_id, comment_text, created_at
          FROM reel_comments
          WHERE reel_id = ${Number(comments[1])}
          ORDER BY created_at ASC LIMIT 200
        `;
        return json({ comments: rows });
      }
      if (comments && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const text = String(body.comment_text || "").trim().slice(0, 2000);
        if (!text) return json({ error: "Comment cannot be empty" }, 400);
        const rows = await sql`
          INSERT INTO reel_comments (reel_id, user_id, comment_text)
          VALUES (${Number(comments[1])}, ${user.id}, ${text})
          RETURNING id, reel_id, user_id, comment_text, created_at
        `;
        return json({ comment: rows[0] }, 201);
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      console.error("EgyBook Media API:", error);
      return json({ error: "Internal server error" }, 500);
    }
  },
};
