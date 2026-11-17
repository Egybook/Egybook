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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const expected = Deno.env.get("EGYBOOK_PLAYBACK_AUTH_SECRET") ?? "";
  const supplied = req.headers.get("x-egybook-playback-secret") ?? "";
  if (expected.length < 32 || !constantTimeEqual(expected, supplied)) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Authorization service is not configured" }, 503);

  const body = await req.json().catch(() => null);
  const playbackId = text(body?.playbackId);
  const rawUserId = body?.userId;
  const userId = rawUserId === null || rawUserId === undefined || rawUserId === "" ? null : text(rawUserId);
  const action = text(body?.action);
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(playbackId) ||
      (userId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) ||
      !["issue", "refresh"].includes(action) || (action === "refresh" && userId === null)) return json({ allowed: false }, 400);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // This mapping is written only by trusted server-side upload/completion code.
    const { data: asset, error: assetError } = await admin
      .from("hovod_playback_assets")
      .select("playback_id,post_id,owner_id,processing_status")
      .eq("playback_id", playbackId)
      .maybeSingle();
    if (assetError || !asset || asset.processing_status !== "ready") return json({ allowed: false }, 403);

    const { data: post, error: postError } = await admin
      .from("posts")
      .select("id,user_id,visibility,audience_user_ids,excluded_user_ids,audience_list_id")
      .eq("id", asset.post_id)
      .maybeSingle();
    if (postError || !post || post.user_id !== asset.owner_id) return json({ allowed: false }, 403);

    const allowed = await canViewPost(admin, post, userId);
    if (!allowed) return json({ allowed: false }, 403);

    return json({ allowed: true, postId: post.id });
  } catch (_error) {
    // Fail closed; do not leak schema or database details to the Worker/browser.
    return json({ error: "Authorization check failed" }, 503);
  }
});

async function canViewPost(admin: any, post: any, viewerId: string | null): Promise<boolean> {
  // Mirror public.egybook_can_view_post() in Supabase exactly:
  // owner check, then legacy/public aliases, then reject anonymous viewers.
  if (viewerId !== null && viewerId === post.user_id) return true;
  const visibility = text(post.visibility).toLowerCase();
  if (["الجميع", "public", "everyone", "publico"].includes(visibility)) return true;
  if (viewerId === null) return false;

  if (visibility === "أنا فقط") return false;
  const audienceIds: string[] = Array.isArray(post.audience_user_ids) ? post.audience_user_ids : [];
  const excludedIds: string[] = Array.isArray(post.excluded_user_ids) ? post.excluded_user_ids : [];
  if (visibility === "أشخاص محددون") return audienceIds.includes(viewerId);
  if (visibility === "استثناء" && excludedIds.includes(viewerId)) return false;

  if (visibility === "قائمة مخصصة") {
    if (!post.audience_list_id) return false;
    const { data: list, error: listError } = await admin.from("custom_audience_lists")
      .select("id").eq("id", post.audience_list_id).eq("user_id", post.user_id).maybeSingle();
    if (listError || !list) return false;
    const { data: member, error: memberError } = await admin.from("custom_audience_list_members")
      .select("user_id").eq("list_id", post.audience_list_id).eq("user_id", viewerId).maybeSingle();
    return !memberError && !!member;
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
  if (visibility === "عام" || visibility === "استثناء") {
    if (visibility === "استثناء" && excludedIds.includes(viewerId)) return false;
    const { data: follow, error: followError } = await admin.from("user_follows")
      .select("follower_id").eq("follower_id", viewerId).eq("following_id", post.user_id).maybeSingle();
    return isFriend || (!followError && !!follow);
  }
  return false;
}
