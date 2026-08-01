import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { AppShell } from "./app-shell.tsx";
import { DEFAULT_THEME, THEME_BOOTSTRAP_SCRIPT } from "./theme.ts";

export const metadata: Metadata = {
  title: "just-study",
  description: "내 컴퓨터에서 안전하게 이어가는 학습 과정",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko" data-theme={DEFAULT_THEME} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
