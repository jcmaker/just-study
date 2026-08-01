import type { ReactNode } from "react";

export function buttonClass(variant: "primary" | "secondary" | "ghost" = "primary"): string {
  const base =
    "tap-target inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold no-underline " +
    "bw radius-md cursor-pointer disabled:cursor-not-allowed disabled:opacity-65";
  if (variant === "primary") {
    return `${base} bg-primary text-primary-foreground border-border shadow-token`;
  }
  if (variant === "secondary") {
    return `${base} bg-card text-card-foreground border-border`;
  }
  return `${base} bg-transparent text-foreground border-transparent`;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`surface p-5 ${className}`}>{children}</div>;
}

export function CardHeader({ title, description, action, headingLevel = 2, id }: {
  title: string;
  description?: string;
  action?: ReactNode;
  headingLevel?: 2 | 3;
  id?: string;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <Heading id={id} className="m-0 text-lg font-bold break-words">{title}</Heading>
        {description ? <p className="mt-1 mb-0 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "muted" }) {
  const tones = {
    neutral: "bg-card text-card-foreground",
    accent: "bg-accent text-accent-foreground",
    muted: "bg-muted text-muted-foreground",
  } as const;
  return (
    <span className={`inline-flex items-center px-2 py-1 text-xs font-semibold bw border-border radius-sm ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function ProgressBar({ completed, approved, percent, label }: {
  completed: number;
  approved: number;
  percent: number;
  label: string;
}) {
  return (
    <div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={approved}
        aria-valuenow={completed}
        aria-valuetext={`${approved}일 중 ${completed}일 완료`}
        className="h-3 w-full bw border-border radius-sm bg-muted overflow-hidden"
      >
        <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 mb-0 text-xs text-muted-foreground">{approved}일 중 {completed}일 완료 ({percent}%)</p>
    </div>
  );
}

export function Alert({ title, children, tone = "warning" }: {
  title: string;
  children: ReactNode;
  tone?: "warning" | "danger";
}) {
  return (
    <div
      role="alert"
      className={`surface p-4 ${tone === "danger" ? "border-destructive" : "border-border"}`}
    >
      <p className={`m-0 font-bold ${tone === "danger" ? "text-destructive" : "text-foreground"}`}>{title}</p>
      <div className="mt-2 text-sm">{children}</div>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`bg-muted radius-sm ${className}`} />;
}
