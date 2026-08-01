"use client";

import Link from "next/link.js";
import { usePathname } from "next/navigation.js";

import { NAV_ITEMS, isActiveNav } from "./nav-items.ts";

export function Nav({ layout }: { layout: "sidebar" | "bottom" }) {
  const pathname = usePathname() ?? "/";
  const isSidebar = layout === "sidebar";

  return (
    <ul className={isSidebar ? "m-0 flex list-none flex-col gap-1 p-0" : "m-0 flex list-none items-stretch justify-around gap-1 p-0"}>
      {NAV_ITEMS.map(({ href, label }) => {
        const active = isActiveNav(pathname, href);
        return (
          <li key={href} className={isSidebar ? "" : "flex-1"}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={[
                "tap-target flex items-center justify-center gap-2 px-3 py-2 text-sm no-underline radius-md",
                isSidebar ? "justify-start" : "flex-col text-xs",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-bold bw border-sidebar-border"
                  : "text-sidebar-foreground bw border-transparent",
              ].join(" ")}
            >
              <span aria-hidden="true" className={active ? "inline-block h-2 w-2 bg-sidebar-primary rounded-full" : "inline-block h-2 w-2 rounded-full border border-solid border-sidebar-foreground opacity-40"} />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
