import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '@/app/session';
import { TeamLayout } from '@/app/Layout';
import { RequireAuth, RequirePerm, RequireTeam } from '@/app/guards';
import { ToastProvider } from '@/components/ui/Toast';
import { PageLoader } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/misc';
import {
  AcceptInvitePage, ForgotPasswordPage, LoginPage, ResetPasswordPage, SetupPage, SignupPage,
} from '@/features/auth/AuthPages';
import { DashboardPage } from '@/features/dashboard/DashboardPage';

// Larger sections load on demand to keep the first load fast on mobile data.
const lz = <T,>(f: () => Promise<T>, name: keyof T) =>
  lazy(() => f().then((m) => ({ default: m[name] as unknown as React.ComponentType })));

const OrdersPage = lz(() => import('@/features/orders/OrdersPage'), 'OrdersPage');
const OrderEditorPage = lz(() => import('@/features/orders/OrderEditorPage'), 'OrderEditorPage');
const ScanBillPage = lz(() => import('@/features/orders/ScanBillPage'), 'ScanBillPage');
const OrderDetailPage = lz(() => import('@/features/orders/OrderDetailPage'), 'OrderDetailPage');
const CustomersPage = lz(() => import('@/features/customers/CustomersPage'), 'CustomersPage');
const CustomerDetailPage = lz(() => import('@/features/customers/CustomerDetailPage'), 'CustomerDetailPage');
const InvoicesPage = lz(() => import('@/features/invoices/InvoicesPage'), 'InvoicesPage');
const InvoiceViewPage = lz(() => import('@/features/invoices/InvoicesPage'), 'InvoiceViewPage');
const DeliveriesPage = lz(() => import('@/features/deliveries/DeliveriesPage'), 'DeliveriesPage');
const MaterialsPage = lz(() => import('@/features/inventory/InventoryPages'), 'MaterialsPage');
const MaterialDetailPage = lz(() => import('@/features/inventory/InventoryPages'), 'MaterialDetailPage');
const PurchasesPage = lz(() => import('@/features/purchases/PurchasePages'), 'PurchasesPage');
const PurchaseEditorPage = lz(() => import('@/features/purchases/PurchasePages'), 'PurchaseEditorPage');
const PurchaseDetailPage = lz(() => import('@/features/purchases/PurchasePages'), 'PurchaseDetailPage');
const SuppliersPage = lz(() => import('@/features/purchases/SuppliersPage'), 'SuppliersPage');
const ExpensesPage = lz(() => import('@/features/expenses/ExpensesPage'), 'ExpensesPage');
const ReportsPage = lz(() => import('@/features/reports/ReportsPage'), 'ReportsPage');
const SettingsLayout = lz(() => import('@/features/settings/SettingsPages'), 'SettingsLayout');
const BusinessSettingsPage = lz(() => import('@/features/settings/SettingsPages'), 'BusinessSettingsPage');
const ServicesPage = lz(() => import('@/features/settings/SettingsPages'), 'ServicesPage');
const WorkersPage = lz(() => import('@/features/settings/SettingsPages'), 'WorkersPage');
const StaffPage = lz(() => import('@/features/settings/SettingsPages'), 'StaffPage');
const PortalHome = lz(() => import('@/features/portal/PortalPages'), 'PortalHome');
const PortalInvoicePage = lz(() => import('@/features/portal/PortalPages'), 'PortalInvoicePage');
const SharedInvoicePage = lz(() => import('@/features/portal/PortalPages'), 'SharedInvoicePage');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true },
    mutations: { retry: 0 },
  },
});

const ORDERS = ['orders.manage', 'invoices.manage', 'payments.record', 'delivery.manage', 'inventory.manage'] as const;

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <SessionProvider>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/signup" element={<SignupPage />} />
                <Route path="/forgot" element={<ForgotPasswordPage />} />
                <Route path="/reset" element={<ResetPasswordPage />} />
                <Route path="/setup" element={<SetupPage />} />
                <Route path="/invite/:token" element={<AcceptInvitePage />} />
                <Route path="/i/:token" element={<SharedInvoicePage />} />
                <Route path="/portal" element={<RequireAuth><PortalHome /></RequireAuth>} />
                <Route path="/portal/invoices/:id" element={<RequireAuth><PortalInvoicePage /></RequireAuth>} />

                <Route element={<RequireTeam><TeamLayout /></RequireTeam>}>
                  <Route index element={<DashboardPage />} />
                  <Route path="orders" element={<RequirePerm any={[...ORDERS]}><OrdersPage /></RequirePerm>} />
                  <Route path="orders/new" element={<RequirePerm any={['orders.manage']}><OrderEditorPage /></RequirePerm>} />
                  <Route path="orders/scan" element={<RequirePerm any={['orders.manage']}><ScanBillPage /></RequirePerm>} />
                  <Route path="orders/:id" element={<RequirePerm any={[...ORDERS]}><OrderDetailPage /></RequirePerm>} />
                  <Route path="orders/:id/edit" element={<RequirePerm any={['orders.manage']}><OrderEditorPage /></RequirePerm>} />
                  <Route path="customers" element={<RequirePerm any={['customers.manage', 'orders.manage']}><CustomersPage /></RequirePerm>} />
                  <Route path="customers/:id" element={<RequirePerm any={['customers.manage', 'orders.manage', 'invoices.manage', 'payments.record']}><CustomerDetailPage /></RequirePerm>} />
                  <Route path="invoices" element={<RequirePerm any={['invoices.manage', 'payments.record', 'orders.manage']}><InvoicesPage /></RequirePerm>} />
                  <Route path="invoices/:id" element={<RequirePerm any={['invoices.manage', 'payments.record', 'orders.manage']}><InvoiceViewPage /></RequirePerm>} />
                  <Route path="deliveries" element={<RequirePerm any={['delivery.manage', 'orders.manage']}><DeliveriesPage /></RequirePerm>} />
                  <Route path="inventory" element={<RequirePerm any={['inventory.manage', 'purchasing.manage', 'finance.view']}><MaterialsPage /></RequirePerm>} />
                  <Route path="inventory/:id" element={<RequirePerm any={['inventory.manage', 'purchasing.manage', 'finance.view']}><MaterialDetailPage /></RequirePerm>} />
                  <Route path="purchases" element={<RequirePerm any={['purchasing.manage', 'finance.view']}><PurchasesPage /></RequirePerm>} />
                  <Route path="purchases/new" element={<RequirePerm any={['purchasing.manage']}><PurchaseEditorPage /></RequirePerm>} />
                  <Route path="purchases/:id" element={<RequirePerm any={['purchasing.manage', 'finance.view']}><PurchaseDetailPage /></RequirePerm>} />
                  <Route path="purchases/:id/edit" element={<RequirePerm any={['purchasing.manage']}><PurchaseEditorPage /></RequirePerm>} />
                  <Route path="suppliers" element={<RequirePerm any={['purchasing.manage', 'finance.view']}><SuppliersPage /></RequirePerm>} />
                  <Route path="expenses" element={<RequirePerm any={['expenses.manage', 'finance.view']}><ExpensesPage /></RequirePerm>} />
                  <Route path="reports" element={<ReportsPage />} />
                  <Route path="settings" element={<RequirePerm any={['settings.manage', 'staff.manage', 'orders.manage']}><SettingsLayout /></RequirePerm>}>
                    <Route index element={<BusinessSettingsPage />} />
                    <Route path="services" element={<RequirePerm any={['settings.manage']}><ServicesPage /></RequirePerm>} />
                    <Route path="workers" element={<RequirePerm any={['settings.manage', 'orders.manage']}><WorkersPage /></RequirePerm>} />
                    <Route path="staff" element={<RequirePerm any={['staff.manage']}><StaffPage /></RequirePerm>} />
                  </Route>
                  <Route path="*" element={<EmptyState title="Page not found" />} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </SessionProvider>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
