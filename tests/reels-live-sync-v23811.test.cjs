'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'cloudflare/egybook-reels-api/worker.js'), 'utf8');
const cacheSource = fs.readFileSync(path.join(root, 'egybook-reels-source-cache.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');

// A known-post lookup is authenticated and explicitly guarded by Supabase RLS.
assert.match(worker, /const protectedReelRead\s*=\s*request\.method\s*===\s*"GET"[\s\S]*by-post/,
  'the new GET by-post route is included in the authenticated read gate');
assert.match(worker, /if\s*\(postLink\s*&&\s*request\.method\s*===\s*"GET"\)[\s\S]*getSupabaseVisiblePostOwners[\s\S]*JOIN reels r[\s\S]*r\.user_id[\s\S]*Cache-Control/,
  'the by-post route checks post visibility before returning linked Neon media rows');
assert.match(script, /function\s+scheduleRealtimeReelSync\([\s\S]*?reconcileRealtimeReelPost/,
  'Realtime video posts are reconciled through one per-viewer/post task');
assert.match(script, /reels\/by-post\/\$\{encodeURIComponent\(postId\)\}[\s\S]*cache:'no-store'/,
  'the frontend performs a no-store lookup for the exact new post');
assert.match(script, /response\.status===404[\s\S]*missingPayload\.error==='POST_NOT_VISIBLE'[\s\S]*post-not-visible/,
  'RLS-denied posts stop immediately rather than consuming all of the bounded Neon-link retries');
const visibleQueryIndex = script.indexOf("const visibleResult=await supabase.from('posts')");
const accountRecheckIndex = script.indexOf("if(String(currentUser?.id||'')!==String(viewerId))return {added:0,reason:'account-changed'};", visibleQueryIndex);
const visiblePostIndex = script.indexOf('const visiblePost=visibleResult.data;', visibleQueryIndex);
assert.ok(visibleQueryIndex >= 0 && accountRecheckIndex > visibleQueryIndex && visiblePostIndex > accountRecheckIndex,
  'a viewer account switch during the RLS verification cannot inject the old account catalog into a new viewer queue');
assert.match(script, /function\s+addPublishedReelsToSource[\s\S]*?const authorId=String\(postData\?\.user_id\|\|''\)[\s\S]*row\.user_id===authorId[\s\S]*row\.post_id===postId/,
  'the queue upsert accepts a different author only when the Reel belongs to that RLS-visible post');
assert.match(script, /if\(isRealtimeVideoPost\(row\)\)void scheduleRealtimeReelSync\(row\)/,
  'new video posts from Supabase Realtime trigger Reels reconciliation');
assert.match(script, /function\s+refreshActiveEvpQueue\([\s\S]*?const activeId=String\(activeEvpPost\.dataset\.postId\|\|''\)[\s\S]*?activeEvpQueueIndex=index/,
  'prepending a Reel re-resolves the currently playing post index instead of changing the active video');
assert.match(script, /catalogInsertedIds:new Set\(\)[\s\S]*requestCatalogInsertedIds=context==='reels'\?new Set\(state\.catalogInsertedIds\|\|\[\]\)[\s\S]*responseReelIds=new Set\(videoRows\.map[\s\S]*!responseReelIds\.has\(String\(id\)\)/,
  'pagination advances only for Realtime Reels missing from the in-flight catalog response, preventing skipped older rows');
assert.match(script, /__egybookRealtimeReelRetryDelays\s*=\s*\[180,\s*420,\s*850,\s*1500,\s*2600\]/,
  'short bounded retries cover the post-insert/Neon-link timing window');
assert.ok(html.includes('script.js?v=247-profile-render-budget'), 'HTML uses the new script cache key');
assert.ok(sw.includes('script.js?v=247-profile-render-budget'), 'Service Worker precaches the new script cache key');

class MemorySessionStorage {
  constructor() { this.values = new Map(); }
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
}
const sessionStorage = new MemorySessionStorage();
const window = {};
vm.runInNewContext(cacheSource, { window, sessionStorage, Date, Map, Set, String, Number, Math, Object, URL });
const cache = window.EgyBookReelsSourceCache;
assert.ok(cache && typeof cache.upsertPublished === 'function', 'Reels cache API is available');

const newReel = { id: '901', user_id: 'author-9', video_url: 'https://media.example/reels/901.mp4', post_id: 'post-901' };
const firstInsert = cache.upsertPublished('viewer-1', [newReel], 20);
assert.equal(firstInsert.payload, null, 'an incomplete synthetic cache page is not written when no full page is known');
assert.equal(cache.read('viewer-1', 0), null, 'the first real catalog page remains a network fetch');

const baseline = Array.from({ length: 20 }, (_, index) => ({
  id: String(index + 1), user_id: 'author-old',
  video_url: `https://media.example/reels/${index + 1}.mp4`, post_id: `post-${index + 1}`
}));
cache.write('viewer-1', 0, { reels: baseline, has_more: true, next_offset: 20 });
cache.write('viewer-2', 0, { reels: [baseline[0]], has_more: false, next_offset: 1 });
const merged = cache.upsertPublished('viewer-1', [newReel], 20);
assert.equal(merged.payload.reels.length, 20, 'the refreshed first page remains page-sized');
assert.equal(merged.payload.reels[0].id, '901', 'the new Reel is placed at the head');
assert.equal(merged.payload.next_offset, 20, 'pagination resumes after the actual cached page length');
assert.equal(merged.payload.has_more, true, 'existing pagination continuation is preserved');
assert.equal(cache.read('viewer-2', 0).payload.reels[0].id, '1', 'another viewer cache is untouched');

console.log('V238.1.1 Reels Live Sync: PASS 21 assertions');
