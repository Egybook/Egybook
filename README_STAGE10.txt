EgyBook — Stage 10: Header and Sidebar
=====================================

Replace these three files in the GitHub Pages repository root:
- index.html
- styles.css
- script.js

Changes:
- Added a premium dark/neon EgyBook side drawer with profile, friends, notifications,
  saved items, activity, dashboard, settings/privacy, appearance, language, help/support,
  and sign-out actions.
- The name chip in the header copies its displayed name when clicked while signed in;
  it does not navigate to the profile.
- Removed no working page content and did not add a version footer.
- Sidebar profile name, handle, and avatar follow the loaded profile.

Notes:
- Some menu destinations (activity log, advanced dashboard, appearance/language settings)
  show an explanatory message because those full features are not implemented yet.
- JavaScript syntax was checked with `node --check script.js`.
- The live GitHub Pages/Supabase deployment was not browser-tested.
