import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toE164 } from '@/lib/phone';
import { errorMessage } from '@/lib/errors';
import { useBusinessId } from '@/app/session';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Checkbox, TextAreaField, TextField } from '@/components/ui/Field';
import { ErrorBox } from '@/components/ui/misc';
import { useToast } from '@/components/ui/Toast';
import type { Customer } from '@/types/models';
import { findByPhone } from './api';

const phone = z.string().trim().min(1, 'Enter a phone number').refine((v) => !!toE164(v), 'Enter a valid mobile number');
const schema = z.object({
  full_name: z.string().trim().min(1, 'Enter the name').max(120),
  phone,
  same_whatsapp: z.boolean(),
  whatsapp: z.string().trim().optional(),
  email: z.union([z.literal(''), z.string().trim().email('Enter a valid email')]).optional(),
  address: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(1000).optional(),
}).refine((v) => v.same_whatsapp || !v.whatsapp || !!toE164(v.whatsapp), { path: ['whatsapp'], message: 'Enter a valid WhatsApp number' });
type Form = z.infer<typeof schema>;

export function CustomerFormDialog({
  open, onClose, customer, onSaved,
}: { open: boolean; onClose: () => void; customer?: Customer | null; onSaved?: (c: Customer) => void }) {
  const bid = useBusinessId();
  const qc = useQueryClient();
  const toast = useToast();
  const [err, setErr] = useState<string | null>(null);
  const [dupes, setDupes] = useState<{ id: string; full_name: string; customer_code: string }[] | null>(null);
  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm<Form>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setDupes(null);
    reset({
      full_name: customer?.full_name ?? '',
      phone: customer?.phone_e164 ?? '',
      same_whatsapp: !customer || !customer.whatsapp_e164 || customer.whatsapp_e164 === customer.phone_e164,
      whatsapp: customer?.whatsapp_e164 ?? '',
      email: customer?.email ?? '',
      address: customer?.address ?? '',
      notes: customer?.notes ?? '',
    });
  }, [open, customer, reset]);

  const save = async (v: Form, confirmedDuplicate = false) => {
    setErr(null);
    const p = toE164(v.phone)!;
    if (!confirmedDuplicate) {
      const found = await findByPhone(bid, p, customer?.id);
      if (found.length) { setDupes(found); return; }
    }
    const row = {
      full_name: v.full_name,
      phone_e164: p,
      whatsapp_e164: v.same_whatsapp ? p : v.whatsapp ? toE164(v.whatsapp) : null,
      email: v.email || null,
      address: v.address || null,
      notes: v.notes || null,
    };
    const res = customer
      ? await supabase.from('customers').update(row).eq('id', customer.id).select().single()
      : await supabase.from('customers').insert({ ...row, business_id: bid }).select().single();
    if (res.error) return setErr(errorMessage(res.error));
    qc.invalidateQueries({ queryKey: ['customers'] });
    qc.invalidateQueries({ queryKey: ['customer', res.data.id] });
    toast.success(customer ? 'Customer updated' : `Customer ${res.data.customer_code} added`);
    onSaved?.(res.data as Customer);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={customer ? 'Edit customer' : 'New customer'}
      footer={
        dupes ? (
          <>
            <Button variant="secondary" onClick={() => setDupes(null)}>Change number</Button>
            <Button loading={isSubmitting} onClick={handleSubmit((v) => save(v, true))}>Save anyway</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button loading={isSubmitting} onClick={handleSubmit((v) => save(v))}>Save customer</Button>
          </>
        )
      }
    >
      <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); handleSubmit((v) => save(v))(); }}>
        <TextField label="Full name" required autoFocus {...register('full_name')} error={errors.full_name?.message} />
        <TextField label="Mobile number" required inputMode="tel" placeholder="98765 43210" hint="10-digit numbers get +91 automatically" {...register('phone')} error={errors.phone?.message} />
        <Checkbox label="WhatsApp is on the same number" {...register('same_whatsapp')} />
        {!watch('same_whatsapp') && (
          <TextField label="WhatsApp number" inputMode="tel" {...register('whatsapp')} error={errors.whatsapp?.message} />
        )}
        <TextField label="Email (optional)" type="email" {...register('email')} error={errors.email?.message} />
        <TextAreaField label="Address (optional)" rows={2} {...register('address')} />
        <TextAreaField label="Notes for the team (optional)" hint="Not shown to the customer" rows={2} {...register('notes')} />
        {dupes && (
          <div className="flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="alert">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <div>
              This number is already used by {dupes.map((d) => `${d.full_name} (${d.customer_code})`).join(', ')}.
              Is this a different person?
            </div>
          </div>
        )}
        {err && <ErrorBox message={err} />}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
