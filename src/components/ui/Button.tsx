import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import clsx from 'clsx';
import { Link, type LinkProps } from 'react-router-dom';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold';
type Size = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition select-none ' +
  'disabled:cursor-not-allowed disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-burgundy-400 focus-visible:ring-offset-2';
const variants: Record<Variant, string> = {
  primary: 'bg-burgundy-700 text-white hover:bg-burgundy-800 active:bg-burgundy-900 shadow-sm',
  secondary: 'bg-white text-ink-900 border border-cream-300 hover:bg-cream-50 hover:border-gold-300 shadow-sm',
  ghost: 'text-ink-700 hover:bg-cream-200',
  danger: 'bg-white text-burgundy-700 border border-burgundy-200 hover:bg-burgundy-50',
  gold: 'bg-gold-500 text-white hover:bg-gold-700 shadow-sm',
};
const sizes: Record<Size, string> = {
  sm: 'min-h-[36px] px-3 text-sm',
  md: 'min-h-[44px] px-4 text-sm',
  lg: 'min-h-[52px] px-5 text-base',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={clsx(base, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner className="h-4 w-4" /> : icon}
      {children}
    </button>
  );
});

export function ButtonLink({
  variant = 'primary', size = 'md', icon, className, children, ...rest
}: LinkProps & { variant?: Variant; size?: Size; icon?: ReactNode }) {
  return (
    <Link className={clsx(base, variants[variant], sizes[size], className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}
