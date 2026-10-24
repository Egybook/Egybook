EgyBook — Profile Isolation and Per-Account Post Counts
======================================================

Changes in this patch
- Profile posts are loaded from Supabase for the selected profile owner (user_id).
- The profile post count comes from the posts returned for that selected account, not from the current home-feed DOM.
- Other users' profile views display only posts with public visibility labels.
- Profile post loading has a request token so an older request cannot overwrite a newer profile after quick navigation.
- If the query fails, the count shows an em dash and an error state instead of incorrectly claiming the account has zero posts.

Files changed
- script.js

Important deployment/testing notes
- No database migration is included in this patch.
- Supabase RLS must allow a user to read public profile rows and public posts, while restricting private rows/posts appropriately.
- This patch does not claim to implement full private-account/friend-only visibility unless the database policies and visibility values enforce it.
- Syntax check: node --check script.js passed.
- Live Supabase and browser testing were not available in this environment. After deploying, test with two accounts that have different post counts and with private/public posts.
