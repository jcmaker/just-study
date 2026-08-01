import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createCourse } from "../src/server/courses.ts";
import { getDashboardOverview } from "../src/server/dashboard.ts";
import { openDatabase, type DatabaseHandle } from "../src/server/database.ts";
import {
  approveOutline,
  completeDay,
  gradeQuiz,
  recordDailyResearch,
  saveLearningCheckpoint,
  startQuiz,
} from "../src/server/learning.ts";

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
    gradingCriteria: "핵심 원리와 적용 이유를 모두 설명한다.",
  }));
}

function grades(list: ReturnType<typeof questions>, incorrectIndex: number | null) {
  return list.map((question, index) => ({
    questionId: question.id,
    answer: `${question.conceptLabel}에 대한 사용자 답변`,
    result: index === incorrectIndex ? ("incorrect" as const) : ("correct" as const),
    feedback: index === incorrectIndex ? "적용 이유를 보완해야 합니다." : "핵심 원리와 적용 이유가 정확합니다.",
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
  state = gradeQuiz(db, dataRoot, { courseId, expectedRevision: state.course.revision, attemptId, grades: grades(list, null) });
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

    // A second course cites the same source in canonical form. Five selected rows,
    // four distinct normalized URLs. Without normalization this assertion reads 5.
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
    gradeQuiz(db, dataRoot, {
      courseId: course.course.id,
      expectedRevision: state.course.revision,
      attemptId,
      grades: [{
        questionId: list[0]!.id,
        answer: "정렬한다는 뜻인가요?",
        result: "needs_clarification",
        feedback: "어떤 비용인지 불명확합니다.",
        clarificationQuestion: "시간 비용과 공간 비용 중 무엇을 뜻하나요?",
      }],
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
