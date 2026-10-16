# Production-readiness checklist

Legend: ✅ done and tested here · 🟡 built, needs checking on a real Supabase project · ⬜ to do before going live

## What was actually tested in this build

| Test | Result |
|---|---|
| All 10 migrations apply on PostgreSQL 16 | ✅ |
| `10_core_flow.sql` — order, invoice, payments, purchase, stock, costs, profit, correction (79 assertions) | ✅ pass |
| `20_security.sql` — customer / staff / other-tenant / anonymous attacks, share links, rate limit (76 assertions) | ✅ pass |
| `30_bill_import.sql` — old bills keep their date and book number, duplicates refused, retries safe, permissions | ✅ pass |
| Bill reader (Deno, 5) — dates, phone, amount checks and warnings | ✅ pass |
| Scan bill book in Chrome with a sample bill (reader stubbed): review form, save, duplicate refused | ✅ against a local test API |
| `40_whatsapp_customers.sql` — 4-digit customer IDs, WhatsApp status from delivery results, customer photos, permissions | ✅ pass |
| WhatsApp helpers (Deno, 5) — template message, webhook parsing, signature check, error mapping | ✅ pass |
| Browser: auto-send on save (sent → read), not-on-WhatsApp customer, new customer ID 1009, photos saved and shown after reopening (WhatsApp and storage stubbed) | ✅ against a local test API |
| Concurrency — 20 parallel invoices, 10× double-tap payment, 10 parallel stock uses | ✅ pass |
| API smoke — the app's real queries and writes through PostgREST as owner, staff, customer (82 checks) | ✅ pass |
| Unit + component tests (Vitest, 21) | ✅ pass |
| PDF tests (Deno, 5) and visual check of the PDF | ✅ pass |
| TypeScript strict type-check and production build | ✅ pass |
| Browser check (Chrome, desktop 1366px and phone 390px): dashboard, orders, order detail, new order, reports, inventory, settings, staff view, customer portal, full "new order → invoice → advance → WhatsApp share" flow | ✅ against a local test API |

Not tested here (needs a real Supabase project): Supabase Auth emails and password reset, Storage uploads and signed URLs, Edge Functions running on Supabase, Vercel deployment.

## Foundation
- ✅ Project builds and runs locally
- ✅ Schema and migrations apply successfully (plain PostgreSQL) · 🟡 run `supabase db push` on the dev project
- 🟡 Owner, staff and customer sign-in (logic tested; Supabase Auth emails need checking)
- ✅ RLS prevents unauthorised and cross-customer access

## Orders and billing
- ✅ One order supports multiple items and quantities
- ✅ Invoice totals and balances correct (database and PDF) · 🟡 PDF download through the deployed function
- ✅ Issued invoices stay unchanged when catalogue prices change
- ✅ Customers can open only their own invoices and valid links

## Inventory and accounts
- ✅ Purchases update stock exactly once
- ✅ Material use is linked to the correct order item
- ✅ Partial payments, refunds and reversals are traceable
- ✅ Reports separate sales, collections, stock, expenses and profit

## Sharing and launch
- ✅ WhatsApp opens with the correct prefilled message (manual send; PDF attached by hand)
- ✅ PDF download and the manual-attach explanation are in place
- ✅ Phone and desktop layouts
- ✅ Tests, environment setup, deployment and backup instructions written

## Before going live
- ⬜ Create dev + prod Supabase projects (Mumbai, paid plan for prod) and deploy (`docs/DEPLOY.md`)
- ⬜ Set up SMTP so sign-up and password emails arrive reliably
- ⬜ On the dev project, test: sign-up, password reset, staff invite, customer invite, photo upload, PDF download, secure link on a phone, WhatsApp share on the owner's phone
- ⬜ Enter real prices, workers, materials and opening stock
- ⬜ Do the restore drill once (`docs/BACKUP.md`)
- ⬜ Run old paper books and the app side by side for one week; compare daily totals
- ⬜ Confirm GST status with the accountant before turning tax on
- ⬜ Turn on Supabase MFA for the owner's Supabase dashboard account

## Scan bill book
- ⬜ Set `ANTHROPIC_API_KEY` and try 10–20 real bill-book pages; note how often fields need correcting
- ⬜ Tell the owner that bill photos are sent to Anthropic to be read

## Automatic WhatsApp
- ⬜ Meta Business account, WhatsApp Business Platform on +91 89190 93604 (Coexistence), approved `invoice_with_pdf` template
- ⬜ Set WHATSAPP_* secrets, deploy whatsapp-send and whatsapp-webhook, register the webhook URL in Meta
- ⬜ Send one test bill to your own number and check Sent → Delivered → Read appears on the order

## Known limitations
- WhatsApp cannot tell in advance whether a number has WhatsApp. The app learns it from the first message's result.
- Scan bill book was tested with a stubbed reader here; real handwriting accuracy depends on photo quality and must be checked on real pages. The owner always reviews before saving.
- WhatsApp: opens a chat with the text filled in. It cannot attach the PDF or send automatically, and cannot confirm delivery. The share log records only that WhatsApp was opened.
- Payments are recorded by hand; nothing is verified with a bank or UPI provider.
- Delivery bookings (Rapido, courier) are made outside the app; only the reference is recorded.
- One live invoice per order. Splitting an order across several invoices is not supported.
- Credit notes are handled by cancel-and-reissue rather than a separate credit-note document.
- Notifications are in-app only (no SMS/push). Reminders are generated when someone opens the app.
- Material units are fixed per material; there is no automatic unit conversion (by design, to avoid mistakes).
- Reports are computed live. They are fast for thousands of orders; at hundreds of thousands, add summary tables.
- Load testing on the hosted plan has not been done; Supabase plan limits (connections, storage, function invocations) apply.
