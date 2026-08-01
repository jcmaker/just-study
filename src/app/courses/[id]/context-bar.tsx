import Link from "next/link.js";

export function CourseContextBar({ title, dayLabel }: { title: string; dayLabel: string | null }) {
  return (
    <div className="-mx-4 mb-4 flex min-w-0 items-center gap-3 bw-b border-sidebar-border bg-sidebar px-4 py-2 lg:hidden">
      <Link href="/courses" className="tap-target inline-flex shrink-0 items-center px-2 text-sm text-sidebar-foreground no-underline">
        <span aria-hidden="true">←</span>
        <span className="ml-1">과정</span>
      </Link>
      <span className="min-w-0 flex-1 truncate text-sm font-bold text-sidebar-foreground">{title}</span>
      {dayLabel ? <span className="shrink-0 text-xs text-sidebar-foreground">{dayLabel}</span> : null}
    </div>
  );
}
