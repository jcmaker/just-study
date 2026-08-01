"use client";

import { useRouter } from "next/navigation.js";
import { useActionState } from "react";

import {
  initialReflectionState,
  type ReflectionState,
} from "./action-state.ts";
import { submitReflectionAction } from "./actions.ts";
import { buttonClass } from "./ui/primitives.tsx";

const FIELDS = [
  { name: "learned", label: "오늘 무엇을 배웠나요?" },
  { name: "confusing", label: "아직 헷갈리는 것은 무엇인가요?" },
  { name: "feeling", label: "오늘 공부에 대한 한 줄 소감은 무엇인가요?" },
] as const;

type ReflectionFormViewProps = {
  action: string | ((formData: FormData) => void);
  courseId: string;
  onRefresh?: () => void;
  pending: boolean;
  revision: number;
  state: ReflectionState;
};

export function ReflectionFormView({
  action,
  courseId,
  onRefresh,
  pending,
  revision,
  state,
}: ReflectionFormViewProps) {
  const keepSubmitted = state.status === "error" || state.status === "conflict";

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="expectedRevision" value={revision} />

      {FIELDS.map(({ name, label }) => (
        <div key={name}>
          <label htmlFor={`reflection-${name}`}>{label}</label>
          <textarea
            key={`${name}-${state.status}-${revision}`}
            id={`reflection-${name}`}
            name={name}
            defaultValue={keepSubmitted ? state[name] : ""}
            required
            minLength={1}
            maxLength={10000}
            rows={3}
            aria-describedby={`reflection-${name}-help`}
            className="tap-target w-full resize-y bw border-border radius-md bg-input px-3 py-2 text-foreground"
          />
          <p id={`reflection-${name}-help`} className="mt-1 mb-0 text-xs text-muted-foreground">
            1~10,000자로 입력해 주세요.
          </p>
        </div>
      ))}

      {state.status === "conflict" ? (
        <div role="alert" className="grid gap-2 text-sm text-destructive">
          <p className="m-0">{state.message}</p>
          <div>
            <button
              type="button"
              className={buttonClass("secondary")}
              onClick={onRefresh}
            >
              최신 상태 불러오기
            </button>
          </div>
        </div>
      ) : null}
      {state.status === "error" ? (
        <p className="m-0 text-sm text-destructive" role="alert">
          {state.message}
        </p>
      ) : null}
      <p className="m-0 text-sm text-muted-foreground" aria-live="polite">
        {state.status === "saved" ? state.message : ""}
      </p>

      <div>
        <button
          type="submit"
          className={buttonClass("primary")}
          disabled={pending}
        >
          {pending ? "제출 중…" : "회고 제출하고 다음 Day로"}
        </button>
      </div>
    </form>
  );
}

function ReflectionConflictFormView(
  props: Omit<ReflectionFormViewProps, "onRefresh">,
) {
  const router = useRouter();

  return <ReflectionFormView {...props} onRefresh={() => router.refresh()} />;
}

export function ReflectionForm({
  courseId,
  revision,
}: {
  courseId: string;
  revision: number;
}) {
  const [state, action, pending] = useActionState(
    submitReflectionAction,
    initialReflectionState,
  );
  const viewProps = { action, courseId, revision, state, pending };

  return state.status === "conflict" ? (
    <ReflectionConflictFormView {...viewProps} />
  ) : (
    <ReflectionFormView {...viewProps} />
  );
}
