# Security model

## Principles

1. **The database decides.** Every rule is enforced by PostgreSQL Row Level Security (RLS) and by `SECURITY DEFINER` functions that check permissions first. Hiding a button in the app is only convenience.
2. **Deny by default.** RLS is enabled on every table. A table with no policy for an action blocks it.
3. **Money and stock change only through functions** (`save_order`, `issue_invoice`, `record_payment`, `receive_purchase`, `consume_material`, …). `INSERT/UPDATE/DELETE` on orders, invoices, payments, stock movements, audit log and similar tables is revoked from the `authenticated` role.
4. **Never trust the browser** for business IDs, totals, costs, roles or customer links. Totals are recalculated in the database (`app.recalc_order`). `business_id` cannot change on any row (trigger). Child rows must belong to the same business as their parent (trigger).
5. **The service-role key exists only inside Edge Functions.**

## Roles

| Role | How created | Access |
|---|---|---|
| Owner | `create_business()` by a signed-in user | Everything in that business |
| Staff | Invite link from the owner (`create_invite` → `accept_invite`) | Only granted permissions |
| Customer | Invite link from the owner | Own records only, through portal functions |

Staff permissions: `customers.manage`, `orders.manage`, `invoices.manage`, `payments.record`, `inventory.manage`, `purchasing.manage`, `delivery.manage`, `expenses.manage`, `finance.view`, `reports.export`, `staff.manage`, `settings.manage`. All off by default. Only the owner can grant or remove `finance.view` and `staff.manage`. Staff cannot change their own permissions. Every change is written to the audit log.

Note: staff with `inventory.manage` or `purchasing.manage` can see purchase prices and average material cost, because they need them to do that job. Margins, labour costs, profit and expense records stay behind `finance.view` / `expenses.manage`.

## What customers can never see

Column-level privacy is done with separate tables, because RLS works on rows:

- `order_internal` (owner notes, priority) — `orders.manage` only
- `order_line_costs` (material, labour, other cost) — `finance.view` only
- materials, stock movements, purchases, suppliers, expenses, audit log — no customer policy at all

Customers have **no direct access** to orders, lines, invoices or payments tables. They use `portal_overview()`, `portal_invoice(id)` and `portal_image_path(id)`, which return a fixed, customer-safe set of fields for records linked to `auth.uid()`. Asking for any other invoice returns the same "not found" error whether or not it exists.

## Linking a login to a customer

Never by a phone number typed in the browser. The owner creates a one-time invite (`create_invite`, token stored as a SHA-256 hash, expires in 7 days, older invites revoked). The customer signs in and calls `accept_invite(token)`; only that function can set `customers.user_id` (a trigger blocks every other change).

## Secure invoice links (`/i/<token>`)

- 32 random bytes (base64url). Only the SHA-256 hash is stored.
- No invoice number, name or phone in the URL. Knowing an invoice number grants nothing.
- Expire after the configured days (default 30); revocable per link; all links revoked when the invoice is cancelled.
- Opened only through the `shared-invoice` Edge Function (service role). `open_shared_invoice` is not executable by `anon` or `authenticated`.
- Rate limited: 30 requests/minute per IP, 20/minute per token prefix.
- Unknown, expired, revoked and cancelled links all return the same 404.
- Returns the customer-safe payload plus a 5-minute signed PDF URL. Logged (`open_count`, `last_opened_at`).
- The site sends `Referrer-Policy: no-referrer` so the token never leaks to other sites.

## Storage

All buckets are private except `branding` (logo). Object paths start with `<business_id>/` and policies check membership against that prefix. Invoice PDFs are written only by the Edge Function. Customers can read only images the shop marked "customer can see" on their own orders, and only their own invoice PDFs. Downloads use short-lived signed URLs.

## Abuse protection and data hygiene

- Idempotency keys on orders, invoices, payments, stock movements and supplier payments; double taps return the existing record.
- Row locks on orders, materials and number sequences; parallel requests cannot create duplicate invoice numbers or double stock deductions (tested with 20 parallel requests).
- Append-only tables: payments, stock movements, status history, invoice lines, measurement sets, supplier payments. Mistakes are fixed with reversals, returns or cancellations — never by deleting.
- Search inputs are stripped of PostgREST filter syntax. CSV exports neutralise spreadsheet formulas.
- Error messages shown to users are friendly; technical errors are hidden.
- Supabase Auth: email confirmation on, minimum password length 8, built-in rate limits on sign-in and email sending.

## Tested attacks (`supabase/tests/20_security.sql`)

Customer reading orders/lines/invoices/payments/costs/materials/suppliers/expenses/audit/services/staff; customer opening another customer's or a cancelled invoice; customer re-linking an account or editing another customer; customer calling staff functions; staff reading costs/expenses/purchases/audit or profit reports; staff granting themselves finance access; staff inserting stock or payments directly; staff editing order totals; another business reading, writing, paying, issuing, cancelling or reporting on this business; reusing an invite token; anonymous access to tables and functions; expired, revoked, wrong and invoice-number tokens.
