import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, useEffect } from "react";

/* ---------- Button ---------- */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
};

export function Button({ variant = "primary", size = "md", loading, className = "", children, disabled, ...rest }: ButtonProps) {
  const base =
    "inline-flex max-w-full items-center justify-center gap-2 rounded-full font-semibold leading-5 transition-all duration-150 select-none " +
    "disabled:opacity-40 disabled:cursor-not-allowed active:translate-y-px";
  const sizes = {
    sm: "px-3.5 py-1.5 text-[13px]",
    md: "px-4.5 py-2.5 text-sm",
    lg: "px-6 py-3 text-[15px]",
  }[size];
  const variants = {
    primary: "bg-pine-700 text-[#f4f1e8] shadow-card hover:bg-pine-800 hover:shadow-slip",
    secondary: "bg-raised text-ink border border-line-strong hover:border-ink-3 hover:bg-canvas",
    danger: "bg-raised text-danger-fg border border-danger-fg/35 hover:bg-danger-bg",
    ghost: "text-ink-2 hover:text-ink hover:bg-pine-50",
  }[variant];
  return (
    <button className={`${base} ${sizes} ${variants} ${className}`} disabled={disabled || loading} {...rest}>
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
    <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
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
  return <span className={`inline-flex max-w-full shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold leading-5 ${tones}`}>{children}</span>;
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
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[12.5px] font-semibold text-ink-2">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-ink-3">{hint}</p>}
      {error && <p className="text-xs text-danger-fg" role="alert">{error}</p>}
    </div>
  );
}

export function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-lg border border-line-strong bg-raised px-3 py-2 text-sm text-ink placeholder:text-ink-3/70 focus:border-pine-500 focus:outline-none focus:ring-2 focus:ring-pine-600/15 ${className}`}
      {...rest}
    />
  );
}

export function Textarea({ className = "", ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full rounded-lg border border-line-strong bg-raised px-3 py-2 text-sm text-ink placeholder:text-ink-3/70 focus:border-pine-500 focus:outline-none focus:ring-2 focus:ring-pine-600/15 ${className}`}
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
    <div className="flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line-strong bg-surface/60 px-6 py-14 text-center">
      {icon && <div className="text-ink-3">{icon}</div>}
      <p className="font-display text-lg text-ink">{title}</p>
      {body && <p className="max-w-sm text-sm text-ink-2">{body}</p>}
    </div>
  );
}

export function PageHeading({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="type-h1 text-ink">{title}</h1>
        {sub && <p className="mt-1 text-sm text-ink-2">{sub}</p>}
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
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-pine-950/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-md rounded-card border border-line bg-raised p-6 shadow-pop rise"
      >
        <h2 className="font-display text-xl text-ink">{title}</h2>
        <div className="mt-3 text-sm text-ink-2">{children}</div>
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
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
    <div className={`pointer-events-auto fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm font-medium shadow-pop rise ${tones}`} role="status">
      {children}
    </div>
  );
}
