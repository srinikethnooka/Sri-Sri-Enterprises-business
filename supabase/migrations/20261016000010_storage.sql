-- Sri Sri Boutique — 0010 Storage buckets and policies
-- All buckets are private except 'branding' (logo only).
-- Object names must start with '<business_id>/'.
-- Guarded so the file is a no-op where Supabase Storage is not installed (local SQL tests).

do $outer$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice 'storage schema not present; skipping storage setup';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
    ('order-images', 'order-images', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
    ('receipts', 'receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
    ('invoices', 'invoices', false, 5242880, array['application/pdf']),
    ('delivery-proofs', 'delivery-proofs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
    ('branding', 'branding', true, 2097152, array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'])
  on conflict (id) do nothing;

  execute $p$
    create or replace function app.storage_business(name text) returns uuid
    language sql immutable as $f$
      select case when split_part(name, '/', 1) ~ '^[0-9a-f-]{36}$' then split_part(name, '/', 1)::uuid end
    $f$;
    grant execute on function app.storage_business(text) to authenticated;
  $p$;

  -- Team: order images and delivery proofs
  execute $p$
    create policy "team read order files" on storage.objects for select to authenticated
    using (bucket_id in ('order-images', 'delivery-proofs') and app.is_team(app.storage_business(name)));
    create policy "team write order files" on storage.objects for insert to authenticated
    with check (bucket_id in ('order-images', 'delivery-proofs') and app.is_team(app.storage_business(name)));
    create policy "team delete order files" on storage.objects for delete to authenticated
    using (bucket_id in ('order-images', 'delivery-proofs') and app.has_perm(app.storage_business(name), 'orders.manage'));
  $p$;

  -- Customers: only images the shop marked customer-visible on their own orders
  execute $p$
    create policy "customer read own images" on storage.objects for select to authenticated
    using (bucket_id = 'order-images' and exists (
      select 1 from public.attachments a
      join public.orders o on o.id = a.entity_id and a.entity_type = 'order'
      join public.customers c on c.id = o.customer_id
      where a.bucket = 'order-images' and a.path = storage.objects.name
        and a.visibility = 'customer' and c.user_id = auth.uid()));
  $p$;

  -- Receipts: finance / expenses / purchasing only
  execute $p$
    create policy "finance read receipts" on storage.objects for select to authenticated
    using (bucket_id = 'receipts' and app.has_any_perm(app.storage_business(name),
           array['finance.view', 'expenses.manage', 'purchasing.manage']::public.permission_key[]));
    create policy "finance write receipts" on storage.objects for insert to authenticated
    with check (bucket_id = 'receipts' and app.has_any_perm(app.storage_business(name),
           array['expenses.manage', 'purchasing.manage']::public.permission_key[]));
  $p$;

  -- Invoices: written only by the generate-invoice-pdf Edge Function (service role).
  -- Read by invoice/payment staff, or by the customer who owns the invoice.
  execute $p$
    create policy "staff read invoices" on storage.objects for select to authenticated
    using (bucket_id = 'invoices' and app.has_any_perm(app.storage_business(name),
           array['invoices.manage', 'payments.record', 'orders.manage']::public.permission_key[]));
    create policy "customer read own invoices" on storage.objects for select to authenticated
    using (bucket_id = 'invoices' and exists (
      select 1 from public.invoices i join public.customers c on c.id = i.customer_id
      where i.pdf_path = storage.objects.name and i.status = 'issued' and c.user_id = auth.uid()));
  $p$;

  -- Branding: public read (bucket is public); settings.manage writes
  execute $p$
    create policy "settings write branding" on storage.objects for insert to authenticated
    with check (bucket_id = 'branding' and app.has_perm(app.storage_business(name), 'settings.manage'));
    create policy "settings update branding" on storage.objects for update to authenticated
    using (bucket_id = 'branding' and app.has_perm(app.storage_business(name), 'settings.manage'));
  $p$;
end
$outer$;
