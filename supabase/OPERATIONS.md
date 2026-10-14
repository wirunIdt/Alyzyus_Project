# Alyzyus database and payments

## First deployment

1. Create a Supabase project and apply every file in `migrations/` in filename order in the SQL Editor (or use the Supabase CLI migrations workflow), including the private helper hardening migration.
2. Optionally apply `seed.sql`. It creates eight **inactive sample drafts with stock 0**. Update the catalog with actual products, images, prices, stock and activate them in the administrator interface. The public demo catalog is never a fallback for a failing configured database.
3. Copy the project URL into `SUPABASE_URL`, the publishable key into `SUPABASE_PUBLISHABLE_KEY`, and the server secret into `SUPABASE_SERVICE_ROLE_KEY` in Vercel. Legacy anon/service-role JWT keys are supported too. Every credential remains on the Flask server; the browser only calls same-origin application APIs. Generate `APP_SECRET_KEY` with `python -c "import secrets; print(secrets.token_urlsafe(48))"` and keep the same value across deployments and instances.
4. Set `SITE_URL` to the exact HTTPS production origin. In Supabase Auth, set the Site URL and allow `https://your-domain/auth/callback` as a redirect. Add `http://localhost:3000/auth/callback` separately for development. Keep email confirmation enabled and configure a production SMTP provider for signup and recovery email delivery.
5. Sign up the owner account normally, confirm its email, then promote only that account from the Supabase SQL Editor:

```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'your-owner-email@example.com');
```

Customer-editable signup metadata is never used for authorization. Browser clients cannot insert or update their role. Private orders are readable only by their authenticated owner or an administrator, including direct Supabase requests.

## Flask authentication and email callbacks

The application exchanges email/password credentials and refresh tokens through Supabase Auth REST endpoints. It validates the current identity through the Auth user endpoint before account/order access and reads the administrator role from the database. Access and refresh tokens use HttpOnly, SameSite=Lax cookies, with Secure enabled for an HTTPS `SITE_URL`. Session-bearing responses have `Cache-Control: private, no-store`. The HTTP connection pool carries no shared authorization state.

Signup and password recovery use PKCE with a signed HttpOnly verifier cookie. The default Supabase confirmation link can return an auth code to `/auth/callback`; it must be opened in the browser that began the request. For confirmation links that work across devices, configure Supabase email templates to point directly to the server token-hash callback:

```html
<!-- Confirm signup template -->
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup">Confirm your account</a>
<!-- Reset password template -->
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery">Reset your password</a>
```

`/auth/confirm` verifies the one-time token hash on the server and then sets the account cookies. Recovery goes to `/account?recovery=1`. Callback redirects allow only account, checkout, tracking, or admin destinations on this store's origin. New passwords must contain at least 12 characters. No auth token is returned to browser JavaScript or placed in local storage.

## Supported payment paths

* COD is available when the database and server key are configured. Set `PAYMENT_COD_ENABLED=false` to disable it. Staff mark payment received after collection.
* Bank transfer is available only with `BANK_NAME`, `BANK_ACCOUNT_NAME` and `BANK_ACCOUNT_NUMBER`. Customers receive the order reference; staff verify actual bank receipt before marking paid. No upload or browser success screen establishes payment.
* Hosted Stripe checkout supports cards and eligible wallet/local payment methods enabled in the Stripe Dashboard. `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `SITE_URL` are required. `STRIPE_CARD_CONFIGURATION_ID` can select a specific payment-method configuration; otherwise the Stripe default configuration applies.
* PromptPay uses hosted Stripe QR checkout. Enable it in Stripe, create a payment-method configuration including PromptPay, and supply its `pmc_...` ID as `STRIPE_PROMPTPAY_CONFIGURATION_ID` plus `PAYMENT_PROMPTPAY_ENABLED=true`. Availability remains subject to the merchant account's country, verification, amount and Stripe eligibility rules.

The pinned Stripe Python 16 SDK uses the 2026-09-30.endive API and dynamic payment-method configurations. Set the desired payment methods in the Stripe Dashboard; do not remove webhook verification to make payment status appear successful.

Register `https://your-domain/api/webhooks/stripe` for:

* `checkout.session.completed`
* `checkout.session.async_payment_succeeded`
* `checkout.session.async_payment_failed`
* `checkout.session.expired`

Use test keys, test payment-method configurations and the test endpoint signing secret together during verification. A redirect from Checkout never marks an order paid. Only a valid signed webhook with matching order, customer, session, amount and currency can do that. Webhooks deduplicate by Stripe event ID inside the database transaction.

## Inventory and order rules

Checkout requires a confirmed signed-in account. The database calculates all prices, the 80 THB shipping fee (free from 2,500 THB subtotal) and the first-order `WELCOME10` discount. It locks inventory before reducing stock and stores immutable product snapshots in each order. Repeating the same buyer/idempotency key returns the same order; reusing it with changed input is rejected. A buyer is limited to five new orders per ten minutes.

Status moves pending → confirmed → processing → shipped → delivered. Carrier and tracking number are required for shipment. Non-COD orders must be paid before processing/shipping. Staff can cancel unpaid pending/confirmed/processing orders; inventory is restored once, atomically. Online sessions are expired before manual cancellation. Signed Stripe expiry/failure events also release stock once.

Paid orders cannot be cancelled through the app until a refund workflow is implemented. Issue and reconcile refunds in Stripe/bank operations separately. A late payment arriving after cancellation is flagged `refund_required`, not fulfilled. The current app does not initiate refunds, generate tax invoices, buy shipping labels, automatically calculate tax, or subscribe to courier tracking.

Online checkout reserves stock for the Stripe session's approximately 31-minute lifetime. Stripe expiry webhooks must be operational to release abandoned reservations. If session creation times out, retry with the same idempotency key: it safely recovers the existing order/session. An interrupted provider call may leave a pending order with no session ID; staff should reconcile it against Stripe before cancelling. The API deliberately rejects automatic cancellation of such ambiguous payments.

## Operational checks

* Verify an actual owner/customer sign-in, customer isolation via RLS, one test order per enabled payment type, and webhook redelivery before opening sales.
* Replace the sample catalog and merchant policy/contact text. Confirm bank account details and the carrier/return process with the store owner.
* Supabase's database backup/PITR availability depends on the selected plan. Configure backups, error monitoring and Stripe webhook delivery alerts for production.
* The current customer order endpoint returns the newest 200 orders, and the admin overview the newest 500. Add cursor pagination before growing beyond those operational limits.
* Keep dependencies updated, and keep production secrets out of source control, logs and screenshots.

The legacy Flask JSON files are preserved in the workspace but are not imported into the new public storefront or deployed as public assets. Migrate historical customer records only after deciding which account owns each record.
