# Backup and recovery

## What protects the data

| Layer | What it covers |
|---|---|
| Supabase daily backups (paid plans) | Whole database, restorable from the dashboard |
| Point-in-time recovery (add-on) | Restore to any minute — worth it once the shop depends on the app |
| Weekly manual export (below) | Your own copy, outside Supabase |
| Storage | PDFs can be regenerated from the database; photos and bill images must be backed up separately |
| Append-only records | Payments, stock movements, invoice lines and history are never edited or deleted, so mistakes are visible and reversible |

## Weekly manual backup (10 minutes)

```bash
# Database (schema + data). Needs the database password from Settings → Database.
supabase db dump --linked -f backups/schema_$(date +%F).sql
supabase db dump --linked --data-only -f backups/data_$(date +%F).sql

# Photos and bills
supabase storage cp -r ss:///order-images backups/order-images_$(date +%F) --experimental
supabase storage cp -r ss:///receipts backups/receipts_$(date +%F) --experimental
```
Keep at least the last 8 weekly copies in two places (e.g. an external drive and a private cloud folder). The dumps contain customer data — store them encrypted.

The Reports page CSV exports (sales, collections, outstanding, expenses, purchases, stock) are a useful human-readable monthly archive too.

## Restore drill (do it once before going live, then every 3 months)

1. Create a **new** Supabase project (never restore over production to test).
2. `psql "<new project connection string>" -f backups/schema_<date>.sql`
3. `psql "<new project connection string>" -f backups/data_<date>.sql`
4. Point a local copy of the app at it (`.env.local`) and check: today's orders, an invoice total, a customer balance, stock of one material.
5. Write down how long it took. Delete the test project.

## If something goes wrong

- **A record was entered wrongly** → use the correction tools (cancel invoice, reverse payment, return material, void expense). Do not restore a backup for this.
- **Data lost or corrupted** → Supabase Dashboard → Database → Backups → restore the latest good backup (this replaces the database; everything after that backup is lost — export what you can first).
- **Account compromised** → change the owner password, deactivate unknown staff in Settings → Staff, rotate the Supabase keys (Settings → API) and redeploy with the new anon key, review the audit log (`audit_log` table, owner only).
