EgyBook — Stage 9 route separation fix
=====================================

Files to replace in the GitHub Pages repository root:
- index.html
- styles.css
- script.js
- 404.html

Behavior:
- Main page canonical URL: https://egybook.github.io/Egybook/
- Profile URL: https://egybook.github.io/Egybook/<username>
- The username chip next to the logo is removed.
- Opening Home from a profile navigates to the canonical root URL, not /<username>#home.
- Refreshing the root stays on Home; refreshing a profile route restores that profile via 404.html.

Validation:
- JavaScript syntax can be checked with: node --check script.js
- This package has not been tested against the live GitHub Pages/Supabase deployment.
