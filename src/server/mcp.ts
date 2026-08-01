import {
  createMcpHandler,
  McpServer,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { CourseValidationError, type Course } from "./courses.ts";
import { getHealth } from "./health.ts";
import {
  LearningRevisionConflictError,
  LearningStateError,
  LearningValidationError,
  type LearningSnapshot,
} from "./learning.ts";
import { DatabaseUnavailableError, getRuntime } from "./runtime.ts";
import { StorageError } from "./storage.ts";

export type McpErrorCode =
  | "VALIDATION"
  | "STATE"
  | "REVISION_CONFLICT"
  | "STORAGE_CORRUPT"
  | "UNAVAILABLE"
  | "INTERNAL";

export type McpFailure = {
  ok: false;
  error: { code: McpErrorCode; message: string; retryable: boolean };
};

export function toMcpFailure(error: unknown): McpFailure {
  if (error instanceof CourseValidationError || error instanceof LearningValidationError) {
    return { ok: false, error: { code: "VALIDATION", message: error.message, retryable: false } };
  }
  if (error instanceof LearningStateError) {
    return { ok: false, error: { code: "STATE", message: error.message, retryable: false } };
  }
  if (error instanceof LearningRevisionConflictError) {
    return { ok: false, error: { code: "REVISION_CONFLICT", message: "학습 상태가 변경되었습니다. 최신 상태를 다시 읽어 주세요.", retryable: false } };
  }
  if (error instanceof StorageError) {
    return { ok: false, error: { code: "STORAGE_CORRUPT", message: "저장된 학습 데이터의 무결성을 확인할 수 없습니다. 복구 전에는 덮어쓰지 마세요.", retryable: false } };
  }
  if (error instanceof DatabaseUnavailableError) {
    return { ok: false, error: { code: "UNAVAILABLE", message: "데이터베이스를 사용할 수 없습니다.", retryable: true } };
  }
  return { ok: false, error: { code: "INTERNAL", message: "요청을 처리하지 못했습니다.", retryable: false } };
}

function success<T extends object>(summary: string, data: T) {
  const structuredContent = { ok: true as const, data };
  return {
    content: [{ type: "text" as const, text: summary }],
    structuredContent,
  };
}

function failure(error: unknown) {
  const structuredContent = toMcpFailure(error);
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

type SafeInput<T> =
  | { ok: true; value: T }
  | { ok: false };

function safeInputSchema<T extends z.ZodType>(
  schema: T,
): StandardSchemaWithJSON<unknown, SafeInput<z.output<T>>> {
  const standard = {
    ...(schema as unknown as StandardSchemaWithJSON)["~standard"],
    types: undefined,
  };
  return {
    "~standard": {
      ...standard,
      validate: async (value, options) => {
        try {
          const result = await standard.validate(value, options);
          return result.issues !== undefined
            ? { value: { ok: false as const } }
            : { value: { ok: true as const, value: result.value as z.output<T> } };
        } catch {
          return { value: { ok: false as const } };
        }
      },
    },
  };
}

function invalidInput() {
  return failure(new LearningValidationError("요청 형식이 올바르지 않습니다."));
}

function withSafeInput<T, R>(input: SafeInput<T>, operation: (value: T) => R): R | ReturnType<typeof invalidInput> {
  return input.ok ? operation(input.value) : invalidInput();
}

export function compactCourse(course: Course) {
  return {
    id: course.id,
    title: course.title,
    goal: course.goal,
    status: course.status,
    currentDayId: course.currentDayId,
    currentStage: course.currentStage,
    revision: course.revision,
    outlineApprovedAt: course.outlineApprovedAt,
    completedAt: course.completedAt,
    updatedAt: course.updatedAt,
  };
}

export function compactLearningState(snapshot: LearningSnapshot) {
  return {
    course: compactCourse(snapshot.course),
    days: snapshot.days,
    currentDay: snapshot.currentDay,
    researchRuns: snapshot.researchRuns,
    understoodConcepts: snapshot.understoodConcepts,
    remediationConcepts: snapshot.remediationConcepts,
    quizAttempts: snapshot.quizAttempts,
    currentDayMarkdown: snapshot.documents.currentDay,
  };
}

export type CompactCourse = ReturnType<typeof compactCourse>;
export type CompactLearningState = ReturnType<typeof compactLearningState>;

const INSTRUCTIONS = "실제로 확인하지 않은 출처를 만들지 마세요. 쓰기 전 최신 revision을 사용하세요. 충돌·손상 시 자동 재시도하거나 덮어쓰지 마세요. 현재 Day와 stage에 맞는 도구만 호출하세요. 웹 조사는 서버가 아니라 Codex가 수행하며 확인한 URL만 입력하세요.";

export function createJustStudyMcpServer(): McpServer {
  const server = new McpServer(
    { name: "just-study", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "health",
    {
      title: "Check just-study health",
      description: "Checks the local database, Markdown storage, schema, and recovery state.",
      inputSchema: safeInputSchema(z.object({}).strict()),
      outputSchema: z.object({
        ok: z.literal(true),
        data: z.object({
          ok: z.boolean(),
          database: z.enum(["ok", "error"]),
          storage: z.enum(["ok", "error"]),
          schemaVersion: z.number().int().nullable(),
          expectedSchemaVersion: z.number().int(),
          orphanCourseIds: z.array(z.string()),
          missingCourseIds: z.array(z.string()),
          corruptCourseIds: z.array(z.string()),
          temporaryEntries: z.array(z.string()),
          message: z.string(),
        }).strict(),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => withSafeInput(input, () => {
      try {
        const runtime = getRuntime();
        const report = getHealth(runtime.db, runtime.dataRoot);
        return success(report.message, report);
      } catch (error) {
        return failure(error);
      }
    }),
  );
  return server;
}

export const mcpHandler = createMcpHandler(createJustStudyMcpServer, {
  maxSubscriptions: 0,
});
