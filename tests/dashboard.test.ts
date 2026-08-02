import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import {
  CourseValidationError,
  createCourse,
  getCourseDocument,
} from "../src/server/courses.ts";
import { getDashboardOverview } from "../src/server/dashboard.ts";
import { parseMarkdown, type MarkdownBlock } from "../src/server/markdown.ts";
import {
  attentionItems,
  courseAccentIndex,
  courseCardModel,
  courseProgress,
  coursesEmptyState,
  documentState,
  filterCourses,
  normalizeCourseFilter,
  normalizeTab,
  resumeCardModel,
  resumeCourse,
  RESUME_COMMAND,
  STAGE_LABELS,
  STATUS_LABELS,
} from "../src/server/dashboard-view.ts";
import type { DashboardCourseSummary } from "../src/server/dashboard.ts";
import { openDatabase, type DatabaseHandle } from "../src/server/database.ts";
import {
  approveOutline,
  completeDay,
  answerQuiz,
  getCourseHistory,
  getLearningSnapshot,
  LearningRevisionConflictError,
  LearningStateError,
  LearningValidationError,
  recordDailyResearch,
  saveLearningCheckpoint,
  startQuiz,
  startRemediationQuiz,
  updateCourseDraft,
} from "../src/server/learning.ts";
import { renderApprovedCourseMarkdown } from "../src/server/learning-markdown.ts";
import { listTemporaryEntries, StorageError } from "../src/server/storage.ts";
import {
  applyTheme,
  DARK_THEMES,
  DEFAULT_THEME,
  normalizeTheme,
  THEMES,
  THEME_BOOTSTRAP_SCRIPT,
  THEME_LABELS,
  THEME_STORAGE_KEY,
  themeAttributes,
} from "../src/app/theme.ts";
import { NAV_ITEMS, isActiveNav } from "../src/app/nav-items.ts";
import {
  draftErrorMessage as draftErrorMessageForTest,
  reflectionErrorMessage as reflectionErrorMessageForTest,
} from "../src/app/error-messages.ts";
import {
  submitQuizAnswerAction,
  submitReflectionAction,
  updateCourseDraftAction,
} from "../src/app/actions.ts";

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) {
      return { format: "module", shortCircuit: true, source: "" };
    }

    if (url.endsWith(".tsx")) {
      return {
        format: "module",
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
          compilerOptions: {
            jsx: ts.JsxEmit.ReactJSX,
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
        }).outputText,
      };
    }

    return nextLoad(url, context);
  },
});

function makeDataRoot(): string {
  return mkdtempSync(join(tmpdir(), "just-study-dashboard-"));
}

function withRuntime(run: (db: DatabaseHandle, dataRoot: string) => void): void {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  try {
    run(db, dataRoot);
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
}

function research(topic: string, urls: readonly [string, string]) {
  const first = crypto.randomUUID();
  const second = crypto.randomUUID();
  return {
    questions: [`${topic}의 핵심 개념은 무엇인가?`],
    topicCriteria: ["공식·대학 자료를 우선한다"],
    narrativeMarkdown: `${topic}의 핵심 개념과 학습 순서를 교차 검증했다.`,
    sources: [
      {
        id: first,
        url: urls[0],
        title: "Foundations",
        publisher: "Example University",
        independenceKey: "example-university",
        scores: { authority: 24, crossValidation: 23, relevance: 19, teachingQuality: 14, currency: 9, accessibility: 5 },
        rank: 1,
        selected: true,
        selectionReason: "공개 기초 과정이며 예제와 선수 지식 설명이 명확하다.",
        limitation: null,
      },
      {
        id: second,
        url: urls[1],
        title: "Curriculum Standard",
        publisher: "Independent Standards Group",
        independenceKey: "standards-group",
        scores: { authority: 23, crossValidation: 24, relevance: 18, teachingQuality: 13, currency: 9, accessibility: 5 },
        rank: 2,
        selected: true,
        selectionReason: "독립 기관의 학습 순서와 성취 기준을 제공한다.",
        limitation: null,
      },
    ],
    claims: [{
      id: crypto.randomUUID(),
      statement: `${topic}은 개념 설명과 적용 연습을 함께 학습해야 한다.`,
      major: true,
      conclusion: "두 독립 자료가 같은 학습 방향을 지지한다.",
      uncertainty: null,
      evidence: [
        { sourceId: first, stance: "supports" as const },
        { sourceId: second, stance: "supports" as const },
      ],
    }],
  };
}

const lesson = {
  recallMarkdown: "전날 개념을 한 문장으로 회상한다.",
  preciseExplanationMarkdown: "정확한 정의와 작동 원리를 설명한다.",
  eli5Markdown: "다섯 살도 이해할 말로 다시 설명한다.",
  analogyMarkdown: "일상적인 정리함에 비유한다.",
  exampleMarkdown: "작은 입력을 단계별로 추적한다.",
  applicationMarkdown: "새 문제에 개념을 적용한다.",
  interviewMarkdown: "왜 이 방법을 선택했는지 설명한다.",
};

function questions(prefix: string) {
  return Array.from({ length: 5 }, (_, index) => ({
    id: crypto.randomUUID(),
    conceptKey: `${prefix}-${index + 1}`,
    conceptLabel: `${prefix} 개념 ${index + 1}`,
    prompt: `${prefix} 질문 ${index + 1}: 핵심 원리를 설명하세요.`,
    choices: [`${prefix} 보기 A${index + 1}`, `${prefix} 보기 B${index + 1}`, `${prefix} 보기 C${index + 1}`, `${prefix} 보기 D${index + 1}`],
    correctChoiceIndex: index % 4,
    explanation: "핵심 원리와 적용 이유를 모두 설명한다.",
  }));
}

// 저장된 정답을 고르면 정답, 하나 옆을 고르면 오답이 된다.
function answers(list: ReturnType<typeof questions>, incorrectIndex: number | null) {
  return list.map((question, index) => ({
    questionId: question.id,
    selectedChoiceIndex: index === incorrectIndex
      ? (question.correctChoiceIndex + 1) % 4
      : question.correctChoiceIndex,
  }));
}

function approve(db: DatabaseHandle, dataRoot: string, title: string, urls: readonly [string, string]) {
  const course = createCourse(db, dataRoot, {
    requestId: crypto.randomUUID(),
    title,
    goal: `${title}의 핵심을 설명하고 선택한다.`,
  }).course;
  return approveOutline(db, dataRoot, {
    courseId: course.id,
    expectedRevision: 0,
    priorKnowledge: "기초 용어만 안다.",
    learningPreference: "examples",
    knowledgeMapMarkdown: "기초 → 적용",
    research: research(title, urls),
    days: Array.from({ length: 30 }, (_, index) => ({ objective: `${title} 목표 ${index + 1}을 설명한다` })),
  });
}

function completeCurrentDay(db: DatabaseHandle, dataRoot: string, courseId: string, revision: number, prefix: string): number {
  let state = recordDailyResearch(db, dataRoot, {
    courseId,
    expectedRevision: revision,
    research: research(prefix, [`https://day.example.edu/${prefix}`, `https://day.example.org/${prefix}`]),
  });
  state = saveLearningCheckpoint(db, dataRoot, {
    courseId,
    expectedRevision: state.course.revision,
    lesson,
    understoodConcepts: [{ key: `${prefix}-known`, label: `${prefix} 이해 개념` }],
    remediationConcepts: [],
  });
  const list = questions(prefix);
  state = startQuiz(db, dataRoot, { courseId, expectedRevision: state.course.revision, questions: list });
  const attemptId = state.quizAttempts.at(-1)!.id;
  state = answerQuiz(db, dataRoot, { courseId, expectedRevision: state.course.revision, attemptId, answers: answers(list, null) });
  state = completeDay(db, dataRoot, {
    courseId,
    expectedRevision: state.course.revision,
    reflection: { learned: "핵심 원리", confusing: "상각 분석", feeling: "적용할 수 있다" },
  });
  return state.course.revision;
}

test("dashboard overview aggregates only stored learning facts", () => {
  withRuntime((db, dataRoot) => {
    const draft = createCourse(db, dataRoot, {
      requestId: crypto.randomUUID(),
      title: "초안 과정",
      goal: "아직 목차를 승인하지 않았다.",
    }).course;

    const active = approve(db, dataRoot, "자료구조", [
      "https://Example.EDU:443/foundations",
      "https://standards.example.org/curriculum",
    ]);
    completeCurrentDay(db, dataRoot, active.course.id, active.course.revision, "day-1");

    // A second course cites the same source in canonical form. Six selected rows,
    // four distinct normalized URLs. Without normalization this assertion reads 6.
    approve(db, dataRoot, "중복 출처", [
      "https://example.edu/foundations",
      "https://standards.example.org/curriculum",
    ]);

    const overview = getDashboardOverview(db);

    const draftSummary = overview.courses.find(({ id }) => id === draft.id)!;
    assert.equal(draftSummary.status, "draft");
    assert.equal(draftSummary.approvedDayCount, 0);
    assert.equal(draftSummary.completedDayCount, 0);
    assert.equal(draftSummary.currentDayNumber, null);
    assert.equal(draftSummary.currentDayObjective, null);
    assert.equal(draftSummary.currentStage, null);
    assert.equal(draftSummary.hasQuizResponse, false);

    const activeSummary = overview.courses.find(({ id }) => id === active.course.id)!;
    assert.equal(activeSummary.status, "active");
    assert.equal(activeSummary.approvedDayCount, 30);
    assert.equal(activeSummary.completedDayCount, 1);
    assert.equal(activeSummary.currentDayNumber, 2);
    assert.equal(activeSummary.currentDayObjective, "자료구조 목표 2을 설명한다");
    assert.equal(activeSummary.currentStage, "lecture");
    assert.equal(activeSummary.hasQuizResponse, false);

    assert.equal(overview.totals.activeCourseCount, 2);
    assert.equal(overview.totals.completedCourseCount, 0);
    assert.equal(overview.totals.approvedDayCount, 60);
    assert.equal(overview.totals.completedDayCount, 1);
    // Six selected rows across all courses; four distinct normalized URLs, because
    // https://Example.EDU:443/foundations and https://example.edu/foundations are one
    // source and https://standards.example.org/curriculum appears in both courses.
    const selectedRows = db.prepare("SELECT COUNT(*) AS count FROM research_sources WHERE selected = 1").get() as { count: number };
    assert.equal(selectedRows.count, 6);
    assert.equal(overview.totals.selectedSourceCount, 4);

    assert.equal(overview.recentDays.length, 1);
    assert.deepEqual(
      { courseTitle: overview.recentDays[0]!.courseTitle, dayNumber: overview.recentDays[0]!.dayNumber },
      { courseTitle: "자료구조", dayNumber: 1 },
    );
    assert.equal(overview.recentDays[0]!.objective, "자료구조 목표 1을 설명한다");
    assert.equal(typeof overview.recentDays[0]!.completedAt, "string");
    assert.equal(/markdown/i.test(JSON.stringify(overview)), false);
    assert.equal(/sha256/i.test(JSON.stringify(overview)), false);
  });
});

test("dashboard overview reports an in-progress quiz response and keeps recent Days to five", () => {
  withRuntime((db, dataRoot) => {
    const course = approve(db, dataRoot, "운영체제", [
      "https://os.example.edu/basics",
      "https://os.example.org/standard",
    ]);
    let revision = course.course.revision;
    for (let day = 1; day <= 6; day += 1) {
      revision = completeCurrentDay(db, dataRoot, course.course.id, revision, `os-day-${day}`);
    }

    let state = recordDailyResearch(db, dataRoot, {
      courseId: course.course.id,
      expectedRevision: revision,
      research: research("os-day-7", ["https://day7.example.edu/a", "https://day7.example.org/b"]),
    });
    state = saveLearningCheckpoint(db, dataRoot, {
      courseId: course.course.id,
      expectedRevision: state.course.revision,
      lesson,
      understoodConcepts: [{ key: "os-day-7-known", label: "Day 7 이해 개념" }],
      remediationConcepts: [],
    });
    const list = questions("os-day-7");
    state = startQuiz(db, dataRoot, { courseId: course.course.id, expectedRevision: state.course.revision, questions: list });
    const attemptId = state.quizAttempts.at(-1)!.id;
    answerQuiz(db, dataRoot, {
      courseId: course.course.id,
      expectedRevision: state.course.revision,
      attemptId,
      answers: [{ questionId: list[0]!.id, selectedChoiceIndex: list[0]!.correctChoiceIndex }],
    });

    const overview = getDashboardOverview(db);
    const summary = overview.courses[0]!;
    assert.equal(summary.currentStage, "quiz");
    assert.equal(summary.hasQuizResponse, true);
    assert.equal(summary.completedDayCount, 6);
    assert.equal(overview.recentDays.length, 5);
    assert.deepEqual(overview.recentDays.map(({ dayNumber }) => dayNumber), [6, 5, 4, 3, 2]);
  });
});

test("course history returns every research run and quiz attempt with Day context", () => {
  withRuntime((db, dataRoot) => {
    const approved = approve(db, dataRoot, "알고리즘", [
      "https://algo.example.edu/basics",
      "https://algo.example.org/standard",
    ]);
    const courseId = approved.course.id;
    completeCurrentDay(db, dataRoot, courseId, approved.course.revision, "algo-day-1");

    const history = getCourseHistory(db, courseId)!;
    assert.equal(history.course.id, courseId);
    assert.equal(history.days.length, 30);
    assert.equal(history.days[0]!.completedAt !== null, true);

    const courseRun = history.researchRuns.find(({ scope }) => scope === "course")!;
    assert.equal(courseRun.dayNumber, null);
    assert.equal(courseRun.dayObjective, null);
    assert.equal(courseRun.sources.length, 2);
    assert.equal(courseRun.sources[0]!.totalScore, 94);
    assert.equal(courseRun.claims[0]!.evidence.length, 2);

    const dayRun = history.researchRuns.find(({ scope }) => scope === "day")!;
    assert.equal(dayRun.dayNumber, 1);
    assert.equal(dayRun.dayObjective, "알고리즘 목표 1을 설명한다");

    assert.equal(history.quizAttempts.length, 1);
    const attempt = history.quizAttempts[0]!;
    assert.equal(attempt.dayNumber, 1);
    assert.equal(attempt.dayObjective, "알고리즘 목표 1을 설명한다");
    assert.equal(attempt.status, "passed");
    assert.equal(attempt.score, 5);
    assert.equal(attempt.questions.length, 5);
    assert.equal(attempt.questions[0]!.response !== null, true);
    assert.equal(attempt.questions[0]!.response!.correct, true);

    assert.equal(getCourseHistory(db, crypto.randomUUID()), null);
    assert.equal(/sha256/i.test(JSON.stringify(history)), false);
    assert.equal(/markdownPath/i.test(JSON.stringify(history)), false);
    assert.deepEqual(
      Object.keys(history.course).filter((key) => /sha256|markdownPath/i.test(key)),
      [],
    );
  });
});

test("course history keeps returning history after a course completes", () => {
  withRuntime((db, dataRoot) => {
    const approved = approve(db, dataRoot, "짧은 과정", [
      "https://short.example.edu/a",
      "https://short.example.org/b",
    ]);
    const courseId = approved.course.id;
    let revision = approved.course.revision;
    for (let day = 1; day <= 30; day += 1) {
      revision = completeCurrentDay(db, dataRoot, courseId, revision, `short-day-${day}`);
    }

    const history = getCourseHistory(db, courseId)!;
    assert.equal(history.course.status, "completed");
    assert.equal(history.days.every(({ completedAt }) => completedAt !== null), true);
    assert.equal(history.researchRuns.filter(({ scope }) => scope === "day").length, 30);
    assert.equal(history.quizAttempts.length, 30);
    assert.deepEqual(
      history.quizAttempts.map(({ dayNumber }) => dayNumber),
      Array.from({ length: 30 }, (_, index) => index + 1),
    );
  });
});

test("document state separates missing, damaged, and readable prose", () => {
  assert.deepEqual(documentState(null, false), {
    kind: "damaged",
    title: "저장된 학습 문서를 확인할 수 없습니다",
    description: "체크섬 검증에 실패했습니다. 원문을 덮어쓰지 않았으며 복구 전에는 내용을 표시하지 않습니다.",
  });
  assert.deepEqual(documentState(null, true), {
    kind: "empty",
    title: "아직 저장된 내용이 없습니다",
    description: "Codex에서 $just-study로 학습을 진행하면 여기에 검증된 기록이 표시됩니다.",
  });
  assert.equal(documentState("# 제목", true), null);
  assert.equal(documentState("   ", true)!.kind, "empty");
});

test("a damaged document breaks only the prose read, never the structured history", () => {
  withRuntime((db, dataRoot) => {
    const approved = approve(db, dataRoot, "손상 검증", [
      "https://corrupt.example.edu/a",
      "https://corrupt.example.org/b",
    ]);
    const courseId = approved.course.id;
    const journalPath = join(dataRoot, "courses", courseId, "journal.md");
    const original = readFileSync(journalPath, "utf8");

    writeFileSync(journalPath, `${original}\n손상된 추가 문장\n`, "utf8");

    assert.throws(() => getLearningSnapshot(db, dataRoot, courseId), StorageError);

    const history = getCourseHistory(db, courseId)!;
    assert.equal(history.days.length, 30);
    assert.equal(history.researchRuns.length, 1);
    assert.equal(history.course.status, "active");
    assert.equal(readFileSync(journalPath, "utf8").startsWith(original), true);
  });
});

function summary(overrides: Partial<DashboardCourseSummary> = {}): DashboardCourseSummary {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "과정",
    goal: "목표",
    status: "active",
    currentDayNumber: 3,
    currentDayObjective: "Day 3 목표",
    currentStage: "lecture",
    approvedDayCount: 30,
    completedDayCount: 2,
    hasQuizResponse: false,
    revision: 7,
    outlineApprovedAt: "2026-07-01T00:00:00.000Z",
    completedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

test("view model labels every stored enum in Korean", () => {
  assert.deepEqual(Object.keys(STAGE_LABELS).sort(), ["lecture", "quiz", "reflection", "remediation"]);
  assert.equal(STAGE_LABELS.lecture, "강의");
  assert.equal(STAGE_LABELS.quiz, "퀴즈");
  assert.equal(STAGE_LABELS.remediation, "보완 학습");
  assert.equal(STAGE_LABELS.reflection, "회고");
  assert.equal(STATUS_LABELS.draft, "초안");
  assert.equal(STATUS_LABELS.active, "진행 중");
  assert.equal(STATUS_LABELS.completed, "완료");
  assert.equal(RESUME_COMMAND, "$just-study 계속");
});

test("course card model never invents Day, stage, or progress for a draft", () => {
  const draft = courseCardModel(summary({
    status: "draft",
    currentDayNumber: null,
    currentDayObjective: null,
    currentStage: null,
    approvedDayCount: 0,
    completedDayCount: 0,
  }));
  assert.equal(draft.statusLabel, "초안");
  assert.equal(draft.dayLabel, null);
  assert.equal(draft.stageLabel, null);
  assert.equal(draft.progress, null);
  assert.equal(draft.note, "30일 계획 승인 대기");

  const active = courseCardModel(summary());
  assert.equal(active.dayLabel, "Day 3 / 30");
  assert.equal(active.stageLabel, "강의");
  assert.deepEqual(active.progress, { completed: 2, approved: 30, percent: 7 });
  assert.equal(active.note, null);

  const completed = courseCardModel(summary({
    status: "completed",
    currentDayNumber: null,
    currentDayObjective: null,
    currentStage: null,
    completedDayCount: 30,
    completedAt: "2026-07-20T00:00:00.000Z",
  }));
  assert.equal(completed.dayLabel, "Day 30 / 30");
  assert.equal(completed.stageLabel, null);
  assert.deepEqual(completed.progress, { completed: 30, approved: 30, percent: 100 });
  assert.equal(completed.note, "완료");
});

test("progress is completed Days over approved Days and is never fabricated", () => {
  assert.equal(courseProgress(summary({ approvedDayCount: 0, completedDayCount: 0 })), null);
  assert.deepEqual(courseProgress(summary({ approvedDayCount: 30, completedDayCount: 0 })), { completed: 0, approved: 30, percent: 0 });
  assert.deepEqual(courseProgress(summary({ approvedDayCount: 30, completedDayCount: 29 })), { completed: 29, approved: 30, percent: 97 });
});

test("resume picks the most recently updated active course and falls back deterministically", () => {
  const older = summary({ id: "a", updatedAt: "2026-07-01T00:00:00.000Z" });
  const newer = summary({ id: "b", updatedAt: "2026-07-09T00:00:00.000Z" });
  assert.equal(resumeCourse([older, newer])!.id, "b");
  const sameTimeFirst = summary({ id: "a", updatedAt: "2026-07-09T00:00:00.000Z" });
  const sameTimeSecond = summary({ id: "b", updatedAt: "2026-07-09T00:00:00.000Z" });
  assert.equal(resumeCourse([sameTimeSecond, sameTimeFirst])!.id, "a");

  const drafts = [
    summary({ id: "c", status: "draft", currentStage: null, currentDayNumber: null, updatedAt: "2026-07-02T00:00:00.000Z" }),
    summary({ id: "d", status: "draft", currentStage: null, currentDayNumber: null, updatedAt: "2026-07-08T00:00:00.000Z" }),
  ];
  assert.equal(resumeCourse(drafts)!.id, "d");

  const done = summary({ id: "e", status: "completed", currentStage: null, currentDayNumber: null });
  assert.equal(resumeCourse([done]), null);
  assert.equal(resumeCourse([]), null);
});

test("resume card describes exactly one next action for every data state", () => {
  const empty = resumeCardModel([]);
  assert.equal(empty.kind, "empty");
  assert.equal(empty.title, "첫 학습 과정을 만들어 보세요");
  assert.equal(empty.command, null);

  const onlyCompleted = resumeCardModel([summary({ status: "completed", currentStage: null, currentDayNumber: null })]);
  assert.equal(onlyCompleted.kind, "completed");
  assert.equal(onlyCompleted.command, null);

  const draft = resumeCardModel([summary({
    id: "22222222-2222-4222-8222-222222222222",
    status: "draft",
    currentStage: null,
    currentDayNumber: null,
    currentDayObjective: null,
    approvedDayCount: 0,
  })]);
  assert.equal(draft.kind, "draft");
  assert.equal(draft.command, "$just-study 계속");
  assert.equal(draft.dayLabel, null);
  assert.equal(draft.stageLabel, null);
  assert.equal(draft.objective, null);
  assert.equal(draft.href, "/courses/22222222-2222-4222-8222-222222222222?tab=overview");

  const active = resumeCardModel([summary({ currentStage: "quiz", currentDayNumber: 4, currentDayObjective: "Day 4 목표" })]);
  assert.equal(active.kind, "active");
  assert.equal(active.dayLabel, "Day 4 / 30");
  assert.equal(active.stageLabel, "퀴즈");
  assert.equal(active.objective, "Day 4 목표");
  assert.equal(active.command, "$just-study 계속");
  assert.deepEqual(active.progress, { completed: 2, approved: 30, percent: 7 });
  assert.equal(active.href, "/courses/11111111-1111-4111-8111-111111111111?tab=today");
});

test("attention uses the fixed priority, one item per course, at most three", () => {
  const items = attentionItems([
    summary({ id: "lecture", currentStage: "lecture", updatedAt: "2026-07-09T00:00:00.000Z" }),
    summary({ id: "draft", status: "draft", currentStage: null, currentDayNumber: null, approvedDayCount: 0, updatedAt: "2026-07-08T00:00:00.000Z" }),
    summary({ id: "quiz-open", currentStage: "quiz", hasQuizResponse: false, updatedAt: "2026-07-07T00:00:00.000Z" }),
    summary({ id: "quiz-started", currentStage: "quiz", hasQuizResponse: true, updatedAt: "2026-07-06T00:00:00.000Z" }),
    summary({ id: "reflection", currentStage: "reflection", updatedAt: "2026-07-05T00:00:00.000Z" }),
    summary({ id: "remediation", currentStage: "remediation", updatedAt: "2026-07-04T00:00:00.000Z" }),
    summary({ id: "completed", status: "completed", currentStage: null, currentDayNumber: null }),
  ]);

  assert.deepEqual(items.map(({ courseId }) => courseId), ["remediation", "reflection", "quiz-started"]);
  assert.equal(items[0]!.message, "보완 학습이 필요합니다");
  assert.equal(items[0]!.tab, "today");
  assert.equal(items[1]!.message, "회고를 완료하면 다음 Day로 이동합니다");
  assert.equal(items[1]!.tab, "today");
  assert.equal(items[2]!.message, "퀴즈 답변을 이어가세요");
  assert.equal(items[2]!.tab, "quiz");
  assert.equal(items[2]!.href, "/courses/quiz-started?tab=quiz");

  assert.deepEqual(attentionItems([summary({ status: "completed", currentStage: null })]), []);

  const openQuiz = attentionItems([summary({ id: "only", currentStage: "quiz", hasQuizResponse: false })]);
  assert.equal(openQuiz[0]!.message, "오늘의 퀴즈가 기다리고 있습니다");
  assert.equal(openQuiz[0]!.tab, "today");

  const onlyDraft = attentionItems([summary({ status: "draft", currentStage: null, currentDayNumber: null })]);
  assert.equal(onlyDraft[0]!.message, "30일 계획 승인이 필요합니다");
  assert.equal(onlyDraft[0]!.tab, "overview");

  const onlyLecture = attentionItems([summary({ currentStage: "lecture" })]);
  assert.equal(onlyLecture[0]!.message, "오늘 학습을 이어가세요");
  assert.equal(onlyLecture[0]!.tab, "today");
});

test("attention ties break on updatedAt descending", () => {
  const items = attentionItems([
    summary({ id: "old", currentStage: "lecture", updatedAt: "2026-07-01T00:00:00.000Z" }),
    summary({ id: "new", currentStage: "lecture", updatedAt: "2026-07-11T00:00:00.000Z" }),
    summary({ id: "mid", currentStage: "lecture", updatedAt: "2026-07-05T00:00:00.000Z" }),
    summary({ id: "oldest", currentStage: "lecture", updatedAt: "2026-06-01T00:00:00.000Z" }),
  ]);
  assert.deepEqual(items.map(({ courseId }) => courseId), ["new", "mid", "old"]);

  const sameTimeItems = attentionItems([
    summary({ id: "z", currentStage: "lecture", updatedAt: "2026-07-11T00:00:00.000Z" }),
    summary({ id: "a", currentStage: "lecture", updatedAt: "2026-07-11T00:00:00.000Z" }),
  ]);
  assert.deepEqual(sameTimeItems.map(({ courseId }) => courseId), ["a", "z"]);
});

test("tab and filter values are normalized deterministically", () => {
  for (const tab of ["overview", "plan", "today", "sources", "quiz", "journal"]) {
    assert.equal(normalizeTab(tab), tab);
  }
  for (const value of [undefined, null, "", "Overview", "unknown", "../secret", ["today"]]) {
    assert.equal(normalizeTab(value as never), "overview");
  }
  for (const filter of ["all", "active", "draft", "completed"]) {
    assert.equal(normalizeCourseFilter(filter), filter);
  }
  for (const value of [undefined, null, "", "ACTIVE", "archived", ["all"]]) {
    assert.equal(normalizeCourseFilter(value as never), "all");
  }
});

test("filter selects by stored status only", () => {
  const courses = [
    summary({ id: "a", status: "draft" }),
    summary({ id: "b", status: "active" }),
    summary({ id: "c", status: "completed" }),
  ];
  assert.deepEqual(filterCourses(courses, "all").map(({ id }) => id), ["a", "b", "c"]);
  assert.deepEqual(filterCourses(courses, "draft").map(({ id }) => id), ["a"]);
  assert.deepEqual(filterCourses(courses, "active").map(({ id }) => id), ["b"]);
  assert.deepEqual(filterCourses(courses, "completed").map(({ id }) => id), ["c"]);
});

test("course list distinguishes no courses from an empty filter", () => {
  const none = coursesEmptyState(0, 0, "all");
  assert.equal(none?.kind, "no-courses");
  assert.equal(none?.title, "아직 저장된 과정이 없습니다");
  assert.equal(none?.actionLabel, "새 과정 만들기");

  const filtered = coursesEmptyState(3, 0, "completed");
  assert.equal(filtered?.kind, "no-matches");
  assert.equal(filtered?.title, "완료 상태의 과정이 없습니다");
  assert.equal(filtered?.actionLabel, "필터 해제");

  assert.equal(coursesEmptyState(3, 2, "active"), null);
  assert.equal(coursesEmptyState(3, 3, "all"), null);
});

test("course accent is a stable identity-only palette index", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(courseAccentIndex(id), courseAccentIndex(id));
  assert.equal(Number.isInteger(courseAccentIndex(id)), true);
  assert.equal(courseAccentIndex(id) >= 0 && courseAccentIndex(id) < 6, true);
  assert.equal(courseAccentIndex(""), 0);
});

test("parser keeps raw HTML as literal text", () => {
  const blocks = parseMarkdown("<script>alert(1)</script>\n\n<img src=x onerror=y>");
  assert.deepEqual(blocks, [
    { type: "paragraph", inline: [{ type: "text", value: "<script>alert(1)</script>" }] },
    { type: "paragraph", inline: [{ type: "text", value: "<img src=x onerror=y>" }] },
  ]);
});

test("parser links only http and https URLs and keeps others as text", () => {
  const source = "[안전](https://example.edu/a) [평문](javascript:alert(1)) [상대](/local) [빈](  )";
  const blocks = parseMarkdown(source);

  assert.deepEqual(blocks, [{
    type: "paragraph",
    inline: [
      { type: "link", href: "https://example.edu/a", text: "안전" },
      { type: "text", value: " [평문](javascript:alert(1)) [상대](/local) [빈](  )" },
    ],
  }]);

  const inline = blocks[0]!.type === "paragraph" ? blocks[0]!.inline : [];
  assert.equal(inline.filter(({ type }) => type === "link").length, 1);
  for (const node of inline) {
    if (node.type === "link") assert.match(node.href, /^https?:\/\//);
  }
  assert.equal(inline.some((node) => node.type === "link" && node.href.includes("javascript:")), false);
  assert.equal(inline.some((node) => node.type === "text" && node.value.includes("javascript:")), true);
});

test("parser never emits a link for a non-http scheme in any position", () => {
  for (const unsafe of [
    "[a](javascript:alert)",
    "[b](data:text/html,x)",
    "[c](vbscript:x)",
    "[d](file:///etc/passwd)",
    "[e](//evil.test/x)",
    "[f](/local)",
  ]) {
    const blocks = parseMarkdown(unsafe);
    const inline = blocks[0]!.type === "paragraph" ? blocks[0]!.inline : [];
    assert.equal(inline.some(({ type }) => type === "link"), false, unsafe);
    assert.equal(inline.map((node) => (node.type === "text" ? node.value : "")).join(""), unsafe, unsafe);
  }
  const safe = parseMarkdown("[g](HTTPS://Example.EDU/a)");
  const inline = safe[0]!.type === "paragraph" ? safe[0]!.inline : [];
  assert.deepEqual(inline, [{ type: "link", href: "https://example.edu/a", text: "g" }]);
});

test("parser reads headings, lists, quotes, code, rules, and tables", () => {
  const source = [
    "# 제목",
    "",
    "### 소제목",
    "",
    "- 첫째",
    "- 둘째",
    "",
    "1. 하나",
    "2. 둘",
    "",
    "> 인용",
    "> 계속",
    "",
    "```ts",
    "const a = 1;",
    "```",
    "",
    "---",
    "",
    "| 이름 | 점수 |",
    "| --- | ---: |",
    "| 자료 | 94 |",
  ].join("\n");

  assert.deepEqual(parseMarkdown(source), [
    { type: "heading", level: 1, inline: [{ type: "text", value: "제목" }] },
    { type: "heading", level: 3, inline: [{ type: "text", value: "소제목" }] },
    { type: "list", ordered: false, items: [
      [{ type: "text", value: "첫째" }],
      [{ type: "text", value: "둘째" }],
    ] },
    { type: "list", ordered: true, items: [
      [{ type: "text", value: "하나" }],
      [{ type: "text", value: "둘" }],
    ] },
    { type: "quote", lines: [
      [{ type: "text", value: "인용" }],
      [{ type: "text", value: "계속" }],
    ] },
    { type: "code", language: "ts", value: "const a = 1;" },
    { type: "rule" },
    { type: "table", header: [
      [{ type: "text", value: "이름" }],
      [{ type: "text", value: "점수" }],
    ], alignments: ["left", "right"], rows: [[
      [{ type: "text", value: "자료" }],
      [{ type: "text", value: "94" }],
    ]] },
  ] satisfies MarkdownBlock[]);
});

test("parser reads emphasis and inline code without nesting HTML", () => {
  assert.deepEqual(parseMarkdown("**굵게** *기울임* `코드` 그리고 <b>평문</b>"), [{
    type: "paragraph",
    inline: [
      { type: "strong", value: "굵게" },
      { type: "text", value: " " },
      { type: "emphasis", value: "기울임" },
      { type: "text", value: " " },
      { type: "code", value: "코드" },
      { type: "text", value: " 그리고 <b>평문</b>" },
    ],
  }]);
});

test("parser never loses content on unterminated syntax", () => {
  assert.deepEqual(parseMarkdown("**열림"), [{ type: "paragraph", inline: [{ type: "text", value: "**열림" }] }]);
  assert.deepEqual(parseMarkdown("```ts\nconst a = 1;"), [{ type: "code", language: "ts", value: "const a = 1;" }]);
  assert.deepEqual(parseMarkdown("   "), []);
  assert.deepEqual(parseMarkdown(""), []);
});

test("parser treats a fenced block as literal even when it contains Markdown", () => {
  assert.deepEqual(parseMarkdown("```\n# 제목\n- 목록\n```"), [
    { type: "code", language: null, value: "# 제목\n- 목록" },
  ]);
});

test("parser preserves escaped pipes from generated learning documents", () => {
  const generated = renderApprovedCourseMarkdown(
    { title: "파이프", goal: "파이프를 안전하게 읽는다." } as never,
    {
      courseId: "11111111-1111-4111-8111-111111111111",
      expectedRevision: 0,
      priorKnowledge: "기초 | 표",
      learningPreference: "examples",
      knowledgeMapMarkdown: "기초 → 적용",
      research: {
        ...research("파이프", ["https://pipes.example.edu/a", "https://pipes.example.org/b"]),
        sources: [{
          ...research("파이프", ["https://pipes.example.edu/a", "https://pipes.example.org/b"]).sources[0]!,
          title: "제목 | 파이프",
          selectionReason: "이유 | 추가",
        }],
      },
      days: Array.from({ length: 30 }, (_, index) => ({ objective: `목표 | ${index + 1}` })),
    },
  );

  assert.equal(generated.includes("제목 \\| 파이프"), true);
  const text = JSON.stringify(parseMarkdown(generated));
  assert.equal(text.includes("제목 | 파이프"), true);
  assert.equal(text.includes("이유 | 추가"), true);
  assert.equal(text.includes("목표 | 1"), true);
});

test("parser round-trips writer-escaped course metadata as literal text", () => {
  const title = "제목 *문자* \\ 경로 | 값";
  const goal = "목표 *문자* \\ 경로 | 값";
  const objective = "Day *문자* \\ 경로 | 값";
  const tableCell = "표 \\ 경로 | 값";
  const data = research("이스케이프", ["https://escape.example.edu/a", "https://escape.example.org/b"]);
  const generated = renderApprovedCourseMarkdown(
    { title, goal } as never,
    {
      courseId: "11111111-1111-4111-8111-111111111111",
      expectedRevision: 0,
      priorKnowledge: tableCell,
      learningPreference: "examples",
      knowledgeMapMarkdown: "기초 → 적용",
      research: {
        ...data,
        sources: [{ ...data.sources[0]!, title: tableCell, selectionReason: tableCell }],
      },
      days: Array.from({ length: 30 }, () => ({ objective })),
    },
  );
  const blocks = parseMarkdown(generated);
  const heading = blocks.find((block) => block.type === "heading" && block.level === 1);
  const goalBlock = blocks.find((block) => block.type === "paragraph" && block.inline.length === 1 && block.inline[0]?.type === "text" && block.inline[0].value === goal);
  const objectives = blocks.find((block): block is Extract<MarkdownBlock, { type: "list" }> => block.type === "list" && block.ordered);
  const courseInfo = blocks.find((block): block is Extract<MarkdownBlock, { type: "table" }> => block.type === "table" && block.header[0]?.[0]?.type === "text" && block.header[0][0].value === "항목");
  const sourceTable = blocks.find((block): block is Extract<MarkdownBlock, { type: "table" }> => block.type === "table" && block.header[0]?.[0]?.type === "text" && block.header[0][0].value === "순위");

  assert.deepEqual(heading, { type: "heading", level: 1, inline: [{ type: "text", value: title }] });
  assert.deepEqual(goalBlock, { type: "paragraph", inline: [{ type: "text", value: goal }] });
  assert.deepEqual(objectives?.items[0], [{ type: "text", value: objective }]);
  assert.deepEqual(courseInfo?.rows[0]?.[1], [{ type: "text", value: tableCell }]);
  assert.deepEqual(sourceTable?.rows[0]?.[2], [{ type: "text", value: tableCell }]);
});

test("parser keeps every malformed-table cell as literal text", () => {
  const source = [
    "| 이름 | 점수 |",
    "| --- | --- |",
    "| 자료 | 94 | 보존 |",
  ].join("\n");

  assert.deepEqual(parseMarkdown(source), [{
    type: "paragraph",
    inline: [{ type: "text", value: "| 이름 | 점수 | | --- | --- | | 자료 | 94 | 보존 |" }],
  }]);
});

test("theme values are validated and default to focus", () => {
  assert.deepEqual([...THEMES], ["focus", "calm", "focus-dark", "bubblegum", "terminal"]);
  assert.equal(DEFAULT_THEME, "focus");
  assert.equal(THEME_STORAGE_KEY, "just-study:theme");
  // 라벨은 테마 목록과 정확히 일대일이어야 한다. 테마를 늘리면 여기서 먼저 걸린다.
  assert.deepEqual(Object.keys(THEME_LABELS).sort(), [...THEMES].sort());
  for (const theme of THEMES) assert.equal(normalizeTheme(theme), theme);
  for (const value of [undefined, null, "", "dark", "FOCUS", "focus ", 3, {}, ["calm"]]) {
    assert.equal(normalizeTheme(value), "focus");
  }
});

test("theme attributes mark every dark theme and leave the light ones alone", () => {
  assert.deepEqual(themeAttributes("focus"), { theme: "focus", dark: false, colorScheme: "light" });
  assert.deepEqual(themeAttributes("calm"), { theme: "calm", dark: false, colorScheme: "light" });
  assert.deepEqual(themeAttributes("bubblegum"), { theme: "bubblegum", dark: false, colorScheme: "light" });
  // 어두운 테마는 목록으로 관리한다. 새 dark 테마를 목록에 넣지 않으면 여기서 걸린다.
  assert.deepEqual([...DARK_THEMES], ["focus-dark", "terminal"]);
  for (const theme of THEMES) {
    const expected = DARK_THEMES.includes(theme);
    assert.deepEqual(
      themeAttributes(theme),
      { theme, dark: expected, colorScheme: expected ? "dark" : "light" },
      theme,
    );
    // 부트스트랩 스크립트도 같은 목록을 써야 첫 페인트가 어긋나지 않는다.
    assert.equal(THEME_BOOTSTRAP_SCRIPT.includes(JSON.stringify(DARK_THEMES)), true);
  }
});

test("applyTheme writes exactly the documented DOM state", () => {
  const classes = new Set<string>();
  const attributes = new Map<string, string>();
  const root = {
    dataset: {} as Record<string, string>,
    style: { colorScheme: "" },
    classList: {
      add: (name: string) => { classes.add(name); },
      remove: (name: string) => { classes.delete(name); },
    },
    setAttribute: (name: string, value: string) => { attributes.set(name, value); },
  };

  applyTheme("focus-dark", root as never);
  assert.equal(attributes.get("data-theme"), "focus-dark");
  assert.equal(classes.has("dark"), true);
  assert.equal(root.style.colorScheme, "dark");

  applyTheme("calm", root as never);
  assert.equal(attributes.get("data-theme"), "calm");
  assert.equal(classes.has("dark"), false);
  assert.equal(root.style.colorScheme, "light");
});

test("the bootstrap script is self-contained, synchronous, and fails closed to focus", () => {
  assert.equal(THEME_BOOTSTRAP_SCRIPT.includes(THEME_STORAGE_KEY), true);
  for (const theme of THEMES) assert.equal(THEME_BOOTSTRAP_SCRIPT.includes(theme), true);
  assert.equal(/try\s*\{/.test(THEME_BOOTSTRAP_SCRIPT), true);
  assert.equal(/catch/.test(THEME_BOOTSTRAP_SCRIPT), true);
  assert.equal(THEME_BOOTSTRAP_SCRIPT.includes("fetch("), false);
  assert.equal(THEME_BOOTSTRAP_SCRIPT.includes("import"), false);
  assert.equal(THEME_BOOTSTRAP_SCRIPT.includes("</script"), false);
  assert.equal(THEME_BOOTSTRAP_SCRIPT.length < 700, true);
  assert.match(THEME_BOOTSTRAP_SCRIPT, /catch\(e\)\{[^}]*setAttribute\("data-theme","focus"\)[^}]*colorScheme="light"/);
});

test("globals.css defines every semantic and chart token for every theme", () => {
  const css = readFileSync(resolve(import.meta.dirname, "../src/app/globals.css"), "utf8");
  const tokens = [
    "--background", "--foreground", "--card", "--card-foreground", "--popover", "--popover-foreground",
    "--primary", "--primary-foreground", "--secondary", "--secondary-foreground", "--muted",
    "--muted-foreground", "--accent", "--accent-foreground", "--destructive", "--destructive-foreground",
    "--border", "--input", "--ring", "--sidebar", "--sidebar-foreground", "--sidebar-primary",
    "--sidebar-primary-foreground", "--sidebar-accent", "--sidebar-accent-foreground",
    "--sidebar-border", "--sidebar-ring", "--radius-sm", "--radius-md", "--radius-lg", "--radius-xl",
  ];
  // 테마 목록을 그대로 순회한다. 새 테마가 토큰을 빠뜨리면 여기서 걸린다.
  for (const name of THEMES) {
    const pattern = name === "focus"
      ? /:root,\s*\[data-theme="focus"\]\s*\{([^}]*)\}/
      : new RegExp(`\\[data-theme="${name}"\\]\\s*\\{([^}]*)\\}`);
    const block = pattern.exec(css)?.[1];
    assert.ok(block, `globals.css has no ${name} token block`);
    for (const token of tokens) {
      assert.match(block, new RegExp(`${token}\\s*:`), `${name} is missing ${token}`);
    }
    for (const slot of [0, 1, 2, 3, 4, 5]) {
      assert.match(block, new RegExp(`--course-accent-${slot}\\s*:`), `${name} is missing course accent ${slot}`);
    }
  }
  assert.equal((css.match(/--chart-1\s*:/g) ?? []).length, THEMES.length);
  assert.equal((css.match(/--chart-5\s*:/g) ?? []).length, THEMES.length);
  assert.equal(css.includes("calc(var(--radius)"), false);
  assert.equal(css.includes("--font-sans: var(--font-sans);"), false);
  assert.equal(css.includes("/ 2.50)"), false);
  assert.match(css, /--course-accent-0\s*:/);
  assert.match(css, /--course-accent-5\s*:/);
  assert.match(css, /prefers-reduced-motion/);
  for (const helper of ["bw", "bw-b", "bw-t", "bw-r", "radius-sm", "radius-md", "radius-lg", "shadow-token", "outline-selected", "tap-target", "sr-only"]) {
    assert.match(css, new RegExp(`@utility ${helper}\\s*\\{`), `globals.css is missing @utility ${helper}`);
  }
  assert.match(css, /\.surface\s*\{/);
  assert.equal(css.includes(".bw {"), false);
});

test("navigation exposes exactly Today, Courses, and Settings", () => {
  assert.deepEqual(NAV_ITEMS.map(({ href }) => href), ["/", "/courses", "/settings"]);
  assert.deepEqual(NAV_ITEMS.map(({ label }) => label), ["오늘", "과정", "설정"]);
  assert.equal(NAV_ITEMS.every(({ label }) => label.length > 0), true);
});

test("active navigation matches the section, not a prefix accident", () => {
  assert.equal(isActiveNav("/", "/"), true);
  assert.equal(isActiveNav("/courses", "/"), false);
  assert.equal(isActiveNav("/courses", "/courses"), true);
  assert.equal(isActiveNav("/courses/11111111-1111-4111-8111-111111111111", "/courses"), true);
  assert.equal(isActiveNav("/coursesomething", "/courses"), false);
  assert.equal(isActiveNav("/settings", "/settings"), true);
  assert.equal(isActiveNav("/status", "/settings"), false);
});

test("draft editing updates SQLite and Markdown together and bumps the revision", () => {
  withRuntime((db, dataRoot) => {
    const created = createCourse(db, dataRoot, {
      requestId: crypto.randomUUID(),
      title: "옛 제목",
      goal: "옛 목표",
    }).course;

    const updated = updateCourseDraft(db, dataRoot, {
      courseId: created.id,
      expectedRevision: 0,
      title: "새 제목",
      goal: "새 목표를 30일 뒤에 달성한다.",
    });

    assert.equal(updated.title, "새 제목");
    assert.equal(updated.goal, "새 목표를 30일 뒤에 달성한다.");
    assert.equal(updated.revision, 1);
    assert.equal(updated.status, "draft");
    assert.notEqual(updated.markdownSha256, created.markdownSha256);
    assert.equal(Number.isNaN(Date.parse(updated.updatedAt)), false);
    assert.equal(Date.parse(updated.updatedAt) >= Date.parse(created.updatedAt), true);

    const document = getCourseDocument(db, dataRoot, created.id)!;
    assert.match(document.markdown, /새 제목/);
    assert.match(document.markdown, /새 목표를 30일 뒤에 달성한다/);
    assert.equal(document.markdown.includes("옛 제목"), false);
  });
});

test("draft editing rejects invalid input, stale revisions, and non-draft courses without changing anything", () => {
  withRuntime((db, dataRoot) => {
    const created = createCourse(db, dataRoot, {
      requestId: crypto.randomUUID(),
      title: "제목",
      goal: "목표",
    }).course;

    assert.throws(
      () => updateCourseDraft(db, dataRoot, { courseId: created.id, expectedRevision: 0, title: "   ", goal: "목표" }),
      CourseValidationError,
    );
    assert.throws(
      () => updateCourseDraft(db, dataRoot, { courseId: created.id, expectedRevision: 0, title: "x".repeat(121), goal: "목표" }),
      CourseValidationError,
    );
    assert.throws(
      () => updateCourseDraft(db, dataRoot, { courseId: created.id, expectedRevision: 0, title: "줄\n바꿈", goal: "목표" }),
      CourseValidationError,
    );
    assert.throws(
      () => updateCourseDraft(db, dataRoot, { courseId: created.id, expectedRevision: 1, title: "제목", goal: "목표" }),
      LearningRevisionConflictError,
    );
    assert.throws(
      () => updateCourseDraft(db, dataRoot, { courseId: crypto.randomUUID(), expectedRevision: 0, title: "제목", goal: "목표" }),
      LearningStateError,
    );

    const unchanged = getCourseDocument(db, dataRoot, created.id)!;
    assert.equal(unchanged.course.revision, 0);
    assert.equal(unchanged.course.title, "제목");
    assert.equal(unchanged.course.markdownSha256, created.markdownSha256);

    const approved = approve(db, dataRoot, "활성 과정", [
      "https://active.example.edu/a",
      "https://active.example.org/b",
    ]);
    assert.throws(
      () => updateCourseDraft(db, dataRoot, {
        courseId: approved.course.id,
        expectedRevision: approved.course.revision,
        title: "바꾸기",
        goal: "바꾸기",
      }),
      LearningStateError,
    );
    assert.equal(getCourseHistory(db, approved.course.id)!.course.title, "활성 과정");
  });
});

test("a failure inside the draft transaction leaves neither SQLite nor Markdown changed", () => {
  withRuntime((db, dataRoot) => {
    const created = createCourse(db, dataRoot, {
      requestId: crypto.randomUUID(),
      title: "원래 제목",
      goal: "원래 목표",
    }).course;
    const before = getCourseDocument(db, dataRoot, created.id)!;

    const original = db.prepare.bind(db);
    let armed = true;
    (db as { prepare: typeof db.prepare }).prepare = ((sql: string) => {
      if (armed && sql.includes("UPDATE courses SET title = ?")) {
        armed = false;
        original("UPDATE courses SET revision = revision + 1 WHERE id = ?").run(
          created.id,
        );
      }
      return original(sql);
    }) as typeof db.prepare;

    try {
      assert.throws(
        () =>
          updateCourseDraft(db, dataRoot, {
            courseId: created.id,
            expectedRevision: 0,
            title: "새 제목",
            goal: "새 목표",
          }),
        LearningRevisionConflictError,
      );
    } finally {
      (db as { prepare: typeof db.prepare }).prepare = original as typeof db.prepare;
    }

    const after = getCourseDocument(db, dataRoot, created.id)!;
    assert.equal(after.markdown, before.markdown);
    assert.equal(after.course.title, "원래 제목");
    assert.equal(after.course.goal, "원래 목표");
    assert.equal(after.course.markdownSha256, before.course.markdownSha256);
    assert.equal(after.course.revision, 0);
    assert.deepEqual(listTemporaryEntries(dataRoot), []);
  });
});

test("actions never surface raw engine English to the user", () => {
  const engineMessages = [
    "Only a draft course can be edited",
    "Course does not exist",
    "Course is no longer a draft",
    "expectedRevision must be a non-negative integer",
    "Day completion requires reflection stage",
    "reflection.learned is outside its allowed length",
    "Daily research and a passed quiz are required",
  ];
  const mapped = [
    ...engineMessages.map((raw) =>
      draftErrorMessageForTest(new LearningStateError(raw)),
    ),
    ...engineMessages.map((raw) =>
      draftErrorMessageForTest(new LearningValidationError(raw)),
    ),
    ...engineMessages.map((raw) =>
      reflectionErrorMessageForTest(new LearningStateError(raw)),
    ),
    ...engineMessages.map((raw) =>
      reflectionErrorMessageForTest(new LearningValidationError(raw)),
    ),
    draftErrorMessageForTest(new Error("SQLITE_BUSY: database is locked")),
    reflectionErrorMessageForTest(
      new Error("EACCES: permission denied, open '/private/data/x.md'"),
    ),
  ];

  for (const message of mapped) {
    assert.ok(message.length > 0);
    const latin = message.replaceAll("/status", "").match(/[A-Za-z]{3,}/g) ?? [];
    assert.deepEqual(latin, [], message);
    for (const raw of engineMessages) {
      assert.equal(message.includes(raw), false, message);
    }
    assert.equal(message.includes("SQLITE"), false, message);
    assert.equal(message.includes("/private/"), false, message);
  }

  assert.equal(
    draftErrorMessageForTest(
      new CourseValidationError("과정 제목은 줄바꿈 없이 1~120자여야 합니다."),
    ),
    "과정 제목은 줄바꿈 없이 1~120자여야 합니다.",
  );
});

test("draft form constrains fields and preserves submitted values across outcomes", async () => {
  const { DraftFormView } = await import("../src/app/draft-form.tsx");
  const renderForm = (
    state: {
      status: "idle" | "saved" | "error" | "conflict";
      message: string | null;
      title: string;
      goal: string;
    },
    revision = 3,
    serverValues = { title: "서버 제목", goal: "서버 목표" },
  ) =>
    renderToStaticMarkup(
      createElement(DraftFormView, {
        action: "/courses/draft",
        courseId: "course-draft",
        revision,
        title: serverValues.title,
        goal: serverValues.goal,
        state,
        pending: false,
        onRefresh() {},
      }),
    );

  const idle = renderForm({
    status: "idle",
    message: null,
    title: "",
    goal: "",
  });
  assert.match(idle, /name="courseId" value="course-draft"/);
  assert.match(idle, /name="expectedRevision" value="3"/);
  const titleInput = idle.match(/<input[^>]*id="draft-title"[^>]*>/)?.[0];
  assert.ok(titleInput);
  for (const attribute of [
    /name="title"/,
    /value="서버 제목"/,
    /required=""/,
    /minLength="1"/,
    /maxLength="120"/,
    /aria-describedby="draft-title-help"/,
    /class="[^"]*tap-target[^"]*"/,
  ]) {
    assert.match(titleInput, attribute);
  }
  const goalInput = idle.match(/<textarea[^>]*id="draft-goal"[^>]*>서버 목표<\/textarea>/)?.[0];
  assert.ok(goalInput);
  for (const attribute of [
    /name="goal"/,
    /required=""/,
    /minLength="1"/,
    /maxLength="2000"/,
    /rows="5"/,
    /aria-describedby="draft-goal-help"/,
  ]) {
    assert.match(goalInput, attribute);
  }
  assert.match(idle, /<label[^>]*for="draft-title"[^>]*>과정 제목<\/label>/);
  assert.match(idle, /<label[^>]*for="draft-goal"[^>]*>학습 목표<\/label>/);
  assert.match(idle, /<p[^>]*aria-live="polite"[^>]*><\/p>/);

  const error = renderForm({
    status: "error",
    message: "저장하지 못했습니다.",
    title: "입력 중인 제목",
    goal: "입력 중인 목표",
  });
  assert.match(error, /value="입력 중인 제목"/);
  assert.match(error, />입력 중인 목표<\/textarea>/);
  assert.match(error, /role="alert"[^>]*>저장하지 못했습니다\.<\/p>/);

  const conflict = renderForm({
    status: "conflict",
    message: "최신 상태와 충돌했습니다.",
    title: "보존할 제목",
    goal: "보존할 목표",
  });
  assert.match(conflict, /value="보존할 제목"/);
  assert.match(conflict, />보존할 목표<\/textarea>/);
  assert.match(conflict, /role="alert"/);
  assert.match(conflict, /최신 상태와 충돌했습니다\./);
  assert.match(
    conflict,
    /<button[^>]*type="button"[^>]*class="[^"]*tap-target[^"]*"[^>]*>최신 상태 불러오기<\/button>/,
  );

  const revalidated = renderForm(
    {
      status: "saved",
      message: "과정 정보를 저장했습니다.",
      title: "정규화 전 제출 제목",
      goal: "정규화 전 제출 목표",
    },
    4,
    { title: "최신 서버 제목", goal: "최신 서버 목표" },
  );
  assert.match(revalidated, /name="expectedRevision" value="4"/);
  assert.match(revalidated, /value="최신 서버 제목"/);
  assert.match(revalidated, />최신 서버 목표<\/textarea>/);
  assert.doesNotMatch(revalidated, /정규화 전 제출/);
  assert.match(
    revalidated,
    /<p[^>]*aria-live="polite"[^>]*>과정 정보를 저장했습니다\.<\/p>/,
  );
});

test("course overview mounts the draft editor only while the course is a draft", async () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  const runtimeGlobal = globalThis as typeof globalThis & {
    __justStudyRuntime?: { dataRoot: string; db: DatabaseHandle | null };
  };
  const previousRuntime = runtimeGlobal.__justStudyRuntime;
  runtimeGlobal.__justStudyRuntime = { dataRoot, db };

  try {
    const { default: CoursePage } = await import(
      "../src/app/courses/[id]/page.tsx"
    );
    const course = createCourse(db, dataRoot, {
      requestId: crypto.randomUUID(),
      title: "수정 가능한 초안",
      goal: "초안 편집기 노출 확인",
    }).course;
    const renderCourse = async (tab = "overview") => {
      const page = await CoursePage({
        params: Promise.resolve({ id: course.id }),
        searchParams: Promise.resolve({ tab }),
      });
      return renderToStaticMarkup(page);
    };

    const draftOverview = await renderCourse();
    assert.match(draftOverview, /과정 정보 수정/);
    assert.match(draftOverview, /name="expectedRevision" value="0"/);
    assert.doesNotMatch(await renderCourse("plan"), /과정 정보 수정/);

    db.prepare("UPDATE courses SET status = 'active' WHERE id = ?").run(course.id);
    assert.doesNotMatch(await renderCourse(), /과정 정보 수정/);

    db.prepare("UPDATE courses SET status = 'completed' WHERE id = ?").run(course.id);
    assert.doesNotMatch(await renderCourse(), /과정 정보 수정/);
  } finally {
    db.close();
    if (previousRuntime === undefined) delete runtimeGlobal.__justStudyRuntime;
    else runtimeGlobal.__justStudyRuntime = previousRuntime;
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("modules reachable from client components import no server-only code", () => {
  const appRoot = resolve(import.meta.dirname, "../src/app");
  const clientEntry = [
    "draft-form.tsx",
    "reflection-form.tsx",
    "copy-command.tsx",
    "theme-picker.tsx",
    "new-course-panel.tsx",
    "nav.tsx",
  ];
  const seen = new Set<string>();

  function walk(file: string): void {
    if (seen.has(file) || !existsSync(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    if (/^[\s\S]*?^["']use server["'];/m.test(source)) return;
    assert.equal(/from "node:/.test(source), false, `${file} imports a Node builtin`);
    assert.equal(
      source.includes("better-sqlite3"),
      false,
      `${file} imports better-sqlite3`,
    );
    assert.equal(
      /from "\.\.\/server\//.test(source) ||
        /from "\.\.\/\.\.\/server\//.test(source) ||
        /from "\.\.\/\.\.\/\.\.\/server\//.test(source),
      false,
      `${file} reaches into src/server`,
    );
    for (const [, specifier] of source.matchAll(/from "(\.[^"]+)"/g)) {
      walk(resolve(file, "..", specifier));
    }
  }

  for (const entry of clientEntry) walk(resolve(appRoot, entry));
  assert.ok(seen.size >= clientEntry.length);
});

test("a draft action rejects missing or blank revisions without mutating the course", async () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  const runtimeGlobal = globalThis as typeof globalThis & {
    __justStudyRuntime?: { dataRoot: string; db: DatabaseHandle | null };
  };
  const previousRuntime = runtimeGlobal.__justStudyRuntime;
  runtimeGlobal.__justStudyRuntime = { dataRoot, db };

  try {
    const course = createCourse(db, dataRoot, {
      requestId: crypto.randomUUID(),
      title: "수정 전 제목",
      goal: "수정 전 목표",
    }).course;
    const before = getCourseDocument(db, dataRoot, course.id)!;

    for (const rawRevision of [null, "", "   "] as const) {
      const formData = new FormData();
      formData.set("courseId", course.id);
      formData.set("title", "수정 후 제목");
      formData.set("goal", "수정 후 목표");
      if (rawRevision !== null) {
        formData.set("expectedRevision", rawRevision);
      }

      const state = await updateCourseDraftAction({} as never, formData);

      assert.equal(state.status, "error", JSON.stringify(rawRevision));
      assert.equal(state.title, "수정 후 제목");
      assert.equal(state.goal, "수정 후 목표");
      const unchanged = getCourseDocument(db, dataRoot, course.id)!;
      assert.equal(unchanged.markdown, before.markdown, JSON.stringify(rawRevision));
      assert.equal(unchanged.course.revision, 0, JSON.stringify(rawRevision));
      assert.equal(unchanged.course.title, "수정 전 제목", JSON.stringify(rawRevision));
      assert.equal(unchanged.course.goal, "수정 전 목표", JSON.stringify(rawRevision));
    }
  } finally {
    db.close();
    if (previousRuntime === undefined) delete runtimeGlobal.__justStudyRuntime;
    else runtimeGlobal.__justStudyRuntime = previousRuntime;
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("reflection cannot bypass stage, quiz mastery, or Day 30 termination", () => {
  withRuntime((db, dataRoot) => {
    const approved = approve(db, dataRoot, "회고 검증", [
      "https://reflect.example.edu/a",
      "https://reflect.example.org/b",
    ]);
    const courseId = approved.course.id;
    const reflection = { learned: "배운 점", confusing: "헷갈린 점", feeling: "느낀 점" };

    assert.throws(
      () => completeDay(db, dataRoot, { courseId, expectedRevision: approved.course.revision, reflection }),
      LearningStateError,
    );

    let state = recordDailyResearch(db, dataRoot, {
      courseId,
      expectedRevision: approved.course.revision,
      research: research("회고-day-1", ["https://r1.example.edu/a", "https://r1.example.org/b"]),
    });
    state = saveLearningCheckpoint(db, dataRoot, {
      courseId,
      expectedRevision: state.course.revision,
      lesson,
      understoodConcepts: [{ key: "reflect-known", label: "이해 개념" }],
      remediationConcepts: [],
    });
    const list = questions("reflect");
    state = startQuiz(db, dataRoot, { courseId, expectedRevision: state.course.revision, questions: list });
    const attemptId = state.quizAttempts.at(-1)!.id;
    state = answerQuiz(db, dataRoot, {
      courseId,
      expectedRevision: state.course.revision,
      attemptId,
      answers: answers(list, 2),
    });
    assert.equal(state.course.currentStage, "remediation");
    assert.throws(
      () => completeDay(db, dataRoot, { courseId, expectedRevision: state.course.revision, reflection }),
      LearningStateError,
    );

    assert.throws(
      () => completeDay(db, dataRoot, { courseId, expectedRevision: state.course.revision, reflection: { learned: "", confusing: "b", feeling: "c" } }),
      LearningValidationError,
    );

    let revision = state.course.revision;
    for (let day = 1; day <= 30; day += 1) {
      if (day === 1) {
        // Finish the remediation cycle already in progress for Day 1.
        let inner = saveLearningCheckpoint(db, dataRoot, {
          courseId,
          expectedRevision: revision,
          lesson: { remediationMarkdown: "다른 예제로 다시 설명한다." },
        });
        const second = questions("reflect-remediation");
        second[2] = { ...second[2]!, conceptKey: list[2]!.conceptKey, conceptLabel: list[2]!.conceptLabel };
        inner = startRemediationQuiz(db, dataRoot, {
          courseId,
          expectedRevision: inner.course.revision,
          remediationMarkdown: "새 예제로 다시 적용한다.",
          questions: second,
        });
        const secondAttempt = inner.quizAttempts.at(-1)!.id;
        inner = answerQuiz(db, dataRoot, {
          courseId,
          expectedRevision: inner.course.revision,
          attemptId: secondAttempt,
          answers: answers(second, null),
        });
        assert.equal(inner.course.currentStage, "reflection");
        inner = completeDay(db, dataRoot, { courseId, expectedRevision: inner.course.revision, reflection });
        revision = inner.course.revision;
        continue;
      }
      revision = completeCurrentDay(db, dataRoot, courseId, revision, `reflect-day-${day}`);
    }

    const final = getCourseHistory(db, courseId)!;
    assert.equal(final.course.status, "completed");
    assert.equal(final.course.currentDayId, null);
    assert.equal(final.course.currentStage, null);
    assert.equal(final.days.length, 30);
    assert.throws(
      () => completeDay(db, dataRoot, { courseId, expectedRevision: final.course.revision, reflection }),
      LearningStateError,
    );
  });
});

test("reflection form constrains fields and preserves submitted answers across outcomes", async () => {
  const { ReflectionFormView } = await import("../src/app/reflection-form.tsx");
  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fields = [
    { key: "learned", label: "오늘 무엇을 배웠나요?" },
    { key: "confusing", label: "아직 헷갈리는 것은 무엇인가요?" },
    { key: "feeling", label: "오늘 공부에 대한 한 줄 소감은 무엇인가요?" },
  ] as const;

  const renderForm = (
    state: {
      status: "idle" | "saved" | "error" | "conflict";
      message: string | null;
      learned: string;
      confusing: string;
      feeling: string;
    },
    revision = 5,
    pending = false,
  ) =>
    renderToStaticMarkup(
      createElement(ReflectionFormView, {
        action: "/courses/reflection",
        courseId: "course-reflect",
        revision,
        state,
        pending,
        onRefresh() {},
      }),
    );

  const idle = renderForm({
    status: "idle",
    message: null,
    learned: "",
    confusing: "",
    feeling: "",
  });
  assert.match(idle, /name="courseId" value="course-reflect"/);
  assert.match(idle, /name="expectedRevision" value="5"/);

  for (const { key, label } of fields) {
    const textarea = idle.match(
      new RegExp(`<textarea[^>]*id="reflection-${key}"[^>]*>[^<]*</textarea>`),
    )?.[0];
    assert.ok(textarea, key);
    for (const attribute of [
      new RegExp(`name="${key}"`),
      /required=""/,
      /minLength="1"/,
      /maxLength="10000"/,
      /rows="3"/,
      new RegExp(`aria-describedby="reflection-${key}-help"`),
    ]) {
      assert.match(textarea!, attribute);
    }
    assert.match(textarea!, /><\/textarea>$/);
    assert.match(
      idle,
      new RegExp(`<label[^>]*for="reflection-${key}"[^>]*>${escapeRegExp(label)}</label>`),
    );
  }
  assert.match(idle, /<p[^>]*aria-live="polite"[^>]*><\/p>/);
  assert.match(idle, /<button[^>]*type="submit"[^>]*>회고 제출하고 다음 Day로<\/button>/);
  // buttonClass() always emits Tailwind `disabled:` variants, so assert on the rendered attribute.
  assert.doesNotMatch(idle, /disabled=""/);

  const error = renderForm({
    status: "error",
    message: "회고를 저장하지 못했습니다.",
    learned: "입력한 배운 점",
    confusing: "입력한 헷갈린 점",
    feeling: "입력한 소감",
  });
  assert.match(error, />입력한 배운 점<\/textarea>/);
  assert.match(error, />입력한 헷갈린 점<\/textarea>/);
  assert.match(error, />입력한 소감<\/textarea>/);
  assert.match(error, /role="alert"[^>]*>회고를 저장하지 못했습니다\.<\/p>/);
  assert.match(error, /<p[^>]*aria-live="polite"[^>]*><\/p>/);

  const conflict = renderForm({
    status: "conflict",
    message: "최신 상태와 충돌했습니다.",
    learned: "보존할 배운 점",
    confusing: "보존할 헷갈린 점",
    feeling: "보존할 소감",
  });
  assert.match(conflict, />보존할 배운 점<\/textarea>/);
  assert.match(conflict, />보존할 헷갈린 점<\/textarea>/);
  assert.match(conflict, />보존할 소감<\/textarea>/);
  assert.match(conflict, /role="alert"/);
  assert.match(conflict, /최신 상태와 충돌했습니다\./);
  assert.match(
    conflict,
    /<button[^>]*type="button"[^>]*class="[^"]*tap-target[^"]*"[^>]*>최신 상태 불러오기<\/button>/,
  );
  assert.match(conflict, /<p[^>]*aria-live="polite"[^>]*><\/p>/);

  const saved = renderForm({
    status: "saved",
    message: "회고를 저장했습니다.",
    learned: "제출한 배운 점",
    confusing: "제출한 헷갈린 점",
    feeling: "제출한 소감",
  });
  for (const { key } of fields) {
    assert.match(saved, new RegExp(`<textarea[^>]*id="reflection-${key}"[^>]*></textarea>`));
  }
  assert.doesNotMatch(saved, /제출한 배운 점/);
  assert.doesNotMatch(saved, /제출한 헷갈린 점/);
  assert.doesNotMatch(saved, /제출한 소감/);
  assert.match(
    saved,
    /<p[^>]*aria-live="polite"[^>]*>회고를 저장했습니다\.<\/p>/,
  );

  const pendingRendered = renderForm(
    { status: "idle", message: null, learned: "", confusing: "", feeling: "" },
    5,
    true,
  );
  assert.match(
    pendingRendered,
    /<button[^>]*type="submit"[^>]*disabled=""[^>]*>제출 중…<\/button>/,
  );
});

function reachReflection(db: DatabaseHandle, dataRoot: string, title: string, prefix: string) {
  const approved = approve(db, dataRoot, title, [
    `https://${prefix}.example.edu/a`,
    `https://${prefix}.example.org/b`,
  ]);
  const courseId = approved.course.id;
  let state = recordDailyResearch(db, dataRoot, {
    courseId,
    expectedRevision: approved.course.revision,
    research: research(prefix, [
      `https://${prefix}-day.example.edu/a`,
      `https://${prefix}-day.example.org/b`,
    ]),
  });
  state = saveLearningCheckpoint(db, dataRoot, {
    courseId,
    expectedRevision: state.course.revision,
    lesson,
    understoodConcepts: [{ key: `${prefix}-known`, label: `${prefix} 이해 개념` }],
    remediationConcepts: [],
  });
  const list = questions(prefix);
  state = startQuiz(db, dataRoot, { courseId, expectedRevision: state.course.revision, questions: list });
  state = answerQuiz(db, dataRoot, {
    courseId,
    expectedRevision: state.course.revision,
    attemptId: state.quizAttempts.at(-1)!.id,
    answers: answers(list, null),
  });
  return { courseId, state };
}

test("a reflection action rejects missing or blank revisions without mutating the course", async () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  const runtimeGlobal = globalThis as typeof globalThis & {
    __justStudyRuntime?: { dataRoot: string; db: DatabaseHandle | null };
  };
  const previousRuntime = runtimeGlobal.__justStudyRuntime;
  runtimeGlobal.__justStudyRuntime = { dataRoot, db };

  try {
    const { courseId, state } = reachReflection(db, dataRoot, "회고 리비전", "reflect-revision");
    assert.equal(state.course.currentStage, "reflection");
    const before = getCourseHistory(db, courseId)!;

    for (const rawRevision of [null, "", "   ", "정수아님"] as const) {
      const formData = new FormData();
      formData.set("courseId", courseId);
      formData.set("learned", "배운 점");
      formData.set("confusing", "헷갈린 점");
      formData.set("feeling", "느낀 점");
      if (rawRevision !== null) formData.set("expectedRevision", rawRevision);

      const result = await submitReflectionAction({} as never, formData);
      const label = JSON.stringify(rawRevision);

      assert.equal(result.status, "error", label);
      assert.equal(result.learned, "배운 점", label);
      assert.equal(result.confusing, "헷갈린 점", label);
      assert.equal(result.feeling, "느낀 점", label);

      const unchanged = getCourseHistory(db, courseId)!;
      assert.equal(unchanged.course.revision, before.course.revision, label);
      assert.equal(unchanged.course.currentStage, "reflection", label);
      assert.equal(unchanged.days.filter(({ completedAt }) => completedAt !== null).length, 0, label);
    }
  } finally {
    db.close();
    if (previousRuntime === undefined) delete runtimeGlobal.__justStudyRuntime;
    else runtimeGlobal.__justStudyRuntime = previousRuntime;
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("the today tab mounts the reflection form only during the reflection stage", async () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  const runtimeGlobal = globalThis as typeof globalThis & {
    __justStudyRuntime?: { dataRoot: string; db: DatabaseHandle | null };
  };
  const previousRuntime = runtimeGlobal.__justStudyRuntime;
  runtimeGlobal.__justStudyRuntime = { dataRoot, db };

  try {
    const { default: CoursePage } = await import("../src/app/courses/[id]/page.tsx");
    const renderToday = async (id: string) =>
      renderToStaticMarkup(
        await CoursePage({
          params: Promise.resolve({ id }),
          searchParams: Promise.resolve({ tab: "today" }),
        }),
      );

    const draft = createCourse(db, dataRoot, {
      requestId: crypto.randomUUID(),
      title: "초안 과정",
      goal: "초안에서는 회고를 제출할 수 없다.",
    }).course;
    const draftToday = await renderToday(draft.id);
    assert.doesNotMatch(draftToday, /오늘의 회고/);
    assert.doesNotMatch(draftToday, /id="reflection-learned"/);

    const lectureCourse = approve(db, dataRoot, "강의 단계", [
      "https://lecture.example.edu/a",
      "https://lecture.example.org/b",
    ]).course;
    assert.equal(lectureCourse.currentStage, "lecture");
    const lectureToday = await renderToday(lectureCourse.id);
    assert.doesNotMatch(lectureToday, /오늘의 회고/);
    assert.doesNotMatch(lectureToday, /id="reflection-learned"/);

    const { courseId } = reachReflection(db, dataRoot, "회고 단계", "reflect-stage");
    const reflectionToday = await renderToday(courseId);
    assert.match(reflectionToday, /오늘의 회고/);
    assert.match(reflectionToday, /id="reflection-learned"/);
    assert.match(reflectionToday, /id="reflection-confusing"/);
    assert.match(reflectionToday, /id="reflection-feeling"/);
    assert.match(reflectionToday, /회고 제출하고 다음 Day로/);
    assert.match(reflectionToday, new RegExp(`name="expectedRevision" value="${getCourseHistory(db, courseId)!.course.revision}"`));
    // 회고도 강의 본문 뒤에 온다.
    const lessonBefore = reflectionToday.indexOf("전날 개념을 한 문장으로 회상한다");
    const formAfter = reflectionToday.indexOf('id="reflection-learned"');
    assert.notEqual(lessonBefore, -1, "강의 본문이 보여야 한다");
    assert.ok(lessonBefore < formAfter, `강의(${lessonBefore})가 회고(${formAfter})보다 앞에 와야 한다`);
  } finally {
    db.close();
    if (previousRuntime === undefined) delete runtimeGlobal.__justStudyRuntime;
    else runtimeGlobal.__justStudyRuntime = previousRuntime;
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("README documents the real dashboard routes, themes, and edit boundary", () => {
  const readme = readFileSync(resolve(import.meta.dirname, "../README.md"), "utf8");
  for (const fragment of [
    "/courses",
    "/settings",
    "/status",
    "just-study:theme",
    "Focus",
    "Calm",
    "Focus Dark",
    "127.0.0.1",
  ]) {
    assert.ok(readme.includes(fragment), `README is missing ${fragment}`);
  }
  assert.match(readme, /로그인|계정/);
  assert.match(readme, /초안/);
  assert.match(readme, /회고/);
  for (const marker of ["TO" + "DO", "TB" + "D", "FIX" + "ME"]) {
    assert.equal(readme.includes(marker), false);
  }
});

test("route loading boundaries announce progress without leaking content", async () => {
  const runtimeGlobal = globalThis as typeof globalThis & {
    __justStudyRuntime?: { dataRoot: string; db: DatabaseHandle | null };
  };
  const hadRuntime = Object.prototype.hasOwnProperty.call(runtimeGlobal, "__justStudyRuntime");
  const previousRuntime = runtimeGlobal.__justStudyRuntime;
  delete runtimeGlobal.__justStudyRuntime;

  try {
    const boundaries: Array<{ path: string; srText: string }> = [
      { path: "../src/app/loading.tsx", srText: "오늘 화면을 불러오는 중입니다." },
      { path: "../src/app/courses/loading.tsx", srText: "과정 목록을 불러오는 중입니다." },
      { path: "../src/app/courses/[id]/loading.tsx", srText: "과정을 불러오는 중입니다." },
    ];

    for (const { path, srText } of boundaries) {
      const { default: LoadingComponent } = await import(path);
      let markup: string | undefined;
      assert.doesNotThrow(() => {
        markup = renderToStaticMarkup(createElement(LoadingComponent));
      }, `${path} must render without touching the runtime/database`);
      assert.ok(markup, `${path} produced no markup`);

      assert.match(markup!, /aria-busy="true"/);
      assert.match(markup!, /aria-live="polite"/);
      assert.match(markup!, new RegExp(`<p class="sr-only">${srText}</p>`));

      const hiddenSkeletons = markup!.match(/aria-hidden="true"/g) ?? [];
      assert.ok(hiddenSkeletons.length >= 1, `${path} must render at least one aria-hidden skeleton`);

      const visibleText = markup!
        .replace(/<[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/[a-zA-Z0-9]+>/g, "")
        .replace(/<[^>]*aria-hidden="true"[^>]*\/>/g, "")
        .replace(/<[^>]+>/g, "")
        .trim();
      assert.equal(visibleText, srText, `${path} leaks visible text beyond the sr-only announcement`);
    }
  } finally {
    if (hadRuntime) runtimeGlobal.__justStudyRuntime = previousRuntime;
    else delete runtimeGlobal.__justStudyRuntime;
  }
});

function reachQuiz(db: DatabaseHandle, dataRoot: string, title: string, prefix: string) {
  const approved = approve(db, dataRoot, title, [
    `https://${prefix}.example.edu/a`,
    `https://${prefix}.example.org/b`,
  ]);
  const courseId = approved.course.id;
  let state = recordDailyResearch(db, dataRoot, {
    courseId,
    expectedRevision: approved.course.revision,
    research: research(prefix, [`https://${prefix}-d.example.edu/a`, `https://${prefix}-d.example.org/b`]),
  });
  state = saveLearningCheckpoint(db, dataRoot, {
    courseId,
    expectedRevision: state.course.revision,
    lesson,
    understoodConcepts: [{ key: `${prefix}-known`, label: `${prefix} 이해 개념` }],
    remediationConcepts: [],
  });
  const list = questions(prefix);
  state = startQuiz(db, dataRoot, { courseId, expectedRevision: state.course.revision, questions: list });
  return { courseId, state, list };
}

test("quiz form shows the saved choices without leaking the answer key", async () => {
  const { QuizFormView } = await import("../src/app/quiz-form.tsx");
  const question = {
    id: "11111111-1111-4111-8111-111111111111",
    position: 2,
    prompt: "문맥 교환 비용이 큰 이유는 무엇인가?",
    choices: ["레지스터와 캐시 상태를 저장하고 복원해야 한다", "디스크를 매번 포맷한다", "네트워크를 재연결한다", "화면을 다시 그린다"],
  };
  const render = (state: {
    status: "idle" | "saved" | "error" | "conflict";
    message: string | null;
    selectedChoiceIndex: number | null;
  }, pending = false) =>
    renderToStaticMarkup(
      createElement(QuizFormView, {
        action: "/courses/quiz",
        attemptId: "22222222-2222-4222-8222-222222222222",
        courseId: "33333333-3333-4333-8333-333333333333",
        question,
        revision: 7,
        state,
        pending,
        onRefresh() {},
      }),
    );

  const idle = render({ status: "idle", message: null, selectedChoiceIndex: null });
  assert.match(idle, /name="courseId" value="33333333-3333-4333-8333-333333333333"/);
  assert.match(idle, /name="attemptId" value="22222222-2222-4222-8222-222222222222"/);
  assert.match(idle, /name="questionId" value="11111111-1111-4111-8111-111111111111"/);
  assert.match(idle, /name="expectedRevision" value="7"/);

  // 네 보기가 저장된 순서 그대로 나오고 값이 0..3 이어야 한다.
  for (const [index, choice] of question.choices.entries()) {
    assert.ok(idle.includes(choice), choice);
    assert.match(idle, new RegExp(`name="selectedChoiceIndex" value="${index}"`));
  }
  assert.equal((idle.match(/type="radio"/g) ?? []).length, 4);
  // 정답 인덱스는 폼에 전달되지 않으므로 어떤 보기도 정답으로 표시되지 않는다.
  assert.doesNotMatch(idle, /정답/);
  assert.doesNotMatch(idle, /correctChoiceIndex/);
  assert.doesNotMatch(idle, /checked/);
  assert.match(idle, /<p[^>]*aria-live="polite"[^>]*><\/p>/);

  // 속성 순서에 기대지 않도록 해당 라디오 태그만 뽑아 검사한다.
  const radioAt = (html: string, index: number) =>
    html.match(new RegExp(`<input[^>]*id="quiz-choice-${index}"[^>]*>`))?.[0] ?? "";

  const error = render({ status: "error", message: "보기 중 하나를 선택한 뒤 제출해 주세요.", selectedChoiceIndex: 2 });
  assert.match(error, /role="alert"[^>]*>보기 중 하나를 선택한 뒤 제출해 주세요\.<\/p>/);
  assert.match(radioAt(error, 2), /checked=""/);
  assert.doesNotMatch(radioAt(error, 0), /checked=""/);

  const conflict = render({ status: "conflict", message: "학습 상태가 먼저 변경됐습니다.", selectedChoiceIndex: 0 });
  assert.match(conflict, /최신 상태 불러오기/);
  assert.match(radioAt(conflict, 0), /checked=""/);
  assert.doesNotMatch(radioAt(conflict, 3), /checked=""/);

  const saved = render({ status: "saved", message: "답안을 저장했습니다.", selectedChoiceIndex: null });
  assert.match(saved, /aria-live="polite"[^>]*>답안을 저장했습니다\.<\/p>/);
  assert.doesNotMatch(saved, /checked/);

  const pendingRender = render({ status: "idle", message: null, selectedChoiceIndex: null }, true);
  assert.match(pendingRender, /disabled=""/);
  assert.match(pendingRender, /제출 중…/);
});

test("the today tab mounts the quiz form only during the quiz stage and never sends the answer key", async () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  const runtimeGlobal = globalThis as typeof globalThis & {
    __justStudyRuntime?: { dataRoot: string; db: DatabaseHandle | null };
  };
  const previousRuntime = runtimeGlobal.__justStudyRuntime;
  runtimeGlobal.__justStudyRuntime = { dataRoot, db };

  try {
    const { default: CoursePage } = await import("../src/app/courses/[id]/page.tsx");
    const renderToday = async (id: string) =>
      renderToStaticMarkup(
        await CoursePage({
          params: Promise.resolve({ id }),
          searchParams: Promise.resolve({ tab: "today" }),
        }),
      );

    const lectureCourse = approve(db, dataRoot, "강의 단계", [
      "https://ql.example.edu/a",
      "https://ql.example.org/b",
    ]).course;
    const lectureToday = await renderToday(lectureCourse.id);
    assert.doesNotMatch(lectureToday, /오늘의 퀴즈/);
    assert.doesNotMatch(lectureToday, /name="selectedChoiceIndex"/);

    const { courseId, list } = reachQuiz(db, dataRoot, "퀴즈 단계", "quiz-stage");
    const quizToday = await renderToday(courseId);
    assert.match(quizToday, /오늘의 퀴즈/);
    assert.match(quizToday, /name="selectedChoiceIndex"/);
    assert.match(quizToday, /답안 제출/);

    // 첫 번째 미응답 문항만 나오고, 저장된 정답은 절대 실려 나가지 않는다.
    assert.ok(quizToday.includes(list[0]!.prompt));
    assert.equal(quizToday.includes(list[1]!.prompt), false);
    for (const choice of list[0]!.choices) assert.ok(quizToday.includes(choice), choice);
    assert.doesNotMatch(quizToday, /correctChoiceIndex/);
    assert.equal((quizToday.match(/type="radio"/g) ?? []).length, 4);

    // 학습이 먼저다. 강의 본문이 퀴즈 폼보다 위에 와야 한다.
    const lessonIndex = quizToday.indexOf("전날 개념을 한 문장으로 회상한다");
    const quizIndex = quizToday.indexOf('name="selectedChoiceIndex"');
    assert.notEqual(lessonIndex, -1, "강의 본문이 보여야 한다");
    assert.ok(lessonIndex < quizIndex, `강의(${lessonIndex})가 퀴즈(${quizIndex})보다 앞에 와야 한다`);
  } finally {
    db.close();
    if (previousRuntime === undefined) delete runtimeGlobal.__justStudyRuntime;
    else runtimeGlobal.__justStudyRuntime = previousRuntime;
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("a quiz action rejects missing or blank revisions without recording an answer", async () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  const runtimeGlobal = globalThis as typeof globalThis & {
    __justStudyRuntime?: { dataRoot: string; db: DatabaseHandle | null };
  };
  const previousRuntime = runtimeGlobal.__justStudyRuntime;
  runtimeGlobal.__justStudyRuntime = { dataRoot, db };

  try {
    const { courseId, state, list } = reachQuiz(db, dataRoot, "퀴즈 리비전", "quiz-revision");
    const attemptId = state.quizAttempts.at(-1)!.id;
    const before = getCourseHistory(db, courseId)!;

    for (const rawRevision of [null, "", "   ", "정수아님"] as const) {
      const formData = new FormData();
      formData.set("courseId", courseId);
      formData.set("attemptId", attemptId);
      formData.set("questionId", list[0]!.id);
      formData.set("selectedChoiceIndex", String(list[0]!.correctChoiceIndex));
      if (rawRevision !== null) formData.set("expectedRevision", rawRevision);

      const result = await submitQuizAnswerAction({} as never, formData);
      const label = JSON.stringify(rawRevision);

      assert.equal(result.status, "error", label);
      const unchanged = getCourseHistory(db, courseId)!;
      assert.equal(unchanged.course.revision, before.course.revision, label);
      assert.equal(unchanged.course.currentStage, "quiz", label);
      assert.ok(unchanged.quizAttempts.at(-1)!.questions.every(({ response }) => response === null), label);
    }
  } finally {
    db.close();
    if (previousRuntime === undefined) delete runtimeGlobal.__justStudyRuntime;
    else runtimeGlobal.__justStudyRuntime = previousRuntime;
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("stage steps follow the learning engine order and mark exactly one current step", async () => {
  const { stageSteps, STAGE_ORDER } = await import("../src/server/dashboard-view.ts");

  assert.deepEqual([...STAGE_ORDER], ["lecture", "quiz", "remediation", "reflection"]);
  assert.deepEqual(
    stageSteps("lecture", false).map(({ label }) => label),
    ["강의", "퀴즈", "보완 학습", "회고", "Day 완료"],
  );

  for (const [index, stage] of STAGE_ORDER.entries()) {
    const steps = stageSteps(stage, false);
    assert.equal(steps.filter(({ state }) => state === "current").length, 1, stage);
    assert.equal(steps.findIndex(({ state }) => state === "current"), index, stage);
    assert.ok(steps.slice(0, index).every(({ state }) => state === "done"), stage);
    assert.ok(steps.slice(index + 1).every(({ state }) => state === "upcoming"), stage);
  }

  const completed = stageSteps(null, true);
  assert.equal(completed.at(-1)!.state, "current");
  assert.ok(completed.slice(0, -1).every(({ state }) => state === "done"));

  const notStarted = stageSteps(null, false);
  assert.ok(notStarted.every(({ state }) => state === "upcoming"));
});

test("the today tab shows a stage stepper and folds the lecture away outside the lecture stage", async () => {
  const dataRoot = makeDataRoot();
  const db = openDatabase(dataRoot);
  const runtimeGlobal = globalThis as typeof globalThis & {
    __justStudyRuntime?: { dataRoot: string; db: DatabaseHandle | null };
  };
  const previousRuntime = runtimeGlobal.__justStudyRuntime;
  runtimeGlobal.__justStudyRuntime = { dataRoot, db };

  try {
    const { default: CoursePage } = await import("../src/app/courses/[id]/page.tsx");
    const renderToday = async (id: string) =>
      renderToStaticMarkup(
        await CoursePage({
          params: Promise.resolve({ id }),
          searchParams: Promise.resolve({ tab: "today" }),
        }),
      );

    const lectureCourse = approve(db, dataRoot, "강의 단계 스텝", [
      "https://ss.example.edu/a",
      "https://ss.example.org/b",
    ]).course;
    const lectureToday = await renderToday(lectureCourse.id);
    // 다섯 단계가 순서대로 보이고 현재 단계가 하나만 표시된다.
    assert.match(lectureToday, /오늘의 진행 단계/);
    for (const label of ["강의", "퀴즈", "보완 학습", "회고", "Day 완료"]) {
      assert.ok(lectureToday.includes(label), label);
    }
    assert.equal((lectureToday.match(/aria-current="step"/g) ?? []).length, 1);
    // 강의 단계에서는 강의를 접지 않는다.
    assert.doesNotMatch(lectureToday, /1단계 · 오늘의 강의 다시 보기/);

    const { courseId } = reachQuiz(db, dataRoot, "퀴즈 단계 스텝", "step-quiz");
    const quizToday = await renderToday(courseId);
    assert.equal((quizToday.match(/aria-current="step"/g) ?? []).length, 1);
    // 퀴즈 단계에서는 강의가 접힌 채로 남고 퀴즈가 펼쳐진다.
    assert.match(quizToday, /1단계 · 오늘의 강의 다시 보기/);
    assert.match(quizToday, /<details/);
    assert.match(quizToday, /2단계 · 오늘의 퀴즈/);
    assert.doesNotMatch(quizToday, /3단계 · 오늘의 회고/);
  } finally {
    db.close();
    if (previousRuntime === undefined) delete runtimeGlobal.__justStudyRuntime;
    else runtimeGlobal.__justStudyRuntime = previousRuntime;
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("the daily and course documents never print the fixed scoring rubric", () => {
  withRuntime((db, dataRoot) => {
    const { courseId, state } = reachQuiz(db, dataRoot, "루브릭 비공개", "rubric-hidden");
    assert.equal(state.course.currentStage, "quiz");
    const snapshot = getLearningSnapshot(db, dataRoot, courseId)!;
    for (const [name, document] of [["current-day", snapshot.documents.currentDay!], ["course", snapshot.documents.course]] as const) {
      assert.doesNotMatch(document, /고정 평가 루브릭/, name);
      assert.doesNotMatch(document, /\| 평가 기준 \| 배점 \|/, name);
    }
  });
});
