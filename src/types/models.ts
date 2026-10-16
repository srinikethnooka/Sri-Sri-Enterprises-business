// Row shapes used by the UI. Numeric columns arrive from PostgREST as numbers or
// strings depending on size, so money is typed as number | string and passed through toNum().
export type Money = number | string;

export type Role = 'owner' | 'staff' | 'customer';
export type Permission =
  | 'customers.manage' | 'orders.manage' | 'invoices.manage' | 'payments.record'
  | 'inventory.manage' | 'purchasing.manage' | 'delivery.manage' | 'expenses.manage'
  | 'finance.view' | 'reports.export' | 'staff.manage' | 'settings.manage';

export const ALL_PERMISSIONS: { key: Permission; label: string; sensitive?: boolean }[] = [
  { key: 'customers.manage', label: 'Customers & measurements' },
  { key: 'orders.manage', label: 'Create and update orders' },
  { key: 'invoices.manage', label: 'Issue and cancel invoices' },
  { key: 'payments.record', label: 'Record payments and refunds' },
  { key: 'delivery.manage', label: 'Deliveries' },
  { key: 'inventory.manage', label: 'Inventory and material use' },
  { key: 'purchasing.manage', label: 'Purchases and suppliers' },
  { key: 'expenses.manage', label: 'Expenses' },
  { key: 'finance.view', label: 'See costs, margins and profit', sensitive: true },
  { key: 'reports.export', label: 'Export reports', sensitive: true },
  { key: 'staff.manage', label: 'Manage staff', sensitive: true },
  { key: 'settings.manage', label: 'Business settings and price list' },
];

export type OrderStatus =
  | 'draft' | 'confirmed' | 'in_progress' | 'waiting_materials' | 'quality_check'
  | 'ready' | 'out_for_delivery' | 'delivered' | 'cancelled';

export const NEXT_STATUSES: Record<OrderStatus, OrderStatus[]> = {
  draft: ['confirmed', 'cancelled'],
  confirmed: ['in_progress', 'waiting_materials', 'cancelled'],
  in_progress: ['waiting_materials', 'quality_check', 'ready', 'cancelled'],
  waiting_materials: ['in_progress', 'cancelled'],
  quality_check: ['in_progress', 'ready', 'cancelled'],
  ready: ['out_for_delivery', 'delivered', 'quality_check', 'cancelled'],
  out_for_delivery: ['delivered', 'ready', 'cancelled'],
  delivered: [],
  cancelled: [],
};

export type Unit = 'pcs' | 'm' | 'g' | 'ml' | 'roll' | 'set' | 'hour' | 'job';
export const UNITS: Unit[] = ['pcs', 'm', 'g', 'ml', 'roll', 'set', 'hour', 'job'];
export type PaymentMethod = 'cash' | 'upi' | 'bank' | 'card' | 'other';
export type DeliveryMethod = 'pickup' | 'local_delivery' | 'courier' | 'rapido';

export interface Business {
  id: string;
  name: string;
  invoice_prefix: string;
  logo_path: string | null;
  address: string | null;
  phone: string | null;
  whatsapp_e164: string | null;
  email: string | null;
  gstin: string | null;
  payment_instructions: string | null;
  invoice_footer: string | null;
  tax_enabled: boolean;
  tax_label: string;
  tax_rate: Money;
  rounding_rule: 'rupee' | 'none';
  stock_shortage_mode: 'block' | 'override';
  share_link_days: number;
  whatsapp_template: string | null;
  whatsapp_auto_send: boolean;
  whatsapp_template_name: string;
  whatsapp_template_lang: string;
}

export interface Customer {
  id: string;
  business_id: string;
  customer_code: string;
  full_name: string;
  phone_e164: string;
  whatsapp_e164: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  user_id: string | null;
  active: boolean;
  created_at: string;
  whatsapp_status: 'unknown' | 'yes' | 'no';
}

export interface MeasurementSet {
  id: string;
  customer_id: string;
  garment_type: string;
  values: Record<string, number | string>;
  unit: 'inch' | 'cm';
  notes: string | null;
  taken_at: string;
}

export interface Service {
  id: string;
  business_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  default_price: Money;
  unit: Unit;
  standard_cost_estimate: Money | null;
  active: boolean;
}

export interface Worker {
  id: string;
  name: string;
  phone: string | null;
  skills: string | null;
  active: boolean;
}

export interface Order {
  id: string;
  business_id: string;
  order_no: string;
  customer_id: string;
  status: OrderStatus;
  order_date: string;
  due_at: string | null;
  delivery_method: DeliveryMethod;
  delivery_address: string | null;
  measurement_set_id: string | null;
  assigned_worker_id: string | null;
  customer_notes: string | null;
  items_subtotal: Money;
  order_discount: Money;
  delivery_charge: Money;
  taxable_amount: Money;
  tax_rate: Money;
  tax_amount: Money;
  round_off: Money;
  total: Money;
  cancelled_reason: string | null;
  created_at: string;
}

export interface OrderLine {
  id: string;
  order_id: string;
  position: number;
  service_id: string | null;
  description: string;
  customer_description: string | null;
  garment_details: string | null;
  qty: Money;
  unit: Unit;
  unit_price: Money;
  line_discount: Money;
  line_subtotal: Money;
  internal_notes: string | null;
}

export interface Invoice {
  id: string;
  business_id: string;
  invoice_no: string;
  order_id: string;
  customer_id: string;
  status: 'issued' | 'cancelled';
  issued_at: string;
  total: Money;
  pdf_path: string | null;
  replaces_invoice_id: string | null;
  cancel_reason: string | null;
  cancelled_at: string | null;
}

export interface Payment {
  id: string;
  order_id: string;
  invoice_id: string | null;
  kind: 'payment' | 'refund' | 'reversal';
  amount: Money;
  signed_amount: Money;
  method: PaymentMethod;
  reference_no: string | null;
  received_at: string;
  note: string | null;
  reverses_payment_id: string | null;
}

export interface Material {
  id: string;
  business_id: string;
  code: string;
  name: string;
  category: string | null;
  unit: Unit;
  reorder_level: Money;
  default_supplier_id: string | null;
  on_hand: Money;
  avg_cost: Money;
  active: boolean;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  gstin: string | null;
  notes: string | null;
  active: boolean;
}

/** Customer-safe invoice payload (shared link, portal, PDF). */
export interface InvoicePayload {
  invoice: {
    id?: string;
    invoice_no: string;
    status: 'issued' | 'cancelled';
    issued_at: string;
    items_subtotal: Money;
    order_discount: Money;
    delivery_charge: Money;
    taxable_amount: Money;
    tax_label: string | null;
    tax_rate: Money;
    tax_amount: Money;
    round_off: Money;
    total: Money;
    snapshot: {
      business: { name: string; address?: string | null; phone?: string | null; whatsapp?: string | null;
        email?: string | null; gstin?: string | null; payment_instructions?: string | null; footer?: string | null };
      customer: { name: string; code: string; phone?: string | null; address?: string | null };
      order: { order_no: string; order_date?: string | null; due_at?: string | null; notes?: string | null };
    };
  };
  lines: { description: string; qty: Money; unit: Unit; unit_price: Money; line_discount: Money; line_subtotal: Money }[];
  paid: Money;
  balance: Money;
  payments: { kind: string; amount: Money; method: string; received_at: string }[];
  order_status: OrderStatus;
  due_at: string | null;
}
