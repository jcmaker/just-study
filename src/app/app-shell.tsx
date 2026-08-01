import Link from "next/link.js";
import type { ReactNode } from "react";

import { Nav } from "./nav.tsx";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:pl-64">
      <a
        href="#main"
        className="absolute left-2 top-2 z-50 -translate-y-20 bg-card text-card-foreground px-3 py-2 bw border-border radius-md focus:translate-y-0"
      >
        본문으로 건너뛰기
      </a>

      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 bw-b border-sidebar-border bg-sidebar px-4 py-3 lg:hidden">
        <Link href="/" className="text-base font-extrabold text-sidebar-foreground no-underline">just-study</Link>
      </header>

      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-64 lg:flex-col lg:gap-6 lg:bw-r lg:border-sidebar-border lg:bg-sidebar lg:p-4">
        <Link href="/" className="text-lg font-extrabold text-sidebar-foreground no-underline">just-study</Link>
        <nav aria-label="주요 메뉴"><Nav layout="sidebar" /></nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1280px] flex-1 px-4 pt-6 pb-28 lg:pb-10">
          {children}
        </main>
      </div>

      <nav
        aria-label="주요 메뉴"
        className="fixed inset-x-0 bottom-0 z-30 bw-t border-sidebar-border bg-sidebar px-2 pt-1 lg:hidden"
        style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))" }}
      >
        <Nav layout="bottom" />
      </nav>
    </div>
  );
}
