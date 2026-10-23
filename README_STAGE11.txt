EgyBook — Stage 11 consolidated update
=====================================

Files in this bundle:
- index.html
- styles.css
- script.js
- 404.html
- SUPABASE_SETUP.sql
- SUPABASE_README.txt
- README_STAGE10.txt

Implemented in this pass:
- Preserved the EgyBook dark navy / blue / cyan / purple identity.
- Added a dedicated responsive Reels screen with local video selection and controls:
  play/pause, seek ±10 seconds, progress slider, mute, playback speed, fullscreen.
- Reels support depends on the browser's native playback formats (MP4/WebM/MOV where supported); this is not a transcoding service.
- Added defensive horizontal-overflow rules and reduced top spacing on MEMEZ.
- Preserved existing shared image viewer, profile photo options, albums, routes, and profile-update post code from the uploaded source files.

Validation performed:
- `node --check script.js` passed.
- No live GitHub Pages/Supabase browser test was possible here.

Known limitations that are NOT claimed as complete:
- The exact root cause of stray text such as `n\\...` still needs inspection in a live browser; overflow protections are not proof that the source bug is fixed.
- Multi-image upload per post, durable public photo IDs across devices, and server-side comments/reactions/follows are not implemented by the existing schema.
- The new Reels screen lets the user choose a local video for playback; it does not yet automatically build a cross-user reels feed from Supabase posts.
- Test profile updates, album routing, and viewer scroll restoration on the deployed site before public release.

Deployment:
1. Extract this ZIP.
2. Upload the changed files to the root of the existing GitHub repository, keeping exact filenames.
3. Keep Supabase credentials as the publishable key only; never use a service-role key in browser code.
4. Test mobile and desktop, including direct refresh of /Egybook/reels and photo/post routes.


Stage 12 — requested fixes
--------------------------
- Removed the account-name/login chip from the top header markup; obsolete account-chip styling is disabled.
- Added a login/account entry inside the sidebar so authentication remains reachable without restoring the topbar chip.
- Removed the topbar chip click handler and made header synchronization a harmless no-op.
- Added stronger mobile width/overflow containment and wrapping for MEMEZ, profile, posts, and dynamically rendered text.
- Validation: JavaScript syntax check and HTML/CSS structural checks performed locally. A live browser test on GitHub Pages is still required to confirm the stray `n\` fragment's exact runtime source.


STAGE 12 — UNIFIED IMAGE VIEWER
================================
Updated files: index.html, styles.css, script.js, SUPABASE_SETUP.sql, README_STAGE11.txt

What changed:
- Rebuilt the image viewer into a desktop split view with a right-hand information/actions panel and a mobile stacked layout.
- Added image counter and previous/next navigation, thumbnail strip, zoom controls, fullscreen, image dimensions, author/avatar/date/caption display.
- Added copy/share of a canonical EgyBook photo route and download via fetch/blob so public cloud images download as files when browser CORS permits.
- Added direct-route resolution for post images and profile avatar/cover URLs. Post image links use /Egybook/photo/post-<post-id>; profile image links use /Egybook/photo/avatar-<auth-user-id> and /Egybook/photo/cover-<auth-user-id>.
- Closing the viewer restores the captured scroll position; Escape and arrow-key navigation are supported.
- Added Supabase tables and RLS policies for cloud-backed post reactions/comments and standalone photo reactions/comments. Signed-in users can write; public visitors can read counts and comments.
- Reaction list displays user names and each user's reaction when the SQL relationship is available.

Required before cloud interactions work:
1. Review the appended "Unified photo viewer" sections in SUPABASE_SETUP.sql.
2. Run the updated SQL in Supabase Dashboard > SQL Editor.
3. Deploy index.html, styles.css, script.js, and SUPABASE_SETUP.sql (SQL must be run in Supabase; uploading it to GitHub does not execute it).
4. Test with a signed-in account and a public image.

Known limitations:
- Cloud reaction/comment features require the SQL migration above to be run. Without it, cloud counts/lists may show a setup error.
- Standalone profile/cover image comments/reactions use photo IDs based on the owner Auth UID. Existing legacy/local album entries may have local-only IDs, so their links are only stable if the source ID is stable.
- Downloading uses fetch/blob first; if the storage server blocks CORS, the browser fallback opens the image URL and the browser may require its own download action.
- This bundle passed `node --check script.js` and an HTML duplicate-ID check, but was not tested live against the deployed GitHub Pages site or Supabase project.


ACCOUNT DATA ISOLATION FIX
=========================
This update fixes cross-account data leakage caused by shared, unscoped browser localStorage keys and by signing in with an account whose cloud profile row was missing: the previous sign-in flow could upsert the previous browser profile into the newly signed-in account.

Changes:
- Browser caches (profile fallback, albums, post state, comments, saved photos and post drafts) now use a key scoped to the authenticated Supabase user ID.
- Legacy unscoped localStorage values are intentionally ignored so they cannot be copied into another account.
- Signing in loads the profile by the authenticated user's Auth UID. Missing profile rows are initialized from that user's Supabase Auth metadata, not from the previously active profile.
- Removed the login flow's unsafe upsert of the current browser profile into the newly signed-in account.
- Public profile fields are saved in public.profiles; phone, birthdate, gender, website and privacy are saved in owner-only public.profile_private protected by RLS.
- Profile edits synchronize public and private fields to Supabase.

IMPORTANT DEPLOYMENT
1. Review and run the complete updated SUPABASE_SETUP.sql in Supabase SQL Editor.
2. Upload the updated script.js and SUPABASE_SETUP.sql to GitHub; upload the updated README if desired.
3. Test with two separate email accounts: set different names/photos/phone numbers, sign out, sign in to the other account, and confirm no private profile fields or local albums/reactions/comments carry over.
4. Public posts from other users may still appear in the shared home feed by design. The signed-in account's own profile post list is filtered by the post's user_id.
5. Old unscoped local browser data is not automatically imported, because it cannot be safely attributed to one account. Existing cloud profiles/posts are preserved.
