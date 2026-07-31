"use server";

import { redirect } from "next/navigation.js";

import {
  CourseValidationError,
  createCourse,
} from "../server/courses.ts";
import { getRuntime, requireDatabase } from "../server/runtime.ts";

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
