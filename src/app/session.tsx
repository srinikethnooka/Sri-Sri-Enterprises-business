import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Business, Permission, Role } from '@/types/models';

export interface Membership {
  id: string;
  business_id: string;
  role: Role;
  display_name: string | null;
  business: Business;
  permissions: Permission[];
}

interface SessionCtx {
  session: Session | null;
  loading: boolean;
  memberships: Membership[];
  /** The team membership in use (owner/staff). Null for customer-only accounts. */
  current: Membership | null;
  business: Business | null;
  isOwner: boolean;
  isCustomerOnly: boolean;
  can: (p: Permission) => boolean;
  canAny: (...p: Permission[]) => boolean;
  switchBusiness: (businessId: string) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionCtx | null>(null);
const KEY = 'ssb.business';

function readStored(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [selected, setSelected] = useState<string | null>(readStored);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) qc.clear();
    });
    return () => data.subscription.unsubscribe();
  }, [qc]);

  const uid = session?.user.id;
  const membershipsQ = useQuery({
    queryKey: ['memberships', uid],
    enabled: !!uid,
    queryFn: async (): Promise<Membership[]> => {
      const { data, error } = await supabase
        .from('business_members')
        .select('id, business_id, role, display_name, business:businesses(*), member_permissions(permission)')
        .eq('user_id', uid!)
        .eq('active', true);
      if (error) throw error;
      return (data ?? []).map((m: Record<string, unknown>) => ({
        id: m.id as string,
        business_id: m.business_id as string,
        role: m.role as Role,
        display_name: m.display_name as string | null,
        business: m.business as Business,
        permissions: ((m.member_permissions as { permission: Permission }[]) ?? []).map((p) => p.permission),
      }));
    },
  });

  const memberships = membershipsQ.data ?? [];
  const team = memberships.filter((m) => m.role !== 'customer');
  const current = team.find((m) => m.business_id === selected) ?? team[0] ?? null;

  const can = useCallback(
    (p: Permission) => !!current && (current.role === 'owner' || current.permissions.includes(p)),
    [current],
  );

  const value = useMemo<SessionCtx>(() => ({
    session,
    loading: !authReady || (!!uid && membershipsQ.isLoading),
    memberships,
    current,
    business: current?.business ?? null,
    isOwner: current?.role === 'owner',
    isCustomerOnly: memberships.length > 0 && team.length === 0,
    can,
    canAny: (...ps: Permission[]) => ps.some(can),
    switchBusiness: (id: string) => {
      setSelected(id);
      try { localStorage.setItem(KEY, id); } catch { /* storage unavailable */ }
      qc.invalidateQueries();
    },
    refresh: async () => { await qc.invalidateQueries({ queryKey: ['memberships'] }); },
    signOut: async () => { await supabase.auth.signOut(); qc.clear(); },
  }), [session, authReady, uid, membershipsQ.isLoading, memberships, current, team.length, can, qc]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSession outside SessionProvider');
  return c;
}

/** Business id of the current team membership; throws if missing (only used inside the team app). */
export function useBusinessId(): string {
  const { current } = useSession();
  if (!current) throw new Error('No business selected');
  return current.business_id;
}
