"use server";

import { revalidatePath } from "next/cache.js";
import { redirect } from "next/navigation.js";

import {
  CourseValidationError,
  createCourse,
} from "../server/courses.ts";
import {
  completeDay,
  LearningRevisionConflictError,
  updateCourseDraft,
} from "../server/learning.ts";
import { getRuntime, requireDatabase } from "../server/runtime.ts";

import type { DraftEditState, ReflectionState } from "./action-state.ts";
import { draftErrorMessage, reflectionErrorMessage } from "./error-messages.ts";

function readExpectedRevision(formData: FormData): number {
  const raw = formData.get("expectedRevision");
  return typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN;
}

export type CreateCourseState = { error: string | null };

export async function createCourseAction(
  _previous: CreateCourseState,
  formData: FormData,
): Promise<CreateCourseState> {
  let courseId: string;

  try {
    const runtime = getRuntime();
    courseId = createCourse(requireDatabase(runtime), runtime.dataRoot, {
      requestId: String(formData.get("requestId") ?? ""),
      title: String(formData.get("title") ?? ""),
      goal: String(formData.get("goal") ?? ""),
    }).course.id;
  } catch (error) {
    return {
      error:
        error instanceof CourseValidationError
          ? error.message
          : "과정을 저장하지 못했습니다. /status에서 상태를 확인한 뒤 다시 시도해 주세요.",
    };
  }

  redirect(`/courses/${courseId}`);
}

export async function updateCourseDraftAction(
  _previous: DraftEditState,
  formData: FormData,
): Promise<DraftEditState> {
  const title = String(formData.get("title") ?? "");
  const goal = String(formData.get("goal") ?? "");
  const courseId = String(formData.get("courseId") ?? "");
  const expectedRevision = readExpectedRevision(formData);

  try {
    const runtime = getRuntime();
    updateCourseDraft(requireDatabase(runtime), runtime.dataRoot, {
      courseId,
      expectedRevision,
      title,
      goal,
    });
  } catch (error) {
    if (error instanceof LearningRevisionConflictError) {
      return {
        status: "conflict",
        message:
          "다른 곳에서 이 과정이 먼저 저장됐습니다. 입력한 내용은 그대로 두었습니다. 최신 상태를 불러온 뒤 다시 저장해 주세요.",
        title,
        goal,
      };
    }
    return { status: "error", message: draftErrorMessage(error), title, goal };
  }

  revalidatePath(`/courses/${courseId}`);
  revalidatePath("/courses");
  revalidatePath("/");
  return { status: "saved", message: "과정 정보를 저장했습니다.", title, goal };
}

export async function submitReflectionAction(
  _previous: ReflectionState,
  formData: FormData,
): Promise<ReflectionState> {
  const learned = String(formData.get("learned") ?? "");
  const confusing = String(formData.get("confusing") ?? "");
  const feeling = String(formData.get("feeling") ?? "");
  const courseId = String(formData.get("courseId") ?? "");
  const expectedRevision = readExpectedRevision(formData);
  const kept = { learned, confusing, feeling };

  try {
    const runtime = getRuntime();
    completeDay(requireDatabase(runtime), runtime.dataRoot, {
      courseId,
      expectedRevision,
      reflection: kept,
    });
  } catch (error) {
    if (error instanceof LearningRevisionConflictError) {
      return {
        status: "conflict",
        message:
          "학습 상태가 먼저 변경됐습니다. 작성한 회고는 그대로 두었습니다. 최신 상태를 불러온 뒤 다시 제출해 주세요.",
        ...kept,
      };
    }
    return { status: "error", message: reflectionErrorMessage(error), ...kept };
  }

  revalidatePath(`/courses/${courseId}`);
  revalidatePath("/courses");
  revalidatePath("/");
  return {
    status: "saved",
    message: "회고를 저장하고 다음 Day로 이동했습니다.",
    learned: "",
    confusing: "",
    feeling: "",
  };
}
