import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-egybook-playback-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});
const text = (v: unknown) => typeof v === "string" ? v.trim() : "";

function constantTimeEqual(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type PlaybackTicket = {
  aud: "hovod-playback";
  iss: "egybook";
  pid: string;
  sub: string;
  jti: string;
  iat: number;
  exp: number;
};

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const fromB64url = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

async function hmac(payloadPart: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadPart))));
}

async function mintTicket(playbackId: string, userId: string, secret: string): Promise<PlaybackTicket & { token: string }> {
  const now = Math.floor(Date.now() / 1000);
  const payload: PlaybackTicket = {
    aud: "hovod-playback", iss: "egybook", pid: playbackId, sub: userId,
    jti: crypto.randomUUID().replace(/-/g, ""), iat: now, exp: now + 600,
  };
  const payloadPart = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return { ...payload, token: `${payloadPart}.${await hmac(payloadPart, secret)}` };
}

async function verifyTicket(token: string, playbackId: string, secret: string): Promise<PlaybackTicket | null> {
  if (!token || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadPart, signaturePart] = parts;
  let supplied: Uint8Array;
  let payload: PlaybackTicket;
  try {
    supplied = fromB64url(signaturePart);
    payload = JSON.parse(new TextDecoder().decode(fromB64url(payloadPart)));
  } catch { return null; }
  const expected = fromB64url(await hmac(payloadPart, secret));
  if (supplied.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < supplied.length; i++) diff |= supplied[i] ^ expected[i];
  const now = Math.floor(Date.now() / 1000);
  if (diff !== 0 || payload.aud !== "hovod-playback" || payload.iss !== "egybook" ||
      payload.pid !== playbackId || typeof payload.sub !== "string" || !payload.sub ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(payload.jti) || !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.exp) || payload.iat > now + 15 || payload.exp <= now ||
      payload.exp - payload.iat > 600 || payload.iat < now - 600) return null;
  return payload;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // This endpoint is server-to-server only. The caller must be the trusted Hovod
  // Worker/API, never browser JavaScript. Keep both secrets out of client code.
  const expectedAuth = Deno.env.get("EGYBOOK_PLAYBACK_AUTH_SECRET") ?? "";
  const suppliedAuth = req.headers.get("x-egybook-playback-secret") ?? "";
  if (expectedAuth.length < 32 || !constantTimeEqual(expectedAuth, suppliedAuth)) {
    return json({ error: "Unauthorized" }, 401);
  }
  const ticketSecret = Deno.env.get("PLAYBACK_TOKEN_SECRET") ?? "";
  if (ticketSecret.length < 32) return json({ error: "Ticket signing is not configured" }, 503);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Authorization service is not configured" }, 503);

  const body = await req.json().catch(() => null);
  const playbackId = text(body?.playbackId);
  const userId = text(body?.userId);
  const action = text(body?.action);
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(playbackId) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId) ||
      !["issue", "refresh"].includes(action)) return json({ error: "Invalid request" }, 400);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    if (action === "refresh") {
      const currentToken = text(body?.currentTicket);
      const current = await verifyTicket(currentToken, playbackId, ticketSecret);
      if (!current || current.sub !== userId || (body?.currentTicketId && body.currentTicketId !== current.jti)) {
        return json({ error: "Invalid current playback ticket" }, 403);
      }
    }

    // The mapping is written only by trusted server-side upload/completion code.
    const { data: asset, error: assetError } = await admin
      .from("hovod_playback_assets")
      .select("playback_id,post_id,owner_id,processing_status")
      .eq("playback_id", playbackId)
      .maybeSingle();
    if (assetError || !asset || asset.processing_status !== "ready") return json({ error: "Playback unavailable" }, 403);

    const { data: post, error: postError } = await admin
      .from("posts")
      .select("id,user_id,visibility,audience_user_ids,excluded_user_ids,audience_list_id")
      .eq("id", asset.post_id)
      .maybeSingle();
    if (postError || !post || post.user_id !== asset.owner_id) return json({ error: "Playback unavailable" }, 403);

    const allowed = await canViewPost(admin, post, userId);
    if (!allowed) return json({ error: "Playback no longer authorized" }, 403);

    const minted = await mintTicket(playbackId, userId, ticketSecret);
    return json({ ticket: minted.token, expiresAt: minted.exp, refreshAfterSec: 540 });
  } catch (_error) {
    // Fail closed; do not leak schema or database details to Hovod/browser.
    return json({ error: "Authorization check failed" }, 503);
  }
});

async function canViewPost(admin: any, post: any, viewerId: string): Promise<boolean> {
  if (viewerId === post.user_id) return true;
  const visibility = text(post.visibility);
  const publicValues = new Set(["الجميع", "public", "everyone", "publico"]);
  if (publicValues.has(visibility.toLowerCase())) return true;
  if (visibility === "أنا فقط") return false;

  const audienceIds: string[] = Array.isArray(post.audience_user_ids) ? post.audience_user_ids : [];
  const excludedIds: string[] = Array.isArray(post.excluded_user_ids) ? post.excluded_user_ids : [];
  if (visibility === "أشخاص محددون") return audienceIds.includes(viewerId);
  if (visibility === "استثناء" && excludedIds.includes(viewerId)) return false;

  if (visibility === "قائمة مخصصة") {
    if (!post.audience_list_id) return false;
    // A list is valid only when it belongs to the post owner. This prevents
    // a forged/stale audience_list_id from granting membership in another user's list.
    const { data: audienceList, error: listError } = await admin.from("custom_audience_lists")
      .select("id").eq("id", post.audience_list_id).eq("user_id", post.user_id).maybeSingle();
    if (listError || !audienceList) return false;
    const { data, error } = await admin.from("custom_audience_list_members")
      .select("user_id").eq("list_id", post.audience_list_id).eq("user_id", viewerId).maybeSingle();
    return !error && !!data;
  }

  if (visibility === "الأصدقاء المقربون") {
    const { data, error } = await admin.from("close_friends")
      .select("friend_id").eq("user_id", post.user_id).eq("friend_id", viewerId).maybeSingle();
    return !error && !!data;
  }

  const { data: friendship, error: friendshipError } = await admin.from("friend_requests")
    .select("id").eq("status", "accepted")
    .or(`and(sender_id.eq.${post.user_id},receiver_id.eq.${viewerId}),and(sender_id.eq.${viewerId},receiver_id.eq.${post.user_id})`)
    .limit(1);
  if (friendshipError) return false;
  const isFriend = !!friendship?.length;

  if (visibility === "الأصدقاء") return isFriend;
  if (visibility === "عام") {
    const { data: follow, error: followError } = await admin.from("user_follows")
      .select("follower_id").eq("follower_id", viewerId).eq("following_id", post.user_id).maybeSingle();
    return isFriend || (!followError && !!follow);
  }
  if (visibility === "استثناء") {
    const { data: follow, error: followError } = await admin.from("user_follows")
      .select("follower_id").eq("follower_id", viewerId).eq("following_id", post.user_id).maybeSingle();
    return isFriend || (!followError && !!follow);
  }
  return false;
}
