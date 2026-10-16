import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useSession } from './session';
import { PageLoader } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/misc';
import type { Permission } from '@/types/models';

/** Signed-in team member (owner/staff). Customers go to the portal; new users to setup. */
export function RequireTeam({ children }: { children: ReactNode }) {
  const { session, loading, current, isCustomerOnly } = useSession();
  const loc = useLocation();
  if (loading) return <PageLoader />;
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (isCustomerOnly) return <Navigate to="/portal" replace />;
  if (!current) return <Navigate to="/setup" replace />;
  return <>{children}</>;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const loc = useLocation();
  if (loading) return <PageLoader />;
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}

/**
 * Hides a page from staff who lack the permission. This is a convenience only:
 * the database refuses the data and actions regardless (RLS + RPC checks).
 */
export function RequirePerm({ any, children }: { any: Permission[]; children: ReactNode }) {
  const { canAny } = useSession();
  if (!canAny(...any)) {
    return (
      <EmptyState
        icon={<ShieldAlert className="h-6 w-6" />}
        title="You don't have access to this page"
        body="Ask the owner to give you permission if you need it."
      />
    );
  }
  return <>{children}</>;
}
