# Deployment

Two separate Supabase projects are recommended: **dev** (for testing) and **prod** (real data). Never test on prod.

## 1. Supabase project

1. supabase.com → New project. Region: **Mumbai (ap-south-1)**. Use a strong database password and keep it in a password manager.
2. Choose a paid plan for production: free projects pause when idle and have no automatic backups. Check current pricing on supabase.com.
3. Install the CLI and link:
   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase db push                       # applies supabase/migrations in order
   ```
4. Edge Functions:
   ```bash
   supabase functions deploy invoice-pdf
   supabase functions deploy shared-invoice --no-verify-jwt
   supabase functions deploy scan-bill
   supabase functions deploy whatsapp-send
   supabase functions deploy whatsapp-webhook --no-verify-jwt   # automatic WhatsApp (docs/WHATSAPP_AUTO.md)
   supabase secrets set APP_ORIGINS=https://<your-domain>
   supabase secrets set ANTHROPIC_API_KEY=<key>      # only if you use Scan bill book (docs/BILL_SCAN.md)
   ```
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically.
   The functions read the DejaVu fonts from `_shared/fonts` (listed as `static_files` in `config.toml`). If your CLI version does not bundle static files, upgrade the CLI.
5. Storage: migration 0010 creates the buckets and policies. Check Storage → Buckets shows `order-images`, `receipts`, `invoices`, `delivery-proofs` (private) and `branding` (public).
6. Auth → URL Configuration:
   - Site URL: `https://<your-domain>`
   - Redirect URLs: `https://<your-domain>/**`
7. Auth → Email: keep "Confirm email" on. Set up a custom SMTP sender (Settings → Auth → SMTP) — the built-in sender is heavily rate limited and meant for testing only.
8. Auth → Rate limits: keep defaults or lower them.

## 2. Frontend on Vercel

1. Push this folder to a private GitHub repository.
2. Vercel → Add New Project → import the repo. Framework: Vite. Build: `npm run build`. Output: `dist`.
3. Environment variables (Production and Preview):
   - `VITE_SUPABASE_URL` = `https://<ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = the **anon** public key
4. Deploy. `vercel.json` adds SPA routing and security headers (no-referrer, no framing, no sniffing).
5. Add your domain in Vercel, then update `APP_ORIGINS` and the Auth URLs to match.

## 3. First login

Open the site → Create account → confirm email → **Set up your boutique** (enter the WhatsApp number, e.g. 89190 93604). Then follow `docs/USER_GUIDE.md`.

## 4. Updating later

```bash
git pull
supabase db push                           # new migrations only; never edit an applied migration
supabase functions deploy invoice-pdf shared-invoice
```
Vercel redeploys on push. Always run `npm test`, `npm run typecheck` and `npm run test:db` first, and try the change on the dev project.

## Optional: WhatsApp Business Platform later

The app only opens WhatsApp with a prefilled message. To send automatically later, implement the `MessageChannel` interface in `src/lib/whatsapp.ts` with a server-side Edge Function that calls the WhatsApp Cloud API using approved templates. Keep the API token in Supabase secrets, never in the frontend.
