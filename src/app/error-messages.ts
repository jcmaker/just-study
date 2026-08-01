import { CourseValidationError } from "../server/courses.ts";
import {
  LearningStateError,
  LearningValidationError,
} from "../server/learning.ts";

export function draftErrorMessage(error: unknown): string {
  if (error instanceof CourseValidationError) return error.message;
  if (error instanceof LearningValidationError) {
    return "입력한 값이 형식에 맞지 않습니다. 제목과 목표의 길이를 확인해 주세요.";
  }
  if (error instanceof LearningStateError) {
    return "초안 상태의 과정만 수정할 수 있습니다. 최신 상태를 다시 불러와 주세요.";
  }
  return "과정을 저장하지 못했습니다. /status에서 상태를 확인한 뒤 다시 시도해 주세요.";
}

export function reflectionErrorMessage(error: unknown): string {
  if (error instanceof LearningValidationError) {
    return "세 답변을 모두 1~10,000자로 작성해 주세요.";
  }
  if (error instanceof LearningStateError) {
    return "지금은 회고를 제출할 수 없습니다. 퀴즈를 모두 통과한 회고 단계에서만 제출할 수 있습니다.";
  }
  return "회고를 저장하지 못했습니다. /status에서 상태를 확인한 뒤 다시 시도해 주세요.";
}
