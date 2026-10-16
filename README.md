# Sri Sri Boutique — Boutique Management System

Orders, **scanning old bill-book pages into orders**, multi-item billing, PDF invoices, secure invoice links, manual WhatsApp sharing, payments, inventory with weighted-average costing, purchases, suppliers, expenses, deliveries, profit reports and a customer portal — for Sri Sri Boutique (blouse stitching, Maggam/Aari, mugam work, DDF/DTF printing and tailoring).

**Stack:** React 18 + TypeScript + Vite + Tailwind · Supabase (PostgreSQL, Auth, Storage, Edge Functions) · TanStack Query · React Hook Form + Zod · Recharts · pdf-lib.

---

## What is in this folder

```
src/                     React app (owner/staff app, customer portal, public invoice page)
  app/                   session & permissions, layout, route guards
  components/            UI kit (buttons, fields, dialogs, toasts, tables…)
  features/              one folder per area: orders, customers, invoices, inventory, purchases,
                         expenses, deliveries, reports, settings, portal, notifications
  lib/                   money/date formatting (₹, IST), phone (E.164), WhatsApp, CSV, PDF helpers
supabase/
  migrations/            10 SQL migrations: tables, triggers, RLS, business functions, reports, storage
  functions/             Edge Functions: invoice-pdf, shared-invoice, scan-bill, whatsapp-send, whatsapp-webhook
  tests/                 SQL test suite: business flow, security/isolation, concurrency
scripts/                 test-db.sh, test-concurrency.sh, api-smoke.mjs
docs/                    ARCHITECTURE, SECURITY, ACCOUNTING, DEPLOY, BACKUP, CHECKLIST, USER_GUIDE
```

## Decisions made for you (change any time)

| Question | Default chosen | Where to change |
|---|---|---|
| GST | Off. Invoices show no tax line. | Settings → Invoices → "Charge tax (GST)" |
| Invoice numbers | `SSB/2026-27/0001`, restarting each April | Settings → Invoice number prefix |
| Workers | Names only (no login) for assigning work and labour cost | Settings → Workers |
| Measurements | Blouse set: length, bust, under-bust, waist, shoulder, armhole, sleeve length/round, front/back neck, apex, dart point — plus any custom field | Customer page → New measurements |
| Customer accounts | Owner sends an invite link (no SMS cost) | Customer page → Invite to portal |
| Stock shortage | Blocked, but the owner can approve it | Settings → Inventory |
| WhatsApp business number | Entered during setup (e.g. **+91 89190 93604**); shown on invoices and the customer's invoice page | Settings → WhatsApp business number |

## Automatic WhatsApp bills

When switched on (Settings → Business), saving an invoice sends the bill PDF to the customer on WhatsApp automatically. If the number is not on WhatsApp, the bill is just saved and the customer is marked "Not on WhatsApp". Needs a one-time WhatsApp Business Platform setup — see `docs/WHATSAPP_AUTO.md`. Until then, "Share by hand" works as before.

## Customer IDs and photos

Every new customer gets a 4-digit ID (1001, 1002, …). Orders and customers have a **Photos** section: photos are saved in private storage, linked in the database, and shown every time you open the order or customer.

## Scan bill book

Orders → **Scan bill book**: photograph pages of the paper bill book and the app fills in customer, items, amounts, advance, dates and measurements for you to check and save. Needs one Anthropic API key set as a Supabase secret — see `docs/BILL_SCAN.md`.

## Run it locally

Requirements: Node 20+, the [Supabase CLI](https://supabase.com/docs/guides/cli), Docker (for the local Supabase stack).

```bash
npm install
supabase start                        # local Postgres, Auth, Storage, Functions
supabase db reset                     # applies supabase/migrations
cp .env.example .env.local            # paste the local API URL and anon key printed by `supabase start`
supabase functions serve              # Edge Functions (PDF + shared links), separate terminal
npm run dev                           # http://localhost:5173
```

First use: **Create an account → confirm the email (local emails appear in Inbucket, http://localhost:54324) → "Set up your boutique"**. You become the owner. Then:

1. **Settings → Business**: logo, address, WhatsApp number, UPI/payment instructions.
2. **Settings → Price list**: set your usual prices (they start at ₹0).
3. **Settings → Workers**: add tailors / embroiderers.
4. **Settings → Staff & access**: invite staff with only the permissions they need.
5. **Inventory**: add materials, then record purchases (or an opening-stock adjustment).

## Tests

```bash
npm test                 # unit + component tests (Vitest): money, IST dates, phone, WhatsApp text, CSV, totals, invoice view
npm run typecheck        # TypeScript
PGHOST=… PGPORT=… PGUSER=postgres npm run test:db
                         # applies all migrations to a throwaway DB and runs:
                         #  • 10_core_flow.sql   order → invoice → payments → purchase → stock → costs → profit → correction
                         #  • 20_security.sql    customers vs customers, staff without finance, other tenant, anonymous,
                         #                       share-link expiry/revoke, rate limit, direct-write attempts
                         #  • concurrency        20 parallel invoices (unique, gap-free), 10× double-tap payment, parallel stock use
deno test --allow-read --allow-write --config supabase/functions/deno.json supabase/functions/_shared/
                         # PDF generation (one page, multi-page, cancelled, ₹ formatting, IST dates)
API_URL=… JWT_SECRET=… node scripts/api-smoke.mjs
                         # runs the app's real API queries through PostgREST as owner, staff and customer
```

See `docs/CHECKLIST.md` for what has been verified and what still needs doing before going live.

## Deploy

Short version (full steps in `docs/DEPLOY.md`):

1. Create a Supabase project in **Mumbai (ap-south-1)** on a paid plan (daily backups, no pausing).
2. `supabase link` → `supabase db push` → `supabase functions deploy invoice-pdf shared-invoice`.
3. `supabase secrets set APP_ORIGINS=https://your-domain`.
4. Auth → URL configuration: site URL and redirect URLs = your domain. Set up SMTP for real emails.
5. Vercel: import the repo, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, deploy.

The service-role key is **never** put in the frontend or in Vercel.
