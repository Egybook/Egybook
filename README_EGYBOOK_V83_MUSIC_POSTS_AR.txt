EgyBook v83 — Music Posts & Composer Improvements

Modified files:
- script.js
- styles.css
- index.html

New file:
- EGYBOOK_V83_MUSIC_POSTS_MIGRATION.sql

Included:
- Compact, isolated Audius picker.
- Choose a song, set its start time, select a clip length from 5 to 30 seconds, preview the segment, and save the selection.
- Music metadata is attached to the post payload; newly created posts show an in-post play/mute control and stop playback at the selected clip end.
- Photo picker accepts multiple images (up to 10 selected at once), allows per-image removal, and prepares a media_urls JSON array.
- Audience screen wording changed to “إعدادات المنشور”; final action reads “مشاركة”.
- Cache-busting updated to v83.

Required:
1. Run EGYBOOK_V83_MUSIC_POSTS_MIGRATION.sql in Supabase SQL Editor before publishing music metadata or multiple-image posts.
2. Verify Supabase Storage policies allow authenticated users to upload post media.
3. Test on a staging copy first. Live Audius API playback and actual mobile browser behavior were not testable here.
4. Legacy feed-loading queries have not all been updated to fetch the new fields, so the new music controls/multi-image gallery are guaranteed only for the immediate post-render path until those fetch paths are updated. Do not assume persistence display after reload is fully complete.

Git commit:
Add music posts and composer controls
