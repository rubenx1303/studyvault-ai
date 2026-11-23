import clsx from 'clsx';
import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

export const cn = clsx;

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('surface rounded-2xl shadow-[0_1px_2px_rgb(0_0_0/0.04)]', className)} {...p} />;
}

export function CardHeader({
  title,
  icon,
  action,
  subtitle,
}: {
  title: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon && <span className="text-muted">{icon}</span>}
        <div className="min-w-0">
          <h2 className="truncate text-[0.92rem] font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="text-muted truncate text-xs">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  disabled,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium whitespace-nowrap transition-all duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-3.5 text-sm',
        variant === 'primary' &&
          'bg-accent-600 text-white shadow-sm shadow-accent-600/20 hover:bg-accent-500',
        variant === 'secondary' && 'surface hover:bg-[var(--surface-2)]',
        variant === 'ghost' && 'text-muted hover:bg-[var(--surface-2)] hover:text-[var(--text)]',
        variant === 'danger' && 'bg-red-500/10 text-red-600 hover:bg-red-500/15 dark:text-red-400',
        className,
      )}
      disabled={disabled || loading}
      {...p}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

const TONES = {
  neutral: 'bg-[var(--surface-2)] text-muted',
  accent: 'bg-accent-500/10 text-accent-600 dark:text-accent-400',
  ok: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  warn: 'bg-amber-500/12 text-amber-700 dark:text-amber-400',
  danger: 'bg-red-500/10 text-red-600 dark:text-red-400',
  muted: 'bg-[var(--surface-2)] text-muted',
};
export type Tone = keyof typeof TONES;

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.7rem] font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={cn('inline-block size-2 shrink-0 rounded-full', className)}
      style={{ background: color }}
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-muted', className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />;
}

export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      {icon && (
        <div className="surface-2 text-muted mb-3 grid size-11 place-items-center rounded-2xl">{icon}</div>
      )}
      <p className="text-sm font-medium">{title}</p>
      {children && <p className="text-muted mt-1 max-w-sm text-xs leading-relaxed">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="animate-in mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="text-muted mb-1 text-xs font-medium">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-muted mt-1 text-sm">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="tablist" className="surface-2 inline-flex max-w-full gap-0.5 overflow-x-auto rounded-xl p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition-colors',
            value === t.id ? 'surface font-medium shadow-sm' : 'text-muted hover:text-[var(--text)]',
          )}
          style={value === t.id ? undefined : { border: '1px solid transparent' }}
        >
          {t.label}
          {t.count !== undefined && <span className="text-muted text-xs tabular-nums">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Select({ className, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn('surface h-9 rounded-xl px-3 text-sm', className)} {...p} />;
}

export function Input({ className, ...p }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn('surface h-9 w-full rounded-xl px-3 text-sm placeholder:text-[var(--muted)]', className)}
      {...p}
    />
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
      {(error as Error).message}
    </div>
  );
}
