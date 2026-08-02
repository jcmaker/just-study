"use client";

import { useRouter } from "next/navigation.js";
import { useActionState } from "react";

import {
  initialQuizAnswerState,
  type QuizAnswerState,
} from "./action-state.ts";
import { submitQuizAnswerAction } from "./actions.ts";
import { buttonClass } from "./ui/primitives.tsx";

export type QuizFormQuestion = {
  id: string;
  position: number;
  prompt: string;
  choices: readonly string[];
};

type QuizFormViewProps = {
  action: string | ((formData: FormData) => void);
  attemptId: string;
  courseId: string;
  onRefresh?: () => void;
  pending: boolean;
  question: QuizFormQuestion;
  revision: number;
  state: QuizAnswerState;
};

export function QuizFormView({
  action,
  attemptId,
  courseId,
  onRefresh,
  pending,
  question,
  revision,
  state,
}: QuizFormViewProps) {
  const keepSelection = state.status === "error" || state.status === "conflict";

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="attemptId" value={attemptId} />
      <input type="hidden" name="questionId" value={question.id} />
      <input type="hidden" name="expectedRevision" value={revision} />

      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="mb-2 font-semibold">
          {question.position}. {question.prompt}
        </legend>
        {question.choices.map((choice, index) => (
          <label
            key={choice}
            htmlFor={`quiz-choice-${index}`}
            className="tap-target flex cursor-pointer items-center gap-2 bw border-border radius-md px-3 py-2"
          >
            <input
              key={`${question.id}-${index}-${state.status}`}
              type="radio"
              id={`quiz-choice-${index}`}
              name="selectedChoiceIndex"
              value={index}
              defaultChecked={keepSelection && state.selectedChoiceIndex === index}
              required
            />
            <span className="break-words">{choice}</span>
          </label>
        ))}
      </fieldset>

      {state.status === "conflict" ? (
        <div role="alert" className="grid gap-2 text-sm text-destructive">
          <p className="m-0">{state.message}</p>
          <div>
            <button type="button" className={buttonClass("secondary")} onClick={onRefresh}>
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
        <button type="submit" className={buttonClass("primary")} disabled={pending}>
          {pending ? "제출 중…" : "답안 제출"}
        </button>
      </div>
    </form>
  );
}

function QuizConflictFormView(props: Omit<QuizFormViewProps, "onRefresh">) {
  const router = useRouter();

  return <QuizFormView {...props} onRefresh={() => router.refresh()} />;
}

export function QuizForm({
  courseId,
  revision,
  attemptId,
  question,
}: {
  courseId: string;
  revision: number;
  attemptId: string;
  question: QuizFormQuestion;
}) {
  const [state, action, pending] = useActionState(
    submitQuizAnswerAction,
    initialQuizAnswerState,
  );
  const viewProps = { action, attemptId, courseId, question, revision, state, pending };

  return state.status === "conflict" ? (
    <QuizConflictFormView {...viewProps} />
  ) : (
    <QuizFormView {...viewProps} />
  );
}
