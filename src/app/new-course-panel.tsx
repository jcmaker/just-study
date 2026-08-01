"use client";

import { useEffect, useId, useRef, useState } from "react";

import { CourseForm } from "./course-form.tsx";
import { buttonClass } from "./ui/primitives.tsx";

export function NewCoursePanel({ requestId }: { requestId: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        className={buttonClass("primary")}
        onClick={() => setOpen(true)}
      >
        새 과정
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={() => {
          setOpen(false);
          openerRef.current?.focus();
        }}
        className="new-course-dialog w-full max-w-lg bw border-border radius-lg bg-card text-card-foreground p-5 sm:mx-auto max-sm:m-0 max-sm:h-dvh max-sm:max-w-none max-sm:rounded-none"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="mt-0 mb-4 text-xl font-bold">새 과정</h2>
          <button type="button" className={buttonClass("ghost")} onClick={() => setOpen(false)}>닫기</button>
        </div>
        {open ? <CourseForm requestId={requestId} autoFocus /> : null}
      </dialog>
    </>
  );
}
