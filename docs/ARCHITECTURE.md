# Sri Sri Boutique — Phase 1: Architecture & Data Model

Status: **As built.** This is the Phase 1 design updated to match the code. See `CHECKLIST.md` for test results.

**Changes from the original design:** invoices have only `issued` and `cancelled` states (the order itself is the draft); staff/customer invites are database functions (no Edge Function needed); exports are a database function (`export_report`) checked against `reports.export`; the business has a WhatsApp number shown on invoices; the six open questions were answered with the defaults in the README.

---

## 1. System overview

```
 Browser (phone / tablet / desktop)
   React + TS + Vite + Tailwind
   TanStack Query · React Hook Form + Zod · Recharts
        │  anon key + user JWT only
        ▼
 Supabase
   ├─ Auth            email/phone login, password recovery
   ├─ PostgreSQL      tables + RLS (deny by default)
   │                  + SECURITY DEFINER RPC functions for money & stock
   ├─ Storage         private buckets, short-lived signed URLs
   └─ Edge Functions  service-role work: invoice PDFs, share links,
                      staff invites, customer linking, exports
        │
        ▼
 Vercel (static frontend hosting)
```

**Core rules**

1. The browser never calculates money that gets saved. It sends inputs, e.g. "item X, qty 2, price ₹800". The database function recalculates and stores the totals.
2. Money and stock changes go only through database functions (RPCs), each in one transaction. Direct `INSERT`/`UPDATE` on financial and stock tables is revoked from client roles.
3. Every write that could be double-clicked takes an `idempotency_key`, with a unique constraint.
4. The service-role key exists only in Edge Functions. It is never in the frontend or `.env` files shipped to Vercel.
5. Every table carries `business_id`. Tenant isolation is enforced by RLS, never by the client.

---

## 2. Roles and permissions

| Role | How the account is created | Sees |
|---|---|---|
| **Owner** | First signup creates the business | Everything in their business |
| **Staff** | Owner sends an invite (Edge Function) | Only modules they are granted |
| **Customer** | Owner-assisted invite, or self-signup followed by a verified link (see 2.2) | Only their own customer record |

### 2.1 Staff permission flags (all off by default)

`customers.manage`, `orders.manage`, `invoices.manage`, `payments.record`, `inventory.manage`, `purchasing.manage`, `delivery.manage`, `expenses.manage`, `finance.view` (costs, margins, profit, supplier balances), `reports.export`, `staff.manage`, `settings.manage`.

`finance.view` is the only flag that unlocks costs and profit. Granting it requires a confirmation dialog and writes an audit-log entry.

### 2.2 Linking a customer login to a customer record

A phone number typed in the browser is **never** trusted for this. Two safe paths:

- **Owner invite:** the owner clicks "Invite to portal" on a customer. An Edge Function creates a one-time invite token (stored hashed, expires in 7 days) and builds a link. The customer signs up through that link. The function then sets `customers.user_id`.
- **Self-signup:** the customer verifies their phone by OTP through Supabase Auth. An Edge Function matches the *verified* phone from the JWT to exactly one customer record. Zero matches or more than one match means the owner must approve it manually.

---

## 3. Privacy design: RLS is row-level, so costs live in separate tables

RLS can hide rows but not single columns. Anything a customer or ordinary staff member must not see therefore sits in its own table with stricter policies:

| Visible to customer (own rows) | Internal only |
|---|---|
| `orders` (customer fields) | `order_internal` (owner notes, priority reasons) |
| `order_lines` (description, qty, price, discount) | `order_line_costs` (material, labour, other, cost status) |
| `invoices`, `invoice_lines` (issued only) | `stock_movements`, `materials`, `purchases`, `suppliers` |
| `payments` (on their invoices) | `expenses`, profit views, `audit_log` |
| `attachments` where `visibility = 'customer'` | `attachments` where `visibility = 'internal'` |

Customers read through **views** (`v_customer_orders`, `v_customer_invoices`) that select only safe columns. The base tables have no customer policy at all.

---

## 4. Data model

All tables have: `id uuid pk`, `business_id uuid not null fk`, `created_at`, `created_by`, `updated_at`. Money is `numeric(12,2)`. Quantities are `numeric(12,3)`. Timestamps are `timestamptz`, displayed in `Asia/Kolkata`.

### 4.1 Tenancy and people
- **businesses** — name, logo_path, address, phone, email, gstin (nullable), invoice_footer, payment_instructions, timezone, settings jsonb (stock-block mode, rounding rule, tax on/off).
- **profiles** — `id = auth.users.id`, full_name, phone.
- **business_members** — business_id, user_id, role (`owner|staff|customer`), active. Unique (business_id, user_id).
- **member_permissions** — member_id, permission (enum from 2.1). PK (member_id, permission).
- **workers** — name, phone, rate notes, active. Tailors and embroiderers who may not have logins. Optional link to a member.

### 4.2 Customers
- **customers** — customer_code (`CUS-00042`), full_name, phone_e164, whatsapp_e164, email, address, user_id (nullable, unique). Index on (business_id, phone_e164). A trigram index on name supports search.
- **measurement_sets** — customer_id, taken_at, garment_type, values jsonb (e.g. bust, waist, shoulder, sleeve length, armhole, blouse length, neck depth front/back), notes. **Insert-only.** An edit creates a new row, and orders point at the exact set used.

### 4.3 Catalogue
- **service_categories** — name, sort.
- **services** — category_id, name, description, default_price, unit, standard_cost_estimate, active.

### 4.4 Orders
- **orders** — order_no (`ORD-2026-0001`), customer_id, status, order_date, due_at, delivery_method, measurement_set_id, assigned_worker_id, customer_notes, cancelled_reason.
- **order_internal** — order_id pk/fk, internal_notes, priority.
- **order_lines** — order_id, service_id (nullable for custom items), description, customer_description, qty, unit, unit_price, line_discount, line_subtotal (generated: `qty*unit_price - line_discount`, check ≥ 0), internal_notes.
- **order_line_costs** — line_id pk/fk, material_cost (derived from consumption), labour_cost, other_cost, cost_status (`incomplete|complete`).
- **order_status_history** — order_id, from_status, to_status, changed_by, changed_at, note. Written only by the `change_order_status` RPC.

Status enum: `draft → confirmed → in_progress ⇄ waiting_materials → quality_check → ready → out_for_delivery → delivered`, with `cancelled` reachable before `delivered`. Allowed transitions are checked in the RPC.

### 4.5 Invoices and payments
- **invoices** — invoice_no (`SSB/2026-27/0001`), order_id, customer_id, status (`draft|issued|cancelled`), issued_at, due amounts (subtotal, discount, delivery_charge, tax, round_off, total), snapshot jsonb (business details, customer details, lines exactly as issued), pdf_path, replaces_invoice_id (for corrections).
- **invoice_lines** — copied from order_lines at issue time. **Immutable once issued** (enforced by trigger).
- **payments** — customer_id, invoice_id, order_id, kind (`payment|refund|reversal`), amount (> 0), method (`cash|upi|bank|card|other`), reference_no, received_at, reverses_payment_id, idempotency_key unique. No deletes. Mistakes are fixed by a `reversal` row.
- **invoice_share_links** — invoice_id, token_hash (SHA-256 of a 32-byte random token), expires_at, revoked_at, last_opened_at, open_count.

**Balance** = invoice total − Σ payments + Σ refunds ± reversals. This is computed in a view, never stored by the client.

**Corrections:** an issued invoice is never edited. You cancel it (with a reason) and issue a new one that references it. Both stay on record.

### 4.6 Inventory and purchasing
- **suppliers** — name, phone, address, gstin, notes.
- **materials** — code, name, category, unit (`pcs|m|g|ml|roll`), reorder_level, default_supplier_id, on_hand (maintained only by trigger), avg_cost (weighted average), active.
- **purchases** — purchase_no, supplier_id, purchase_date, other_charges, discount, total, status (`draft|received|cancelled`), bill_attachment_id.
- **purchase_lines** — purchase_id, material_id, qty, unit_cost, batch_no.
- **supplier_payments** — supplier_id, purchase_id, amount, method, paid_at, idempotency_key.
- **stock_movements** — material_id, type (`receipt|consumption|return_in|return_out|waste|adjustment`), qty (signed), unit_cost, purchase_line_id, order_line_id, reason, idempotency_key unique. **Insert-only.** This is the single source of truth for stock.

Units are fixed per material. A movement must use the material's unit, so there are no silent conversions.

**Costing method: weighted average.** On receipt: `new_avg = (on_hand*avg + qty*unit_cost) / (on_hand + qty)`. Consumption is recorded at the current avg_cost, and that cost is frozen on the movement row, so later price changes never alter past orders.

### 4.7 Expenses, delivery, files, notifications, audit
- **expense_categories**, **expenses** — date, category_id, amount, description, method, supplier_id, receipt attachment, notes. Corrections go through reversal entries.
- **deliveries** — order_id, method, destination, contact, provider, booking_ref, charge, dispatched_at, delivered_at, status, proof attachment.
- **attachments** — bucket, path, entity_type, entity_id, visibility (`customer|internal`), mime, size.
- **notifications** — type, entity, due_at, dedupe_key unique, read_by.
- **message_shares** — channel (`whatsapp_manual`), entity, phone, message_text, opened_at. Records an *attempt*, never a delivery.
- **audit_log** — actor, action, entity, before jsonb, after jsonb, at. Written by triggers on sensitive tables.
- **number_sequences** — (business_id, kind, period) pk, next_value. Taken with `SELECT … FOR UPDATE` inside the issuing RPC, so numbers are gap-free and never duplicated under concurrency.

### 4.8 Relationship summary

```
business ─┬─ members ─ permissions
          ├─ customers ─┬─ measurement_sets
          │             └─ orders ─┬─ order_lines ─┬─ order_line_costs
          │                        │               └─ stock_movements (consumption)
          │                        ├─ order_internal, status_history, deliveries
          │                        └─ invoices ─┬─ invoice_lines
          │                                     ├─ payments
          │                                     └─ share_links
          ├─ suppliers ─ purchases ─ purchase_lines ─ stock_movements (receipt)
          ├─ materials ─ stock_movements
          └─ expenses, attachments, notifications, audit_log, sequences
```

---

## 5. Key database functions (RPCs)

Each RPC checks membership and permission, runs in one transaction, and writes the audit log.

| Function | What it does |
|---|---|
| `save_order(payload, idem_key)` | Upserts order and lines, validates prices, recomputes totals |
| `change_order_status(order_id, to, note)` | Validates the transition and writes history |
| `issue_invoice(order_id, idem_key)` | Takes the next number, snapshots lines, locks them |
| `cancel_invoice(id, reason)` / `correct_invoice(id)` | Cancels with a reason / issues a linked replacement |
| `record_payment(...)`, `record_refund(...)`, `reverse_payment(id, reason)` | Traceable money entries |
| `receive_purchase(purchase_id, idem_key)` | Stock receipts and avg-cost update, exactly once |
| `consume_material(order_line_id, material_id, qty, idem_key)` | Consumption at avg cost; obeys block or override setting |
| `adjust_stock(material_id, qty, type, reason)` | Waste, returns, corrections |

Edge Functions: `invoice-pdf` (staff or the invoice's customer; generates/stores the PDF, returns a 5-minute signed URL) and `shared-invoice` (public secure link; rate-limited). Everything else is a database function.

---

## 6. Accounting definitions (documented, used by all reports)

Revenue is recognised on the **invoice issue date** (accrual). Cash is reported separately.

| Measure | Formula |
|---|---|
| Gross invoice sales | Σ line subtotals before line discounts, issued invoices |
| Discounts | line discounts + order discounts |
| Net sales | gross − discounts − cancelled/credited invoices (tax and delivery shown separately) |
| Collections | Σ payments − Σ refunds, by `received_at` |
| Receivables | Σ open invoice balances |
| Inventory purchases | Σ received purchases (balance-sheet item, **not** an expense) |
| Materials consumed | Σ consumption movements × frozen unit cost |
| Gross profit | net sales − materials consumed − direct labour − other direct costs |
| Net operating profit | gross profit − operating expenses |

Profit is shown as **"Actual"** only when every line in the period has `cost_status = complete`. Otherwise it is labelled **"Incomplete — N orders missing costs"**. Purchases are never also counted as expenses.

---

## 7. Storage

| Bucket | Contents | Access |
|---|---|---|
| `invoices` | Issued PDFs | Private; signed URL via portal or share link |
| `order-images` | Reference and finished photos | Private; customer sees `visibility = customer` only |
| `receipts` | Purchase bills, expense receipts | Private; `finance.view` / `expenses.manage` |
| `branding` | Logo | Public read |

Paths start with `business_id/`, and Storage policies check membership against that prefix.

---

## 8. Secure invoice links

- The token is 32 random bytes in base64url. Only its SHA-256 hash is stored.
- The URL is `/i/<token>`, with no invoice number, name or phone in it.
- The default expiry is 30 days, configurable. The owner can revoke a link at any time.
- `open-share-link` is rate-limited per IP and token, logs each open, and returns invoice data from the snapshot plus a short-lived PDF URL.
- Knowing an invoice number grants nothing.

## 9. Manual WhatsApp (release 1)

The message is built from a template plus live invoice data. The app opens it with `https://wa.me/<e164 without +>?text=<encoded>`. Three buttons: **Open WhatsApp**, **Download PDF**, **Copy message**. The UI states plainly that the PDF must be attached manually. A `MessageChannel` interface (`ManualWhatsApp` now, `WhatsAppCloudAPI` later) keeps billing code unchanged when the API is added.

---

## 10. Project structure

```
sri-sri-boutique/
├─ src/
│  ├─ app/            router, providers, auth guard, layouts
│  ├─ components/ui/  Button, Input, Select, Dialog, Table, Pagination,
│  │                  Toast, EmptyState, Spinner, Money, DateText
│  ├─ features/
│  │  ├─ auth/  dashboard/  customers/  catalogue/  orders/
│  │  ├─ invoices/  payments/  inventory/  purchases/  suppliers/
│  │  ├─ expenses/  deliveries/  reports/  notifications/
│  │  ├─ sharing/      (MessageChannel, whatsapp templates)
│  │  ├─ portal/       (customer-facing pages)
│  │  └─ settings/     (business, staff, permissions)
│  │     each feature: api.ts · hooks.ts · schemas.ts · types.ts · pages/ · components/
│  ├─ lib/            supabase client, money (₹, en-IN), dates (IST), phone (E.164)
│  └─ types/database.ts   (generated by `supabase gen types`)
├─ supabase/
│  ├─ migrations/     0001_tenancy … 00NN_reports_views
│  ├─ functions/      generate-invoice-pdf, create-share-link, open-share-link,
│  │                  invite-staff, invite-customer, link-customer, export-report
│  ├─ tests/          pgTAP: RLS, RPCs, accounting
│  └─ seed.sql        dev-only sample data
├─ tests/e2e/         Playwright: owner, staff, customer flows, mobile viewport
├─ docs/              ARCHITECTURE, SECURITY, ACCOUNTING, DEPLOY, BACKUP
├─ .env.example
└─ README.md
```

Tests: **Vitest** (units, money maths, Zod), **pgTAP** (RLS: a customer tries another customer's IDs, staff without `finance.view` tries cost tables, cross-tenant reads), **Playwright** (end-to-end at phone and desktop widths).

---

## 11. Hosting notes

- Put the Supabase region in **Mumbai (ap-south-1)** for low latency.
- Free-tier Supabase projects pause when idle and have no automatic backups. Use a paid plan for production, with daily backups. Check current pricing before signing up.
- Keep separate Supabase projects for **dev** and **prod**.
- Vercel holds only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

---

## 12. Phase plan

| Phase | Output | Done when |
|---|---|---|
| 2 | Migrations, auth, RLS, RPC skeletons, pgTAP | All isolation tests pass |
| 3 | Design system, layout, role-aware dashboards | Works at 360px and 1440px |
| 4 | Customers, measurements, catalogue, orders, status | Order with multiple lines saved and tracked |
| 5 | Invoicing, PDF, payments, share links | Totals and balances verified by tests |
| 6 | Inventory, purchases, suppliers, consumption, expenses | Receipt is idempotent; avg cost correct |
| 7 | Reports, profit, CSV/Excel export | Every total traces to records |
| 8 | Customer portal, WhatsApp sharing, notifications | Customer sees only own data |
| 9 | Full test run, security audit, load test | No failing tests |
| 10 | Deploy, backups, docs, final checklist | Restore tested |

---

## 13. Decisions (defaults chosen)

GST off; invoice numbers restart each April (`SSB/2026-27/0001`); workers are names without logins; blouse measurement set plus custom fields; customers join by owner invite; stock shortage blocked with owner override; WhatsApp business number stored in settings. All can be changed in Settings.
