import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MailCheck } from 'lucide-react';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { toE164 } from '@/lib/phone';
import { useSession } from '@/app/session';
import { Brand } from '@/app/Brand';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { ErrorBox } from '@/components/ui/misc';
import { PageLoader } from '@/components/ui/Spinner';

const INVITE_KEY = 'ssb.pendingInvite';

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream-100 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center"><Brand /></div>
        <div className="card p-6 sm:p-8">
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
          {!supabaseConfigured && (
            <div className="mt-4"><ErrorBox message="The app is not connected to Supabase yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see README)." /></div>
          )}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-4 text-center text-sm text-ink-500">{footer}</div>}
      </div>
    </div>
  );
}

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
});

export function LoginPage() {
  const { session, loading } = useSession();
  const loc = useLocation();
  const navigate = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });
  const from = (loc.state as { from?: string } | null)?.from;

  if (loading) return <PageLoader />;
  if (session) return <Navigate to={pendingInvitePath() ?? from ?? '/'} replace />;

  return (
    <AuthShell title="Sign in" subtitle="Welcome back." footer={<>New here? <Link className="font-medium text-burgundy-700" to="/signup" state={loc.state}>Create an account</Link></>}>
      <form className="space-y-4" noValidate onSubmit={handleSubmit(async (v) => {
        setErr(null);
        const { error } = await supabase.auth.signInWithPassword(v);
        if (error) setErr(/invalid/i.test(error.message) ? 'Email or password is wrong.' : errorMessage(error));
        else navigate(pendingInvitePath() ?? from ?? '/', { replace: true });
      })}>
        <TextField label="Email" type="email" autoComplete="email" {...register('email')} error={errors.email?.message} />
        <TextField label="Password" type="password" autoComplete="current-password" {...register('password')} error={errors.password?.message} />
        {err && <ErrorBox message={err} />}
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>Sign in</Button>
        <p className="text-center text-sm"><Link className="text-burgundy-700" to="/forgot">Forgot password?</Link></p>
      </form>
    </AuthShell>
  );
}

const signupSchema = z.object({
  full_name: z.string().trim().min(2, 'Enter your name'),
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(8, 'At least 8 characters'),
});

export function SignupPage() {
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof signupSchema>>({ resolver: zodResolver(signupSchema) });
  const pending = pendingInvitePath();

  if (done) {
    return (
      <AuthShell title="Check your email">
        <div className="flex flex-col items-center gap-3 text-center text-sm text-ink-700">
          <MailCheck className="h-10 w-10 text-gold-500" />
          <p>We sent you a confirmation link. Open it on this device to finish creating your account.</p>
          <Link to="/login" className="font-medium text-burgundy-700">Back to sign in</Link>
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell
      title={pending ? 'Create your account to accept the invite' : 'Create an account'}
      footer={<>Already have an account? <Link className="font-medium text-burgundy-700" to="/login">Sign in</Link></>}
    >
      <form className="space-y-4" noValidate onSubmit={handleSubmit(async (v) => {
        setErr(null);
        const { data, error } = await supabase.auth.signUp({
          email: v.email,
          password: v.password,
          options: { data: { full_name: v.full_name }, emailRedirectTo: `${window.location.origin}${pending ?? '/'}` },
        });
        if (error) setErr(errorMessage(error));
        else if (!data.session) setDone(true);
      })}>
        <TextField label="Your name" autoComplete="name" {...register('full_name')} error={errors.full_name?.message} />
        <TextField label="Email" type="email" autoComplete="email" {...register('email')} error={errors.email?.message} />
        <TextField label="Password" type="password" autoComplete="new-password" hint="At least 8 characters" {...register('password')} error={errors.password?.message} />
        {err && <ErrorBox message={err} />}
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>Create account</Button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <AuthShell title="Reset your password" footer={<Link className="text-burgundy-700" to="/login">Back to sign in</Link>}>
      {sent ? (
        <p className="text-sm text-ink-700">If an account exists for <b>{email}</b>, a reset link is on its way. Check your inbox and spam folder.</p>
      ) : (
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          // Same message whether or not the email exists (no account enumeration).
          await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset` });
          setBusy(false);
          setSent(true);
        }}>
          <TextField label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" size="lg" className="w-full" loading={busy}>Send reset link</Button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <AuthShell title="Choose a new password">
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        if (pw.length < 8) { setErr('At least 8 characters'); return; }
        setBusy(true);
        const { error } = await supabase.auth.updateUser({ password: pw });
        setBusy(false);
        if (error) setErr(errorMessage(error));
        else navigate('/', { replace: true });
      }}>
        <TextField label="New password" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        {err && <ErrorBox message={err} />}
        <Button type="submit" size="lg" className="w-full" loading={busy}>Save password</Button>
      </form>
    </AuthShell>
  );
}

const setupSchema = z.object({
  business: z.string().trim().min(2, 'Enter the boutique name'),
  owner: z.string().trim().min(2, 'Enter your name'),
  phone: z.string().trim().optional(),
  whatsapp: z.string().trim().optional(),
  address: z.string().trim().optional(),
});

/** First-time setup: the signed-in user creates their boutique and becomes owner. */
export function SetupPage() {
  const { session, current, isCustomerOnly, refresh, loading } = useSession();
  const navigate = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<z.infer<typeof setupSchema>>({
    resolver: zodResolver(setupSchema),
    defaultValues: { business: 'Sri Sri Boutique', owner: (session?.user.user_metadata?.full_name as string) ?? '' },
  });
  if (loading) return <PageLoader />;
  if (!session) return <Navigate to="/login" replace />;
  if (current) return <Navigate to="/" replace />;
  if (isCustomerOnly) return <Navigate to="/portal" replace />;

  return (
    <AuthShell title="Set up your boutique" subtitle="You will be the owner. You can change these details later in Settings.">
      <form className="space-y-4" noValidate onSubmit={handleSubmit(async (v) => {
        setErr(null);
        const phone = v.phone ? toE164(v.phone) : null;
        const wa = v.whatsapp ? toE164(v.whatsapp) : null;
        if (v.phone && !phone) return setError('phone', { message: 'Enter a valid mobile number' });
        if (v.whatsapp && !wa) return setError('whatsapp', { message: 'Enter a valid WhatsApp number' });
        const { error } = await supabase.rpc('create_business', {
          p_name: v.business, p_owner_name: v.owner, p_phone: phone, p_whatsapp: wa, p_address: v.address || null,
        });
        if (error) return setErr(errorMessage(error));
        await refresh();
        navigate('/', { replace: true });
      })}>
        <TextField label="Boutique name" required {...register('business')} error={errors.business?.message} />
        <TextField label="Your name" required {...register('owner')} error={errors.owner?.message} />
        <TextField label="Shop phone" inputMode="tel" placeholder="98765 43210" {...register('phone')} error={errors.phone?.message} />
        <TextField label="WhatsApp business number" inputMode="tel" placeholder="89190 93604" hint="Shown on invoices and the customer's invoice page." {...register('whatsapp')} error={errors.whatsapp?.message} />
        <TextField label="Address" {...register('address')} />
        {err && <ErrorBox message={err} />}
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>Create boutique</Button>
        <p className="text-center text-xs text-ink-500">Joining an existing boutique? Ask the owner to send you an invite link instead.</p>
      </form>
    </AuthShell>
  );
}

function pendingInvitePath(): string | null {
  try {
    const t = sessionStorage.getItem(INVITE_KEY);
    return t ? `/invite/${t}` : null;
  } catch { return null; }
}

/** /invite/:token — staff or customer portal invite. */
export function AcceptInvitePage() {
  const { token = '' } = useParams();
  const { session, loading, refresh } = useSession();
  const navigate = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Remember the invite across sign-up / email confirmation, without putting it in other URLs.
    try { sessionStorage.setItem(INVITE_KEY, token); } catch { /* ignore */ }
  }, [token]);

  if (loading) return <PageLoader />;
  if (!session) {
    return (
      <AuthShell title="You've been invited" subtitle="Sign in or create an account to accept.">
        <div className="flex flex-col gap-3">
          <Button size="lg" onClick={() => navigate('/signup')}>Create an account</Button>
          <Button size="lg" variant="secondary" onClick={() => navigate('/login')}>I already have an account</Button>
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Accept invite" subtitle={`Signed in as ${session.user.email}`}>
      {err && <div className="mb-4"><ErrorBox message={err} /></div>}
      <Button size="lg" className="w-full" loading={busy} onClick={async () => {
        setBusy(true);
        setErr(null);
        const { data, error } = await supabase.rpc('accept_invite', { p_token: token });
        setBusy(false);
        if (error) return setErr(errorMessage(error));
        try { sessionStorage.removeItem(INVITE_KEY); } catch { /* ignore */ }
        await refresh();
        navigate((data as { role: string }).role === 'customer' ? '/portal' : '/', { replace: true });
      }}>
        Accept invite
      </Button>
    </AuthShell>
  );
}
