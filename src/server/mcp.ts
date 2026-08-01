import {
  createMcpHandler,
  McpServer,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import {
  CourseValidationError,
  createCourse,
  listCourses,
  UUID_PATTERN,
  type Course,
} from "./courses.ts";
import { getHealth } from "./health.ts";
import {
  getLearningDocument,
  getLearningSnapshot,
  LearningRevisionConflictError,
  LearningStateError,
  LearningValidationError,
  type LearningSnapshot,
} from "./learning.ts";
import {
  DatabaseUnavailableError,
  getRuntime,
  requireDatabase,
} from "./runtime.ts";
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

const uuidSchema = z.string().regex(UUID_PATTERN);
const revisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const documentSchema = z.enum(["course", "progress", "journal", "current-day"]);

const compactCourseSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  goal: z.string(),
  status: z.enum(["draft", "active", "completed"]),
  currentDayId: uuidSchema.nullable(),
  currentStage: z.enum(["lecture", "quiz", "remediation", "reflection"]).nullable(),
  revision: revisionSchema,
  outlineApprovedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  updatedAt: z.string(),
}).strict();

const successSchema = <T extends z.ZodType>(data: T) => z.object({
  ok: z.literal(true),
  data,
}).strict();

function runTool<T extends object>(summary: (value: T) => string, operation: () => T) {
  try {
    const value = operation();
    return success(summary(value), value);
  } catch (error) {
    return failure(error);
  }
}

const requiredText = (maximum: number) => z.string().min(1).max(maximum).refine((value) => !value.includes("\0"));
const rubricSchema = z.object({
  authority: z.number().int().min(0).max(25),
  crossValidation: z.number().int().min(0).max(25),
  relevance: z.number().int().min(0).max(20),
  teachingQuality: z.number().int().min(0).max(15),
  currency: z.number().int().min(0).max(10),
  accessibility: z.number().int().min(0).max(5),
}).strict();
const evidenceSchema = z.object({
  sourceId: uuidSchema,
  stance: z.enum(["supports", "opposes", "context"]),
}).strict();
const sourceInputSchema = z.object({
  id: uuidSchema,
  url: requiredText(2_048),
  title: requiredText(500),
  publisher: requiredText(300),
  independenceKey: requiredText(200),
  scores: rubricSchema,
  rank: z.number().int().positive(),
  selected: z.boolean(),
  selectionReason: requiredText(1_000).nullable(),
  limitation: requiredText(2_000).nullable(),
}).strict();
const claimSchema = z.object({
  id: uuidSchema,
  statement: requiredText(5_000),
  major: z.boolean(),
  conclusion: requiredText(5_000),
  uncertainty: requiredText(5_000).nullable(),
  evidence: z.array(evidenceSchema).min(1),
}).strict();
const researchInputSchema = z.object({
  questions: z.array(requiredText(1_000)).min(1).max(20),
  topicCriteria: z.array(requiredText(1_000)).min(1).max(20),
  narrativeMarkdown: requiredText(1_000_000),
  sources: z.array(sourceInputSchema).min(1).max(100),
  claims: z.array(claimSchema).min(1).max(100),
}).strict();
const sourceOutputSchema = sourceInputSchema.extend({ totalScore: z.number().int().min(0).max(100) });
const researchRunSchema = researchInputSchema.omit({ narrativeMarkdown: true }).extend({
  id: uuidSchema,
  scope: z.enum(["course", "day"]),
  dayId: uuidSchema.nullable(),
  sources: z.array(sourceOutputSchema),
  createdAt: z.string(),
});
const learningDaySchema = z.object({
  id: uuidSchema,
  dayNumber: z.number().int().min(1).max(30),
  objective: z.string(),
  completedAt: z.string().nullable(),
}).strict();
const conceptOutputSchema = z.object({ key: z.string(), label: z.string() }).strict();
const quizResponseSchema = z.object({
  id: uuidSchema,
  questionId: uuidSchema,
  responseNumber: z.number().int().positive(),
  answer: z.string(),
  result: z.enum(["correct", "incorrect", "needs_clarification"]),
  feedback: z.string(),
  clarificationQuestion: z.string().nullable(),
  createdAt: z.string(),
}).strict();
const quizQuestionOutputSchema = z.object({
  id: uuidSchema,
  position: z.number().int().min(1).max(5),
  conceptKey: z.string(),
  conceptLabel: z.string(),
  prompt: z.string(),
  gradingCriteria: z.string(),
  responses: z.array(quizResponseSchema),
}).strict();
const quizAttemptSchema = z.object({
  id: uuidSchema,
  attemptNumber: z.number().int().positive(),
  status: z.enum(["in_progress", "passed", "failed"]),
  score: z.number().int().min(0).max(5).nullable(),
  questions: z.array(quizQuestionOutputSchema).length(5),
  createdAt: z.string(),
  gradedAt: z.string().nullable(),
}).strict();
const compactLearningStateSchema = z.object({
  course: compactCourseSchema,
  days: z.array(learningDaySchema).max(30),
  currentDay: learningDaySchema.nullable(),
  researchRuns: z.array(researchRunSchema),
  understoodConcepts: z.array(conceptOutputSchema),
  remediationConcepts: z.array(conceptOutputSchema),
  quizAttempts: z.array(quizAttemptSchema),
  currentDayMarkdown: z.string().nullable(),
}).strict();
const stateOutputSchema = successSchema(z.object({ state: compactLearningStateSchema }).strict());

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

  server.registerTool(
    "list_courses",
    {
      title: "List learning courses",
      description: "Lists local courses with resumable Day, stage, and revision state.",
      inputSchema: safeInputSchema(z.object({}).strict()),
      outputSchema: successSchema(z.object({ courses: z.array(compactCourseSchema) }).strict()),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => withSafeInput(input, () => runTool(
        ({ courses }) => `${courses.length}개의 과정을 찾았습니다.`,
        () => {
          const runtime = getRuntime();
          return { courses: listCourses(requireDatabase(runtime)).map(compactCourse) };
        },
      )),
  );

  server.registerTool(
    "get_learning_state",
    {
      title: "Get resumable learning state",
      description: "Reads the saved current Day, stage, research, concepts, quiz, and current Day Markdown.",
      inputSchema: safeInputSchema(z.object({ courseId: uuidSchema }).strict()),
      outputSchema: stateOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => withSafeInput(input, ({ courseId }) => runTool(
        ({ state }) => `${state.course.title}의 ${state.course.currentStage ?? "완료"} 단계입니다.`,
        () => {
          const runtime = getRuntime();
          const snapshot = getLearningSnapshot(requireDatabase(runtime), runtime.dataRoot, courseId);
          if (!snapshot) throw new LearningStateError("Course does not exist");
          return { state: compactLearningState(snapshot) };
        },
      )),
  );

  server.registerTool(
    "read_learning_document",
    {
      title: "Read a verified learning document",
      description: "Reads one fixed, checksum-verified course, progress, journal, or current-day Markdown document.",
      inputSchema: safeInputSchema(z.object({ courseId: uuidSchema, document: documentSchema }).strict()),
      outputSchema: successSchema(z.object({ course: compactCourseSchema, document: documentSchema, markdown: z.string() }).strict()),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => withSafeInput(input, ({ courseId, document }) => runTool(
        () => `${document} 문서를 읽었습니다.`,
        () => {
          const runtime = getRuntime();
          const found = getLearningDocument(requireDatabase(runtime), runtime.dataRoot, courseId, document);
          if (!found) throw new LearningStateError("Learning document is not available");
          return { course: compactCourse(found.course), document: found.document, markdown: found.markdown };
        },
      )),
  );

  server.registerTool(
    "create_course",
    {
      title: "Create a draft learning course",
      description: "Creates one local draft course idempotently from a reusable request UUID.",
      inputSchema: safeInputSchema(z.object({ requestId: uuidSchema, title: z.string().min(1).max(120), goal: z.string().min(1).max(2_000) }).strict()),
      outputSchema: successSchema(z.object({ course: compactCourseSchema, created: z.boolean() }).strict()),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => withSafeInput(input, (value) => runTool(
        ({ created }) => created ? "새 학습 과정을 만들었습니다." : "같은 요청의 기존 학습 과정을 반환했습니다.",
        () => {
          const runtime = getRuntime();
          const result = createCourse(requireDatabase(runtime), runtime.dataRoot, value);
          return { course: compactCourse(result.course), created: result.created };
        },
      )),
  );

  return server;
}

export const mcpHandler = createMcpHandler(createJustStudyMcpServer, {
  maxSubscriptions: 0,
});
