import { cloneElement, isValidElement, type ReactElement, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, useEffect, useId, useRef } from "react";
import { IconSearch, IconChat } from "./icons";

/* ---------- Button ---------- */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
};

export function Button({ variant = "primary", size = "md", loading, className = "", children, disabled, ...rest }: ButtonProps) {
  const base =
    "inline-flex max-w-full items-center justify-center gap-2 rounded-lg font-semibold leading-5 transition-all duration-150 select-none " +
    "disabled:opacity-40 disabled:cursor-not-allowed active:translate-y-px";
  const sizes = {
    sm: "min-h-9 px-3 py-1.5 text-[13px]",
    md: "min-h-11 px-4 py-2.5 text-sm",
    lg: "min-h-12 px-6 py-3 text-[15px]",
  }[size];
  const variants = {
    primary: "bg-pine-700 text-[#f4f1e8] shadow-card hover:bg-pine-800 hover:shadow-slip",
    secondary: "bg-raised text-ink border border-line-strong hover:border-ink-3 hover:bg-canvas",
    danger: "bg-raised text-danger-fg border border-danger-fg/35 hover:bg-danger-bg",
    ghost: "text-ink-2 hover:text-ink hover:bg-pine-50",
  }[variant];
  return (
    <button type="button" aria-busy={loading || undefined} className={`${base} ${sizes} ${variants} ${className}`} disabled={disabled || loading} {...rest}>
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function Spinner({ className = "size-5" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ---------- Surfaces ---------- */
export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <section className={`min-w-0 rounded-card border border-line bg-surface shadow-card ${className}`}>{children}</section>;
}

export function CardHead({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-5 sm:px-6">
      <div className="min-w-0 flex-1">
        <h2 className="type-h2 text-ink">{title}</h2>
        {sub && <p className="mt-1 text-xs leading-relaxed text-ink-3">{sub}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatTile({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: "accent" }) {
  return (
    <div className="rounded-tile border border-line bg-surface px-4 py-3.5">
      <p className="micro">{label}</p>
      <p className={`mt-1.5 font-display text-[28px] leading-none tabular ${tone === "accent" ? "text-pine-700" : "text-ink"}`}>{value}</p>
      {hint && <p className="mt-1.5 text-[11.5px] text-ink-3">{hint}</p>}
    </div>
  );
}

/* ---------- Badge ---------- */
export function Badge({ tone = "neutral", children }: { tone?: "success" | "warn" | "danger" | "info" | "neutral" | "accent"; children: ReactNode }) {
  const tones = {
    success: "bg-success-bg text-success-fg border-success-fg/20",
    warn: "bg-warn-bg text-warn-fg border-warn-fg/20",
    danger: "bg-danger-bg text-danger-fg border-danger-fg/20",
    info: "bg-info-bg text-info-fg border-info-fg/20",
    neutral: "bg-canvas text-ink-2 border-line-strong",
    accent: "bg-pine-50 text-pine-700 border-pine-200",
  }[tone];
  return <span className={`status-label inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium leading-5 ${tones}`}><span className="size-1.5 shrink-0 rounded-full bg-current opacity-70" aria-hidden="true" />{children}</span>;
}

/* ---------- Field / Input ---------- */
export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  const generatedId = useId();
  const controlId = htmlFor ?? generatedId;
  const descriptionId = `${controlId}-description`;
  const control = isValidElement(children) ? cloneElement(children as ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>, {
    id: controlId,
    "aria-describedby": hint || error ? descriptionId : undefined,
    "aria-invalid": error ? true : undefined,
  }) : children;
  return (
    <div className="min-w-0 space-y-2">
      <label htmlFor={controlId} className="block text-[13px] font-semibold text-ink">
        {label}
      </label>
      {control}
      {hint && !error && <p id={descriptionId} className="text-xs leading-relaxed text-ink-3">{hint}</p>}
      {error && <p id={descriptionId} className="text-xs leading-relaxed text-danger-fg" role="alert">{error}</p>}
    </div>
  );
}

export function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`field-control ${className}`}
      {...rest}
    />
  );
}

export function Textarea({ className = "", ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`field-control min-h-24 resize-y ${className}`}
      {...rest}
    />
  );
}

/* ---------- States ---------- */
export function ErrorNote({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-danger-fg/20 bg-danger-bg px-4 py-3 text-sm text-danger-fg" role="alert">
      <svg className="mt-0.5 size-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 5a1 1 0 112 0v5a1 1 0 11-2 0V5zm1 8a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd" />
      </svg>
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        {children}
        {onRetry && (
          <button onClick={onRetry} className="mt-1 font-semibold underline underline-offset-2">
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, body }: { icon?: ReactNode; title: string; body?: string }) {
  return (
    <div className="empty-state">
      <div className="empty-state-mark" aria-hidden="true">{icon ?? <IconChat className="size-5" />}</div>
      <h2 className="font-display text-2xl tracking-tight text-ink">{title}</h2>
      {body && <p className="max-w-sm text-sm leading-relaxed text-ink-3">{body}</p>}
    </div>
  );
}

export function PageHeading({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="page-heading">
      <div className="min-w-0 max-w-2xl">
        <p className="section-kicker mb-3">Your workspace</p>
        <h1 className="type-h1 text-ink">{title}</h1>
        {sub && <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-3">{sub}</p>}
      </div>
      {actions}
    </div>
  );
}

/* ---------- Modal ---------- */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  sub,
  variant = "modal",
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  sub?: string;
  variant?: "modal" | "drawer";
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const dialog = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <dialog ref={ref} aria-labelledby={titleId} className={`app-dialog ${variant === "drawer" ? "app-drawer" : "app-modal"}`} onCancel={(event) => { event.preventDefault(); if (dismissible) onClose(); }} onClick={(event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      if (dismissible && event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) onClose();
    }}>
      <div className="dialog-header">
        <div className="min-w-0"><p className="section-kicker mb-2">Cleardesk console</p><h2 id={titleId} className="font-display text-2xl tracking-tight text-ink">{title}</h2>{sub && <p className="mt-2 text-sm leading-relaxed text-ink-3">{sub}</p>}</div>
        <button type="button" className="dialog-close" onClick={onClose} disabled={!dismissible} aria-label={`Close ${title}`}>×</button>
      </div>
      <div className="dialog-body">{children}</div>
      {footer && <div className="dialog-footer">{footer}</div>}
    </dialog>
  );
}

/* ---------- Toast ---------- */
export function Toast({ tone, children, onClose }: { tone: "info" | "error" | "success"; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 5200);
    return () => clearTimeout(t);
  }, [onClose]);
  const tones = {
    info: "bg-pine-900 text-[#f4f1e8]",
    error: "bg-danger-fg text-white",
    success: "bg-success-fg text-white",
  }[tone];
  return (
    <div className={`pointer-events-auto fixed bottom-5 left-1/2 z-[60] w-max max-w-[calc(100%_-_2rem)] -translate-x-1/2 rounded-xl px-4 py-3 text-sm font-medium shadow-pop rise ${tones}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function LoadingState({ label = "Loading workspace" }: { label?: string }) {
  return <div role="status" className="loading-state"><span className="sr-only">{label}</span><div className="space-y-5" aria-hidden="true">{[1, 2, 3].map(n => <div key={n} className="flex items-center gap-4"><span className="skeleton size-11 rounded-xl" /><span className="flex-1 space-y-2"><span className="skeleton block h-3 w-1/3 rounded" /><span className="skeleton block h-2.5 w-2/3 rounded" /></span></div>)}</div></div>;
}

export function SearchField({ value, onChange, placeholder = "Search", label = "Search records" }: { value: string; onChange: (value: string) => void; placeholder?: string; label?: string }) {
  return <div className="relative min-w-0 flex-1 sm:max-w-sm"><IconSearch className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" /><Input aria-label={label} type="search" value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} className="!pl-10" /></div>;
}

export function FilterButtons<T extends string>({ value, onChange, options, label }: { value: T; onChange: (value: T) => void; options: { value: T; label: string }[]; label: string }) {
  return <div className="filter-buttons" role="group" aria-label={label}>{options.map(option => <button type="button" key={option.value} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>;
}
