"use client";

import { startTransition, useEffect, useId, useState } from "react";

import { buttonClass } from "./ui/primitives.tsx";

export function LocalDate({ iso }: { iso: string }) {
  const [text, setText] = useState(iso.slice(0, 10));
  useEffect(() => {
    startTransition(() => {
      setText(new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }));
    });
  }, [iso]);
  return <time dateTime={iso} suppressHydrationWarning>{text}</time>;
}

export function CopyCommand({ command, label = "Codex에서 계속" }: { command: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const commandId = useId();

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(command);
      setState("copied");
    } catch {
      setState("manual");
    }
  }

  return (
    <div>
      <button type="button" className={buttonClass("primary")} onClick={() => { void copy(); }} aria-describedby={commandId}>
        {label}
      </button>
      <p id={commandId} className="mt-2 mb-0 text-sm">
        Codex 대화에 붙여 넣을 명령: <code className="font-mono select-all">{command}</code>
      </p>
      <p aria-live="polite" className="mt-1 mb-0 text-sm">
        {state === "copied" ? "복사됨" : state === "manual" ? "이 브라우저에서 복사 권한이 없어 자동 복사하지 못했습니다. 위 명령을 직접 선택해 복사해 주세요." : ""}
      </p>
    </div>
  );
}
