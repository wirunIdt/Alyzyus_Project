# Security maintenance

This guide covers the Flask app, browser client, Supabase policies, and Vercel deployment.
It describes controls and how to verify them. It is not a penetration-test certification.
Do not put credentials, customer records, private conversation text, or raw production logs in issues or this public repository.

## Browser and HTTP boundaries

- JSON mutations require an exact same-origin `Origin` and a compatible `Sec-Fetch-Site`; the signed Stripe webhook is the explicit exception.
- Session cookies are HttpOnly, SameSite=Lax and Secure on HTTPS. Tokens never enter browser localStorage or the public bootstrap.
- Dynamic HTML uses a fresh CSP nonce. Standalone 3D/offline HTML uses SHA-256 script hashes; inline handlers and `eval` are blocked. Three.js has pinned CDN Subresource Integrity.
- CSP permits inline **styles** for existing theme variables and 3D labels. This does not permit inline JavaScript. Product colors are validated as six-digit HEX at the server boundary.
- External HTTPS product images remain supported; they are loaded by browsers and never fetched by the Python server. The image host can observe ordinary image requests. Referrers omit private paths on cross-origin requests.
- Payment redirects accept only hosted HTTPS `checkout.stripe.com` URLs. Configure and review the allowlist before introducing another payment provider or custom checkout domain.
- Flask accepts the configured `SITE_URL` host and the exact Vercel system deployment/branch/production hosts. Local development also accepts localhost and loopback. Update configuration deliberately when adding a custom domain.
- Total request size is 1 MiB. Multipart parsing permits at most 8 parts and 128 KiB of field/buffer memory; actual image decoding has separate byte, pixel and format limits.
- Private APIs and dynamic pages use `private, no-store`. The service worker caches public offline assets only.

After editing `public/static/queue3d.html` or `public/offline.html`, run:

```powershell
.\.venv\Scripts\python.exe scripts/check.py --fix
```

This refreshes Vercel's static CSP hashes after formatting. `scripts/security-headers.py --check`
fails QC when the hash configuration is stale. Flask uses the same generated constants in
`server/csp_hashes.py`, so the function does not need to read CDN asset files at startup.

## Account confirmation and recovery

Request the confirmation/recovery email and open its link in the **same browser**.
Both PKCE codes and token-hash fallback links require signed initiation state, limited to one hour.
The token-hash fallback also checks the verified Auth email against an HMAC fingerprint of the initiating email.
Expired links, cleared browser cookies, or old token-hash cookies require a fresh email request.
Unrequested invite/email-change token-hash flows are rejected. The app does not initiate those flows.
Keep `APP_SECRET_KEY` stable and secret; replacing it invalidates pending signed initiation cookies.

Authorization uses a fresh Supabase user lookup and the database profile role, never editable `user_metadata.role`.
Appearance customization, orders and support require a verified account; Admin APIs independently require the Admin role.

## Database and storage

- All application tables in `public` have RLS enabled. Owners can read their own orders/support records; Admin reads use explicit policies. Only active products are public.
- Clients cannot directly write profiles, orders, payment events, support messages/tickets, or activity logs. Product writes require the Admin RLS policy.
- Privileged commerce/support RPCs are callable only by the server role. Private helper execution is explicitly restricted; definer functions use a fixed search path.
- Prices, discounts, stock changes and order transitions are decided transactionally in PostgreSQL. Idempotency prevents duplicate orders/replies/payment events; row locks protect stock and ticket revisions.
- Signed Stripe events are verified in Flask. The database also rejects missing identifiers, NULL amounts/currency and incomplete successful payment events. Expired/failed sessions may legitimately lack PaymentIntent.
- `product-images` is intentionally public for product images only, restricted to WebP and 850,000 bytes. Uploads pass Admin authentication and Pillow decoding/re-encoding. Customer attachments are not stored there.
- Durable business audit events omit message bodies, credentials, customer addresses and payment-card details.

Run Supabase Security Advisor after every migration. Review grants as well as policies: RLS does not itself grant access, and function execution defaults must be explicitly revoked.

## Operator actions requiring account access

1. Enable **Leaked Password Protection** in Supabase Auth if the project's plan supports it. Confirm the warning disappears in Security Advisor. Do not buy or upgrade a plan automatically.
2. Treat any server API key shared in a chat, screenshot or log as exposed. Create its replacement in Supabase; place the new value directly in Vercel `SUPABASE_SERVICE_ROLE_KEY` for the intended environments. Redeploy, verify server functions, then revoke the old key. Never commit or paste the replacement in chat. Existing `APP_SECRET_KEY` is a separate credential and should not be replaced as a substitute.
3. Review owner/Admin MFA, recovery methods, Auth rate limits/CAPTCHA, SMTP delivery and GitHub branch protection in the actual provider accounts. The app's order/support quotas are not a global anti-bot service.
4. Review unpaid COD/bank stock reservations. They remain reserved until a legitimate staff cancellation; choose an expiry/manual-confirmation policy before high-volume sales. Do not automatically cancel paid orders as a workaround.

References: [Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection),
[Supabase API keys](https://supabase.com/docs/guides/api/api-keys),
[Flask web security](https://flask.palletsprojects.com/en/stable/web-security/),
[Vercel headers](https://vercel.com/docs/project-configuration/vercel-json#headers).

## Reproducible checks

```powershell
.\.venv\Scripts\python.exe scripts/check.py
.\.venv\Scripts\python.exe -m pip_audit -r requirements.txt
npm --prefix tests audit --audit-level=low
.\.venv\Scripts\python.exe scripts/security-scan.py
```

The credential scanner reports only file paths and credential **types**, never matching values.
An optional `--history <existing-git-mirror>` scans historical text/blob content up to 3 MiB per blob.
This is a pattern-based check, not universal secret detection. Publishing/deployment use explicit allowlists;
archived private files, `.env`, local environments and artifacts are excluded.

Dependency audits query current advisory data and need network access. A clean result means no known matching
advisories were returned at that time, not that a dependency is guaranteed safe. GitHub CI runs these audits,
source scanning and the same bounded Python/Node behavior suites without production credentials.

The SQL tests use an isolated in-memory PostgreSQL implementation and fabricated identities. HTTP tests
use provider mocks. They verify adversarial ownership, privilege escalation, session swapping, CSP consistency,
malformed uploads/payments, idempotency and private-cache behavior without changing production customer data.
