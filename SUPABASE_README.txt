EgyBook — Supabase setup and authentication
==========================================

This package contains the existing EgyBook site plus an improved Arabic neon login/signup interface.

WHAT IS INCLUDED
- Email/password login and signup through Supabase Auth.
- Signup fields for full name and username.
- Password confirmation and password recovery email flow.
- Existing social feed files preserved.
- SQL foundation for secure owner/admin roles, verification requests, verified badges, and editable paid-verification settings.

BEFORE DEPLOYING
1. Open Supabase Dashboard > SQL Editor.
2. Review SUPABASE_SETUP.sql and run it. It preserves the existing profiles table, adds cover_url if missing, grants the required table privileges, and sets up row-level and Storage policies for posts and profile images plus verification tables. Existing data is not intentionally deleted.
3. Upload the files index.html, styles.css, and script.js to the root of your GitHub Pages repository (keep their names exactly).
4. Test signup using an email address you can access. If email confirmation is enabled, confirm the email before logging in.

MAKE THE OWNER ACCOUNT
1. First create the owner's account through the website signup form. Use the intended owner email, full name, and username.
2. In Supabase Dashboard > Authentication > Users, locate that account and copy its UID.
3. In SQL Editor, run the following query after replacing the placeholder UUID with the real UID:

   insert into public.user_roles (user_id, role)
   values ('PASTE_OWNER_AUTH_UID_HERE'::uuid, 'owner')
   on conflict (user_id) do update set role = 'owner';

4. Then run this query with the same real UID:

   insert into public.verified_accounts (user_id, verified_by, verification_type)
   values ('PASTE_OWNER_AUTH_UID_HERE'::uuid, 'PASTE_OWNER_AUTH_UID_HERE'::uuid, 'owner')
   on conflict (user_id) do update set verification_type = 'owner', expires_at = null;

SECURITY NOTES
- Never put a Supabase service_role/secret key in browser JavaScript.
- Do not assign owner privileges based on an email or username in client-side code.
- Only use the real Auth UID when assigning the owner role in SQL.
- Paid verification is NOT live payment processing yet. Prices are stored as editable settings, but a real payment provider and server-side payment verification must be integrated before accepting money.
- Verification request tables are a backend foundation; the full admin dashboard/workflow still needs to be implemented and tested before public launch.


PROFILE AVATAR AND COVER CLOUD STORAGE
- Profile and cover images are uploaded to the existing public `post-media` bucket under `<auth-user-id>/profile/`.
- The `profiles.avatar_url` and `profiles.cover_url` columns store the public URLs.
- Run the updated SUPABASE_SETUP.sql in Supabase SQL Editor to add `cover_url` if missing, grant required table privileges, and ensure Storage policies are present. Review it before running.
- Users must be signed in to upload these images. Do not make the bucket or policies private without changing the URL retrieval code.
