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
import { getHealth, isUninitializedDataRoot } from "./health.ts";
import {
  approveOutline,
  completeDay,
  getLearningDocument,
  getLearningSnapshot,
  gradeQuiz,
  LearningRevisionConflictError,
  LearningStateError,
  LearningValidationError,
  recordDailyResearch,
  saveLearningCheckpoint,
  startQuiz,
  startRemediationQuiz,
  type LearningSnapshot,
} from "./learning.ts";
import type { DatabaseHandle } from "./database.ts";
import {
  DatabaseUnavailableError,
  getReadOnlyRuntime,
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
    currentDayNumber: null as number | null,
    currentStage: course.currentStage,
    revision: course.revision,
    outlineApprovedAt: course.outlineApprovedAt,
    completedAt: course.completedAt,
    updatedAt: course.updatedAt,
  };
}

export function compactLearningState(snapshot: LearningSnapshot) {
  return {
    course: { ...compactCourse(snapshot.course), currentDayNumber: snapshot.currentDay?.dayNumber ?? null },
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
  currentDayNumber: z.number().int().min(1).max(30).nullable(),
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
const researchLocalKeySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
const rubricSchema = z.object({
  authority: z.number().int().min(0).max(25),
  crossValidation: z.number().int().min(0).max(25),
  relevance: z.number().int().min(0).max(20),
  teachingQuality: z.number().int().min(0).max(15),
  currency: z.number().int().min(0).max(10),
  accessibility: z.number().int().min(0).max(5),
}).strict();
const evidenceSchema = z.object({
  sourceId: researchLocalKeySchema,
  stance: z.enum(["supports", "opposes", "context"]),
}).strict();
const sourceInputSchema = z.object({
  id: researchLocalKeySchema,
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
  id: researchLocalKeySchema,
  statement: requiredText(5_000),
  major: z.boolean(),
  conclusion: requiredText(5_000),
  uncertainty: requiredText(5_000).nullable(),
  evidence: z.array(evidenceSchema).min(1),
}).strict();
const researchInputObjectSchema = z.object({
  questions: z.array(requiredText(1_000)).min(1).max(20),
  topicCriteria: z.array(requiredText(1_000)).min(1).max(20),
  narrativeMarkdown: requiredText(1_000_000),
  sources: z.array(sourceInputSchema).min(1).max(100),
  claims: z.array(claimSchema).min(1).max(100),
}).strict();
const researchInputSchema = researchInputObjectSchema.superRefine((research, context) => {
  const sourceIds = new Set<string>();
  research.sources.forEach((source, index) => {
    if (sourceIds.has(source.id)) context.addIssue({ code: "custom", path: ["sources", index, "id"], message: "source ID is duplicated" });
    sourceIds.add(source.id);
  });
  const claimIds = new Set<string>();
  research.claims.forEach((claim, claimIndex) => {
    if (claimIds.has(claim.id)) context.addIssue({ code: "custom", path: ["claims", claimIndex, "id"], message: "claim ID is duplicated" });
    claimIds.add(claim.id);
    const evidenceKeys = new Set<string>();
    claim.evidence.forEach((evidence, evidenceIndex) => {
      if (!sourceIds.has(evidence.sourceId)) context.addIssue({ code: "custom", path: ["claims", claimIndex, "evidence", evidenceIndex, "sourceId"], message: "claim evidence source is missing" });
      const key = `${evidence.sourceId}:${evidence.stance}`;
      if (evidenceKeys.has(key)) context.addIssue({ code: "custom", path: ["claims", claimIndex, "evidence", evidenceIndex], message: "claim evidence is duplicated" });
      evidenceKeys.add(key);
    });
  });
});
const evidenceOutputSchema = evidenceSchema.extend({ sourceId: uuidSchema });
const sourceOutputSchema = sourceInputSchema.extend({ id: uuidSchema, totalScore: z.number().int().min(0).max(100) });
const claimOutputSchema = claimSchema.extend({ id: uuidSchema, evidence: z.array(evidenceOutputSchema).min(1) });
const researchRunSchema = researchInputObjectSchema.omit({ narrativeMarkdown: true, sources: true, claims: true }).extend({
  id: uuidSchema,
  scope: z.enum(["course", "day"]),
  dayId: uuidSchema.nullable(),
  sources: z.array(sourceOutputSchema),
  claims: z.array(claimOutputSchema),
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

const lessonSchema = z.object({
  recallMarkdown: requiredText(1_000_000).optional(),
  preciseExplanationMarkdown: requiredText(1_000_000).optional(),
  eli5Markdown: requiredText(1_000_000).optional(),
  analogyMarkdown: requiredText(1_000_000).optional(),
  exampleMarkdown: requiredText(1_000_000).optional(),
  applicationMarkdown: requiredText(1_000_000).optional(),
  interviewMarkdown: requiredText(1_000_000).optional(),
  remediationMarkdown: requiredText(1_000_000).optional(),
}).strict();
const conceptKeySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
const conceptSchema = z.object({ key: conceptKeySchema, label: requiredText(300) }).strict();
const quizQuestionSchema = z.object({
  id: uuidSchema,
  conceptKey: conceptKeySchema,
  conceptLabel: requiredText(300),
  prompt: requiredText(10_000),
  gradingCriteria: requiredText(10_000),
}).strict();
const gradeSchema = z.object({
  questionId: uuidSchema,
  answer: requiredText(50_000),
  result: z.enum(["correct", "incorrect", "needs_clarification"]),
  feedback: requiredText(10_000),
  clarificationQuestion: requiredText(10_000).optional(),
}).strict();
const reflectionSchema = z.object({
  learned: requiredText(10_000),
  confusing: requiredText(10_000),
  feeling: requiredText(10_000),
}).strict();
const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

async function stateTool(
  summary: string,
  operation: (db: DatabaseHandle, dataRoot: string) => LearningSnapshot,
) {
  try {
    const runtime = getRuntime();
    const snapshot = operation(requireDatabase(runtime), runtime.dataRoot);
    return success(summary, { state: compactLearningState(snapshot) });
  } catch (error) {
    return failure(error);
  }
}

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
          state: z.enum(["ready", "uninitialized", "recovery_required"]),
          database: z.enum(["ok", "uninitialized", "error"]),
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
      const runtime = getReadOnlyRuntime();
      try {
        const report = getHealth(runtime.db, runtime.dataRoot);
        return success(report.message, report);
      } catch (error) {
        return failure(error);
      } finally {
        runtime.close();
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
          const runtime = getReadOnlyRuntime();
          try {
            if (!runtime.db && isUninitializedDataRoot(runtime.dataRoot)) {
              return { courses: [] };
            }
            const db = requireDatabase(runtime);
            return {
              courses: listCourses(db).map((course) => {
                const day = course.currentDayId === null
                  ? null
                  : db.prepare("SELECT day_number FROM course_days WHERE id = ? AND course_id = ?")
                    .get(course.currentDayId, course.id) as { day_number: number } | undefined;
                return { ...compactCourse(course), currentDayNumber: day?.day_number ?? null };
              }),
            };
          } finally {
            runtime.close();
          }
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
          const runtime = getReadOnlyRuntime();
          try {
            const snapshot = getLearningSnapshot(requireDatabase(runtime), runtime.dataRoot, courseId);
            if (!snapshot) throw new LearningStateError("Course does not exist");
            return { state: compactLearningState(snapshot) };
          } finally {
            runtime.close();
          }
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
          const runtime = getReadOnlyRuntime();
          try {
            const found = getLearningDocument(requireDatabase(runtime), runtime.dataRoot, courseId, document);
            if (!found) throw new LearningStateError("Learning document is not available");
            return { course: compactCourse(found.course), document: found.document, markdown: found.markdown };
          } finally {
            runtime.close();
          }
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

  server.registerTool(
    "approve_outline",
    {
      title: "Approve a researched 30-Day outline",
      description: "Activates a draft only after the user approves its interview, research, knowledge map, and exactly 30 objectives.",
      inputSchema: safeInputSchema(z.object({
        courseId: uuidSchema,
        expectedRevision: revisionSchema,
        priorKnowledge: requiredText(10_000),
        learningPreference: z.enum(["examples", "theory", "practice"]),
        knowledgeMapMarkdown: requiredText(1_000_000),
        research: researchInputSchema,
        days: z.array(z.object({ objective: requiredText(500) }).strict()).length(30),
      }).strict()),
      outputSchema: stateOutputSchema,
      annotations: writeAnnotations,
    },
    async (input) => withSafeInput(input, (value) => stateTool("30일 학습 목차를 승인했습니다.", (db, root) => approveOutline(db, root, value))),
  );

  server.registerTool(
    "record_daily_research",
    {
      title: "Record verified daily research",
      description: "Stores sources and cross-checked claims actually researched by Codex for the current Day.",
      inputSchema: safeInputSchema(z.object({ courseId: uuidSchema, expectedRevision: revisionSchema, research: researchInputSchema }).strict()),
      outputSchema: stateOutputSchema,
      annotations: writeAnnotations,
    },
    async (input) => withSafeInput(input, (value) => stateTool("오늘의 리서치를 저장했습니다.", (db, root) => recordDailyResearch(db, root, value))),
  );

  server.registerTool(
    "save_checkpoint",
    {
      title: "Save a lesson or remediation checkpoint",
      description: "Persists supplied lesson content and concept status for the current allowed stage.",
      inputSchema: safeInputSchema(z.object({
        courseId: uuidSchema,
        expectedRevision: revisionSchema,
        lesson: lessonSchema,
        understoodConcepts: z.array(conceptSchema).max(100).optional(),
        remediationConcepts: z.array(conceptSchema).max(100).optional(),
      }).strict()),
      outputSchema: stateOutputSchema,
      annotations: writeAnnotations,
    },
    async (input) => withSafeInput(input, (value) => stateTool("학습 체크포인트를 저장했습니다.", (db, root) => saveLearningCheckpoint(db, root, value))),
  );

  server.registerTool(
    "start_quiz",
    {
      title: "Start the current Day quiz",
      description: "Stores exactly five questions fixed before seeing the learner's answers.",
      inputSchema: safeInputSchema(z.object({ courseId: uuidSchema, expectedRevision: revisionSchema, questions: z.array(quizQuestionSchema).length(5) }).strict()),
      outputSchema: stateOutputSchema,
      annotations: writeAnnotations,
    },
    async (input) => withSafeInput(input, (value) => stateTool("다섯 문제 퀴즈를 시작했습니다.", (db, root) => startQuiz(db, root, value))),
  );

  server.registerTool(
    "grade_quiz",
    {
      title: "Grade quiz responses",
      description: "Stores one to five supplied answers, judgments, feedback, and optional clarification without inventing answers.",
      inputSchema: safeInputSchema(z.object({ courseId: uuidSchema, expectedRevision: revisionSchema, attemptId: uuidSchema, grades: z.array(gradeSchema).min(1).max(5) }).strict()),
      outputSchema: stateOutputSchema,
      annotations: writeAnnotations,
    },
    async (input) => withSafeInput(input, (value) => stateTool("퀴즈 응답과 판정을 저장했습니다.", (db, root) => gradeQuiz(db, root, value))),
  );

  server.registerTool(
    "start_remediation_quiz",
    {
      title: "Start a new remediation quiz",
      description: "Stores a different explanation and five new questions covering every remediation concept.",
      inputSchema: safeInputSchema(z.object({ courseId: uuidSchema, expectedRevision: revisionSchema, remediationMarkdown: requiredText(1_000_000), questions: z.array(quizQuestionSchema).length(5) }).strict()),
      outputSchema: stateOutputSchema,
      annotations: writeAnnotations,
    },
    async (input) => withSafeInput(input, (value) => stateTool("새 보충 퀴즈를 시작했습니다.", (db, root) => startRemediationQuiz(db, root, value))),
  );

  server.registerTool(
    "complete_day",
    {
      title: "Complete the current learning Day",
      description: "Stores three reflections after verified daily research and a passed five-of-five quiz.",
      inputSchema: safeInputSchema(z.object({ courseId: uuidSchema, expectedRevision: revisionSchema, reflection: reflectionSchema }).strict()),
      outputSchema: stateOutputSchema,
      annotations: writeAnnotations,
    },
    async (input) => withSafeInput(input, (value) => stateTool("오늘의 학습과 회고를 완료했습니다.", (db, root) => completeDay(db, root, value))),
  );

  return server;
}

export const mcpHandler = createMcpHandler(createJustStudyMcpServer, {
  maxSubscriptions: 0,
});
