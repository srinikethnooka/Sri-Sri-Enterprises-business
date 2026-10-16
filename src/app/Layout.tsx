import { useEffect, useState, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  LayoutDashboard, ClipboardList, Users, ReceiptIndianRupee, Truck, Boxes, ShoppingCart, Building2,
  Wallet, BarChart3, Settings, LogOut, Menu, Plus, X,
} from 'lucide-react';
import { useSession } from './session';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import type { Permission } from '@/types/models';
import { Brand } from './Brand';

interface NavItem { to: string; label: string; icon: ComponentType<{ className?: string }>; perms?: Permission[] }

export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/orders', label: 'Orders', icon: ClipboardList, perms: ['orders.manage', 'invoices.manage', 'payments.record', 'delivery.manage', 'inventory.manage'] },
  { to: '/customers', label: 'Customers', icon: Users, perms: ['customers.manage', 'orders.manage'] },
  { to: '/invoices', label: 'Invoices & payments', icon: ReceiptIndianRupee, perms: ['invoices.manage', 'payments.record', 'orders.manage'] },
  { to: '/deliveries', label: 'Deliveries', icon: Truck, perms: ['delivery.manage', 'orders.manage'] },
  { to: '/inventory', label: 'Inventory', icon: Boxes, perms: ['inventory.manage', 'purchasing.manage', 'finance.view'] },
  { to: '/purchases', label: 'Purchases', icon: ShoppingCart, perms: ['purchasing.manage', 'finance.view'] },
  { to: '/suppliers', label: 'Suppliers', icon: Building2, perms: ['purchasing.manage', 'finance.view'] },
  { to: '/expenses', label: 'Expenses', icon: Wallet, perms: ['expenses.manage', 'finance.view'] },
  { to: '/reports', label: 'Reports', icon: BarChart3, perms: ['finance.view', 'payments.record', 'orders.manage', 'inventory.manage', 'customers.manage'] },
  { to: '/settings', label: 'Settings', icon: Settings, perms: ['settings.manage', 'staff.manage'] },
];

function useNav() {
  const { canAny } = useSession();
  return NAV.filter((n) => !n.perms || canAny(...n.perms));
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const items = useNav();
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {items.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.to === '/'}
          onClick={onNavigate}
          className={({ isActive }) => clsx(
            'flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-sm font-medium transition',
            isActive ? 'bg-burgundy-700 text-white shadow-sm' : 'text-ink-700 hover:bg-cream-200',
          )}
        >
          <n.icon className="h-5 w-5 shrink-0" />
          {n.label}
        </NavLink>
      ))}
    </nav>
  );
}

function UserBox() {
  const { session, current, memberships, switchBusiness, signOut } = useSession();
  const navigate = useNavigate();
  const teams = memberships.filter((m) => m.role !== 'customer');
  return (
    <div className="space-y-2 border-t border-cream-300 pt-3">
      {teams.length > 1 && (
        <select className="input" value={current?.business_id} onChange={(e) => switchBusiness(e.target.value)} aria-label="Business">
          {teams.map((m) => <option key={m.business_id} value={m.business_id}>{m.business.name}</option>)}
        </select>
      )}
      <div className="px-1 text-xs text-ink-500">
        <p className="truncate font-medium text-ink-700">{current?.display_name || session?.user.email}</p>
        <p className="capitalize">{current?.role}</p>
      </div>
      <button
        onClick={async () => { await signOut(); navigate('/login'); }}
        className="flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 text-sm text-ink-700 hover:bg-cream-200"
      >
        <LogOut className="h-5 w-5" /> Sign out
      </button>
    </div>
  );
}

export function TeamLayout() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const { can, business } = useSession();
  useEffect(() => setOpen(false), [loc.pathname]);

  return (
    <div className="min-h-screen lg:pl-64">
      {/* Desktop sidebar */}
      <aside className="no-print fixed inset-y-0 left-0 hidden w-64 flex-col gap-4 border-r border-cream-300 bg-cream-50 p-4 lg:flex">
        <Brand name={business?.name} logoPath={business?.logo_path} />
        <div className="flex-1 overflow-y-auto"><NavList /></div>
        <UserBox />
      </aside>

      {/* Top bar */}
      <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-cream-300 bg-cream-50/95 px-3 backdrop-blur lg:px-6">
        <div className="flex items-center gap-2">
          <button className="rounded-lg p-2 hover:bg-cream-200 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-6 w-6" />
          </button>
          <div className="lg:hidden"><Brand name={business?.name} compact /></div>
        </div>
        <div className="flex items-center gap-1">
          {can('orders.manage') && (
            <NavLink to="/orders/new" className="hidden items-center gap-2 rounded-lg bg-burgundy-700 px-3 py-2 text-sm font-medium text-white hover:bg-burgundy-800 sm:inline-flex">
              <Plus className="h-4 w-4" /> New order
            </NavLink>
          )}
          <NotificationBell />
        </div>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-ink-900/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col gap-4 bg-cream-50 p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <Brand name={business?.name} logoPath={business?.logo_path} />
              <button className="rounded-lg p-2 hover:bg-cream-200" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto"><NavList onNavigate={() => setOpen(false)} /></div>
            <UserBox />
          </div>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-3 pb-28 pt-4 sm:px-6 lg:pb-10">
        <Outlet />
      </main>

      {/* Mobile bottom bar */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-cream-300 bg-cream-50/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Quick">
        {[
          { to: '/', label: 'Home', icon: LayoutDashboard, show: true },
          { to: '/orders', label: 'Orders', icon: ClipboardList, show: true },
          { to: '/orders/new', label: 'New order', icon: Plus, show: can('orders.manage') },
          { to: '/customers', label: 'Customers', icon: Users, show: can('customers.manage') || can('orders.manage') },
        ].filter((x) => x.show).map((x) => (
          <NavLink key={x.to} to={x.to} end
            className={({ isActive }) => clsx('flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
              isActive ? 'text-burgundy-700' : 'text-ink-500')}>
            <x.icon className="h-5 w-5" />{x.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
