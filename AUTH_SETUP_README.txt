EgyBook — Auth UI Update (Stage 12)

Included:
- index.html: welcome screen, login/signup flow, email/phone method selector, Google button, phone OTP fields.
- styles.css: responsive dark navy/blue neon styling inspired by the supplied reference.
- script.js: email login/signup retained; phone OTP request/verification wired to Supabase Auth; Google OAuth button wired to Supabase OAuth.

IMPORTANT CONFIGURATION
1. Supabase Dashboard > Authentication > Sign In / Providers:
   - Keep Email enabled.
   - Enable Phone and configure a supported SMS provider with its credentials.
   - Enable Google and configure Google OAuth credentials and the callback URL for your deployed EgyBook site.
2. Phone numbers must be entered in international format, for example +2010XXXXXXXX.
3. WhatsApp delivery is NOT enabled by this code alone. Supabase phone OTP is requested as SMS (`type: sms`). To deliver OTP through WhatsApp, you must configure a provider/workflow that explicitly supports WhatsApp OTP, and wire it securely; do not put provider secrets in these public frontend files.
4. Google OAuth will only work after the provider and redirect URLs are configured in Supabase and the Google Cloud console.
5. Test with a test account before publishing. Existing database data and SQL files were not modified by this UI update.

The skyline illustration is CSS-based; it is a lightweight stylized illustration, not a photograph.
