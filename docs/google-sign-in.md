# Google sign-in and staff approval

The sign-in page offers Google only when Supabase's public Auth settings report that the Google provider is enabled. Email links remain available. No Google client secret belongs in frontend environment variables or Git.

## One-time provider setup

1. In Google Cloud / Google Auth Platform, use the organisation's project and create an OAuth client of type **Web application**. Configure branding and the audience for the staff who will sign in. If staff use personal Google accounts, do not restrict the audience to an unrelated Workspace organisation. Testing mode only permits listed test users; finish the appropriate publishing/verification before a general rollout.
2. Add the live register's exact HTTPS origin as an authorised JavaScript origin. Add this **authorised redirect URI**:
   `https://bvbrafmazxrfiaocqdjg.supabase.co/auth/v1/callback`
3. In the RoboThink-Register Supabase project, open **Authentication → Sign In / Providers → Google**. Enter the client ID and client secret directly there and enable Google. Keep email verification checks enabled; do not enable “skip nonce” or skip email verification for this web flow.
4. In **Authentication → URL Configuration**, confirm the Site URL and allowed redirect URLs include the live register origin. Use exact production URLs; do not add broad wildcard production redirects.
5. Reload the register. **Continue with Google** appears without another application deployment.

References: https://supabase.com/docs/guides/auth/social-sign-in/auth-google and https://supabase.com/docs/guides/auth/auth-identity-linking

## Existing staff

Use the Google account with the same verified email as the existing staff login. Supabase automatically links verified identities with matching emails. The existing Auth user ID, profile, role, centre assignments and history are retained. A different email is a separate identity and must not inherit access. Do not manually merge or change staff Auth IDs to work around a mismatched email.

## New staff

1. Ask the staff member to complete a Google or email-link sign-in once, verifying the exact email they will use.
2. Their account can authenticate but cannot open operational pages until approved.
3. An admin opens **Staff & centres → Approve staff access**, enters the exact email, name and role, then approves.
4. Assign the staff member's centre/venue. They can press **Try again** on the access screen.

Approval reuses a matching unlinked historical profile when unambiguous, preserving its ID and assignments. Duplicate emails or already-linked accounts require an admin to resolve them; approval never silently replaces a linked identity. Authentication does not automatically create staff profiles. Existing accounts are not reapproved or removed by this change.

## Sessions and shared devices

Session persistence, refresh and callback detection are explicitly enabled. Session restoration ignores stale initial results after a newer Auth event, and a failed restoration no longer leaves an endless loading screen. Browser storage restrictions, private browsing, sign-out and server session policies can still require another login. Staff must sign out on shared centre devices.

## Verification

- `npm ci --prefix frontend`
- `npm test --prefix frontend`
- `npm run build --prefix frontend`
- Run `db/tests/staff_auth_access.sql` using the SQL editor or a privileged database connection. It checks access boundaries and admin approval in a transaction, then rolls every fixture change back.
- After enabling the provider, test an existing approved Google email, cancellation, an unapproved Google email, logout, reopening the app, and the home-screen app on iPhone/Android. Confirm the approved user's profile ID, role and centre access remain the same. Do not claim Google is operational until the real callback succeeds.

The security change is tracked in `supabase/migrations/20261103132626_staff_approval_for_social_login.sql`. It has been applied to the hosted database. Older SQL files under `db/` are historical and must not be reapplied over this migration.
