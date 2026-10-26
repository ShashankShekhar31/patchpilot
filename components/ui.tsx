"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { SEVERITY_LABEL, type Severity } from "@/lib/severity";
import { CheckIcon, CloseIcon, CopyIcon } from "./icons";

export const SEVERITY_STYLES: Record<
  Severity,
  { badge: string; dot: string; text: string; bar: string; border: string }
> = {
  critical: {
    badge: "border-critical/35 bg-critical/10 text-critical",
    dot: "bg-critical",
    text: "text-critical",
    bar: "bg-critical",
    border: "border-l-critical",
  },
  high: {
    badge: "border-high/35 bg-high/10 text-high",
    dot: "bg-high",
    text: "text-high",
    bar: "bg-high",
    border: "border-l-high",
  },
  medium: {
    badge: "border-medium/35 bg-medium/10 text-medium",
    dot: "bg-medium",
    text: "text-medium",
    bar: "bg-medium",
    border: "border-l-medium",
  },
  low: {
    badge: "border-low/35 bg-low/10 text-low",
    dot: "bg-low",
    text: "text-low",
    bar: "bg-low",
    border: "border-l-low",
  },
  info: {
    badge: "border-info/30 bg-info/10 text-info",
    dot: "bg-info",
    text: "text-info",
    bar: "bg-info",
    border: "border-l-info",
  },
};

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "border-accent/40 bg-accent text-[#04201d] hover:bg-accent-strong hover:text-[#02110f] disabled:bg-accent/40 disabled:text-[#04201d]/60",
  secondary:
    "border-line-strong bg-panel-raised text-ink hover:border-accent/40 hover:bg-panel-raised/80",
  ghost: "border-transparent bg-transparent text-muted hover:bg-white/[0.04] hover:text-ink",
  danger: "border-critical/40 bg-critical/10 text-critical hover:bg-critical/15",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-2.5 text-[12px]",
  md: "h-9 gap-2 px-3.5 text-[13px]",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  className = "",
  children,
  disabled,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex shrink-0 items-center justify-center rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
    />
  );
}

export function SeverityBadge({ severity, className = "" }: { severity: Severity; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-wide ${SEVERITY_STYLES[severity].badge} ${className}`}
    >
      <span className={`size-1.5 rounded-full ${SEVERITY_STYLES[severity].dot}`} aria-hidden />
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

export function Chip({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "warning";
  className?: string;
}) {
  const tones = {
    neutral: "border-line-strong bg-panel-raised text-muted",
    accent: "border-accent/30 bg-accent-soft text-accent",
    warning: "border-medium/30 bg-medium/10 text-medium",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-wide ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

function fallbackCopy(value: string): boolean {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({
  value,
  label = "Copy",
  size = "sm",
  variant = "ghost",
  className = "",
}: {
  value: string;
  label?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function handleCopy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(value);
      ok = true;
    } catch {
      ok = fallbackCopy(value);
    }
    if (!ok) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      onClick={handleCopy}
      aria-label={copied ? "Copied" : label}
    >
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      <span>{copied ? "Copied" : label}</span>
    </Button>
  );
}

export function CodeBlock({
  value,
  language,
  label,
  maxHeight = 260,
  className = "",
}: {
  value: string;
  language?: string;
  label?: string;
  maxHeight?: number;
  className?: string;
}) {
  return (
    <div className={`overflow-hidden rounded border border-line bg-canvas ${className}`}>
      <div className="flex items-center justify-between gap-2 border-b border-line bg-panel px-2 py-1">
        <span className="truncate font-mono text-[10.5px] uppercase tracking-wide text-faint">
          {label ?? language ?? "code"}
        </span>
        <CopyButton value={value} label="Copy" size="sm" variant="ghost" className="h-6 px-1.5" />
      </div>
      <pre
        className="overflow-auto p-3 font-mono text-[11.5px] leading-5 text-ink"
        style={{ maxHeight }}
      >
        <code>{value}</code>
      </pre>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`my-auto w-full ${wide ? "max-w-3xl" : "max-w-xl"} rounded-lg border border-line-strong bg-panel shadow-2xl`}
      >
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
          <h2 id={titleId} className="text-sm font-semibold text-ink">
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded p-1 text-muted hover:bg-white/[0.05] hover:text-ink"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-5 py-4 text-[13px] leading-6 text-muted">
          {children}
        </div>
      </div>
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">{children}</p>
  );
}