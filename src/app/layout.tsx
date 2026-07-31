import type { Metadata } from "next";
import Link from "next/link.js";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "just-study",
  description: "내 컴퓨터에서 안전하게 이어가는 학습 과정",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <header>
          <Link className="brand" href="/">
            just-study
          </Link>
          <nav aria-label="주요 메뉴">
            <Link href="/">과정</Link>
            <Link href="/status">상태</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
