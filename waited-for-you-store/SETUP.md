# Set up checkout and private ebook delivery

The original storefront and cover are preserved. The API creates the ₹450 Razorpay order, verifies the payment signature, and confirms the captured payment directly with Razorpay. The actual ebook remains in the API's private files and is never served from the storefront's public folder.

## 1. Replace the exposed Test Mode keys

The Test Mode key pair shared earlier in chat should be treated as exposed. In the Razorpay Dashboard, switch to **Test Mode**, revoke or rotate that pair, and create a fresh Test Mode Key ID and Key Secret. Do not paste either value into chat or add them to source files.

In Replit, open **Tools → Secrets** and add:

- `RAZORPAY_KEY_ID` — the new Test Mode Key ID; it must start with `rzp_test_`
- `RAZORPAY_KEY_SECRET` — the matching Test Mode Key Secret

These keys are not currently configured in this project, so checkout will report that setup is required until both are saved. If `RAZORPAY_MODE` is not set, the server defaults to **Test Mode**. The server does not send a secret key to the browser.

## 2. Run a Test Mode checkout

1. Open the storefront preview and select **Buy Ebook**.
2. Complete checkout using Razorpay's Test Mode payment details.
3. The API checks the order ID, amount, currency, HMAC signature, and captured status with Razorpay.
4. A verified test payment shows a confirmation, but does **not** release the actual PDF. Test payments do not transfer real money.

Invalid signatures, cancelled/failed payments, payments that are not captured, and orders with a different amount or currency are rejected. No frontend success message can authorize a download.

## 3. Live payments and downloads are not enabled

Live checkout remains off by default. Do not set `RAZORPAY_MODE=live` until valid Live Mode credentials have been created and you are ready to accept real payments. To enable it later, add these separate Replit Secrets:

- `RAZORPAY_LIVE_KEY_ID` — must start with `rzp_live_`
- `RAZORPAY_LIVE_KEY_SECRET`
- `RAZORPAY_MODE` — set to `live` only after the matching Live Mode credentials are saved

The server rejects Live Mode if the mode is misspelled, credentials are missing, or the Key ID has the wrong prefix. Test credentials cannot create a Live Mode order, and Live credentials are not used in Test Mode.

After a captured ₹450 Live Mode payment is verified on the server, the API returns a signed download authorization that expires after 30 minutes. The browser submits it in a POST request; the API checks the token and the matching `verified_live` order in PostgreSQL before streaming the private PDF as an attachment. The PDF has no public URL. A Test Mode order, failed/unverified payment, invalid or expired token, or non-Live order cannot use this endpoint.

## 4. Keep the existing book file private

The uploaded 161-page PDF is kept at `artifacts/api-server/private/ebook.pdf`. It is outside the storefront's `public/` folder and is excluded from Git, but included in the API deployment image so the server can deliver it after a valid Live Mode purchase. Do not move it into `public/` or replace it with a sample file. If the book is replaced, update this private file and republish the API artifact.

The project does not use a separate file-storage service for this fixed book. Files written to a running Autoscale instance are temporary; the bundled private file is the source of truth.

## 5. Useful project checks

- `pnpm --filter @workspace/api-server run test` — payment-signature, mode-isolation, and download-authorization tests
- `pnpm run typecheck` — checks the workspace
- `pnpm --filter @workspace/db run push` — applies the development order-table schema when setting up the database

These checks do not make a payment. An actual Razorpay Test Mode checkout still requires the new Test Mode secrets above.

## 6. Hosting choices and cost limits

Prices and plan limits change; check the provider's current pages before publishing:

- **Replit Starter:** currently includes one published app for 30 days; it can be published again after expiry. This store needs a backend and database, so it cannot run as a static-only site. Replit lists Autoscale at a $2/month base plus usage for compute and requests; outgoing PDF downloads and the production database can also use credits or incur usage charges. Review the [publishing prices](https://docs.replit.com/billing/deployment-pricing), [Starter plan limits](https://docs.replit.com/billing/plans/starter-plan), and Usage page before publishing.
- **Static hosting:** free static hosting can serve the storefront files, but it cannot run this Express payment API or its PostgreSQL order checks. You would need a separate backend and database.
- **Render free services:** useful for a demo, not a dependable sales deployment: free web services sleep after 15 minutes idle and may take about a minute to wake; free PostgreSQL databases expire after 30 days. See [Render's free-service limits](https://render.com/docs/free).
- **Vercel Hobby:** free, but limited to personal, non-commercial use, so it is not suitable for a store selling ebooks. See [Vercel Hobby terms](https://vercel.com/docs/plans/hobby).

I have not published the app or enabled a paid service. The preview works, but payment checkout remains unavailable until you add the replacement Test Mode secrets.
