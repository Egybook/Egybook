const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const root = path.resolve(__dirname, '..');
  const workerDir = path.join(root, 'cloudflare', 'egybook-reels-api');
  const workerPath = path.join(workerDir, 'worker.js');
  const helper = await import(pathToFileURL(path.join(workerDir, 'egybook-media-safety-v2381.mjs')).href);
  const workerSource = fs.readFileSync(workerPath, 'utf8');
  const appSource = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
  const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const swSource = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');

  const env = { REELS_BUCKET: { name: 'reels' }, MEDIA_BUCKET: { name: 'media' } };
  assert.equal(helper.isUnifiedVideoObjectKey('videos/user/clip.mp4'), true);
  assert.equal(helper.isUnifiedVideoObjectKey('reels/user/clip.mp4'), true);
  assert.equal(helper.isUnifiedVideoObjectKey('user/posts/image.webp'), false);
  assert.equal(helper.isUnifiedVideoObjectKey('user/variants/360.mp4'), false);
  assert.equal(helper.selectMediaBucketForKey('videos/user/clip.mp4', env), env.REELS_BUCKET);
  assert.equal(helper.selectMediaBucketForKey('reels/user/clip.mp4', env), env.REELS_BUCKET);
  assert.equal(helper.selectMediaBucketForKey('user/posts/image.webp', env), env.MEDIA_BUCKET);
  assert.equal(helper.selectMediaBucketForKey('user/variants/360.mp4', env), env.MEDIA_BUCKET);

  const sampleRows = [
    { id: 1, post_id: 'visible-post' },
    { id: 2, post_id: 'private-post' },
    { id: 3, post_id: null },
    { id: 4, post_id: 'deleted-or-unknown-post' },
  ];
  const filtered = helper.filterReelCatalogRowsForViewer(sampleRows, new Set(['visible-post']));
  assert.deepEqual(filtered.map(row => row.id), [1, 3],
    'only RLS-visible linked posts and unlinked standalone Reels remain in the authenticated catalog');
  assert.deepEqual(helper.filterReelCatalogRowsForViewer(sampleRows, []).map(row => row.id), [3],
    'unknown linked posts fail closed while unlinked standalone items keep their existing authenticated-catalog behavior');

  // Exercise the actual Worker handler with mocked Supabase/Neon/R2 boundaries.
  // No production credentials or services are accessed by this test.
  const state = {
    visiblePosts: ['visible-post'],
    visibleOwners: { 'visible-post': 'owner-2' },
    catalogRows: sampleRows,
    linkedRows: [
      { id: 71, user_id: 'owner-2', video_url: 'https://worker.test/media/videos/owner-2/public.mp4', thumbnail_url: '', caption: 'Visible reel', created_at: '2026-11-23T18:00:00Z', post_id: 'visible-post' },
      { id: 73, user_id: 'foreign-owner', video_url: 'https://worker.test/media/videos/foreign-owner/wrong-link.mp4', thumbnail_url: '', caption: 'Mismatched owner link', created_at: '2026-11-23T18:02:00Z', post_id: 'visible-post' },
      { id: 72, user_id: 'owner-3', video_url: 'https://worker.test/media/videos/owner-3/private.mp4', thumbnail_url: '', caption: 'Private reel', created_at: '2026-11-23T18:01:00Z', post_id: 'private-post' },
    ],
    detailRows: [{ id: 2, user_id: 'user-1', video_url: 'https://worker.test/media/videos/user-1/private.mp4', post_id: 'private-post', likes_count: 0, comments_count: 0, shares_count: 0 }],
    deleteRecords: [{ id: '99', user_id: 'user-1', post_id: 'deleted-post', link_user_id: 'user-1' }],
    existingPosts: [],
    deletedRows: [{ id: '99' }],
    neonCalls: [],
    reelsBucket: { deleted: [], heads: 0 },
    mediaBucket: { deleted: [], heads: 0 },
    auxiliaryReferenceTable: '',
    auxiliaryFailureTable: '',
  };
  function neonStub() {
    return async (strings, ...values) => {
      const query = strings.join(' ').replace(/\s+/g, ' ').toLowerCase();
      state.neonCalls.push({ query, values });
      if (query.includes('delete from reels')) return state.deletedRows;
      if (query.includes('from reel_post_links l') && query.includes('join reels r') && query.includes('where l.post_id')) {
        return state.linkedRows.filter(row => String(row.post_id) === String(values[0]) && String(row.user_id) === String(values[1]));
      }
      if (query.includes('from reels r') && query.includes('where r.video_url')) return state.deleteRecords;
      if (query.includes('from reels r') && query.includes('where r.id =')) return state.detailRows;
      if (query.includes('from reels r') && query.includes('order by r.created_at')) return state.catalogRows;
      return [];
    };
  }
  function makeBucket(bucketState, isReels) {
    return {
      async head() {
        bucketState.heads++;
        if (bucketState.deleted.length) return null;
        return { size: 1234, customMetadata: { owner: 'user-1' }, httpEtag: 'etag-1', writeHttpMetadata() {} };
      },
      async delete(key) { bucketState.deleted.push(key); },
    };
  }
  const testEnv = {
    SUPABASE_URL: 'https://supabase.example',
    SUPABASE_ANON_KEY: 'anon-test-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-test-key',
    NEON_DATABASE_URL: 'postgres://test.invalid/egybook',
    REELS_BUCKET: makeBucket(state.reelsBucket, true),
    MEDIA_BUCKET: makeBucket(state.mediaBucket, false),
  };

  const originalFetch = global.fetch;
  global.__EGYBOOK_TEST_NEON = neonStub;
  const tempWorkerPath = path.join(workerDir, `worker.v2381.test-harness-${process.pid}.mjs`);
  const testableWorkerSource = workerSource.replace(
    'import { neon } from "@neondatabase/serverless";',
    'const neon = globalThis.__EGYBOOK_TEST_NEON;'
  );
  assert.notEqual(testableWorkerSource, workerSource, 'the test harness replaces the external Neon adapter only in its temporary copy');
  fs.writeFileSync(tempWorkerPath, testableWorkerSource);

  global.fetch = async (input, init = {}) => {
    const requestUrl = new URL(String(input));
    const headers = new Headers(init.headers || {});
    if (requestUrl.pathname === '/auth/v1/user') {
      return Response.json({ id: 'user-1', aud: 'authenticated' });
    }
    if (requestUrl.pathname === '/rest/v1/posts') {
      const apikey = headers.get('apikey');
      if (apikey === 'service-test-key') {
        const postId = (requestUrl.searchParams.get('id') || '').replace(/^eq\./, '');
        return Response.json(state.existingPosts.includes(postId) ? [{ id: postId }] : []);
      }
      const visible = new Set(state.visiblePosts);
      const filter = requestUrl.searchParams.get('id') || '';
      const requested = filter.startsWith('in.(')
        ? filter.slice(4, -1).split(',')
        : [filter.replace(/^eq\./, '')];
      return Response.json(requested.filter(id => visible.has(id)).map(id => requestUrl.searchParams.get('select') === 'id,user_id'
        ? ({ id, user_id: state.visibleOwners[id] }) : ({ id })));
    }
    if (requestUrl.pathname === '/rest/v1/rpc/egybook_media_url_is_referenced') return Response.json(false);
    const auxiliaryTable = requestUrl.pathname.match(/^\/rest\/v1\/(photo_album_items|saved_photos|profile_media_history)$/)?.[1];
    if (auxiliaryTable) {
      if (state.auxiliaryFailureTable === auxiliaryTable) return new Response('reference lookup failed', { status: 500 });
      return Response.json(state.auxiliaryReferenceTable === auxiliaryTable ? [{ id: 'aux-reference' }] : []);
    }
    return new Response('Not mocked', { status: 404 });
  };

  try {
    const { default: worker } = await import(`${pathToFileURL(tempWorkerPath).href}?run=${Date.now()}`);
    const authHeader = { Authorization: 'Bearer test-access-token' };

    const catalogResponse = await worker.fetch(
      new Request('https://worker.test/reels?limit=20&offset=0', { headers: authHeader }),
      testEnv
    );
    assert.equal(catalogResponse.status, 200);
    assert.deepEqual((await catalogResponse.json()).reels.map(row => row.id), [1, 3],
      'actual Worker catalog hides linked posts not visible under Supabase RLS');

    const anonymousCatalogResponse = await worker.fetch(
      new Request('https://worker.test/reels?limit=20&offset=0'),
      testEnv
    );
    assert.equal(anonymousCatalogResponse.status, 401,
      'actual Worker catalog rejects unauthenticated reads');

    const visiblePostReelsResponse = await worker.fetch(
      new Request('https://worker.test/reels/by-post/visible-post', { headers: authHeader }) ,
      testEnv
    );
    assert.equal(visiblePostReelsResponse.status, 200,
      'read-only post-to-Reels lookup allows an authenticated RLS-visible post');
    assert.deepEqual((await visiblePostReelsResponse.json()).reels.map(row => row.id), [71],
      'read-only post-to-Reels lookup returns only the linked row for the requested visible post');
    assert.ok(state.neonCalls.some(call => call.query.includes('r.user_id =') && call.query.includes('l.user_id =')),
      'read-only post-to-Reels lookup limits returned media to the verified post owner');
    assert.deepEqual((await worker.fetch(new Request('https://worker.test/reels/by-post/visible-post', { headers: authHeader }), testEnv).then(response => response.json())).reels.map(row => row.id), [71],
      'a mismatched reel owner is not returned even when the linked post itself is visible');

    const privatePostReelsResponse = await worker.fetch(
      new Request('https://worker.test/reels/by-post/private-post', { headers: authHeader }),
      testEnv
    );
    assert.equal(privatePostReelsResponse.status, 404,
      'read-only post-to-Reels lookup hides a linked Reel when Supabase RLS denies its post');
    assert.equal((await privatePostReelsResponse.json()).error, 'POST_NOT_VISIBLE',
      'the lookup distinguishes an RLS-denied post from a temporarily missing Neon link without revealing its existence');

    const anonymousPostReelsResponse = await worker.fetch(
      new Request('https://worker.test/reels/by-post/visible-post'),
      testEnv
    );
    assert.equal(anonymousPostReelsResponse.status, 401,
      'read-only post-to-Reels lookup rejects unauthenticated reads');

    const detailResponse = await worker.fetch(
      new Request('https://worker.test/reels/2', { headers: authHeader }),
      testEnv
    );
    assert.equal(detailResponse.status, 404,
      'actual Worker hides single-Reel details for a linked post the viewer cannot read');

    const deleteResponse = await worker.fetch(
      new Request('https://worker.test/media/videos/user-1/clip.mp4', { method: 'DELETE', headers: authHeader }),
      testEnv
    );
    assert.equal(deleteResponse.status, 200,
      'actual Worker can remove an unreferenced video after the post and Neon link are gone');
    assert.deepEqual(state.reelsBucket.deleted, ['videos/user-1/clip.mp4'],
      'actual Worker deletes feed video bytes from REELS_BUCKET');
    assert.deepEqual(state.mediaBucket.deleted, [],
      'actual Worker does not accidentally target MEDIA_BUCKET for feed video bytes');
    assert.ok(state.neonCalls.some(call => call.query.includes('delete from reels')),
      'actual Worker removes the owner-matched orphaned Neon video record before R2 deletion');

    const priorNeonCallCount = state.neonCalls.length;
    const imageDeleteResponse = await worker.fetch(
      new Request('https://worker.test/media/user-1/posts/photo.webp', { method: 'DELETE', headers: authHeader }),
      testEnv
    );
    assert.equal(imageDeleteResponse.status, 200,
      'actual Worker preserves the existing image-delete path');
    assert.deepEqual(state.mediaBucket.deleted, ['user-1/posts/photo.webp'],
      'actual Worker continues to remove image bytes from MEDIA_BUCKET');
    assert.equal(state.neonCalls.length, priorNeonCallCount,
      'image deletion does not invoke the Neon video-record cleanup path');

    state.mediaBucket.deleted.length = 0;
    state.auxiliaryReferenceTable = 'photo_album_items';
    const referencedImageResponse = await worker.fetch(
      new Request('https://worker.test/media/user-1/posts/photo.webp', { method: 'DELETE', headers: authHeader }),
      testEnv
    );
    assert.equal(referencedImageResponse.status, 409,
      'actual Worker protects images retained by a photo album');
    assert.deepEqual(state.mediaBucket.deleted, [],
      'R2 image bytes are retained while an auxiliary collection references them');
    state.auxiliaryReferenceTable = '';

    state.reelsBucket.deleted.length = 0;
    state.auxiliaryReferenceTable = 'saved_photos';
    const referencedVideoResponse = await worker.fetch(
      new Request('https://worker.test/media/videos/user-1/clip.mp4', { method: 'DELETE', headers: authHeader }),
      testEnv
    );
    assert.equal(referencedVideoResponse.status, 409,
      'actual Worker protects videos still referenced by saved-photo or other auxiliary collections');
    assert.deepEqual(state.reelsBucket.deleted, [],
      'R2 video bytes are retained when an auxiliary Supabase reference exists');

    state.auxiliaryReferenceTable = '';
    state.auxiliaryFailureTable = 'profile_media_history';
    const originalConsoleError = console.error;
    console.error = () => {};
    let referenceFailureResponse;
    try {
      referenceFailureResponse = await worker.fetch(
        new Request('https://worker.test/media/videos/user-1/clip.mp4', { method: 'DELETE', headers: authHeader }),
        testEnv
      );
    } finally {
      console.error = originalConsoleError;
    }
    assert.equal(referenceFailureResponse.status, 503,
      'actual Worker fails closed when a durable media reference lookup fails');
    assert.deepEqual(state.reelsBucket.deleted, [],
      'R2 video bytes are retained when reference verification is incomplete');
    state.auxiliaryFailureTable = '';

    state.reelsBucket.deleted.length = 0;
    state.existingPosts = ['deleted-post'];
    state.reelsBucket.deleted.length = 0;
    state.reelsBucket.heads = 0;
    state.neonCalls.length = 0;
    const guardedDeleteResponse = await worker.fetch(
      new Request('https://worker.test/media/videos/user-1/clip.mp4', { method: 'DELETE', headers: authHeader }),
      testEnv
    );
    assert.equal(guardedDeleteResponse.status, 409,
      'actual Worker refuses to delete media while its linked Supabase post still exists');
    assert.deepEqual(state.reelsBucket.deleted, [],
      'actual Worker retains R2 bytes when a linked post still exists');
  } finally {
    global.fetch = originalFetch;
    delete global.__EGYBOOK_TEST_NEON;
    try { fs.unlinkSync(tempWorkerPath); } catch (_) {}
  }

  assert.match(workerSource, /protectedReelRead[\s\S]*path === "\/reels"[\s\S]*getUser\(request, env\)/,
    'Reels catalog and detail reads require a verified Supabase session');
  assert.match(workerSource, /getSupabaseVisiblePostIds\([\s\S]*request\.headers\.get\("Authorization"\)/,
    'Worker checks linked post IDs using the caller JWT and Supabase RLS');
  assert.match(workerSource, /filterReelCatalogRowsForViewer\(pageRows, visiblePostIds\)/,
    'catalog media URLs are filtered server-side before returning');
  assert.match(appSource, /const token=await getUploadAccessToken\(\)[\s\S]*Authorization: `Bearer \$\{token\}`/,
    'the existing client sends its current session token to the protected catalog endpoint');

  const deleteStart = workerSource.indexOf('async function deleteMedia(');
  const deleteEnd = workerSource.indexOf('\nasync function uploadMedia(', deleteStart);
  const deleteBlock = workerSource.slice(deleteStart, deleteEnd);
  assert.match(deleteBlock, /selectMediaBucketForKey\(key, env\)/,
    'deletion uses the same R2 bucket classifier as media serving');
  assert.ok(deleteBlock.indexOf('hasDatabaseReference(') < deleteBlock.indexOf('removeDeletedPostVideoRecord('),
    'Supabase reference checks run before Neon video cleanup');
  assert.match(deleteBlock, /hasAuxiliaryMediaReference\(mediaUrl, env\)/,
    'durable album, saved-photo, and profile-history references are checked before video deletion');

  assert.ok(indexSource.includes('script.js?v=247-profile-render-budget'), 'script URL is cache-busted for V238.1');
  assert.ok(swSource.includes('2026-11-egybook-v247-render-and-reels-load'), 'Service Worker cache version advances to V245');
  assert.ok(swSource.includes('script.js?v=247-profile-render-budget'), 'Service Worker core shell points to the V238.1 script');

  console.log('EgyBook V238.1.1 Reels Lookup Privacy + Media Delete Guard: PASS 43 assertions');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
