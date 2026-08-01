"use client";

import { useRouter } from "next/navigation.js";
import { useActionState } from "react";

import {
  initialDraftEditState,
  type DraftEditState,
} from "./action-state.ts";
import { updateCourseDraftAction } from "./actions.ts";
import { buttonClass } from "./ui/primitives.tsx";

type DraftFormViewProps = {
  action: string | ((formData: FormData) => void);
  courseId: string;
  goal: string;
  onRefresh?: () => void;
  pending: boolean;
  revision: number;
  state: DraftEditState;
  title: string;
};

export function DraftFormView({
  action,
  courseId,
  goal,
  onRefresh,
  pending,
  revision,
  state,
  title,
}: DraftFormViewProps) {
  const keepSubmitted = state.status === "error" || state.status === "conflict";
  const currentTitle = keepSubmitted ? state.title : title;
  const currentGoal = keepSubmitted ? state.goal : goal;

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="expectedRevision" value={revision} />

      <div>
        <label htmlFor="draft-title">과정 제목</label>
        <input
          key={`title-${state.status}-${revision}`}
          id="draft-title"
          name="title"
          defaultValue={currentTitle}
          required
          minLength={1}
          maxLength={120}
          aria-describedby="draft-title-help"
          className="tap-target w-full bw border-border radius-md bg-input px-3 py-2 text-foreground"
        />
        <p id="draft-title-help" className="mt-1 mb-0 text-xs text-muted-foreground">
          1~120자로 입력해 주세요.
        </p>
      </div>

      <div>
        <label htmlFor="draft-goal">학습 목표</label>
        <textarea
          key={`goal-${state.status}-${revision}`}
          id="draft-goal"
          name="goal"
          defaultValue={currentGoal}
          required
          minLength={1}
          maxLength={2000}
          rows={5}
          aria-describedby="draft-goal-help"
          className="w-full resize-y bw border-border radius-md bg-input px-3 py-2 text-foreground"
        />
        <p id="draft-goal-help" className="mt-1 mb-0 text-xs text-muted-foreground">
          1~2,000자로 입력해 주세요.
        </p>
      </div>

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
          {pending ? "저장 중…" : "변경 사항 저장"}
        </button>
      </div>
    </form>
  );
}

function DraftConflictFormView(
  props: Omit<DraftFormViewProps, "onRefresh">,
) {
  const router = useRouter();

  return <DraftFormView {...props} onRefresh={() => router.refresh()} />;
}

export function DraftForm({
  courseId,
  revision,
  title,
  goal,
}: {
  courseId: string;
  revision: number;
  title: string;
  goal: string;
}) {
  const [state, action, pending] = useActionState(
    updateCourseDraftAction,
    initialDraftEditState,
  );
  const viewProps = {
    action,
    courseId,
    revision,
    title,
    goal,
    state,
    pending,
  };

  return state.status === "conflict" ? (
    <DraftConflictFormView {...viewProps} />
  ) : (
    <DraftFormView {...viewProps} />
  );
}
