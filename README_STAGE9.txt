EgyBook — Stage 9 profile routing
=================================
Files:
- index.html
- styles.css
- script.js
- 404.html

Features:
- Home remains at https://egybook.github.io/Egybook/
- Profile URL pattern: https://egybook.github.io/Egybook/<username>
- The shared header displays @username while viewing a profile.
- Browser back/forward updates the view.
- 404.html forwards deep profile URLs back through index.html so GitHub Pages can restore the route after refresh.
- Profile data for another username is loaded from public.profiles by username when available.

Deployment:
Upload all four files to the root of the GitHub Pages repository, preserving exact names.
JavaScript syntax was checked with Node.js. The live Supabase/GitHub Pages behavior was not browser-tested.
