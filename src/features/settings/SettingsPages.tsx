import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Plus, ShieldAlert, Upload } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { rupees, toNum, UNIT_LABEL } from '@/lib/format';
import { prettyPhone, toE164 } from '@/lib/phone';
import { DEFAULT_TEMPLATE } from '@/lib/whatsapp';
import { useBusinessId, useSession } from '@/app/session';
import { logoUrl } from '@/app/Brand';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Checkbox, SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { Badge, Card, EmptyState, ErrorBox, PageHeader } from '@/components/ui/misc';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { ShareLinkBox } from '@/components/ShareLinkBox';
import { ALL_PERMISSIONS, UNITS, type Business, type Permission, type Service, type Unit, type Worker } from '@/types/models';

export function SettingsLayout() {
  const { can } = useSession();
  const tabs = [
    { to: '/settings', label: 'Business', show: can('settings.manage'), end: true },
    { to: '/settings/services', label: 'Price list', show: can('settings.manage') },
    { to: '/settings/workers', label: 'Workers', show: can('settings.manage') || can('orders.manage') },
    { to: '/settings/staff', label: 'Staff & access', show: can('staff.manage') },
  ].filter((t) => t.show);
  return (
    <div>
      <PageHeader title="Settings" />
      <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-cream-300" aria-label="Settings sections">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => clsx('whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium',
            isActive ? 'border-burgundy-700 text-burgundy-700' : 'border-transparent text-ink-500 hover:text-ink-900')}>{t.label}</NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}

export function BusinessSettingsPage() {
  const bid = useBusinessId();
  const { refresh, can } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const logoInput = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: ['business', bid], queryFn: async () => (await supabase.from('businesses').select('*').eq('id', bid).single()).data as Business });
  const [f, setF] = useState<Record<string, string | boolean>>({});
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!q.data) return;
    const b = q.data;
    setF({
      name: b.name, invoice_prefix: b.invoice_prefix, address: b.address ?? '', phone: b.phone ?? '', whatsapp_e164: b.whatsapp_e164 ?? '',
      email: b.email ?? '', gstin: b.gstin ?? '', payment_instructions: b.payment_instructions ?? '', invoice_footer: b.invoice_footer ?? '',
      tax_enabled: b.tax_enabled, tax_label: b.tax_label, tax_rate: String(toNum(b.tax_rate)), rounding_rule: b.rounding_rule,
      stock_shortage_mode: b.stock_shortage_mode, share_link_days: String(b.share_link_days), whatsapp_template: b.whatsapp_template ?? '',
      whatsapp_auto_send: b.whatsapp_auto_send, whatsapp_template_name: b.whatsapp_template_name, whatsapp_template_lang: b.whatsapp_template_lang,
    });
  }, [q.data]);

  const save = useMutation({
    mutationFn: async () => {
      const phone = f.phone ? toE164(String(f.phone)) : null;
      const wa = f.whatsapp_e164 ? toE164(String(f.whatsapp_e164)) : null;
      if (f.phone && !phone) throw new Error('Shop phone is not valid');
      if (f.whatsapp_e164 && !wa) throw new Error('WhatsApp number is not valid');
      const rate = Number(f.tax_rate || 0);
      if (!Number.isFinite(rate) || rate < 0 || rate > 50) throw new Error('Tax rate must be between 0 and 50');
      const prefix = String(f.invoice_prefix).trim().toUpperCase();
      if (!/^[A-Z0-9]{1,8}$/.test(prefix)) throw new Error('Invoice prefix: 1–8 letters or numbers');
      if (!/^[a-z0-9_]{1,250}$/.test(String(f.whatsapp_template_name || 'invoice_with_pdf'))) throw new Error('WhatsApp template name: small letters, numbers and _ only');
      if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(String(f.whatsapp_template_lang || 'en'))) throw new Error('WhatsApp template language looks like en or en_US');
      const gstin = String(f.gstin).trim().toUpperCase();
      if (gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) throw new Error('GSTIN should be 15 characters, e.g. 36ABCDE1234F1Z5');
      const { error } = await supabase.from('businesses').update({
        name: String(f.name).trim(), invoice_prefix: prefix, address: f.address || null, phone, whatsapp_e164: wa, email: f.email || null,
        gstin: gstin || null, payment_instructions: f.payment_instructions || null, invoice_footer: f.invoice_footer || null,
        tax_enabled: !!f.tax_enabled, tax_label: String(f.tax_label || 'GST'), tax_rate: rate, rounding_rule: f.rounding_rule,
        stock_shortage_mode: f.stock_shortage_mode, share_link_days: Number(f.share_link_days) || 30,
        whatsapp_template: String(f.whatsapp_template).trim() || null,
        whatsapp_auto_send: !!f.whatsapp_auto_send,
        whatsapp_template_name: String(f.whatsapp_template_name || 'invoice_with_pdf').trim(),
        whatsapp_template_lang: String(f.whatsapp_template_lang || 'en').trim(),
      }).eq('id', bid);
      if (error) throw error;
    },
    onSuccess: async () => { await refresh(); qc.invalidateQueries({ queryKey: ['business', bid] }); toast.success('Settings saved'); setErr(null); },
    onError: (e) => setErr(e instanceof Error && !('code' in e) ? e.message : errorMessage(e)),
  });

  const uploadLogo = async (file?: File) => {
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) return toast.error('Use a PNG or JPG logo (it also goes on the PDF)');
    if (file.size > 2_000_000) return toast.error('Logo must be under 2 MB');
    const path = `${bid}/logo-${Date.now()}.${file.type === 'image/png' ? 'png' : 'jpg'}`;
    const up = await supabase.storage.from('branding').upload(path, file, { contentType: file.type });
    if (up.error) return toast.error(errorMessage(up.error));
    const { error } = await supabase.from('businesses').update({ logo_path: path }).eq('id', bid);
    if (error) return toast.error(errorMessage(error));
    await refresh();
    qc.invalidateQueries({ queryKey: ['business', bid] });
    toast.success('Logo updated');
  };

  if (!can('settings.manage')) return <EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="Only people with settings access can change these." />;
  if (q.isLoading || f.name === undefined) return <PageLoader />;
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const v = (k: string) => String(f[k] ?? '');

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <Card title="Boutique details">
        <div className="mb-4 flex items-center gap-4">
          {logoUrl(q.data?.logo_path) ? <img src={logoUrl(q.data?.logo_path)!} alt="Logo" className="h-16 w-16 rounded-lg border border-cream-300 object-contain" />
            : <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-burgundy-700 font-display text-2xl font-bold text-gold-100">SS</div>}
          <input ref={logoInput} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => uploadLogo(e.target.files?.[0])} />
          <Button variant="secondary" icon={<Upload className="h-4 w-4" />} onClick={() => logoInput.current?.click()}>Change logo</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Business name" value={v('name')} onChange={set('name')} />
          <TextField label="Invoice number prefix" value={v('invoice_prefix')} onChange={set('invoice_prefix')} hint="Invoices look like SSB/2026-27/0001 and restart each April" />
          <TextField label="Shop phone" inputMode="tel" value={v('phone')} onChange={set('phone')} />
          <TextField label="WhatsApp business number" inputMode="tel" value={v('whatsapp_e164')} onChange={set('whatsapp_e164')} hint={f.whatsapp_e164 ? prettyPhone(toE164(v('whatsapp_e164'))) : 'Shown on invoices'} />
          <TextField label="Email" type="email" value={v('email')} onChange={set('email')} />
          <TextField label="GSTIN (if registered)" value={v('gstin')} onChange={set('gstin')} />
          <TextAreaField className="sm:col-span-2" label="Address" rows={2} value={v('address')} onChange={set('address')} />
        </div>
      </Card>
      <Card title="Invoices">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextAreaField label="Payment instructions" rows={3} value={v('payment_instructions')} onChange={set('payment_instructions')} placeholder="UPI ID: …  /  Bank: …" />
          <TextAreaField label="Thank-you message" rows={3} value={v('invoice_footer')} onChange={set('invoice_footer')} />
          <div className="space-y-3 sm:col-span-2">
            <Checkbox label="Charge tax (GST) on invoices" checked={!!f.tax_enabled} onChange={(e) => setF((x) => ({ ...x, tax_enabled: e.target.checked }))}
              hint="Turn on only if the boutique is GST-registered. Applies to new invoices; issued invoices never change." />
            {f.tax_enabled && (
              <div className="grid grid-cols-2 gap-3 sm:max-w-md">
                <TextField label="Tax name" value={v('tax_label')} onChange={set('tax_label')} />
                <TextField label="Rate %" inputMode="decimal" value={v('tax_rate')} onChange={set('tax_rate')} />
              </div>
            )}
          </div>
          <SelectField label="Rounding" value={v('rounding_rule')} onChange={set('rounding_rule')}>
            <option value="rupee">Round totals to the nearest rupee</option>
            <option value="none">Keep paise</option>
          </SelectField>
          <TextField label="Secure invoice links expire after (days)" inputMode="numeric" value={v('share_link_days')} onChange={set('share_link_days')} />
        </div>
      </Card>
      <Card title="Inventory">
        <SelectField label="When there isn't enough stock" value={v('stock_shortage_mode')} onChange={set('stock_shortage_mode')}>
          <option value="override">Block, but let the owner approve it</option>
          <option value="block">Always block</option>
        </SelectField>
      </Card>
      <Card title="Send bills on WhatsApp automatically">
        <div className="space-y-3">
          <Checkbox label="Send the bill to the customer on WhatsApp as soon as an invoice is saved"
            hint="Uses the WhatsApp Business Platform. If the customer's number is not on WhatsApp, the bill is only saved. Needs one-time setup (docs/WHATSAPP_AUTO.md)."
            checked={!!f.whatsapp_auto_send} onChange={(e) => setF((x) => ({ ...x, whatsapp_auto_send: e.target.checked }))} />
          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            <TextField label="Approved template name" value={v('whatsapp_template_name')} onChange={set('whatsapp_template_name')} />
            <TextField label="Template language" value={v('whatsapp_template_lang')} onChange={set('whatsapp_template_lang')} />
          </div>
          <WhatsAppReadiness />
        </div>
      </Card>
      <Card title="WhatsApp message (manual sharing)">
        <TextAreaField label="Invoice message template" rows={10} value={v('whatsapp_template')} onChange={set('whatsapp_template')} placeholder={DEFAULT_TEMPLATE}
          hint="Leave empty to use the default. Placeholders: {name} {business} {order_no} {invoice_no} {total} {paid} {balance} {due_date} {link}. Lines with an empty placeholder are left out." />
      </Card>
      {err && <ErrorBox message={err} />}
      <div className="flex justify-end"><Button type="submit" size="lg" loading={save.isPending}>Save settings</Button></div>
    </form>
  );
}

function WhatsAppReadiness() {
  const bid = useBusinessId();
  const q = useQuery({
    queryKey: ['wa-ready', bid],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('whatsapp-send', { body: { check: true, business_id: bid } });
      if (error) throw error;
      return data as { server_ready: boolean };
    },
  });
  if (q.isLoading) return <p className="text-sm text-ink-500">Checking WhatsApp setup…</p>;
  if (q.error) return <p className="text-sm text-amber-800">Could not check the WhatsApp setup (the whatsapp-send function may not be deployed yet).</p>;
  return q.data?.server_ready
    ? <p className="text-sm text-emerald-800">WhatsApp Business connection is set up on the server.</p>
    : <p className="text-sm text-amber-800">WhatsApp Business is not connected yet. Bills will be saved and you can share them by hand until it is set up.</p>;
}

export function ServicesPage() {
  const bid = useBusinessId();
  const qc = useQueryClient();
  const toast = useToast();
  const [edit, setEdit] = useState<Service | 'new' | null>(null);
  const q = useQuery({ queryKey: ['services', bid, 'all'], queryFn: async () => {
    const [s, c] = await Promise.all([
      supabase.from('services').select('*').eq('business_id', bid).order('name'),
      supabase.from('service_categories').select('id, name').eq('business_id', bid).order('sort'),
    ]);
    if (s.error) throw s.error;
    return { services: s.data as Service[], cats: (c.data ?? []) as { id: string; name: string }[] };
  } });
  const toggle = useMutation({
    mutationFn: async (s: Service) => { const { error } = await supabase.from('services').update({ active: !s.active }).eq('id', s.id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading) return <PageLoader />;
  const byCat = (q.data?.cats ?? []).map((c) => ({ ...c, items: (q.data?.services ?? []).filter((s) => s.category_id === c.id) }));
  const uncategorised = (q.data?.services ?? []).filter((s) => !s.category_id);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-500">Prices here are suggestions. You can change the price on each order; issued invoices never change.</p>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>Add service</Button>
      </div>
      {[...byCat, ...(uncategorised.length ? [{ id: 'none', name: 'Other', items: uncategorised }] : [])].filter((c) => c.items.length).map((c) => (
        <Card key={c.id} title={c.name} padded={false}>
          <ul className="divide-y divide-cream-200">
            {c.items.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div>
                  <p className={clsx('font-medium', !s.active && 'text-ink-400 line-through')}>{s.name}</p>
                  {s.description && <p className="text-sm text-ink-500">{s.description}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="num font-semibold">{toNum(s.default_price) ? `${rupees(s.default_price)} / ${UNIT_LABEL[s.unit]}` : <span className="text-amber-700">Set price</span>}</span>
                  <Button size="sm" variant="ghost" onClick={() => setEdit(s)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => toggle.mutate(s)}>{s.active ? 'Hide' : 'Show'}</Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ))}
      {edit && <ServiceDialog service={edit === 'new' ? null : edit} cats={q.data?.cats ?? []} onClose={() => setEdit(null)} />}
    </div>
  );
}

function ServiceDialog({ service, cats, onClose }: { service: Service | null; cats: { id: string; name: string }[]; onClose: () => void }) {
  const bid = useBusinessId();
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    name: service?.name ?? '', category_id: service?.category_id ?? cats[0]?.id ?? '', description: service?.description ?? '',
    default_price: service ? String(toNum(service.default_price)) : '', unit: (service?.unit ?? 'pcs') as Unit,
    standard_cost_estimate: service?.standard_cost_estimate != null ? String(toNum(service.standard_cost_estimate)) : '',
  });
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      if (!f.name.trim()) throw new Error('Enter a name');
      const price = Number(f.default_price || 0);
      if (!Number.isFinite(price) || price < 0) throw new Error('Price must be 0 or more');
      const est = f.standard_cost_estimate ? Number(f.standard_cost_estimate) : null;
      if (est !== null && (!Number.isFinite(est) || est < 0)) throw new Error('Cost estimate must be 0 or more');
      const row = { name: f.name.trim(), category_id: f.category_id || null, description: f.description || null, default_price: price, unit: f.unit, standard_cost_estimate: est };
      const r = service ? await supabase.from('services').update(row).eq('id', service.id) : await supabase.from('services').insert({ ...row, business_id: bid });
      if (r.error) throw r.error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['services'] }); toast.success('Saved'); onClose(); },
    onError: (e) => setErr(e instanceof Error && !('code' in e) ? e.message : errorMessage(e)),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Dialog open onClose={onClose} title={service ? 'Edit service' : 'Add service'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField className="sm:col-span-2" label="Name" required value={f.name} onChange={set('name')} />
        <SelectField label="Category" value={f.category_id} onChange={set('category_id')}>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
        <SelectField label="Unit" value={f.unit} onChange={set('unit')}>
          {UNITS.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
        </SelectField>
        <TextField label="Usual price (₹)" inputMode="decimal" value={f.default_price} onChange={set('default_price')} />
        {can('finance.view') && <TextField label="Typical cost (₹, owner only)" inputMode="decimal" value={f.standard_cost_estimate} onChange={set('standard_cost_estimate')} hint="A planning estimate; never used as actual profit" />}
        <TextAreaField className="sm:col-span-2" label="Description" rows={2} value={f.description} onChange={set('description')} />
      </div>
      {err && <div className="mt-3"><ErrorBox message={err} /></div>}
    </Dialog>
  );
}

export function WorkersPage() {
  const bid = useBusinessId();
  const qc = useQueryClient();
  const toast = useToast();
  const [edit, setEdit] = useState<Worker | 'new' | null>(null);
  const [f, setF] = useState({ name: '', phone: '', skills: '' });
  const q = useQuery({ queryKey: ['workers-all', bid], queryFn: async () => (await supabase.from('workers').select('*').eq('business_id', bid).order('name')).data as Worker[] ?? [] });
  useEffect(() => { if (edit) setF(edit === 'new' ? { name: '', phone: '', skills: '' } : { name: edit.name, phone: edit.phone ?? '', skills: edit.skills ?? '' }); }, [edit]);
  const save = useMutation({
    mutationFn: async ({ id, row }: { id?: string; row: Partial<Worker> }) => {
      const r = id ? await supabase.from('workers').update(row).eq('id', id) : await supabase.from('workers').insert({ ...row, business_id: bid });
      if (r.error) throw r.error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workers'] }); qc.invalidateQueries({ queryKey: ['workers-all'] }); toast.success('Saved'); setEdit(null); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-500">Tailors and embroiderers you assign work to. They don't need a login.</p>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>Add worker</Button>
      </div>
      <Card padded={false}>
        {!q.data?.length ? <EmptyState title="No workers yet" /> : (
          <ul className="divide-y divide-cream-200">
            {q.data.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-2 px-4 py-3">
                <div><p className={clsx('font-medium', !w.active && 'text-ink-400')}>{w.name} {!w.active && '(inactive)'}</p><p className="text-sm text-ink-500">{[prettyPhone(w.phone), w.skills].filter(Boolean).join(' · ')}</p></div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEdit(w)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => save.mutate({ id: w.id, row: { active: !w.active } })}>{w.active ? 'Deactivate' : 'Activate'}</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Dialog open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'Add worker' : 'Edit worker'} size="sm"
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button>
          <Button loading={save.isPending} onClick={() => {
            if (!f.name.trim()) return toast.error('Enter a name');
            const phone = f.phone ? toE164(f.phone) : null;
            if (f.phone && !phone) return toast.error('Phone is not valid');
            save.mutate({ id: edit && edit !== 'new' ? edit.id : undefined, row: { name: f.name.trim(), phone, skills: f.skills || null } });
          }}>Save</Button></>}>
        <div className="space-y-3">
          <TextField label="Name" required value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} />
          <TextField label="Phone" inputMode="tel" value={f.phone} onChange={(e) => setF((x) => ({ ...x, phone: e.target.value }))} />
          <TextField label="Skills" placeholder="Maggam, stitching…" value={f.skills} onChange={(e) => setF((x) => ({ ...x, skills: e.target.value }))} />
        </div>
      </Dialog>
    </div>
  );
}

interface Member { id: string; user_id: string; role: 'owner' | 'staff' | 'customer'; display_name: string | null; active: boolean; member_permissions: { permission: Permission }[] }

export function StaffPage() {
  const bid = useBusinessId();
  const { isOwner, session } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const q = useQuery({ queryKey: ['staff', bid], queryFn: async () => {
    const { data, error } = await supabase.from('business_members').select('id, user_id, role, display_name, active, member_permissions(permission)')
      .eq('business_id', bid).in('role', ['owner', 'staff']).order('created_at');
    if (error) throw error;
    return data as Member[];
  } });
  const setActive = useMutation({
    mutationFn: async (m: Member) => { const { error } = await supabase.rpc('set_member_active', { p_member_id: m.id, p_active: !m.active }); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-500">Staff see only what you allow. Costs, margins and profit stay hidden unless you grant “See costs, margins and profit”.</p>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setInviting(true)}>Invite staff</Button>
      </div>
      <Card padded={false}>
        {q.isLoading ? <PageLoader /> : (
          <ul className="divide-y divide-cream-200">
            {q.data?.map((m) => (
              <li key={m.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                <div>
                  <p className="font-medium">{m.display_name || 'Unnamed'} {m.role === 'owner' && <Badge tone="gold">Owner</Badge>} {!m.active && <Badge tone="danger">Inactive</Badge>}
                    {m.user_id === session?.user.id && <span className="text-xs text-ink-500"> (you)</span>}</p>
                  <p className="mt-1 flex flex-wrap gap-1">
                    {m.role === 'owner' ? <span className="text-sm text-ink-500">Full access</span>
                      : m.member_permissions.length ? m.member_permissions.map((p) => <Badge key={p.permission} tone={ALL_PERMISSIONS.find((x) => x.key === p.permission)?.sensitive ? 'warn' : 'neutral'}>{ALL_PERMISSIONS.find((x) => x.key === p.permission)?.label}</Badge>)
                      : <span className="text-sm text-ink-500">No access yet</span>}
                  </p>
                </div>
                {m.role === 'staff' && m.user_id !== session?.user.id && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(m)}>Permissions</Button>
                    <Button size="sm" variant="ghost" onClick={() => setActive.mutate(m)}>{m.active ? 'Deactivate' : 'Activate'}</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {inviting && <InviteStaffDialog onClose={() => setInviting(false)} isOwner={isOwner} />}
      {editing && <PermissionsDialog member={editing} isOwner={isOwner} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PermissionPicker({ value, onChange, isOwner }: { value: Permission[]; onChange: (p: Permission[]) => void; isOwner: boolean }) {
  return (
    <div className="space-y-2">
      {ALL_PERMISSIONS.map((p) => {
        const ownerOnly = p.key === 'finance.view' || p.key === 'staff.manage';
        return (
          <Checkbox key={p.key} label={<>{p.label} {p.sensitive && <Badge tone="warn">Sensitive</Badge>}</>}
            hint={ownerOnly && !isOwner ? 'Only the owner can change this' : undefined}
            disabled={ownerOnly && !isOwner}
            checked={value.includes(p.key)}
            onChange={(e) => onChange(e.target.checked ? [...value, p.key] : value.filter((x) => x !== p.key))} />
        );
      })}
    </div>
  );
}

function PermissionsDialog({ member, isOwner, onClose }: { member: Member; isOwner: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [perms, setPerms] = useState<Permission[]>(member.member_permissions.map((p) => p.permission));
  const [confirm, setConfirm] = useState(false);
  const hadFinance = member.member_permissions.some((p) => p.permission === 'finance.view');
  const save = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc('set_member_permissions', { p_member_id: member.id, p_perms: perms }); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['staff'] }); toast.success('Permissions saved'); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <Dialog open onClose={onClose} title={`Access for ${member.display_name ?? 'staff'}`}
        footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} onClick={() => (perms.includes('finance.view') && !hadFinance ? setConfirm(true) : save.mutate())}>Save</Button></>}>
        <PermissionPicker value={perms} onChange={setPerms} isOwner={isOwner} />
      </Dialog>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="Share profit information?" confirmLabel="Yes, allow"
        message="This person will see material costs, labour costs, margins, supplier balances and profit reports. This is recorded in the audit log."
        onConfirm={() => { setConfirm(false); save.mutate(); }} />
    </>
  );
}

function InviteStaffDialog({ onClose, isOwner }: { onClose: () => void; isOwner: boolean }) {
  const bid = useBusinessId();
  const { business } = useSession();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [perms, setPerms] = useState<Permission[]>(['customers.manage', 'orders.manage']);
  const [link, setLink] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error('Enter their name');
      const { data, error } = await supabase.rpc('create_invite', { p_business_id: bid, p_kind: 'staff', p_display_name: name.trim(), p_permissions: perms });
      if (error) throw error;
      return `${window.location.origin}/invite/${data as string}`;
    },
    onSuccess: setLink,
    onError: (e) => setErr(e instanceof Error && !('code' in e) ? e.message : errorMessage(e)),
  });
  return (
    <Dialog open onClose={onClose} title="Invite staff" description="They open the link, create an account, and join with the access you choose."
      footer={!link && <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={create.isPending} onClick={() => create.mutate()}>Create invite link</Button></>}>
      {link ? (
        <ShareLinkBox url={link} phone={toE164(phone)} message={`Hello ${name}, you're invited to join ${business?.name ?? 'our boutique'} on our shop app. Open this link to create your account (valid for 7 days): ${link}`} />
      ) : (
        <div className="space-y-4">
          <TextField label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
          <TextField label="WhatsApp number (to send the link)" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <div><p className="label">What can they do?</p><PermissionPicker value={perms} onChange={setPerms} isOwner={isOwner} /></div>
          {err && <ErrorBox message={err} />}
        </div>
      )}
    </Dialog>
  );
}
