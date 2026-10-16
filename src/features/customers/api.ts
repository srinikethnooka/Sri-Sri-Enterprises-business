import { supabase } from '@/lib/supabase';
import type { Customer, MeasurementSet } from '@/types/models';

/** Removes characters that have meaning in PostgREST filter strings. */
export function safeSearch(s: string): string {
  return s.replace(/[,()*%\\:"']/g, ' ').trim().slice(0, 60);
}

export async function searchCustomers(bid: string, term: string, page: number, pageSize: number) {
  let q = supabase.from('customers').select('*', { count: 'exact' }).eq('business_id', bid).order('created_at', { ascending: false });
  const t = safeSearch(term);
  if (t) {
    const digits = t.replace(/\D/g, '');
    const parts = [`full_name.ilike.*${t}*`, `customer_code.ilike.*${t}*`];
    if (digits.length >= 3) parts.push(`phone_e164.ilike.*${digits}*`);
    q = q.or(parts.join(','));
  }
  const { data, error, count } = await q.range(page * pageSize, page * pageSize + pageSize - 1);
  if (error) throw error;
  return { rows: (data ?? []) as Customer[], total: count ?? 0 };
}

export async function findByPhone(bid: string, phone: string, excludeId?: string) {
  let q = supabase.from('customers').select('id, full_name, customer_code').eq('business_id', bid).eq('phone_e164', phone);
  if (excludeId) q = q.neq('id', excludeId);
  const { data } = await q.limit(5);
  return data ?? [];
}

export async function getCustomer(id: string) {
  const { data, error } = await supabase.from('customers').select('*').eq('id', id).single();
  if (error) throw error;
  return data as Customer;
}

export async function getMeasurements(customerId: string) {
  const { data, error } = await supabase.from('measurement_sets').select('*').eq('customer_id', customerId).order('taken_at', { ascending: false }).limit(50);
  if (error) throw error;
  return (data ?? []) as MeasurementSet[];
}

export const BLOUSE_FIELDS: { key: string; label: string }[] = [
  { key: 'blouse_length', label: 'Blouse length' },
  { key: 'bust', label: 'Bust / chest' },
  { key: 'under_bust', label: 'Under bust' },
  { key: 'waist', label: 'Waist' },
  { key: 'shoulder', label: 'Shoulder' },
  { key: 'armhole', label: 'Armhole' },
  { key: 'sleeve_length', label: 'Sleeve length' },
  { key: 'sleeve_round', label: 'Sleeve round' },
  { key: 'front_neck_depth', label: 'Front neck depth' },
  { key: 'back_neck_depth', label: 'Back neck depth' },
  { key: 'apex', label: 'Apex point' },
  { key: 'dart_point', label: 'Dart point' },
];
