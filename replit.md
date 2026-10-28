# The Book That Waited for You

A responsive storefront for the thriller ebook, with ₹450 Razorpay checkout and private PDF delivery after server-verified captured Live Mode payment.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/waited-for-you-store run dev` — run the storefront
- `pnpm --filter @workspace/api-server run test` — run payment-security unit tests
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — apply the development database schema
- Required environment: `DATABASE_URL`
- Test Mode secrets: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
- Live Mode secrets (not configured by default): `RAZORPAY_LIVE_KEY_ID`, `RAZORPAY_LIVE_KEY_SECRET`, plus `RAZORPAY_MODE=live`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: Vite for the storefront, esbuild for the API

## Where things live

- `artifacts/waited-for-you-store/src/App.tsx` — storefront and checkout UI
- `artifacts/waited-for-you-store/src/index.css` — existing visual design and responsive rules
- `artifacts/waited-for-you-store/public/` — public cover and favicon only
- `artifacts/waited-for-you-store/SETUP.md` — beginner setup and test/live payment instructions
- `artifacts/api-server/src/routes/checkout.ts` — Razorpay order, verification, and private download routes
- `artifacts/api-server/src/lib/paymentSecurity.ts` — mode separation, signature checks, and short-lived download tokens
- `artifacts/api-server/private/ebook.pdf` — the real private ebook file; never move it under `public/`
- `lib/api-spec/openapi.yaml` — API contract source of truth
- `lib/db/src/schema/ebook-orders.ts` — persistent order and verification state

## Architecture decisions

- Checkout defaults to Test Mode when `RAZORPAY_MODE` is absent. Test and Live credentials use separate environment variable names and Key ID prefixes.
- The API alone creates Razorpay orders, verifies HMAC signatures, and confirms payment status with Razorpay.
- Test Mode payments are simulated and never release the real PDF.
- Live delivery requires an explicitly selected Live Mode and valid `rzp_live_` credentials. A short-lived signed authorization is returned only after a captured Live Mode payment; the download route also verifies the matching database order.
- The PDF is Git-ignored but bundled with the API artifact. It is not part of the storefront's static files.

## Product

The storefront preserves the uploaded book content, cover, and dark literary design, adapts to mobile screens, and offers Razorpay checkout for the digital edition at ₹450. A private PDF download is available only after server-side confirmation of a captured Live Mode payment.

## User preferences

- Preserve the existing site design, copy, and book file; do not replace them with sample content.
- Use Razorpay only. Keep Test Mode as the default and do not enable Live Mode until the user has configured valid Live Mode credentials.
- Never expose secret keys or the ebook PDF in client code, public files, logs, or chat.
- Do not publish or make paid changes without the user's permission.

## Gotchas

- After changing `lib/api-spec/openapi.yaml`, run codegen before typechecking packages that use the generated types.
- For a development database setup, run `pnpm --filter @workspace/db run push`; do not run schema changes against production manually.
- Keep `artifacts/api-server/private/ebook.pdf` outside the storefront `public/` directory. The API artifact must include that file in its deployment image.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
