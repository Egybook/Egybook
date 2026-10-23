EgyBook — Stage 10: Header, Sidebar, MEMEZ and post routes
===========================================================

Replace these files in the GitHub Pages repository root:
- index.html
- styles.css
- script.js
- 404.html

Stage 10 changes:
- Standardized the side-drawer icons using consistent inline SVGs.
- Added a header name chip that copies the displayed account name when tapped.
- Added the EgyBook MEMEZ entry and screen with three cards; each card displays “قريبًا”.
- Added a dedicated post URL format: /Egybook/post/POST_ID. The page opens the selected post's comments, and the 404 fallback restores deep links on GitHub Pages.
- Clicking a post author's avatar/name, or a post image, opens the associated profile route.
- Clicking a comment/reply name or avatar closes comments and navigates to a profile route.
- Kept the existing dark navy/blue/cyan/purple visual identity and did not add a version footer.

Checks:
- JavaScript syntax check with `node --check script.js`.
- The live GitHub Pages and Supabase deployment has not been browser-tested.
- Comment content remains in the existing local storage model; this change does not migrate comments into a server-side database.
