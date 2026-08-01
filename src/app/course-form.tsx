"use client";

import { useActionState } from "react";

import {
  createCourseAction,
  type CreateCourseState,
} from "./actions.ts";

const initialState: CreateCourseState = { error: null };

type CourseFormViewProps = {
  action: string | ((formData: FormData) => void);
  autoFocus?: boolean;
  pending: boolean;
  requestId: string;
  state: CreateCourseState;
};

export function CourseFormView({
  action,
  autoFocus = false,
  pending,
  requestId,
  state,
}: CourseFormViewProps) {
  return (
    <form action={action}>
      <input type="hidden" name="requestId" value={requestId} />
      <label htmlFor="course-title">과정 이름</label>
      <input
        autoFocus={autoFocus}
        id="course-title"
        name="title"
        minLength={1}
        maxLength={120}
        required
      />
      <label htmlFor="course-goal">30일 뒤 학습 목표</label>
      <textarea
        id="course-goal"
        name="goal"
        minLength={1}
        maxLength={2000}
        required
        rows={5}
      />
      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending}>
        {pending ? "생성 중…" : "과정 만들기"}
      </button>
    </form>
  );
}

export function CourseForm({ requestId, autoFocus = false }: { requestId: string; autoFocus?: boolean }) {
  const [state, action, pending] = useActionState(
    createCourseAction,
    initialState,
  );

  return (
    <CourseFormView
      action={action}
      autoFocus={autoFocus}
      pending={pending}
      requestId={requestId}
      state={state}
    />
  );
}
