# just-study Learning Dashboard UI/UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing SQLite/Markdown learning engine into a single-user localhost web dashboard where the learner sees the next action first, browses courses, the 30-Day plan, today, sources, quizzes, and the journal, and performs only the two approved writes (draft title/goal, unsubmitted reflection) through the existing service layer.

**Architecture:** Next.js App Router server components read two new read-only service functions (`getDashboardOverview`, `getCourseHistory`) plus the existing `getLearningSnapshot`, hand structured data to one pure view-model module, and render a single component tree whose look is switched only by CSS custom properties for the `focus`, `calm`, and `focus-dark` themes. The browser holds no domain store: client components exist only for active-navigation state, the theme picker, clipboard feedback, and the two edit forms, and every write goes through a server action that calls an existing service function with `expectedRevision`.

**Tech Stack:** Node.js >=22.23.1, Next.js 16 App Router, React 19, TypeScript 5.9, better-sqlite3, Tailwind CSS v4 (`tailwindcss` 4.3.3, `@tailwindcss/postcss` 4.3.3), Node test runner, no other runtime dependency.

## Global Constraints

- Read `docs/superpowers/specs/2026-07-31-just-study-dashboard-uiux-design.md` before each task and do not expand its scope.
- Work only in the clean integration worktree. Never touch the user's uncommitted `tsconfig.json`, `next-env.d.ts`, or documents in the original checkout.
- The integration baseline already contains generated `next-env.d.ts`, `tsconfig.json`, and `tsconfig.tsbuildinfo` changes from the baseline build. Record them as baseline artifacts, never stage or commit them, and do not let them obscure a task diff.
- No login, signup, account, profile, organization menu, OAuth, session, token, CORS, or non-`127.0.0.1` binding.
- The server never calls an LLM or a web search API.
- SQLite is the source of truth for course/Day/stage/quiz/source scores. Markdown is the source of truth for long prose. Never reverse-parse Markdown to derive status, progress, source scores, or quiz results.
- Only four writes are allowed from the UI: create a course shell, edit a `draft` course's title and goal, write the three reflection answers while `currentStage === "reflection"`, and choose a local theme. Everything else is read-only.
- Every domain write passes the exact `expectedRevision` the page rendered. A conflict is surfaced with the user's input preserved and is never auto-retried or overwritten.
- SQLite and Markdown must never be left partially updated. Reuse `prepareMarkdownUpdate` / `commitPreparedUpdate` for any write that touches both.
- Never render raw HTML from Markdown, never render a document whose checksum did not verify, and never turn an error into an empty state or `catch { return [] }`.
- Never leak raw SQL rows, absolute paths, checksums, Markdown storage paths, stack traces, or raw storage/database error text into the UI.
- Add exactly two runtime-visible dependencies: `tailwindcss` and `@tailwindcss/postcss`, both as exact dev dependencies. Do not add a Markdown library, chart library, animation library, date library, icon set, global client store, or a second data-access layer.
- Do not implement, stub, or reserve anything for Phase 5 (schedule, real lecture records, study topics, assignments, todos, PDF, attachments) or for the pomodoro/weekly-status ideas. No empty menus, disabled tabs, unused tables, or placeholder routes.
- Verification viewports are exactly 375px, 768px, and 1280px. Minimum pointer target is 44px. `prefers-reduced-motion` is respected.
- Use strict TDD for every behavior: observe the focused RED failure, write the minimum GREEN implementation, run the focused test, run the full suite, inspect the diff, then commit only that task's files.
- A task passes review only with Critical 0 and Important 0. The phase passes only at >=95/100 using the design's rubric: user value and product intent 25, information architecture and usability 20, responsive and accessibility 20, visual quality and theme consistency 15, data integrity and error recovery 15, performance and simplicity 5.

## Design Conformance Decisions

Four points where this plan resolves an ambiguity in the approved design. Any reviewer should judge the implementation against these resolutions. Each was reviewed independently; the chart-token question was originally resolved the other way and reversed after review.

1. **shadcn/ui is used as a source of component shape, not as a dependency.** The design allows Button, Card, Badge, Progress, Tabs, Sheet, Select, Tooltip, Skeleton, Alert, and DropdownMenu but instructs to "copy only what the real screens need". After mapping every screen, no screen needs a Radix primitive: tabs are real links (the design requires link semantics and `aria-current`), the theme picker is a native radio group (the design requires it), metric explanations use visible helper text (the design allows "보조 텍스트 또는 tooltip"), and the new-course panel is a native `<dialog>` which supplies focus trapping, `Escape`, and inert background from the platform. Therefore Radix, `class-variance-authority`, `clsx`, `tailwind-merge`, and the shadcn CLI are **not** installed. Local components in `src/app/ui/` reproduce the new-york shapes with semantic tokens only. Add Radix only when a concrete native accessibility behavior cannot be met and the root coordinator approves that measured need. This follows the design's own "필요한 항목만" rule and the project-wide ban on unnecessary dependencies.
2. **`--chart-1` … `--chart-5` are kept verbatim.** An earlier draft of this plan dropped them as unused scaffolding. That was wrong: the design states plainly "sidebar, chart, destructive, input와 ring 토큰도 첨부 값 그대로 사용한다", so they are part of a token set the design ordered copied, not speculative scaffolding for an unbuilt feature. Focus and Focus Dark use the attachment's exact values; Calm gets a matching muted set. No chart library is added and no component consumes them.
3. **Waiting-quiz outranks draft in the attention list.** The design's table orders `remediation`, `reflection`, quiz-with-response, quiz-without-response, `draft`, `lecture`, but its prose sort sentence omits quiz-without-response entirely. This plan follows the table order, so a Day whose quiz is saved but unanswered is surfaced before a draft awaiting outline approval — an in-flight Day is a more urgent next action than a course that has not started.
4. **`--border` is a single token that must reach 3:1 contrast against `--background` in every theme.** The attachment's `--input` is white in Focus and therefore cannot be a border color; it is treated as the input *background*. Form controls and cards use `--border`. Focus (black on white) and Focus Dark (white on black) are 21:1; the Calm value below is fixed at 3.21:1.
5. **Accessibility scanning is external to the application.** Task 13 uses an axe scan supplied by the browser/verification environment. Do not add an application or dev dependency solely to run axe.

## Binding Execution Order

Implement in this order: Tasks 1 → 2 → 3 → 4 → the single combined Tasks 5/6 batch → Task 10's service/action boundary → 7 → 8 → 9 → Task 10's remaining UI → 11 → 12 → 13 → 14. Only read-only QA may overlap source implementation. The combined Tasks 5/6 batch and every later implementation batch end only after a passing `npx tsc --noEmit`.

## File Structure

**Create**

- `postcss.config.mjs` — single Tailwind v4 PostCSS plugin.
- `src/server/dashboard.ts` — `getDashboardOverview(db)` structured read model. No Markdown, no UI strings.
- `src/server/dashboard-view.ts` — pure view model. No `node:fs`, no `better-sqlite3`, no React. Labels, progress, resume selection, attention list, accent index, tab/filter normalization.
- `src/server/markdown.ts` — pure Markdown block/inline parser producing a typed AST. No HTML passthrough.
- `src/app/theme.ts` — theme names, default, `normalizeTheme`, `themeAttributes`, `applyTheme(value, root)`, and the inline bootstrap source string built from the same constants.
- `src/app/ui/primitives.tsx` — server-safe presentational primitives: `Card`, `CardHeader`, `Badge`, `ProgressBar`, `Alert`, `Skeleton`, `buttonClass`.
- `src/app/ui/markdown-view.tsx` — renders `src/server/markdown.ts` AST to React elements.
- `src/app/app-shell.tsx` — sidebar + mobile context bar/bottom navigation shell.
- `src/app/nav-items.ts` — JSX-free navigation definition and `isActiveNav`, importable from tests.
- `src/app/nav.tsx` — `"use client"` active-navigation links.
- `src/app/copy-command.tsx` — `"use client"` clipboard button with success/failure fallback.
- `src/app/theme-picker.tsx` — `"use client"` native radio group.
- `src/app/new-course-panel.tsx` — `"use client"` native `<dialog>` wrapper around the existing course form.
- `src/app/action-state.ts` — form-state types and initial values, kept out of the `"use server"` module.
- `src/app/error-messages.ts` — server-only Korean error mapping for actions; never imported by a client component.
- `src/app/draft-form.tsx` — `"use client"` draft title/goal editor.
- `src/app/reflection-form.tsx` — `"use client"` three-answer reflection editor.
- `src/app/courses/page.tsx` — course list with filter.
- `src/app/courses/[id]/tabs.tsx` — tab strip + the six tab panels (server components).
- `src/app/courses/[id]/context-bar.tsx` — mobile back control and current Day.
- `src/app/settings/page.tsx` — theme picker + system section.
- `src/app/loading.tsx`, `src/app/courses/loading.tsx`, `src/app/courses/[id]/loading.tsx` — route skeletons.
- `tests/dashboard.test.ts` — services, view model, Markdown parser, theme helper, and write-path tests.

**Modify**

- `package.json`, `package-lock.json` — exact Tailwind dev dependencies and `tests/dashboard.test.ts` in `npm test`.
- `src/server/courses.ts` — export `normalizeCourseTitleAndGoal` and `renderCourseShellMarkdown`; no behavior change.
- `src/server/learning.ts` — extract shared research/quiz row loaders, add `getCourseHistory`, add `updateCourseDraft`.
- `src/app/actions.ts` — add `updateCourseDraftAction` and `submitReflectionAction`.
- `src/app/layout.tsx` — theme bootstrap, `<html data-theme>`, skip link, app shell.
- `src/app/globals.css` — Tailwind v4 entry and the three theme token sets.
- `src/app/page.tsx` — Today dashboard.
- `src/app/courses/[id]/page.tsx` — course workspace.
- `src/app/course-form.tsx` — add an optional `autoFocus` prop so the dialog focuses the title field; keep `CourseFormView` and its existing props unchanged apart from that one addition.
- `src/app/status/page.tsx` — token-based styling only; keep every existing check and string.
- `src/app/not-found.tsx` — token-based styling only.
- `README.md` — dashboard routes, themes, and the edit boundary.

**Do not create**

- A second frontend app, a client-side store, a UI database, a Markdown library wrapper, a chart/animation/date dependency, a `src/app/api/dashboard/*` route, or any Phase 5 route, table, or menu entry.

---

### Task 1: Structured dashboard read model

**Files:**

- Create: `src/server/dashboard.ts`
- Create: `tests/dashboard.test.ts`
- Modify: `package.json` (test script)

**Interfaces:**

- Consumes: `openDatabase` from `src/server/database.ts`, `createCourse`/`listCourses` from `src/server/courses.ts`, `approveOutline`/`recordDailyResearch`/`saveLearningCheckpoint`/`startQuiz`/`gradeQuiz`/`completeDay` from `src/server/learning.ts`.
- Produces: `DashboardCourseSummary`, `DashboardRecentDay`, `DashboardTotals`, `DashboardOverview`, `getDashboardOverview(db): DashboardOverview`.

- [ ] **Step 1: Add the new test file to the full runner**

In `package.json` change the test script to exactly:

```json
"test": "node --test tests/platform-foundation.test.ts tests/learning-engine.test.ts tests/mcp.test.ts tests/codex-skill.test.ts tests/dashboard.test.ts"
```

If Phase 3 has not yet added `tests/mcp.test.ts` and `tests/codex-skill.test.ts`, list only the files that exist plus `tests/dashboard.test.ts`.

- [ ] **Step 2: Write the failing overview test**

Create `tests/dashboard.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the focused test and observe RED**

Run: `node --test tests/dashboard.test.ts`

Expected: FAIL — `Cannot find module '../src/server/dashboard.ts'`.

- [ ] **Step 4: Implement the read model**

Create `src/server/dashboard.ts`:

```ts
import type { CourseStatus, LearningStage } from "./courses.ts";
import type { DatabaseHandle } from "./database.ts";

export type DashboardCourseSummary = {
  id: string;
  title: string;
  goal: string;
  status: CourseStatus;
  currentDayNumber: number | null;
  currentDayObjective: string | null;
  currentStage: LearningStage | null;
  approvedDayCount: number;
  completedDayCount: number;
  hasQuizResponse: boolean;
  revision: number;
  outlineApprovedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DashboardRecentDay = {
  courseId: string;
  courseTitle: string;
  dayId: string;
  dayNumber: number;
  objective: string;
  completedAt: string;
};

export type DashboardTotals = {
  activeCourseCount: number;
  completedCourseCount: number;
  approvedDayCount: number;
  completedDayCount: number;
  selectedSourceCount: number;
};

export type DashboardOverview = {
  courses: DashboardCourseSummary[];
  totals: DashboardTotals;
  recentDays: DashboardRecentDay[];
};

type SummaryRow = {
  id: string;
  title: string;
  goal: string;
  status: CourseStatus;
  current_stage: LearningStage | null;
  current_day_number: number | null;
  current_day_objective: string | null;
  approved_day_count: number;
  completed_day_count: number;
  quiz_response_count: number;
  revision: number;
  outline_approved_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type RecentDayRow = {
  course_id: string;
  course_title: string;
  day_id: string;
  day_number: number;
  objective: string;
  completed_at: string;
};

export const RECENT_DAY_LIMIT = 5;

function normalizeSourceUrl(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

export function getDashboardOverview(db: DatabaseHandle): DashboardOverview {
  const summaryRows = db.prepare(`
    SELECT
      course.id,
      course.title,
      course.goal,
      course.status,
      course.current_stage,
      current_day.day_number AS current_day_number,
      current_day.objective AS current_day_objective,
      (SELECT COUNT(*) FROM course_days WHERE course_id = course.id) AS approved_day_count,
      (SELECT COUNT(*) FROM course_days WHERE course_id = course.id AND completed_at IS NOT NULL) AS completed_day_count,
      (
        SELECT COUNT(*)
        FROM quiz_responses AS response
        JOIN quiz_questions AS question ON question.id = response.question_id
        WHERE question.day_id = course.current_day_id
      ) AS quiz_response_count,
      course.revision,
      course.outline_approved_at,
      course.completed_at,
      course.created_at,
      course.updated_at
    FROM courses AS course
    LEFT JOIN course_days AS current_day ON current_day.id = course.current_day_id
    ORDER BY course.created_at DESC, course.id ASC
  `).all() as SummaryRow[];

  const recentRows = db.prepare(`
    SELECT
      course.id AS course_id,
      course.title AS course_title,
      day.id AS day_id,
      day.day_number,
      day.objective,
      day.completed_at
    FROM course_days AS day
    JOIN courses AS course ON course.id = day.course_id
    WHERE day.completed_at IS NOT NULL
    ORDER BY day.completed_at DESC, day.day_number DESC, day.id ASC
    LIMIT ?
  `).all(RECENT_DAY_LIMIT) as RecentDayRow[];

  const selectedUrls = db.prepare(`
    SELECT url FROM research_sources WHERE selected = 1
  `).all() as { url: string }[];

  const courses = summaryRows.map((row): DashboardCourseSummary => ({
    id: row.id,
    title: row.title,
    goal: row.goal,
    status: row.status,
    currentDayNumber: row.current_day_number,
    currentDayObjective: row.current_day_objective,
    currentStage: row.current_stage,
    approvedDayCount: row.approved_day_count,
    completedDayCount: row.completed_day_count,
    hasQuizResponse: row.quiz_response_count > 0,
    revision: row.revision,
    outlineApprovedAt: row.outline_approved_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return {
    courses,
    totals: {
      activeCourseCount: courses.filter(({ status }) => status === "active").length,
      completedCourseCount: courses.filter(({ status }) => status === "completed").length,
      approvedDayCount: courses.reduce((total, { approvedDayCount }) => total + approvedDayCount, 0),
      completedDayCount: courses.reduce((total, { completedDayCount }) => total + completedDayCount, 0),
      selectedSourceCount: new Set(selectedUrls.map(({ url }) => normalizeSourceUrl(url))).size,
    },
    recentDays: recentRows.map((row) => ({
      courseId: row.course_id,
      courseTitle: row.course_title,
      dayId: row.day_id,
      dayNumber: row.day_number,
      objective: row.objective,
      completedAt: row.completed_at,
    })),
  };
}
```

- [ ] **Step 5: Run the focused test and full verification**

```bash
node --test tests/dashboard.test.ts
npm test
npm run lint
npx tsc --noEmit
git diff --check
```

Expected: all pass. The test asserts six selected rows but four distinct normalized URLs, so removing `normalizeSourceUrl` makes it fail with 6; fix the normalization, never the assertion.

- [ ] **Step 6: Commit Task 1**

```bash
git add package.json src/server/dashboard.ts tests/dashboard.test.ts
git commit -m "feat: read structured dashboard totals"
```

### Task 2: Shared history loader and course history read

**Files:**

- Modify: `src/server/learning.ts:798-817`
- Modify: `tests/dashboard.test.ts`

**Interfaces:**

- Consumes: existing `ResearchRun`, `QuizAttempt`, `LearningDay`, `Course` types and the row types already declared at `src/server/learning.ts:789-796`.
- Produces: `CourseHistoryCourse`, `CourseHistoryResearchRun`, `CourseHistoryQuizAttempt`, `CourseHistory`, `getCourseHistory(db, courseId): CourseHistory | null`.

**On query count:** a completed 30-Day course makes `getCourseHistory` issue roughly
450 statements (per-run sources and claims, per-claim evidence, per-attempt questions,
per-question responses). That is deliberate. These are the *same* prepared statements
`getLearningSnapshot` already runs, executed synchronously by better-sqlite3 against a
local file in low single-digit milliseconds, and the design forbids building a second
row-mapping path. Do not hand-roll a batched variant here: it would fork the conversion
logic the design requires sharing. If a real profile ever shows this is the bottleneck,
optimize `loadResearchRuns` / `loadQuizAttempts` once, for both callers.

- [ ] **Step 1: Write the failing history test**

Append to `tests/dashboard.test.ts` (add `getCourseHistory` to the existing `../src/server/learning.ts` import):

```ts
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
    assert.equal(attempt.questions[0]!.responses.length, 1);
    assert.equal(attempt.questions[0]!.responses[0]!.result, "correct");

    assert.equal(getCourseHistory(db, crypto.randomUUID()), null);
    // Case-insensitive: the real keys are markdownSha256, journalMarkdownPath, …
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
    assert.deepEqual(history.quizAttempts.map(({ dayNumber }) => dayNumber), Array.from({ length: 30 }, (_, index) => index + 1));
  });
});
```

- [ ] **Step 2: Run the focused test and observe RED**

Run: `node --test --test-name-pattern='course history' tests/dashboard.test.ts`

Expected: FAIL — `getCourseHistory is not exported`.

- [ ] **Step 3: Extract the shared loaders**

In `src/server/learning.ts`, immediately after the row type declarations at line 796, insert these two functions. They contain exactly the mapping expressions that are currently inline inside `getLearningSnapshot`:

```ts
function loadResearchRuns(db: DatabaseHandle, runRows: readonly ResearchRunRow[]): ResearchRun[] {
  return runRows.map((run): ResearchRun => {
    const sourceRows = db.prepare(`SELECT * FROM research_sources WHERE run_id = ? ORDER BY rank`).all(run.id) as ResearchSourceRow[];
    const claimRows = db.prepare(`SELECT id, statement, major, conclusion, uncertainty FROM research_claims WHERE run_id = ? ORDER BY id`).all(run.id) as ResearchClaimRow[];
    return {
      id: run.id,
      scope: run.scope,
      dayId: run.day_id,
      questions: JSON.parse(run.questions_json) as string[],
      topicCriteria: JSON.parse(run.topic_criteria_json) as string[],
      sources: sourceRows.map((source) => ({
        id: source.id,
        url: source.url,
        title: source.title,
        publisher: source.publisher,
        independenceKey: source.independence_key,
        scores: {
          authority: source.authority_score,
          crossValidation: source.cross_validation_score,
          relevance: source.relevance_score,
          teachingQuality: source.teaching_quality_score,
          currency: source.currency_score,
          accessibility: source.accessibility_score,
        },
        totalScore: source.total_score,
        rank: source.rank,
        selected: source.selected === 1,
        selectionReason: source.selection_reason,
        limitation: source.limitation,
      })),
      claims: claimRows.map((claim) => ({
        id: claim.id,
        statement: claim.statement,
        major: claim.major === 1,
        conclusion: claim.conclusion,
        uncertainty: claim.uncertainty,
        evidence: (db.prepare(`SELECT source_id, stance FROM research_claim_evidence WHERE run_id = ? AND claim_id = ? ORDER BY source_id, stance`).all(run.id, claim.id) as EvidenceRow[])
          .map((evidence) => ({ sourceId: evidence.source_id, stance: evidence.stance })),
      })),
      createdAt: run.created_at,
    };
  });
}

function loadQuizAttempts<Row extends AttemptRow>(
  db: DatabaseHandle,
  attemptRows: readonly Row[],
): (QuizAttempt & { row: Row })[] {
  return attemptRows.map((attempt) => {
    const questions = db.prepare(`SELECT id, position, concept_key, concept_label, prompt, grading_criteria FROM quiz_questions WHERE attempt_id = ? ORDER BY position`).all(attempt.id) as QuestionRow[];
    return {
      row: attempt,
      id: attempt.id,
      attemptNumber: attempt.attempt_number,
      status: attempt.status,
      score: attempt.score,
      createdAt: attempt.created_at,
      gradedAt: attempt.graded_at,
      questions: questions.map((question) => ({
        id: question.id,
        position: question.position,
        conceptKey: question.concept_key,
        conceptLabel: question.concept_label,
        prompt: question.prompt,
        gradingCriteria: question.grading_criteria,
        responses: (db.prepare(`SELECT id, question_id, response_number, answer, result, feedback, clarification_question, created_at FROM quiz_responses WHERE question_id = ? ORDER BY response_number`).all(question.id) as ResponseRow[])
          .map((response) => ({
            id: response.id,
            questionId: response.question_id,
            responseNumber: response.response_number,
            answer: response.answer,
            result: response.result,
            feedback: response.feedback,
            clarificationQuestion: response.clarification_question,
            createdAt: response.created_at,
          })),
      })),
    };
  });
}
```

`loadQuizAttempts` carries its source row back on `row` so callers never have to
re-align two arrays by index.

Then in `getLearningSnapshot` replace the inline `runRows.map(...)` expression with `loadResearchRuns(db, runRows)` and the inline `attemptRows.map(...)` expression with `loadQuizAttempts(db, attemptRows).map(({ row: _row, ...attempt }) => attempt)`. Do not change any other line of `getLearningSnapshot`.

- [ ] **Step 4: Add `getCourseHistory`**

Append to `src/server/learning.ts`:

```ts
export type CourseHistoryResearchRun = ResearchRun & {
  dayNumber: number | null;
  dayObjective: string | null;
};

export type CourseHistoryQuizAttempt = QuizAttempt & {
  dayId: string;
  dayNumber: number;
  dayObjective: string;
};

/** Course facts the UI may see: no Markdown path and no checksum. */
export type CourseHistoryCourse = Omit<
  Course,
  | "markdownPath"
  | "markdownSha256"
  | "progressMarkdownPath"
  | "progressMarkdownSha256"
  | "journalMarkdownPath"
  | "journalMarkdownSha256"
  | "currentDayMarkdownPath"
  | "currentDayMarkdownSha256"
>;

export type CourseHistory = {
  course: CourseHistoryCourse;
  days: LearningDay[];
  researchRuns: CourseHistoryResearchRun[];
  quizAttempts: CourseHistoryQuizAttempt[];
};

export function getCourseHistory(db: DatabaseHandle, courseId: string): CourseHistory | null {
  const stored = getCourse(db, courseId);
  if (!stored) return null;
  const {
    markdownPath: _markdownPath,
    markdownSha256: _markdownSha256,
    progressMarkdownPath: _progressMarkdownPath,
    progressMarkdownSha256: _progressMarkdownSha256,
    journalMarkdownPath: _journalMarkdownPath,
    journalMarkdownSha256: _journalMarkdownSha256,
    currentDayMarkdownPath: _currentDayMarkdownPath,
    currentDayMarkdownSha256: _currentDayMarkdownSha256,
    ...course
  } = stored;

  const days = (db.prepare(`
    SELECT id, day_number, objective, completed_at FROM course_days WHERE course_id = ? ORDER BY day_number
  `).all(courseId) as DayRow[]).map((row) => ({
    id: row.id,
    dayNumber: row.day_number,
    objective: row.objective,
    completedAt: row.completed_at,
  }));
  const dayById = new Map(days.map((day) => [day.id, day]));

  const runRows = db.prepare(`
    SELECT id, scope, day_id, questions_json, topic_criteria_json, created_at
    FROM research_runs WHERE course_id = ?
    ORDER BY CASE scope WHEN 'course' THEN 0 ELSE 1 END, created_at, id
  `).all(courseId) as ResearchRunRow[];
  const researchRuns = loadResearchRuns(db, runRows).map((run): CourseHistoryResearchRun => {
    const day = run.dayId === null ? undefined : dayById.get(run.dayId);
    return { ...run, dayNumber: day?.dayNumber ?? null, dayObjective: day?.objective ?? null };
  });

  const attemptRows = db.prepare(`
    SELECT attempt.id, attempt.attempt_number, attempt.status, attempt.score,
           attempt.created_at, attempt.graded_at, attempt.day_id
    FROM quiz_attempts AS attempt
    JOIN course_days AS day ON day.id = attempt.day_id
    WHERE day.course_id = ?
    ORDER BY day.day_number, attempt.attempt_number
  `).all(courseId) as (AttemptRow & { day_id: string })[];
  const quizAttempts = loadQuizAttempts(db, attemptRows).map(({ row, ...attempt }): CourseHistoryQuizAttempt => {
    const day = dayById.get(row.day_id);
    if (!day) throw new LearningStateError("Quiz attempt Day is missing");
    return { ...attempt, dayId: row.day_id, dayNumber: day.dayNumber, dayObjective: day.objective };
  });

  return { course, days, researchRuns, quizAttempts };
}
```

- [ ] **Step 5: Run the focused test and full verification**

```bash
node --test tests/dashboard.test.ts
npm test
npm run lint
npx tsc --noEmit
git diff --check
```

Expected: all pass, including the pre-existing `tests/learning-engine.test.ts` snapshot tests, which prove the extraction did not change `getLearningSnapshot` behavior.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/server/learning.ts tests/dashboard.test.ts
git commit -m "feat: read the full course learning history"
```

### Task 3: Pure view model

**Files:**

- Create: `src/server/dashboard-view.ts`
- Modify: `tests/dashboard.test.ts`

**Interfaces:**

- Consumes: `DashboardCourseSummary` and `DashboardOverview` from Task 1; `CourseStatus`, `LearningStage` from `src/server/courses.ts`.
- Produces: `STAGE_LABELS`, `STATUS_LABELS`, `RESUME_COMMAND`, `COURSE_TABS`, `COURSE_FILTERS`, `CourseTab`, `CourseFilter`, `AttentionItem`, `CourseCardModel`, `courseAccentIndex`, `courseProgress`, `courseCardModel`, `resumeCourse`, `attentionItems`, `filterCourses`, `normalizeTab`, `normalizeCourseFilter`.

This module must import nothing from `node:fs`, `better-sqlite3`, `react`, or `next`. It is the only place that turns stored facts into screen text, so every page imports its labels instead of writing its own.

- [ ] **Step 1: Write the failing view-model test**

Append to `tests/dashboard.test.ts`:

```ts
import {
  attentionItems,
  courseAccentIndex,
  courseCardModel,
  courseProgress,
  filterCourses,
  normalizeCourseFilter,
  normalizeTab,
  resumeCourse,
  RESUME_COMMAND,
  STAGE_LABELS,
  STATUS_LABELS,
} from "../src/server/dashboard-view.ts";
import type { DashboardCourseSummary } from "../src/server/dashboard.ts";

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

  const drafts = [
    summary({ id: "c", status: "draft", currentStage: null, currentDayNumber: null, updatedAt: "2026-07-02T00:00:00.000Z" }),
    summary({ id: "d", status: "draft", currentStage: null, currentDayNumber: null, updatedAt: "2026-07-08T00:00:00.000Z" }),
  ];
  assert.equal(resumeCourse(drafts)!.id, "d");

  const done = summary({ id: "e", status: "completed", currentStage: null, currentDayNumber: null });
  assert.equal(resumeCourse([done]), null);
  assert.equal(resumeCourse([]), null);
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

test("course accent is a stable identity-only palette index", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(courseAccentIndex(id), courseAccentIndex(id));
  assert.equal(Number.isInteger(courseAccentIndex(id)), true);
  assert.equal(courseAccentIndex(id) >= 0 && courseAccentIndex(id) < 6, true);
  assert.equal(courseAccentIndex(""), 0);
});
```

- [ ] **Step 2: Run the focused test and observe RED**

Run: `node --test --test-name-pattern='view model|course card|progress is|resume picks|attention|tab and filter|filter selects|course accent' tests/dashboard.test.ts`

Expected: FAIL — `Cannot find module '../src/server/dashboard-view.ts'`.

- [ ] **Step 3: Implement the view model**

Create `src/server/dashboard-view.ts`:

```ts
import type { CourseStatus, LearningStage } from "./courses.ts";
import type { DashboardCourseSummary } from "./dashboard.ts";

export const STAGE_LABELS: Record<LearningStage, string> = {
  lecture: "강의",
  quiz: "퀴즈",
  remediation: "보완 학습",
  reflection: "회고",
};

export const STATUS_LABELS: Record<CourseStatus, string> = {
  draft: "초안",
  active: "진행 중",
  completed: "완료",
};

export const RESUME_COMMAND = "$just-study 계속";
export const TOTAL_DAYS = 30;
export const ATTENTION_LIMIT = 3;
export const COURSE_ACCENT_COUNT = 6;

export const COURSE_TABS = ["overview", "plan", "today", "sources", "quiz", "journal"] as const;
export type CourseTab = (typeof COURSE_TABS)[number];

export const COURSE_TAB_LABELS: Record<CourseTab, string> = {
  overview: "개요",
  plan: "30일 계획",
  today: "오늘",
  sources: "출처",
  quiz: "퀴즈",
  journal: "학습 기록",
};

export const COURSE_FILTERS = ["all", "active", "draft", "completed"] as const;
export type CourseFilter = (typeof COURSE_FILTERS)[number];

export const COURSE_FILTER_LABELS: Record<CourseFilter, string> = {
  all: "전체",
  active: "진행 중",
  draft: "초안",
  completed: "완료",
};

export type CourseProgress = { completed: number; approved: number; percent: number };

export type CourseCardModel = {
  id: string;
  title: string;
  goal: string;
  statusLabel: string;
  status: CourseStatus;
  dayLabel: string | null;
  stageLabel: string | null;
  progress: CourseProgress | null;
  note: string | null;
  accentIndex: number;
  updatedAt: string;
  href: string;
};

export type AttentionItem = {
  courseId: string;
  courseTitle: string;
  message: string;
  tab: CourseTab;
  href: string;
};

export function normalizeTab(value: unknown): CourseTab {
  return typeof value === "string" && (COURSE_TABS as readonly string[]).includes(value)
    ? (value as CourseTab)
    : "overview";
}

export function normalizeCourseFilter(value: unknown): CourseFilter {
  return typeof value === "string" && (COURSE_FILTERS as readonly string[]).includes(value)
    ? (value as CourseFilter)
    : "all";
}

export function courseAccentIndex(courseId: string): number {
  let hash = 0;
  for (const character of courseId) {
    hash = (hash * 31 + character.codePointAt(0)!) % 1_000_003;
  }
  return hash % COURSE_ACCENT_COUNT;
}

export function courseProgress(course: DashboardCourseSummary): CourseProgress | null {
  if (course.approvedDayCount === 0) return null;
  return {
    completed: course.completedDayCount,
    approved: course.approvedDayCount,
    percent: Math.round((course.completedDayCount / course.approvedDayCount) * 100),
  };
}

export function courseCardModel(course: DashboardCourseSummary): CourseCardModel {
  const progress = courseProgress(course);
  const dayLabel = course.status === "completed"
    ? `Day ${course.approvedDayCount} / ${course.approvedDayCount}`
    : course.currentDayNumber === null
      ? null
      : `Day ${course.currentDayNumber} / ${course.approvedDayCount}`;
  return {
    id: course.id,
    title: course.title,
    goal: course.goal,
    status: course.status,
    statusLabel: STATUS_LABELS[course.status],
    dayLabel,
    stageLabel: course.currentStage === null ? null : STAGE_LABELS[course.currentStage],
    progress,
    note: course.status === "draft" ? "30일 계획 승인 대기" : course.status === "completed" ? "완료" : null,
    accentIndex: courseAccentIndex(course.id),
    updatedAt: course.updatedAt,
    href: `/courses/${course.id}`,
  };
}

function byUpdatedAtDescending(left: DashboardCourseSummary, right: DashboardCourseSummary): number {
  if (left.updatedAt === right.updatedAt) return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  return left.updatedAt < right.updatedAt ? 1 : -1;
}

export function resumeCourse(courses: readonly DashboardCourseSummary[]): DashboardCourseSummary | null {
  const active = courses.filter(({ status }) => status === "active").sort(byUpdatedAtDescending);
  if (active.length > 0) return active[0]!;
  const drafts = courses.filter(({ status }) => status === "draft").sort(byUpdatedAtDescending);
  return drafts[0] ?? null;
}

type AttentionRule = { rank: number; message: string; tab: CourseTab };

function attentionRule(course: DashboardCourseSummary): AttentionRule | null {
  if (course.status === "completed") return null;
  if (course.status === "draft") return { rank: 4, message: "30일 계획 승인이 필요합니다", tab: "overview" };
  switch (course.currentStage) {
    case "remediation":
      return { rank: 0, message: "보완 학습이 필요합니다", tab: "today" };
    case "reflection":
      return { rank: 1, message: "회고를 완료하면 다음 Day로 이동합니다", tab: "today" };
    case "quiz":
      return course.hasQuizResponse
        ? { rank: 2, message: "퀴즈 답변을 이어가세요", tab: "quiz" }
        : { rank: 3, message: "오늘의 퀴즈가 기다리고 있습니다", tab: "today" };
    case "lecture":
      return { rank: 5, message: "오늘 학습을 이어가세요", tab: "today" };
    default:
      return null;
  }
}

export function attentionItems(courses: readonly DashboardCourseSummary[]): AttentionItem[] {
  return courses
    .flatMap((course) => {
      const rule = attentionRule(course);
      return rule === null ? [] : [{ course, rule }];
    })
    .sort((left, right) => left.rule.rank - right.rule.rank || byUpdatedAtDescending(left.course, right.course))
    .slice(0, ATTENTION_LIMIT)
    .map(({ course, rule }) => ({
      courseId: course.id,
      courseTitle: course.title,
      message: rule.message,
      tab: rule.tab,
      href: `/courses/${course.id}?tab=${rule.tab}`,
    }));
}

export function filterCourses(
  courses: readonly DashboardCourseSummary[],
  filter: CourseFilter,
): DashboardCourseSummary[] {
  return filter === "all" ? [...courses] : courses.filter(({ status }) => status === filter);
}
```

- [ ] **Step 4: Run the focused test and full verification**

```bash
node --test tests/dashboard.test.ts
npm test
npm run lint
npx tsc --noEmit
git diff --check
```

Expected: all pass.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/server/dashboard-view.ts tests/dashboard.test.ts
git commit -m "feat: compute dashboard state in one view model"
```

### Task 4: Safe Markdown parser

**Files:**

- Create: `src/server/markdown.ts`
- Modify: `tests/dashboard.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `MarkdownInline`, `MarkdownBlock`, `parseMarkdown(source: string): MarkdownBlock[]`.

The parser must never produce an HTML string and must never mark an untrusted URL as a link. It is the only Markdown reader in the UI; no other module may interpret Markdown syntax.

- [ ] **Step 1: Write the failing parser test**

Append to `tests/dashboard.test.ts`:

```ts
import { parseMarkdown, type MarkdownBlock } from "../src/server/markdown.ts";
import { renderApprovedCourseMarkdown } from "../src/server/learning-markdown.ts";

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

  // Adjacent text runs are merged, so the safe result is exactly one link plus one
  // text node that still contains every original character.
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
  // "javascript:" survives only as literal text, never as a link href.
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
```

- [ ] **Step 2: Run the focused test and observe RED**

Run: `node --test --test-name-pattern='parser' tests/dashboard.test.ts`

Expected: FAIL — `Cannot find module '../src/server/markdown.ts'`.

Note on the link test: `pushText` merges consecutive text runs, so two adjacent
`{type:"text"}` nodes can never appear. The assertion is written to the merged shape
on purpose; the safety property being locked is "no link node is produced for an
unsafe scheme and no character is lost", not the node count.

- [ ] **Step 3: Implement the parser**

Create `src/server/markdown.ts`:

```ts
export type MarkdownInline =
  | { type: "text"; value: string }
  | { type: "strong"; value: string }
  | { type: "emphasis"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; href: string; text: string };

export type MarkdownAlignment = "left" | "center" | "right";

export type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; inline: MarkdownInline[] }
  | { type: "paragraph"; inline: MarkdownInline[] }
  | { type: "list"; ordered: boolean; items: MarkdownInline[][] }
  | { type: "quote"; lines: MarkdownInline[][] }
  | { type: "code"; language: string | null; value: string }
  | { type: "table"; header: MarkdownInline[][]; alignments: MarkdownAlignment[]; rows: MarkdownInline[][][] }
  | { type: "rule" };

const INLINE_PATTERN = /(!?\[[^\]\n]*\]\([^\s()]*\))|(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)/;
const LINK_PATTERN = /^\[([^\]\n]*)\]\(([^\s()]*)\)$/;

function safeLinkHref(candidate: string): string | null {
  if (candidate === "") return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
}

function pushText(target: MarkdownInline[], value: string): void {
  if (value === "") return;
  const last = target.at(-1);
  if (last?.type === "text") last.value += value;
  else target.push({ type: "text", value });
}

export function parseInline(source: string): MarkdownInline[] {
  const result: MarkdownInline[] = [];
  let rest = source;

  while (rest.length > 0) {
    const match = INLINE_PATTERN.exec(rest);
    if (!match) {
      pushText(result, rest);
      break;
    }
    pushText(result, rest.slice(0, match.index));
    const token = match[0]!;
    rest = rest.slice(match.index + token.length);

    if (token.startsWith("`")) {
      result.push({ type: "code", value: token.slice(1, -1) });
      continue;
    }
    if (token.startsWith("**")) {
      result.push({ type: "strong", value: token.slice(2, -2) });
      continue;
    }
    if (token.startsWith("*")) {
      result.push({ type: "emphasis", value: token.slice(1, -1) });
      continue;
    }
    const link = LINK_PATTERN.exec(token.startsWith("!") ? token.slice(1) : token);
    const href = link === null ? null : safeLinkHref(link[2]!.trim());
    if (link === null || href === null || link[1]!.trim() === "") {
      pushText(result, token);
      continue;
    }
    result.push({ type: "link", href, text: link[1]! });
  }

  return result;
}

function tableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const character of trimmed) {
    if (escaped) {
      cell += character === "|" ? "|" : `\\${character}`;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(`${cell}${escaped ? "\\" : ""}`.trim());
  return cells;
}

function alignmentOf(cell: string): MarkdownAlignment | null {
  if (!/^:?-{1,}:?$/.test(cell)) return null;
  if (cell.startsWith(":") && cell.endsWith(":")) return "center";
  if (cell.endsWith(":")) return "right";
  return "left";
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const fence = /^```(.*)$/.exec(line);
    if (fence) {
      const language = fence[1]!.trim();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index]!)) {
        body.push(lines[index]!);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", language: language === "" ? null : language, value: body.join("\n") });
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6,
        inline: parseInline(heading[2]!.trim()),
      });
      index += 1;
      continue;
    }

    if (line.trimStart().startsWith(">")) {
      const quoteLines: MarkdownInline[][] = [];
      while (index < lines.length && lines[index]!.trimStart().startsWith(">")) {
        quoteLines.push(parseInline(lines[index]!.trimStart().replace(/^>\s?/, "")));
        index += 1;
      }
      blocks.push({ type: "quote", lines: quoteLines });
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d{1,9}[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = bullet === null;
      const items: MarkdownInline[][] = [];
      while (index < lines.length) {
        const current = lines[index]!;
        const next = ordered ? /^\s*\d{1,9}[.)]\s+(.*)$/.exec(current) : /^\s*[-*+]\s+(.*)$/.exec(current);
        if (!next) break;
        items.push(parseInline(next[1]!.trim()));
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length && lines[index + 1]!.includes("-")) {
      const header = tableCells(line);
      const alignmentCells = tableCells(lines[index + 1]!);
      const alignments = alignmentCells.map(alignmentOf);
      if (alignments.length === header.length && alignments.every((value) => value !== null)) {
        index += 2;
        const rows: MarkdownInline[][][] = [];
        while (index < lines.length && lines[index]!.includes("|") && lines[index]!.trim() !== "") {
          const cells = tableCells(lines[index]!);
          rows.push(Array.from({ length: header.length }, (_, cell) => parseInline(cells[cell] ?? "")));
          index += 1;
        }
        blocks.push({
          type: "table",
          header: header.map((cell) => parseInline(cell)),
          alignments: alignments as MarkdownAlignment[],
          rows,
        });
        continue;
      }
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index]!;
      if (
        current.trim() === "" ||
        /^```/.test(current) ||
        /^#{1,6}\s/.test(current) ||
        current.trimStart().startsWith(">") ||
        /^\s*[-*+]\s+/.test(current) ||
        /^\s*\d{1,9}[.)]\s+/.test(current) ||
        /^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(current.trim())
      ) break;
      paragraph.push(current.trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", inline: parseInline(paragraph.join(" ")) });
  }

  return blocks;
}
```

- [ ] **Step 4: Run the focused test and full verification**

```bash
node --test tests/dashboard.test.ts
npm test
npm run lint
npx tsc --noEmit
git diff --check
```

Expected: all pass. If a test fails because a token was swallowed, fix the parser so the original characters survive as text; never delete input.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/server/markdown.ts tests/dashboard.test.ts
git commit -m "feat: parse learning Markdown without raw HTML"
```

### Combined Tasks 5/6: Tailwind v4, themes, shell, navigation, and Settings

**Files:**

- Create: `postcss.config.mjs`
- Create: `src/app/theme.ts`
- Modify: `src/app/globals.css` (full replacement)
- Modify: `src/app/layout.tsx`
- Modify: `package.json`, `package-lock.json`
- Modify: `tests/dashboard.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `THEMES`, `DEFAULT_THEME`, `THEME_STORAGE_KEY`, `THEME_LABELS`, `Theme`, `normalizeTheme(value): Theme`, `themeAttributes(theme)`, `applyTheme(value: unknown, root: HTMLElement)`, `THEME_BOOTSTRAP_SCRIPT`.

- [ ] **Step 1: Install the exact Tailwind v4 dev dependencies**

```bash
npm install --save-dev --save-exact tailwindcss@4.3.3 @tailwindcss/postcss@4.3.3
```

Expected: `package.json` devDependencies contain `"tailwindcss": "4.3.3"` and `"@tailwindcss/postcss": "4.3.3"`; the lockfile resolves the same versions. Do not install `clsx`, `tailwind-merge`, `class-variance-authority`, `@radix-ui/*`, `lucide-react`, or the shadcn CLI.

- [ ] **Step 2: Write the failing theme test**

Append to `tests/dashboard.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  applyTheme,
  DEFAULT_THEME,
  normalizeTheme,
  THEMES,
  THEME_BOOTSTRAP_SCRIPT,
  THEME_LABELS,
  THEME_STORAGE_KEY,
  themeAttributes,
} from "../src/app/theme.ts";

test("theme values are validated and default to focus", () => {
  assert.deepEqual([...THEMES], ["focus", "calm", "focus-dark"]);
  assert.equal(DEFAULT_THEME, "focus");
  assert.equal(THEME_STORAGE_KEY, "just-study:theme");
  assert.deepEqual(Object.keys(THEME_LABELS).sort(), ["calm", "focus", "focus-dark"]);
  for (const theme of THEMES) assert.equal(normalizeTheme(theme), theme);
  for (const value of [undefined, null, "", "dark", "FOCUS", "focus ", 3, {}, ["calm"]]) {
    assert.equal(normalizeTheme(value), "focus");
  }
});

test("theme attributes map focus-dark to the dark class and color scheme", () => {
  assert.deepEqual(themeAttributes("focus"), { theme: "focus", dark: false, colorScheme: "light" });
  assert.deepEqual(themeAttributes("calm"), { theme: "calm", dark: false, colorScheme: "light" });
  assert.deepEqual(themeAttributes("focus-dark"), { theme: "focus-dark", dark: true, colorScheme: "dark" });
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

test("globals.css defines every semantic token for all three themes and no chart token", () => {
  const css = readFileSync(resolve(import.meta.dirname, "../src/app/globals.css"), "utf8");
  const tokens = [
    "--background", "--foreground", "--card", "--card-foreground", "--popover", "--popover-foreground",
    "--primary", "--primary-foreground", "--secondary", "--secondary-foreground", "--muted",
    "--muted-foreground", "--accent", "--accent-foreground", "--destructive", "--destructive-foreground",
    "--border", "--input", "--ring", "--sidebar", "--sidebar-foreground", "--sidebar-primary",
    "--sidebar-primary-foreground", "--sidebar-accent", "--sidebar-accent-foreground",
    "--sidebar-border", "--sidebar-ring", "--radius-sm", "--radius-md", "--radius-lg", "--radius-xl",
  ];
  for (const [name, pattern] of [
    ["focus", /:root,\s*\[data-theme="focus"\]\s*\{([^}]*)\}/],
    ["calm", /\[data-theme="calm"\]\s*\{([^}]*)\}/],
    ["focus-dark", /\[data-theme="focus-dark"\]\s*\{([^}]*)\}/],
  ] as const) {
    const block = pattern.exec(css)?.[1];
    assert.ok(block, `globals.css has no ${name} token block`);
    for (const token of tokens) {
      assert.match(block, new RegExp(`${token}\\s*:`), `${name} is missing ${token}`);
    }
  }
  for (const theme of ["focus", "calm", "focus-dark"]) void theme;
  assert.equal((css.match(/--chart-1\s*:/g) ?? []).length, 3);
  assert.equal((css.match(/--chart-5\s*:/g) ?? []).length, 3);
  assert.equal(css.includes("calc(var(--radius)"), false);
  assert.equal(css.includes("--font-sans: var(--font-sans);"), false);
  assert.equal(css.includes("/ 2.50)"), false);
  assert.match(css, /--course-accent-0\s*:/);
  assert.match(css, /--course-accent-5\s*:/);
  assert.match(css, /prefers-reduced-motion/);
  // Variant-capable helpers must be @utility; only .surface may be a plain component.
  for (const helper of ["bw", "bw-b", "bw-t", "bw-r", "radius-sm", "radius-md", "radius-lg", "shadow-token", "outline-selected", "tap-target", "sr-only"]) {
    assert.match(css, new RegExp(`@utility ${helper}\\s*\\{`), `globals.css is missing @utility ${helper}`);
  }
  assert.match(css, /\.surface\s*\{/);
  // Every class the components use must exist. `lg:bw-r` only works via @utility.
  assert.equal(css.includes(".bw {"), false);
});
```

- [ ] **Step 3: Run the focused test and observe RED**

Run: `node --test --test-name-pattern='theme|globals.css' tests/dashboard.test.ts`

Expected: FAIL — `Cannot find module '../src/app/theme.ts'`.

- [ ] **Step 4: Implement the theme helper**

Create `src/app/theme.ts`:

```ts
export const THEMES = ["focus", "calm", "focus-dark"] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "focus";
export const THEME_STORAGE_KEY = "just-study:theme";
export const DARK_THEME: Theme = "focus-dark";

export const THEME_LABELS: Record<Theme, { name: string; description: string }> = {
  focus: { name: "Focus", description: "높은 대비의 흑백과 빨강·노랑 강조. 기본값입니다." },
  calm: { name: "Calm", description: "따뜻한 중성색과 부드러운 경계. 오래 읽을 때 좋습니다." },
  "focus-dark": { name: "Focus Dark", description: "Focus와 같은 구조의 어두운 배경입니다." },
};

export function normalizeTheme(value: unknown): Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value)
    ? (value as Theme)
    : DEFAULT_THEME;
}

export function themeAttributes(theme: Theme): { theme: Theme; dark: boolean; colorScheme: "light" | "dark" } {
  const dark = theme === DARK_THEME;
  return { theme, dark, colorScheme: dark ? "dark" : "light" };
}

export function applyTheme(value: unknown, root: HTMLElement): void {
  const { theme, dark, colorScheme } = themeAttributes(normalizeTheme(value));
  root.setAttribute("data-theme", theme);
  root.classList[dark ? "add" : "remove"]("dark");
  root.style.colorScheme = colorScheme;
}

export const THEME_BOOTSTRAP_SCRIPT = `(function(){var r=document.documentElement;try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var a=${JSON.stringify(THEMES)};if(a.indexOf(t)<0)t=${JSON.stringify(DEFAULT_THEME)};r.setAttribute("data-theme",t);r.classList[t===${JSON.stringify(DARK_THEME)}?"add":"remove"]("dark");r.style.colorScheme=t===${JSON.stringify(DARK_THEME)}?"dark":"light";}catch(e){r.setAttribute("data-theme",${JSON.stringify(DEFAULT_THEME)});r.classList.remove("dark");r.style.colorScheme="light";}})();`;
```

`applyTheme` is written against the small DOM surface the test fakes: `setAttribute`, `classList.add/remove`, and `style.colorScheme`. The bootstrap string is built from the same constants so the two paths cannot diverge; its `catch` explicitly reapplies Focus's `data-theme`, removes `dark`, and sets `colorScheme` to `light` when `localStorage` access fails.

- [ ] **Step 5: Add the PostCSS config**

Create `postcss.config.mjs`:

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

- [ ] **Step 6: Replace `src/app/globals.css`**

Replace the whole file with the Tailwind v4 entry and the three token sets. Focus and Focus Dark values are copied verbatim from the approved attachment except for the three normalizations the design requires; Calm values are fixed here with the contrast reasoning in the comments.

```css
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

:root,
[data-theme="focus"] {
  --background: oklch(1.0000 0 0);
  --foreground: oklch(0 0 0);
  --card: oklch(1.0000 0 0);
  --card-foreground: oklch(0 0 0);
  --popover: oklch(1.0000 0 0);
  --popover-foreground: oklch(0 0 0);
  --primary: hsl(0 100% 43%);
  --primary-foreground: oklch(1.0000 0 0);
  --secondary: oklch(0 0 0);
  --secondary-foreground: oklch(1.0000 0 0);
  --muted: oklch(0.9696 0 0);
  --muted-foreground: oklch(0.5103 0 0);
  --accent: oklch(0.8408 0.1725 84.2008);
  --accent-foreground: oklch(0 0 0);
  --destructive: oklch(0.5308 0.2178 29.2339);
  --destructive-foreground: oklch(1.0000 0 0);
  --border: oklch(0 0 0);
  --input: oklch(1.0000 0 0);
  --ring: oklch(0.5799 0.2380 29.2339);
  --sidebar: oklch(0.9848 0 0);
  --sidebar-foreground: oklch(0 0 0);
  --sidebar-primary: oklch(0.5799 0.2380 29.2339);
  --sidebar-primary-foreground: oklch(1.0000 0 0);
  --sidebar-accent: oklch(0.9234 0 0);
  --sidebar-accent-foreground: oklch(0 0 0);
  --sidebar-border: oklch(0 0 0);
  --sidebar-ring: oklch(0.5799 0.2380 29.2339);
  --chart-1: oklch(0 0 0);
  --chart-2: oklch(0.5799 0.2380 29.2339);
  --chart-3: oklch(0.8408 0.1725 84.2008);
  --chart-4: oklch(0.4907 0.0695 144.4260);
  --chart-5: oklch(0.5166 0.0826 46.9154);
  --radius-sm: 0px;
  --radius-md: 0px;
  --radius-lg: 0px;
  --radius-xl: 0px;
  --shadow-2xs: 3px 3px 0px 0px hsl(0 0% 0% / 0.50);
  --shadow-xs: 3px 3px 0px 0px hsl(0 0% 0% / 0.50);
  --shadow-sm: 3px 3px 0px 0px hsl(0 0% 0% / 1.00), 3px 1px 2px -1px hsl(0 0% 0% / 1.00);
  --shadow-base: 3px 3px 0px 0px hsl(0 0% 0% / 1.00), 3px 1px 2px -1px hsl(0 0% 0% / 1.00);
  --shadow-md: 3px 3px 0px 0px hsl(0 0% 0% / 1.00), 3px 2px 4px -1px hsl(0 0% 0% / 1.00);
  --shadow-lg: 3px 3px 0px 0px hsl(0 0% 0% / 1.00), 3px 4px 6px -1px hsl(0 0% 0% / 1.00);
  --shadow-xl: 3px 3px 0px 0px hsl(0 0% 0% / 1.00), 3px 8px 10px -1px hsl(0 0% 0% / 1.00);
  /* The attachment's 2.50 alpha is invalid; clamped to the maximum 1.00. */
  --shadow-2xl: 3px 3px 0px 0px hsl(0 0% 0% / 1.00);
  --border-width-base: 2px;
  --course-accent-0: oklch(0.5799 0.2380 29.2339);
  --course-accent-1: oklch(0.5100 0.1400 264.0000);
  --course-accent-2: oklch(0.4907 0.0695 144.4260);
  --course-accent-3: oklch(0.5166 0.0826 46.9154);
  --course-accent-4: oklch(0.4800 0.1300 320.0000);
  --course-accent-5: oklch(0.4600 0.0900 200.0000);
}

[data-theme="calm"] {
  /* Contrast computed from OKLCH lightness with Y = L^3 (Oklab's achromatic axis),
     not the CIE L* formula. Against --background: foreground 13.6:1,
     muted-foreground 7.7:1, border 4.0:1, ring 7.3:1;
     primary-foreground on primary 7.6:1. All pass WCAG AA; border and ring clear
     the 3:1 non-text minimum. */
  --background: oklch(0.9761 0.0086 84.5);
  --foreground: oklch(0.2795 0.0158 63.2);
  --card: oklch(0.9925 0.0044 84.5);
  --card-foreground: oklch(0.2795 0.0158 63.2);
  --popover: oklch(0.9925 0.0044 84.5);
  --popover-foreground: oklch(0.2795 0.0158 63.2);
  --primary: oklch(0.4381 0.0721 158.5);
  --primary-foreground: oklch(0.9900 0.0040 84.5);
  --secondary: oklch(0.9246 0.0121 84.5);
  --secondary-foreground: oklch(0.2795 0.0158 63.2);
  --muted: oklch(0.9440 0.0102 84.5);
  --muted-foreground: oklch(0.4245 0.0166 63.2);
  --accent: oklch(0.8520 0.0940 78.5);
  --accent-foreground: oklch(0.2795 0.0158 63.2);
  --destructive: oklch(0.4700 0.1720 27.5);
  --destructive-foreground: oklch(0.9900 0.0040 84.5);
  --border: oklch(0.5800 0.0190 63.2);
  --input: oklch(0.9925 0.0044 84.5);
  --ring: oklch(0.4381 0.0721 158.5);
  --sidebar: oklch(0.9560 0.0110 84.5);
  --sidebar-foreground: oklch(0.2795 0.0158 63.2);
  --sidebar-primary: oklch(0.4381 0.0721 158.5);
  --sidebar-primary-foreground: oklch(0.9900 0.0040 84.5);
  --sidebar-accent: oklch(0.9180 0.0128 84.5);
  --sidebar-accent-foreground: oklch(0.2795 0.0158 63.2);
  --sidebar-border: oklch(0.5800 0.0190 63.2);
  --sidebar-ring: oklch(0.4381 0.0721 158.5);
  --chart-1: oklch(0.2795 0.0158 63.2);
  --chart-2: oklch(0.4381 0.0721 158.5);
  --chart-3: oklch(0.8520 0.0940 78.5);
  --chart-4: oklch(0.4600 0.0850 55.0000);
  --chart-5: oklch(0.4300 0.0700 250.0000);
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 10px;
  --radius-xl: 12px;
  --shadow-2xs: 0 1px 1px 0 hsl(30 20% 20% / 0.05);
  --shadow-xs: 0 1px 2px 0 hsl(30 20% 20% / 0.06);
  --shadow-sm: 0 1px 2px 0 hsl(30 20% 20% / 0.08);
  --shadow-base: 0 1px 2px 0 hsl(30 20% 20% / 0.08), 0 2px 8px -2px hsl(30 20% 20% / 0.10);
  --shadow-md: 0 2px 4px -1px hsl(30 20% 20% / 0.10), 0 4px 10px -2px hsl(30 20% 20% / 0.10);
  --shadow-lg: 0 4px 8px -2px hsl(30 20% 20% / 0.10), 0 8px 20px -4px hsl(30 20% 20% / 0.12);
  --shadow-xl: 0 8px 16px -4px hsl(30 20% 20% / 0.12), 0 16px 32px -8px hsl(30 20% 20% / 0.14);
  --shadow-2xl: 0 16px 32px -8px hsl(30 20% 20% / 0.16);
  --border-width-base: 1px;
  --course-accent-0: oklch(0.4381 0.0721 158.5);
  --course-accent-1: oklch(0.4300 0.0700 250.0000);
  --course-accent-2: oklch(0.4500 0.0800 130.0000);
  --course-accent-3: oklch(0.4600 0.0850 55.0000);
  --course-accent-4: oklch(0.4400 0.0750 330.0000);
  --course-accent-5: oklch(0.4200 0.0650 210.0000);
}

[data-theme="focus-dark"] {
  --background: oklch(0 0 0);
  --foreground: oklch(1.0000 0 0);
  --card: oklch(0.1457 0 0);
  --card-foreground: oklch(1.0000 0 0);
  --popover: oklch(0.1457 0 0);
  --popover-foreground: oklch(1.0000 0 0);
  --primary: oklch(0.6280 0.2577 29.2339);
  /* The attachment's white-on-this-red is 4.00:1, below AA for 14px/600 button
     text. Black is 5.25:1 and matches this theme's existing black-on-accent
     treatment, so accessibility wins over a verbatim copy. */
  --primary-foreground: oklch(0 0 0);
  --secondary: oklch(1.0000 0 0);
  --secondary-foreground: oklch(0 0 0);
  --muted: oklch(0.2376 0 0);
  --muted-foreground: oklch(0.7652 0 0);
  --accent: oklch(0.8533 0.1706 86.7515);
  --accent-foreground: oklch(0 0 0);
  --destructive: oklch(0.6489 0.2370 26.9728);
  --destructive-foreground: oklch(1.0000 0 0);
  --border: oklch(1.0000 0 0);
  --input: oklch(0 0 0);
  --ring: oklch(0.6280 0.2577 29.2339);
  --sidebar: oklch(0.1157 0 0);
  --sidebar-foreground: oklch(1.0000 0 0);
  --sidebar-primary: oklch(0.6280 0.2577 29.2339);
  --sidebar-primary-foreground: oklch(0 0 0);
  --sidebar-accent: oklch(0.2697 0 0);
  --sidebar-accent-foreground: oklch(1.0000 0 0);
  --sidebar-border: oklch(1.0000 0 0);
  --sidebar-ring: oklch(0.6280 0.2577 29.2339);
  --chart-1: oklch(1.0000 0 0);
  --chart-2: oklch(0.6280 0.2577 29.2339);
  --chart-3: oklch(0.8533 0.1706 86.7515);
  --chart-4: oklch(0.5773 0.0650 144.6756);
  --chart-5: oklch(0.6009 0.0747 47.4204);
  --radius-sm: 0px;
  --radius-md: 0px;
  --radius-lg: 0px;
  --radius-xl: 0px;
  --shadow-2xs: 3px 3px 0px 0px hsl(0 0% 100% / 0.50);
  --shadow-xs: 3px 3px 0px 0px hsl(0 0% 100% / 0.50);
  --shadow-sm: 3px 3px 0px 0px hsl(0 0% 100% / 1.00), 3px 1px 2px -1px hsl(0 0% 100% / 1.00);
  --shadow-base: 3px 3px 0px 0px hsl(0 0% 100% / 1.00), 3px 1px 2px -1px hsl(0 0% 100% / 1.00);
  --shadow-md: 3px 3px 0px 0px hsl(0 0% 100% / 1.00), 3px 2px 4px -1px hsl(0 0% 100% / 1.00);
  --shadow-lg: 3px 3px 0px 0px hsl(0 0% 100% / 1.00), 3px 4px 6px -1px hsl(0 0% 100% / 1.00);
  --shadow-xl: 3px 3px 0px 0px hsl(0 0% 100% / 1.00), 3px 8px 10px -1px hsl(0 0% 100% / 1.00);
  --shadow-2xl: 3px 3px 0px 0px hsl(0 0% 100% / 1.00);
  --border-width-base: 2px;
  --course-accent-0: oklch(0.6280 0.2577 29.2339);
  --course-accent-1: oklch(0.7000 0.1500 264.0000);
  --course-accent-2: oklch(0.7200 0.1300 145.0000);
  --course-accent-3: oklch(0.8533 0.1706 86.7515);
  --course-accent-4: oklch(0.7300 0.1400 320.0000);
  --course-accent-5: oklch(0.7400 0.1100 200.0000);
}

:root {
  /* Literal source stacks; the design forbids a self-referential --font-sans mapping. */
  --font-sans-stack: 'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  --font-serif-stack: 'Georgia', serif;
  --font-mono-stack: 'SF Mono', 'Courier New', monospace;
  --tracking-base: -0.02em;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);

  --font-sans: var(--font-sans-stack);
  --font-serif: var(--font-serif-stack);
  --font-mono: var(--font-mono-stack);

  /* --secondary, --secondary-foreground, --destructive-foreground, --popover*,
     and --chart-* are defined for all three themes because the design says the
     attachment's token set is copied as-is. No component consumes them yet; that
     is a completeness decision about the theme contract, not scaffolding for an
     unbuilt feature. --course-accent-* is the one token family this plan adds,
     and it is consumed by CourseCard. */

  /* Unlike the attachment's --font-sans self-mapping, these are safe: inside
     `@theme inline` the right-hand var() resolves against the per-theme :root
     values above, so `shadow-md` picks up whichever theme is active. The font
     case was broken because the source and the theme key were the same name in
     the same cascade level, which is why --font-sans-stack exists. */
  --shadow-2xs: var(--shadow-2xs);
  --shadow-xs: var(--shadow-xs);
  --shadow-sm: var(--shadow-sm);
  --shadow-md: var(--shadow-md);
  --shadow-lg: var(--shadow-lg);
  --shadow-xl: var(--shadow-xl);
  --shadow-2xl: var(--shadow-2xl);
}

@layer base {
  * {
    border-color: var(--border);
  }

  html {
    -webkit-text-size-adjust: 100%;
  }

  body {
    margin: 0;
    background: var(--background);
    color: var(--foreground);
    font-family: var(--font-sans-stack);
    letter-spacing: var(--tracking-base);
  }

  :focus-visible {
    outline: 3px solid var(--ring);
    outline-offset: 2px;
  }

  a,
  button,
  input,
  textarea,
  select,
  summary {
    font: inherit;
  }
}

/* Token-driven helpers. Tailwind utilities still set the border *color*
   (border-border, border-sidebar-border, border-transparent, border-destructive),
   so these carry only the theme-controlled width, radius, shadow, and outline.
   They must be declared with @utility, not inside @layer components: only
   @utility definitions get responsive and state variants generated, and the
   desktop sidebar uses `lg:bw-r`. They also avoid Tailwind arbitrary-property
   syntax, which is not relied on anywhere in this plan. */
@utility bw { border-width: var(--border-width-base); border-style: solid; }
@utility bw-b { border-bottom-width: var(--border-width-base); border-bottom-style: solid; }
@utility bw-t { border-top-width: var(--border-width-base); border-top-style: solid; }
@utility bw-r { border-right-width: var(--border-width-base); border-right-style: solid; }
@utility radius-sm { border-radius: var(--radius-sm); }
@utility radius-md { border-radius: var(--radius-md); }
@utility radius-lg { border-radius: var(--radius-lg); }
@utility shadow-token { box-shadow: var(--shadow-xs); }
@utility outline-selected { outline: 3px solid var(--ring); outline-offset: 2px; }
@utility tap-target { min-height: 44px; min-width: 44px; }
@utility sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

@layer components {
  .new-course-dialog::backdrop {
    background: color-mix(in oklab, var(--foreground) 55%, transparent);
  }

  .surface {
    border: var(--border-width-base) solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--card);
    color: var(--card-foreground);
    box-shadow: var(--shadow-sm);
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 7: Apply the theme before hydration in `src/app/layout.tsx`**

Replace `src/app/layout.tsx` with:

```tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { AppShell } from "./app-shell.tsx";
import { DEFAULT_THEME, THEME_BOOTSTRAP_SCRIPT } from "./theme.ts";

export const metadata: Metadata = {
  title: "just-study",
  description: "내 컴퓨터에서 안전하게 이어가는 학습 과정",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko" data-theme={DEFAULT_THEME} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
```

`suppressHydrationWarning` sits only on `<html>` because the bootstrap script intentionally changes that element before React hydrates. This is one atomic Tasks 5/6 batch: continue immediately with the shell below and commit only after all theme and shell contracts, including `npx tsc --noEmit`, pass.

- [ ] **Step 8: Run the focused theme test, then continue the same atomic batch**

```bash
node --test --test-name-pattern='theme|globals.css' tests/dashboard.test.ts
```

Expected: every theme test passes. Do not run a partial-batch typecheck and do not commit yet; the complete batch typecheck belongs after the shell is in place.

#### Continue the combined Tasks 5/6 batch: App shell, navigation, and Settings

**Files:**

- Create: `src/app/app-shell.tsx`
- Create: `src/app/nav-items.ts`
- Create: `src/app/nav.tsx`
- Create: `src/app/ui/primitives.tsx`
- Create: `src/app/theme-picker.tsx`
- Create: `src/app/settings/page.tsx`
- Modify: `src/app/status/page.tsx`
- Modify: `src/app/not-found.tsx`
- Modify: `tests/dashboard.test.ts`

**Interfaces:**

- Consumes: `THEMES`, `THEME_LABELS`, `THEME_STORAGE_KEY`, `DEFAULT_THEME`, `normalizeTheme`, `applyTheme` from the theme portion of this batch; `getHealth`/`getRuntime` for the Settings system section.
- Produces: `AppShell`, `NAV_ITEMS`, `Nav`, `ThemePicker`, `Card`, `CardHeader`, `Badge`, `ProgressBar`, `Alert`, `Skeleton`, `buttonClass`.

- [ ] **Step 1: Write the failing navigation-contract test**

Append to `tests/dashboard.test.ts`:

```ts
import { NAV_ITEMS, isActiveNav } from "../src/app/nav-items.ts";

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
```

- [ ] **Step 2: Run the focused test and observe RED**

Run: `node --test --test-name-pattern='navigation exposes|active navigation' tests/dashboard.test.ts`

Expected: FAIL — `Cannot find module '../src/app/nav.tsx'`.

- [ ] **Step 3: Implement the shared primitives**

Create `src/app/ui/primitives.tsx`:

```tsx
import type { ReactNode } from "react";

export function buttonClass(variant: "primary" | "secondary" | "ghost" = "primary"): string {
  const base =
    "tap-target inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold no-underline " +
    "bw radius-md cursor-pointer disabled:cursor-not-allowed disabled:opacity-65";
  if (variant === "primary") {
    return `${base} bg-primary text-primary-foreground border-border shadow-token`;
  }
  if (variant === "secondary") {
    return `${base} bg-card text-card-foreground border-border`;
  }
  return `${base} bg-transparent text-foreground border-transparent`;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`surface p-5 ${className}`}>{children}</div>;
}

export function CardHeader({ title, description, action, headingLevel = 2, id }: {
  title: string;
  description?: string;
  action?: ReactNode;
  headingLevel?: 2 | 3;
  id?: string;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <Heading id={id} className="m-0 text-lg font-bold break-words">{title}</Heading>
        {description ? <p className="mt-1 mb-0 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "muted" }) {
  const tones = {
    neutral: "bg-card text-card-foreground",
    accent: "bg-accent text-accent-foreground",
    muted: "bg-muted text-muted-foreground",
  } as const;
  return (
    <span className={`inline-flex items-center px-2 py-1 text-xs font-semibold bw border-border radius-sm ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function ProgressBar({ completed, approved, percent, label }: {
  completed: number;
  approved: number;
  percent: number;
  label: string;
}) {
  return (
    <div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={approved}
        aria-valuenow={completed}
        aria-valuetext={`${approved}일 중 ${completed}일 완료`}
        className="h-3 w-full bw border-border radius-sm bg-muted overflow-hidden"
      >
        <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 mb-0 text-xs text-muted-foreground">{approved}일 중 {completed}일 완료 ({percent}%)</p>
    </div>
  );
}

export function Alert({ title, children, tone = "warning" }: {
  title: string;
  children: ReactNode;
  tone?: "warning" | "danger";
}) {
  return (
    <div
      role="alert"
      className={`surface p-4 ${tone === "danger" ? "border-destructive" : "border-border"}`}
    >
      <p className={`m-0 font-bold ${tone === "danger" ? "text-destructive" : "text-foreground"}`}>{title}</p>
      <div className="mt-2 text-sm">{children}</div>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`bg-muted radius-sm ${className}`} />;
}
```

- [ ] **Step 4: Implement navigation and the shell**

Node's test runner strips TypeScript types but cannot parse JSX: importing any
`.tsx` file from `tests/dashboard.test.ts` fails with `Unknown file extension ".tsx"`.
Every value a test asserts on must therefore live in a `.ts` module.

Create `src/app/nav-items.ts`:

```ts
export const NAV_ITEMS = [
  { href: "/", label: "오늘" },
  { href: "/courses", label: "과정" },
  { href: "/settings", label: "설정" },
] as const;

export function isActiveNav(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
```

Create `src/app/nav.tsx`:

```tsx
"use client";

import Link from "next/link.js";
import { usePathname } from "next/navigation.js";

import { NAV_ITEMS, isActiveNav } from "./nav-items.ts";

export function Nav({ layout }: { layout: "sidebar" | "bottom" }) {
  const pathname = usePathname();
  const isSidebar = layout === "sidebar";

  return (
    <ul className={isSidebar ? "m-0 flex list-none flex-col gap-1 p-0" : "m-0 flex list-none items-stretch justify-around gap-1 p-0"}>
      {NAV_ITEMS.map(({ href, label }) => {
        const active = isActiveNav(pathname, href);
        return (
          <li key={href} className={isSidebar ? "" : "flex-1"}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={[
                "tap-target flex items-center justify-center gap-2 px-3 py-2 text-sm no-underline radius-md",
                isSidebar ? "justify-start" : "flex-col text-xs",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-bold bw border-sidebar-border"
                  : "text-sidebar-foreground bw border-transparent",
              ].join(" ")}
            >
              <span aria-hidden="true" className={active ? "inline-block h-2 w-2 bg-sidebar-primary rounded-full" : "inline-block h-2 w-2 rounded-full border border-solid border-sidebar-foreground opacity-40"} />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
```

The active item is marked by `aria-current="page"`, a bold weight, a border, and a filled dot, so it never relies on color alone.

Create `src/app/app-shell.tsx`:

```tsx
import Link from "next/link.js";
import type { ReactNode } from "react";

import { Nav } from "./nav.tsx";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:pl-64">
      <a
        href="#main"
        className="absolute left-2 top-2 z-50 -translate-y-20 bg-card text-card-foreground px-3 py-2 bw border-border radius-md focus:translate-y-0"
      >
        본문으로 건너뛰기
      </a>

      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 bw-b border-sidebar-border bg-sidebar px-4 py-3 lg:hidden">
        <Link href="/" className="text-base font-extrabold text-sidebar-foreground no-underline">just-study</Link>
      </header>

      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-64 lg:flex-col lg:gap-6 lg:bw-r lg:border-sidebar-border lg:bg-sidebar lg:p-4">
        <Link href="/" className="text-lg font-extrabold text-sidebar-foreground no-underline">just-study</Link>
        <nav aria-label="주요 메뉴"><Nav layout="sidebar" /></nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1280px] flex-1 px-4 pt-6 pb-28 lg:pb-10">
          {children}
        </main>
      </div>

      <nav
        aria-label="주요 메뉴"
        className="fixed inset-x-0 bottom-0 z-30 bw-t border-sidebar-border bg-sidebar px-2 pt-1 lg:hidden"
        style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))" }}
      >
        <Nav layout="bottom" />
      </nav>
    </div>
  );
}
```

Both navigations render the same three items from one definition; only CSS decides which is visible. `tabIndex={-1}` on `<main>` makes the skip link actually move focus in every browser.

The desktop sidebar is fixed at `>=1024px`; the outer `lg:pl-64` reserves its width, so main content never renders underneath it. Task 9 creates the route-specific mobile context bar where it is first used.

- [ ] **Step 5: Implement the theme picker and Settings**

Create `src/app/theme-picker.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

import {
  applyTheme,
  DEFAULT_THEME,
  normalizeTheme,
  THEMES,
  THEME_LABELS,
  THEME_STORAGE_KEY,
  type Theme,
} from "./theme.ts";

export function ThemePicker() {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    try {
      setTheme(normalizeTheme(localStorage.getItem(THEME_STORAGE_KEY)));
    } catch {
      setTheme(DEFAULT_THEME);
    }
  }, []);

  function choose(next: Theme): void {
    setTheme(next);
    applyTheme(next, document.documentElement);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
      setStatus(`${THEME_LABELS[next].name} 테마를 적용하고 이 브라우저에 저장했습니다.`);
    } catch {
      setStatus(`${THEME_LABELS[next].name} 테마를 적용했지만 저장하지 못했습니다. 새로고침하면 Focus로 돌아갑니다.`);
    }
  }

  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="mb-3 text-sm text-muted-foreground">
        선택한 테마는 이 브라우저에만 저장되며 학습 데이터에는 영향을 주지 않습니다.
      </legend>
      <div className="grid gap-3 sm:grid-cols-3">
        {THEMES.map((value) => (
          <label
            key={value}
            className={`surface tap-target flex cursor-pointer flex-col gap-2 p-4 ${theme === value ? "outline-selected" : ""}`}
          >
            <span className="flex items-center gap-2">
              <input
                type="radio"
                name="theme"
                value={value}
                checked={theme === value}
                onChange={() => { choose(value); }}
                className="h-5 w-5"
              />
              <span className="font-bold">{THEME_LABELS[value].name}</span>
              {theme === value ? <span className="text-xs font-semibold">(선택됨)</span> : null}
            </span>
            <span className="text-sm text-muted-foreground">{THEME_LABELS[value].description}</span>
          </label>
        ))}
      </div>
      <p aria-live="polite" className="mt-3 mb-0 text-sm">{status}</p>
    </fieldset>
  );
}
```

Create `src/app/settings/page.tsx`:

```tsx
import Link from "next/link.js";

import { getHealth } from "../../server/health.ts";
import { getRuntime } from "../../server/runtime.ts";
import { Card, CardHeader } from "../ui/primitives.tsx";
import { ThemePicker } from "../theme-picker.tsx";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const { db, dataRoot } = getRuntime();
  const health = getHealth(db, dataRoot);

  return (
    <>
      <h1 className="mt-0 mb-2 text-3xl font-extrabold">설정</h1>
      <p className="mt-0 mb-6 text-muted-foreground">이 컴퓨터에서만 사용하는 화면 설정과 시스템 상태입니다.</p>

      <Card className="mb-4">
        <CardHeader title="테마" description="세 테마는 같은 화면 구조를 사용하며 색과 모서리만 달라집니다." />
        <ThemePicker />
      </Card>

      <Card>
        <CardHeader title="시스템" description="데이터베이스와 저장소 점검 결과입니다." />
        <p className="mt-0 mb-3">{health.message}</p>
        <Link href="/status" className="underline">상태 화면에서 자세히 보기</Link>
      </Card>
    </>
  );
}
```

- [ ] **Step 6: Restyle `/status` and `not-found` with tokens only**

In `src/app/status/page.tsx`, keep every existing check, label, and string. Replace only the class names: wrap each `<section>` in the `Card` primitive, use `text-muted-foreground` for `<dt>`, and replace `.status-ok` / `.status-error` with `Badge` (`tone="muted"` for 정상, `tone="accent"` for 확인 필요) plus the existing Korean text so meaning never depends on color. Add `<h1 className="mt-0 mb-2 text-3xl font-extrabold">` styling and remove the now-unused `stateLabel` class strings only if they become unreferenced.

In `src/app/not-found.tsx`, wrap the body in `Card` and give the link `className="underline"`. Do not change any Korean copy.

- [ ] **Step 7: Verify shell, Settings, and the whole suite**

```bash
node --test tests/dashboard.test.ts
npm test
npm run lint
npx tsc --noEmit
npm run build
git diff --check
git status --short
```

Expected: all pass and the build emits `/settings`. `git status` may show the pre-existing generated baseline artifacts `tsconfig.json`, `next-env.d.ts`, and `tsconfig.tsbuildinfo`; inspect each diff and leave them unstaged.

- [ ] **Step 8: Commit the single combined Tasks 5/6 batch**

```bash
git add package.json package-lock.json postcss.config.mjs src/app/theme.ts src/app/globals.css src/app/layout.tsx src/app/app-shell.tsx src/app/nav-items.ts src/app/nav.tsx src/app/ui/primitives.tsx src/app/theme-picker.tsx src/app/settings/page.tsx src/app/status/page.tsx src/app/not-found.tsx tests/dashboard.test.ts
git commit -m "feat: add the themed dashboard shell"
```

### Task 7: Today dashboard

**Files:**

- Create: `src/app/copy-command.tsx`
- Create: `src/app/course-card.tsx`
- Modify: `src/app/page.tsx` (full replacement)
- Modify: `tests/dashboard.test.ts`

**Interfaces:**

- Consumes: `getDashboardOverview` (Task 1); `resumeCourse`, `attentionItems`, `courseCardModel`, `RESUME_COMMAND`, `STAGE_LABELS` (Task 3); `Card`, `CardHeader`, `Badge`, `ProgressBar`, `Alert`, `buttonClass` (combined Tasks 5/6).
- Produces: `CopyCommand`, `CourseCard`, and the Today route.

The order on the page is fixed by the design: context, resume card, attention, metrics, course cards, recent Days.

- [ ] **Step 1: Write the failing resume-state test**

Append to `tests/dashboard.test.ts`:

```ts
import { resumeCardModel } from "../src/server/dashboard-view.ts";

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
```

- [ ] **Step 2: Run the focused test and observe RED**

Run: `node --test --test-name-pattern='resume card describes' tests/dashboard.test.ts`

Expected: FAIL — `resumeCardModel is not exported`.

- [ ] **Step 3: Add `resumeCardModel` to the view model**

Append to `src/server/dashboard-view.ts`:

```ts
export type ResumeCardModel = {
  kind: "empty" | "completed" | "draft" | "active";
  title: string;
  description: string;
  courseId: string | null;
  courseTitle: string | null;
  dayLabel: string | null;
  stageLabel: string | null;
  objective: string | null;
  progress: CourseProgress | null;
  command: string | null;
  href: string | null;
  actionLabel: string | null;
};

export function resumeCardModel(courses: readonly DashboardCourseSummary[]): ResumeCardModel {
  const empty: ResumeCardModel = {
    kind: "empty",
    title: "첫 학습 과정을 만들어 보세요",
    description: "과정 이름과 30일 뒤 목표를 저장하면 Codex에서 $just-study로 리서치와 30일 목차를 만들 수 있습니다.",
    courseId: null,
    courseTitle: null,
    dayLabel: null,
    stageLabel: null,
    objective: null,
    progress: null,
    command: null,
    href: null,
    actionLabel: null,
  };
  if (courses.length === 0) return empty;

  const target = resumeCourse(courses);
  if (target === null) {
    return {
      ...empty,
      kind: "completed",
      title: "모든 과정을 완료했습니다",
      description: "새 주제를 정해 다음 30일 과정을 시작할 수 있습니다.",
      href: "/courses",
      actionLabel: "과정 목록 보기",
    };
  }

  const card = courseCardModel(target);
  if (target.status === "draft") {
    return {
      kind: "draft",
      title: target.title,
      description: "30일 계획 승인이 필요합니다. Codex에서 리서치와 목차를 완성해 주세요.",
      courseId: target.id,
      courseTitle: target.title,
      dayLabel: null,
      stageLabel: null,
      objective: null,
      progress: null,
      command: RESUME_COMMAND,
      href: `/courses/${target.id}?tab=overview`,
      actionLabel: "과정 개요 열기",
    };
  }

  return {
    kind: "active",
    title: target.title,
    description: "저장된 Day와 단계에서 이어집니다.",
    courseId: target.id,
    courseTitle: target.title,
    dayLabel: card.dayLabel,
    stageLabel: card.stageLabel,
    objective: target.currentDayObjective,
    progress: card.progress,
    command: RESUME_COMMAND,
    href: `/courses/${target.id}?tab=today`,
    actionLabel: "오늘 학습 열기",
  };
}
```

- [ ] **Step 4: Implement the clipboard component**

Create `src/app/copy-command.tsx`:

```tsx
"use client";

import { useEffect, useId, useState } from "react";

import { buttonClass } from "./ui/primitives.tsx";

/**
 * Renders the server's UTC date on first paint, then swaps to the learner's local
 * date after hydration. `suppressHydrationWarning` covers only this text node.
 */
export function LocalDate({ iso }: { iso: string }) {
  const [text, setText] = useState(iso.slice(0, 10));
  useEffect(() => {
    setText(new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }));
  }, [iso]);
  return <time dateTime={iso} suppressHydrationWarning>{text}</time>;
}

export function CopyCommand({ command, label = "Codex에서 계속" }: { command: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const commandId = useId();

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(command);
      setState("copied");
    } catch {
      setState("manual");
    }
  }

  return (
    <div>
      <button type="button" className={buttonClass("primary")} onClick={() => { void copy(); }} aria-describedby={commandId}>
        {label}
      </button>
      <p id={commandId} className="mt-2 mb-0 text-sm">
        Codex 대화에 붙여 넣을 명령: <code className="font-mono select-all">{command}</code>
      </p>
      <p aria-live="polite" className="mt-1 mb-0 text-sm">
        {state === "copied" ? "복사됨" : state === "manual" ? "이 브라우저에서 복사 권한이 없어 자동 복사하지 못했습니다. 위 명령을 직접 선택해 복사해 주세요." : ""}
      </p>
    </div>
  );
}
```

The button never claims to launch Codex and never renders a deep link.

- [ ] **Step 5: Implement the shared course card**

Create `src/app/course-card.tsx`:

```tsx
import Link from "next/link.js";

import type { CourseCardModel } from "../server/dashboard-view.ts";
import { LocalDate } from "./copy-command.tsx";
import { Badge, Card, ProgressBar } from "./ui/primitives.tsx";

/**
 * The server renders the ISO instant and a fixed UTC date so the first paint is
 * hydration-stable; the client component upgrades it to the learner's local date
 * after mount. No ticking clock and no relative-time formatting.
 */
export function CourseCard({ card }: { card: CourseCardModel }) {
  return (
    <Card className="flex flex-col gap-3">
      <div
        aria-hidden="true"
        className="h-1.5 w-12 radius-sm"
        style={{ background: `var(--course-accent-${card.accentIndex})` }}
      />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="m-0 min-w-0 text-base font-bold break-words">
          <Link href={card.href} className="no-underline hover:underline">{card.title}</Link>
        </h3>
        <Badge tone={card.status === "active" ? "accent" : "muted"}>{card.statusLabel}</Badge>
      </div>
      <p className="m-0 text-sm text-muted-foreground break-words line-clamp-3">{card.goal}</p>
      {card.dayLabel || card.stageLabel ? (
        <p className="m-0 text-sm font-semibold">
          {[card.dayLabel, card.stageLabel].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      {card.note ? <p className="m-0 text-sm">{card.note}</p> : null}
      {card.progress ? (
        <ProgressBar {...card.progress} label={`${card.title} 진도`} />
      ) : null}
      <p className="m-0 text-xs text-muted-foreground">
        마지막 저장 <LocalDate iso={card.updatedAt} />
      </p>
    </Card>
  );
}
```

Course accent is decorative only: it is `aria-hidden` and every meaning is also in text.

- [ ] **Step 6: Replace `src/app/page.tsx`**

```tsx
import Link from "next/link.js";

import { getDashboardOverview } from "../server/dashboard.ts";
import {
  attentionItems,
  courseCardModel,
  resumeCardModel,
} from "../server/dashboard-view.ts";
import { getRuntime } from "../server/runtime.ts";
import { CopyCommand, LocalDate } from "./copy-command.tsx";
import { CourseCard } from "./course-card.tsx";
import { Alert, Card, CardHeader, ProgressBar, buttonClass } from "./ui/primitives.tsx";

export const dynamic = "force-dynamic";

export default function TodayPage() {
  const runtime = getRuntime();
  if (!runtime.db) {
    return (
      <>
        <h1 className="mt-0 mb-2 text-3xl font-extrabold">오늘</h1>
        <Alert title="학습 데이터를 불러올 수 없습니다." tone="danger">
          <p className="mt-0 mb-2">데이터베이스를 사용할 수 없어 진행 상황을 표시하지 않았습니다. 저장된 학습 기록은 변경되지 않았습니다.</p>
          <Link href="/status" className="underline">상태 화면에서 복구 방법 확인하기</Link>
        </Alert>
      </>
    );
  }

  let overview: ReturnType<typeof getDashboardOverview>;
  try {
    overview = getDashboardOverview(runtime.db);
  } catch {
    return (
      <>
        <h1 className="mt-0 mb-2 text-3xl font-extrabold">오늘</h1>
        <Alert title="학습 데이터를 불러올 수 없습니다." tone="danger">
          <p className="mt-0 mb-2">데이터베이스를 읽는 중 문제가 발생했습니다. 저장된 학습 기록은 변경되지 않았습니다.</p>
          <Link href="/status" className="underline">상태 화면에서 복구 방법 확인하기</Link>
        </Alert>
      </>
    );
  }
  const resume = resumeCardModel(overview.courses);
  const attention = attentionItems(overview.courses);
  const { totals, recentDays } = overview;

  return (
    <>
      <p className="mt-0 mb-1 text-sm text-muted-foreground">내 컴퓨터에 저장된 학습</p>
      <h1 className="mt-0 mb-6 text-3xl font-extrabold">오늘 이어갈 학습</h1>

      <Card className="mb-6">
        <CardHeader title={resume.title} description={resume.description} />
        {resume.dayLabel || resume.stageLabel ? (
          <p className="mt-0 mb-2 font-semibold">{[resume.dayLabel, resume.stageLabel].filter(Boolean).join(" · ")}</p>
        ) : null}
        {resume.objective ? <p className="mt-0 mb-3">{resume.objective}</p> : null}
        {resume.progress ? <div className="mb-4"><ProgressBar {...resume.progress} label="현재 과정 진도" /></div> : null}
        {resume.command ? (
          <CopyCommand command={resume.command} />
        ) : (
          <Link href={resume.href ?? "/courses"} className={buttonClass("primary")}>
            {resume.actionLabel ?? "새 과정 만들기"}
          </Link>
        )}
        {resume.command && resume.href ? (
          <p className="mt-3 mb-0"><Link href={resume.href} className="underline">{resume.actionLabel}</Link></p>
        ) : null}
      </Card>

      <section aria-labelledby="attention" className="mb-6">
        <h2 id="attention" className="mt-0 mb-3 text-xl font-bold">주의가 필요한 학습</h2>
        {attention.length === 0 ? (
          <Card><p className="m-0 text-sm text-muted-foreground">지금 주의가 필요한 과정이 없습니다.</p></Card>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0">
            {attention.map((item) => (
              <li key={item.courseId}>
                <Card className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="m-0 font-semibold break-words">{item.courseTitle}</p>
                    <p className="m-0 text-sm text-muted-foreground">{item.message}</p>
                  </div>
                  <Link href={item.href} className={buttonClass("secondary")}>바로 가기</Link>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="metrics" className="mb-6">
        <h2 id="metrics" className="mt-0 mb-3 text-xl font-bold">저장된 학습 집계</h2>
        <dl className="m-0 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { term: "진행 중 과정", value: `${totals.activeCourseCount}개`, hint: "목차를 승인하고 아직 완료하지 않은 과정" },
            { term: "완료 Day", value: `${totals.completedDayCount} / ${totals.approvedDayCount}`, hint: "회고까지 마친 Day 수 / 승인된 전체 Day 수" },
            { term: "선정 출처", value: `${totals.selectedSourceCount}개`, hint: "중복 URL을 제외하고 선정된 검증 자료" },
            { term: "완료 과정", value: `${totals.completedCourseCount}개`, hint: "Day 30까지 마친 과정" },
          ].map(({ term, value, hint }) => (
            /* Only dt/dd may appear inside a div wrapper in a dl, so the hint is
               part of the dd rather than a sibling p. */
            <div key={term} className="surface p-4">
              <dt className="m-0 text-sm text-muted-foreground">{term}</dt>
              <dd className="mt-1 mb-0">
                <span className="block text-2xl font-extrabold">{value}</span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="courses" className="mb-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="courses" className="m-0 text-xl font-bold">과정</h2>
          <Link href="/courses" className="underline">전체 보기</Link>
        </div>
        {overview.courses.length === 0 ? (
          <Card>
            <p className="mt-0 mb-3">아직 저장된 과정이 없습니다.</p>
            <Link href="/courses" className={buttonClass("primary")}>첫 과정 만들기</Link>
          </Card>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2">
            {overview.courses.map((course) => (
              <li key={course.id}><CourseCard card={courseCardModel(course)} /></li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="recent">
        <h2 id="recent" className="mt-0 mb-3 text-xl font-bold">최근 완료한 Day</h2>
        {recentDays.length === 0 ? (
          <Card><p className="m-0 text-sm text-muted-foreground">아직 완료한 Day가 없습니다. 첫 Day를 마치면 여기에 기록이 남습니다.</p></Card>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0">
            {recentDays.map((day) => (
              <li key={day.dayId}>
                <Card>
                  <p className="m-0 text-sm text-muted-foreground">{day.courseTitle}</p>
                  <p className="m-0 font-semibold">Day {day.dayNumber} · {day.objective}</p>
                  <p className="m-0 text-xs text-muted-foreground">
                    완료 <LocalDate iso={day.completedAt} /> ·{" "}
                    <Link href={`/courses/${day.courseId}?tab=journal`} className="underline">학습 기록 보기</Link>
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
```

Dates go through `LocalDate`: the server emits the ISO instant plus its UTC date, so the first paint is deterministic and hydration-stable, and after mount the client swaps in the learner's local date. There is no ticking clock, no relative-time string, and no server/client format divergence.

- [ ] **Step 7: Verify**

```bash
node --test tests/dashboard.test.ts
npm test
npm run lint
npx tsc --noEmit
npm run build
git diff --check
```

Expected: all pass.

- [ ] **Step 8: Commit Task 7**

```bash
git add src/server/dashboard-view.ts src/app/copy-command.tsx src/app/course-card.tsx src/app/page.tsx tests/dashboard.test.ts
git commit -m "feat: show the next learning action first"
```

### Task 8: Courses list and new-course panel

**Files:**

- Create: `src/app/courses/page.tsx`
- Create: `src/app/new-course-panel.tsx`
- Modify: `src/app/course-form.tsx`
- Modify: `tests/dashboard.test.ts`

**Interfaces:**

- Consumes: `getDashboardOverview`, `filterCourses`, `normalizeCourseFilter`, `COURSE_FILTERS`, `COURSE_FILTER_LABELS`, `courseCardModel`, `CourseCard`, existing `createCourseAction`.
- Produces: the `/courses` route, `NewCoursePanel`, and a `CourseForm` that accepts an optional `autoFocus`.

- [ ] **Step 1: Write the failing empty-state test**

Append to `tests/dashboard.test.ts`:

```ts
import { coursesEmptyState } from "../src/server/dashboard-view.ts";

test("course list distinguishes no courses from an empty filter", () => {
  const none = coursesEmptyState(0, 0, "all");
  assert.equal(none.kind, "no-courses");
  assert.equal(none.title, "아직 저장된 과정이 없습니다");
  assert.equal(none.actionLabel, "새 과정 만들기");

  const filtered = coursesEmptyState(3, 0, "completed");
  assert.equal(filtered.kind, "no-matches");
  assert.equal(filtered.title, "완료 상태의 과정이 없습니다");
  assert.equal(filtered.actionLabel, "필터 해제");

  assert.equal(coursesEmptyState(3, 2, "active"), null);
  assert.equal(coursesEmptyState(3, 3, "all"), null);
});
```

- [ ] **Step 2: Run the focused test and observe RED**

Run: `node --test --test-name-pattern='course list distinguishes' tests/dashboard.test.ts`

Expected: FAIL — `coursesEmptyState is not exported`.

- [ ] **Step 3: Add `coursesEmptyState` to the view model**

Append to `src/server/dashboard-view.ts`:

```ts
export type CoursesEmptyState = {
  kind: "no-courses" | "no-matches";
  title: string;
  description: string;
  actionLabel: string;
};

export function coursesEmptyState(
  totalCount: number,
  visibleCount: number,
  filter: CourseFilter,
): CoursesEmptyState | null {
  if (visibleCount > 0) return null;
  if (totalCount === 0) {
    return {
      kind: "no-courses",
      title: "아직 저장된 과정이 없습니다",
      description: "과정 이름과 30일 뒤 목표를 저장한 다음 Codex에서 $just-study를 호출해 리서치와 30일 목차를 만드세요.",
      actionLabel: "새 과정 만들기",
    };
  }
  return {
    kind: "no-matches",
    title: `${COURSE_FILTER_LABELS[filter]} 상태의 과정이 없습니다`,
    description: "다른 상태의 과정은 남아 있습니다. 필터를 해제하면 전체 과정을 볼 수 있습니다.",
    actionLabel: "필터 해제",
  };
}
```

- [ ] **Step 4: Let the course form report success**

In `src/app/course-form.tsx`, add one optional prop to `CourseFormView` and thread it through `CourseForm`. No other behavior changes:

```tsx
export function CourseForm({ requestId, autoFocus = false }: { requestId: string; autoFocus?: boolean }) {
  const [state, action, pending] = useActionState(createCourseAction, initialState);

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
```

Add the matching optional `autoFocus?: boolean` prop to `CourseFormViewProps` and pass `autoFocus={autoFocus}` to the title `<input>`. The existing server action already redirects to the created course on success, so the dialog needs no success callback; it closes because the browser navigates.

- [ ] **Step 5: Implement the native dialog panel**

Create `src/app/new-course-panel.tsx`:

```tsx
"use client";

import { useEffect, useId, useRef, useState } from "react";

import { CourseForm } from "./course-form.tsx";
import { buttonClass } from "./ui/primitives.tsx";

export function NewCoursePanel({ requestId }: { requestId: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <button ref={openerRef} type="button" className={buttonClass("primary")} onClick={() => { setOpen(true); }}>
        새 과정
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={() => { setOpen(false); openerRef.current?.focus(); }}
        className="new-course-dialog w-full max-w-lg bw border-border radius-lg bg-card text-card-foreground p-5 sm:mx-auto max-sm:m-0 max-sm:h-dvh max-sm:max-w-none max-sm:rounded-none"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="mt-0 mb-4 text-xl font-bold">새 과정</h2>
          <button type="button" className={buttonClass("ghost")} onClick={() => { setOpen(false); }}>
            닫기
          </button>
        </div>
        {open ? <CourseForm requestId={requestId} autoFocus /> : null}
      </dialog>
    </>
  );
}
```

`<dialog showModal>` supplies focus trapping, `Escape`, background inertness, and a backdrop from the platform, so no focus-management library is needed. `useId` keeps the heading id unique because `/courses` can render this panel twice (header and empty state), and `onClose` returns focus to the opener.

- [ ] **Step 6: Implement `/courses`**

Create `src/app/courses/page.tsx`:

```tsx
import { randomUUID } from "node:crypto";

import Link from "next/link.js";

import { getDashboardOverview } from "../../server/dashboard.ts";
import {
  COURSE_FILTERS,
  COURSE_FILTER_LABELS,
  coursesEmptyState,
  courseCardModel,
  filterCourses,
  normalizeCourseFilter,
} from "../../server/dashboard-view.ts";
import { getRuntime } from "../../server/runtime.ts";
import { CourseCard } from "../course-card.tsx";
import { NewCoursePanel } from "../new-course-panel.tsx";
import { Alert, Card, buttonClass } from "../ui/primitives.tsx";

export const dynamic = "force-dynamic";

export default async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const runtime = getRuntime();
  const filter = normalizeCourseFilter((await searchParams).filter);

  if (!runtime.db) {
    return (
      <>
        <h1 className="mt-0 mb-2 text-3xl font-extrabold">과정</h1>
        <Alert title="과정 목록을 불러올 수 없습니다." tone="danger">
          <p className="mt-0 mb-2">데이터베이스를 사용할 수 없습니다. 저장된 과정이 없는 것이 아니라 읽지 못한 상태입니다.</p>
          <Link href="/status" className="underline">상태 화면에서 복구 방법 확인하기</Link>
        </Alert>
      </>
    );
  }

  let courses: ReturnType<typeof getDashboardOverview>["courses"];
  try {
    ({ courses } = getDashboardOverview(runtime.db));
  } catch {
    return (
      <>
        <h1 className="mt-0 mb-2 text-3xl font-extrabold">과정</h1>
        <Alert title="과정 목록을 불러올 수 없습니다." tone="danger">
          <p className="mt-0 mb-2">데이터베이스를 읽는 중 문제가 발생했습니다. 저장된 과정이 없는 것이 아니라 읽지 못한 상태입니다.</p>
          <Link href="/status" className="underline">상태 화면에서 복구 방법 확인하기</Link>
        </Alert>
      </>
    );
  }
  const visible = filterCourses(courses, filter);
  const empty = coursesEmptyState(courses.length, visible.length, filter);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-3xl font-extrabold">과정</h1>
        <NewCoursePanel requestId={randomUUID()} />
      </div>

      <nav aria-label="상태 필터" className="mb-5">
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {COURSE_FILTERS.map((value) => {
            const active = value === filter;
            return (
              <li key={value}>
                <Link
                  href={value === "all" ? "/courses" : `/courses?filter=${value}`}
                  aria-current={active ? "true" : undefined}
                  className={`${buttonClass(active ? "primary" : "secondary")} ${active ? "font-extrabold" : ""}`}
                >
                  {COURSE_FILTER_LABELS[value]}
                  {active ? <span className="sr-only"> (선택됨)</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {empty ? (
        <Card>
          <h2 className="mt-0 mb-2 text-xl font-bold">{empty.title}</h2>
          <p className="mt-0 mb-4">{empty.description}</p>
          {empty.kind === "no-courses"
            ? <NewCoursePanel requestId={randomUUID()} />
            : <Link href="/courses" className={buttonClass("secondary")}>{empty.actionLabel}</Link>}
        </Card>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((course) => (
            <li key={course.id}><CourseCard card={courseCardModel(course)} /></li>
          ))}
        </ul>
      )}
    </>
  );
}
```

- [ ] **Step 7: Verify**

```bash
node --test tests/dashboard.test.ts
npm test
npm run lint
npx tsc --noEmit
npm run build
git diff --check
```

Expected: all pass and the build lists `/courses`.

- [ ] **Step 8: Commit Task 8**

```bash
git add src/server/dashboard-view.ts src/app/course-form.tsx src/app/new-course-panel.tsx src/app/courses/page.tsx tests/dashboard.test.ts
git commit -m "feat: browse and filter saved courses"
```

### Task 9: Course workspace with six tabs

**Files:**

- Create: `src/app/ui/markdown-view.tsx`
- Create: `src/app/courses/[id]/context-bar.tsx`
- Create: `src/app/courses/[id]/tabs.tsx`
- Modify: `src/app/courses/[id]/page.tsx` (full replacement)
- Modify: `tests/dashboard.test.ts`

**Interfaces:**

- Consumes: `getCourseHistory` (Task 2), `getLearningSnapshot`, `parseMarkdown` (Task 4), `normalizeTab`, `COURSE_TABS`, `COURSE_TAB_LABELS`, `STAGE_LABELS`, `courseCardModel`, `RESUME_COMMAND`, and the combined Tasks 5/6 primitives.
- Produces: `MarkdownView`, `CourseTabs`, the six panel components, and the `/courses/[id]` route.

The page reads structured history first, which never touches Markdown, and then tries the Markdown-backed snapshot separately so a checksum failure hides only the prose.

- [ ] **Step 1: Write the failing document-state test**

Append to `tests/dashboard.test.ts`:

```ts
import { documentState } from "../src/server/dashboard-view.ts";

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
```

Also append the deterministic corruption contract the page depends on. Add
`getLearningSnapshot` to the `../src/server/learning.ts` import, `readFileSync` and
`writeFileSync` to the `node:fs` import, and `StorageError` from
`../src/server/storage.ts`.

`StorageError` is already exported by the existing storage module. Import it directly; do not make a conditional export change or modify `src/server/storage.ts` in this task.

```ts
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
```

This is the exact seam the course page relies on: `getCourseHistory` first, then a
guarded `getLearningSnapshot`. If the two were merged, a single damaged file would
hide the whole course.

- [ ] **Step 2: Run the focused test and observe RED**

Run: `node --test --test-name-pattern='document state separates|damaged document breaks' tests/dashboard.test.ts`

Expected: FAIL — `documentState is not exported`. The corruption test passes once the import compiles; record that it locks an existing engine contract rather than driving new code.

- [ ] **Step 3: Add `documentState` to the view model**

Append to `src/server/dashboard-view.ts`:

```ts
export type DocumentState = {
  kind: "damaged" | "empty";
  title: string;
  description: string;
};

export function documentState(markdown: string | null, verified: boolean): DocumentState | null {
  if (!verified) {
    return {
      kind: "damaged",
      title: "저장된 학습 문서를 확인할 수 없습니다",
      description: "체크섬 검증에 실패했습니다. 원문을 덮어쓰지 않았으며 복구 전에는 내용을 표시하지 않습니다.",
    };
  }
  if (markdown === null || markdown.trim() === "") {
    return {
      kind: "empty",
      title: "아직 저장된 내용이 없습니다",
      description: "Codex에서 $just-study로 학습을 진행하면 여기에 검증된 기록이 표시됩니다.",
    };
  }
  return null;
}
```

- [ ] **Step 4: Implement the Markdown renderer**

Create `src/app/ui/markdown-view.tsx`:

```tsx
import type { ReactNode } from "react";

import { parseMarkdown, type MarkdownBlock, type MarkdownInline } from "../../server/markdown.ts";

function renderInline(nodes: readonly MarkdownInline[]): ReactNode[] {
  return nodes.map((node, index) => {
    if (node.type === "strong") return <strong key={index}>{node.value}</strong>;
    if (node.type === "emphasis") return <em key={index}>{node.value}</em>;
    if (node.type === "code") {
      return <code key={index} className="px-1 font-mono text-[0.9em] bg-muted text-muted-foreground radius-sm">{node.value}</code>;
    }
    if (node.type === "link") {
      return (
        <a
          key={index}
          href={node.href}
          target="_blank"
          rel="noreferrer"
          className="underline break-words"
        >
          {node.text}
          <span className="sr-only"> (새 창에서 열림)</span>
        </a>
      );
    }
    return <span key={index}>{node.value}</span>;
  });
}

function renderBlock(block: MarkdownBlock, index: number): ReactNode {
  switch (block.type) {
    case "heading": {
      const Heading = `h${Math.min(block.level + 2, 6)}` as "h3" | "h4" | "h5" | "h6";
      return <Heading key={index} className="mt-5 mb-2 font-bold break-words">{renderInline(block.inline)}</Heading>;
    }
    case "paragraph":
      return <p key={index} className="my-3 break-words">{renderInline(block.inline)}</p>;
    case "list":
      return block.ordered ? (
        <ol key={index} className="my-3 list-decimal pl-6">
          {block.items.map((item, item_) => <li key={item_} className="my-1 break-words">{renderInline(item)}</li>)}
        </ol>
      ) : (
        <ul key={index} className="my-3 list-disc pl-6">
          {block.items.map((item, item_) => <li key={item_} className="my-1 break-words">{renderInline(item)}</li>)}
        </ul>
      );
    case "quote":
      return (
        <blockquote key={index} className="my-3 border-l-4 border-solid border-border pl-4 text-muted-foreground">
          {block.lines.map((line, line_) => <p key={line_} className="my-1 break-words">{renderInline(line)}</p>)}
        </blockquote>
      );
    case "code":
      return (
        <pre key={index} className="my-3 overflow-x-auto bw border-border radius-md bg-muted p-3">
          <code className="font-mono text-sm">{block.value}</code>
        </pre>
      );
    case "rule":
      return <hr key={index} className="my-5 border-0 bw-t border-border" />;
    case "table":
      return (
        <div key={index} className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {block.header.map((cell, cell_) => (
                  <th key={cell_} scope="col" style={{ textAlign: block.alignments[cell_] }} className="bw border-border p-2 font-bold">
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, row_) => (
                <tr key={row_}>
                  {row.map((cell, cell_) => (
                    <td key={cell_} style={{ textAlign: block.alignments[cell_] }} className="bw border-border p-2 break-words">
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return null;
  }
}

export function MarkdownView({ markdown }: { markdown: string }) {
  let blocks: MarkdownBlock[];
  try {
    blocks = parseMarkdown(markdown);
  } catch {
    return (
      <div>
        <p className="mt-0 mb-2 text-sm text-muted-foreground">문서를 서식 있는 형태로 표시하지 못해 원문 그대로 보여 줍니다.</p>
        <pre className="overflow-x-auto whitespace-pre-wrap break-words">{markdown}</pre>
      </div>
    );
  }
  return <div>{blocks.map(renderBlock)}</div>;
}
```

React escapes every string it renders, so text that looks like HTML stays visible text. The renderer never uses `dangerouslySetInnerHTML`.

- [ ] **Step 5: Implement the tab strip and panels**

Create `src/app/courses/[id]/tabs.tsx`:

```tsx
import Link from "next/link.js";

import {
  COURSE_TABS,
  COURSE_TAB_LABELS,
  documentState,
  STAGE_LABELS,
  type CourseTab,
} from "../../../server/dashboard-view.ts";
import type { CourseHistory, CourseHistoryCourse, LearningSnapshot } from "../../../server/learning.ts";
import { Badge, Card, CardHeader } from "../../ui/primitives.tsx";
import { MarkdownView } from "../../ui/markdown-view.tsx";

export function CourseTabStrip({ courseId, active }: { courseId: string; active: CourseTab }) {
  return (
    <nav aria-label="과정 정보" className="mb-5 overflow-x-auto">
      <ul className="m-0 flex list-none gap-2 p-0">
        {COURSE_TABS.map((tab) => {
          const selected = tab === active;
          return (
            <li key={tab} className="shrink-0">
              <Link
                href={`/courses/${courseId}?tab=${tab}`}
                aria-current={selected ? "page" : undefined}
                className={[
                  "tap-target inline-flex items-center px-3 py-2 text-sm no-underline radius-md",
                  "bw",
                  selected
                    ? "border-border bg-card font-extrabold underline underline-offset-4"
                    : "border-transparent text-muted-foreground",
                ].join(" ")}
              >
                {COURSE_TAB_LABELS[tab]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function EmptyPanel({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <h3 className="mt-0 mb-2 text-base font-bold">{title}</h3>
      <p className="m-0 text-sm text-muted-foreground">{description}</p>
    </Card>
  );
}

export function DocumentPanel({
  markdown,
  verified,
  emptyTitle,
  emptyDescription,
}: {
  markdown: string | null;
  verified: boolean;
  emptyTitle: string;
  emptyDescription: string;
}) {
  const state = documentState(markdown, verified);
  if (state?.kind === "damaged") {
    return (
      <Card>
        <h3 className="mt-0 mb-2 text-base font-bold text-destructive">{state.title}</h3>
        <p className="mt-0 mb-3 text-sm">{state.description}</p>
        <Link href="/status" className="underline">상태 화면에서 복구 방법 확인하기</Link>
      </Card>
    );
  }
  if (state) return <EmptyPanel title={emptyTitle} description={emptyDescription} />;
  return <Card><MarkdownView markdown={markdown!} /></Card>;
}

export function OverviewPanel({ course, history, snapshot, verified }: {
  course: CourseHistoryCourse;
  history: CourseHistory;
  snapshot: LearningSnapshot | null;
  verified: boolean;
}) {
  const preference = { examples: "예제 중심", theory: "이론 중심", practice: "실습 중심" } as const;
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader title="학습 목표" headingLevel={3} />
        <p className="m-0 break-words">{course.goal}</p>
      </Card>
      <Card>
        <CardHeader title="시작 인터뷰" headingLevel={3} />
        <dl className="m-0 grid gap-2">
          <dt className="m-0 text-sm text-muted-foreground">사전 지식</dt>
          <dd className="m-0 break-words">{course.priorKnowledge ?? "아직 저장되지 않았습니다."}</dd>
          <dt className="m-0 text-sm text-muted-foreground">선호 학습 방식</dt>
          <dd className="m-0">{course.learningPreference === null ? "아직 저장되지 않았습니다." : preference[course.learningPreference]}</dd>
        </dl>
      </Card>
      <Card>
        <CardHeader title="진도" headingLevel={3} />
        <p className="m-0">
          승인된 Day {history.days.length}개 중 {history.days.filter(({ completedAt }) => completedAt !== null).length}개 완료
          {course.currentStage === null ? "" : ` · 현재 단계 ${STAGE_LABELS[course.currentStage]}`}
        </p>
      </Card>
      <Card>
        <CardHeader title="최근 활동" description="저장된 완료 기록과 리서치만 표시합니다." headingLevel={3} />
        {(() => {
          const events = [
            ...history.days
              .filter(({ completedAt }) => completedAt !== null)
              .map((day) => ({ at: day.completedAt!, text: `Day ${day.dayNumber} 완료 · ${day.objective}` })),
            ...history.researchRuns.map((run) => ({
              at: run.createdAt,
              text: run.scope === "course" ? "과정 리서치 저장" : `Day ${run.dayNumber} 리서치 저장`,
            })),
          ].sort((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0)).slice(0, 5);
          return events.length === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">아직 저장된 활동이 없습니다.</p>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0 text-sm">
              {events.map((event) => (
                <li key={`${event.at}-${event.text}`} className="flex flex-wrap gap-2">
                  <time dateTime={event.at} className="shrink-0 text-muted-foreground">{event.at.slice(0, 10)}</time>
                  <span className="min-w-0 break-words">{event.text}</span>
                </li>
              ))}
            </ul>
          );
        })()}
      </Card>
      <div>
        <h3 className="mt-0 mb-2 text-base font-bold">과정 문서</h3>
        <DocumentPanel
          markdown={snapshot?.documents.course ?? null}
          verified={verified}
          emptyTitle="과정 문서가 비어 있습니다"
          emptyDescription="Codex에서 $just-study로 리서치와 30일 목차를 승인하면 여기에 표시됩니다."
        />
      </div>
    </div>
  );
}

export function PlanPanel({ history, currentDayId }: { history: CourseHistory; currentDayId: string | null }) {
  if (history.days.length === 0) {
    return <EmptyPanel title="아직 승인된 30일 계획이 없습니다" description="Codex에서 $just-study로 리서치를 마치고 30개 Day 목차를 승인해 주세요." />;
  }
  return (
    <Card>
      <ol className="m-0 grid list-none gap-2 p-0">
        {history.days.map((day) => {
          const current = day.id === currentDayId;
          const done = day.completedAt !== null;
          return (
            <li key={day.id} className={`flex flex-wrap items-center gap-3 border-b border-solid border-border pb-2 ${current ? "font-bold" : ""}`}>
              <span className="w-16 shrink-0 text-sm text-muted-foreground">Day {day.dayNumber}</span>
              <span className="min-w-0 flex-1 break-words">{day.objective}</span>
              <Badge tone={done ? "muted" : current ? "accent" : "neutral"}>
                {done ? "완료" : current ? "현재" : "예정"}
              </Badge>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

export function SourcesPanel({ history }: { history: CourseHistory }) {
  if (history.researchRuns.length === 0) {
    return <EmptyPanel title="아직 저장된 리서치가 없습니다" description="Codex가 실제로 조사하고 평가한 자료만 여기에 기록됩니다." />;
  }
  return (
    <div className="grid gap-4">
      {history.researchRuns.map((run) => (
        <Card key={run.id}>
          <CardHeader
            title={run.scope === "course" ? "과정 리서치" : `Day ${run.dayNumber} 리서치`}
            description={run.dayObjective ?? "전체 주제 범위와 학습 순서를 조사한 기록입니다."}
            headingLevel={3}
          />
          <h4 className="mt-0 mb-1 text-sm font-bold">리서치 질문</h4>
          <ul className="mt-0 mb-3 list-disc pl-5 text-sm">
            {run.questions.map((question) => <li key={question} className="break-words">{question}</li>)}
          </ul>
          <h4 className="mt-0 mb-1 text-sm font-bold">주제별 선정 기준</h4>
          <ul className="mt-0 mb-3 list-disc pl-5 text-sm">
            {run.topicCriteria.map((criterion) => <li key={criterion} className="break-words">{criterion}</li>)}
          </ul>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">자료 평가 결과</caption>
              <thead>
                <tr>
                  <th scope="col" className="bw border-border p-2 text-left">순위</th>
                  <th scope="col" className="bw border-border p-2 text-left">자료</th>
                  <th scope="col" className="bw border-border p-2 text-right">점수</th>
                  <th scope="col" className="bw border-border p-2 text-left">선정</th>
                </tr>
              </thead>
              <tbody>
                {run.sources.map((source) => (
                  <tr key={source.id}>
                    <td className="bw border-border p-2">{source.rank}</td>
                    <td className="bw border-border p-2">
                      <a href={source.url} target="_blank" rel="noreferrer" className="underline break-words">
                        {source.title}
                        <span className="sr-only"> (새 창에서 열림)</span>
                      </a>
                      <span className="block text-xs text-muted-foreground break-words">{source.publisher}</span>
                      {source.selectionReason ? <span className="block text-xs break-words">선정 이유: {source.selectionReason}</span> : null}
                      {source.limitation ? <span className="block text-xs break-words">한계: {source.limitation}</span> : null}
                    </td>
                    <td className="bw border-border p-2 text-right">{source.totalScore} / 100</td>
                    <td className="bw border-border p-2">{source.selected ? "선정됨" : "미선정"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h4 className="mt-4 mb-1 text-sm font-bold">주장 교차 검증</h4>
          <ul className="m-0 grid list-none gap-2 p-0 text-sm">
            {run.claims.map((claim) => (
              <li key={claim.id} className="border-t border-solid border-border pt-2">
                <p className="m-0 font-semibold break-words">{claim.statement}</p>
                <p className="m-0 break-words">{claim.conclusion}</p>
                {claim.uncertainty ? <p className="m-0 break-words">남은 불확실성: {claim.uncertainty}</p> : null}
                <p className="m-0 text-xs text-muted-foreground">
                  {claim.major ? "핵심 주장 · " : ""}
                  근거 {claim.evidence.length}건 (지지 {claim.evidence.filter(({ stance }) => stance === "supports").length}, 반대 {claim.evidence.filter(({ stance }) => stance === "opposes").length})
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

export function JournalPanel({ history, snapshot, verified }: {
  history: CourseHistory;
  snapshot: LearningSnapshot | null;
  verified: boolean;
}) {
  const completed = history.days.filter(({ completedAt }) => completedAt !== null);
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader
          title="완료한 Day"
          description={`승인된 ${history.days.length}일 중 ${completed.length}일을 마쳤습니다.`}
          headingLevel={3}
        />
        {completed.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">아직 완료한 Day가 없습니다.</p>
        ) : (
          <ol className="m-0 grid list-none gap-2 p-0">
            {completed.map((day) => (
              <li key={day.id} className="flex flex-wrap items-baseline gap-3 border-b border-solid border-border pb-2">
                <span className="w-16 shrink-0 text-sm text-muted-foreground">Day {day.dayNumber}</span>
                <span className="min-w-0 flex-1 break-words">{day.objective}</span>
                <time dateTime={day.completedAt!} className="shrink-0 text-xs text-muted-foreground">
                  {day.completedAt!.slice(0, 10)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <div>
        <h3 className="mt-0 mb-2 text-base font-bold">검증된 학습 기록</h3>
        <DocumentPanel
          markdown={snapshot?.documents.journal ?? null}
          verified={verified}
          emptyTitle="아직 저장된 회고 기록이 없습니다"
          emptyDescription="Day를 완료하면 강의와 회고가 검증된 학습 기록으로 저장됩니다."
        />
      </div>
    </div>
  );
}

export function QuizPanel({ history }: { history: CourseHistory }) {
  if (history.quizAttempts.length === 0) {
    return <EmptyPanel title="아직 저장된 퀴즈가 없습니다" description="강의를 마치면 Codex가 다섯 문제를 저장하고 채점 기록이 여기에 남습니다." />;
  }
  const results = { correct: "정답", incorrect: "오답", needs_clarification: "설명 요청" } as const;
  return (
    <div className="grid gap-4">
      {history.quizAttempts.map((attempt) => (
        <Card key={attempt.id}>
          <CardHeader
            title={`Day ${attempt.dayNumber} · ${attempt.attemptNumber}번째 시도`}
            description={attempt.dayObjective}
            headingLevel={3}
            action={<Badge tone={attempt.status === "passed" ? "accent" : "muted"}>
              {attempt.status === "passed" ? "통과" : attempt.status === "failed" ? "보완 필요" : "진행 중"}
              {attempt.score === null ? "" : ` · ${attempt.score} / 5`}
            </Badge>}
          />
          <ol className="m-0 grid list-none gap-3 p-0">
            {attempt.questions.map((question) => (
              <li key={question.id} className="border-t border-solid border-border pt-3">
                <p className="m-0 font-semibold break-words">{question.position}. {question.prompt}</p>
                <p className="m-0 text-xs text-muted-foreground break-words">채점 기준: {question.gradingCriteria}</p>
                {question.responses.length === 0 ? (
                  <p className="m-0 text-sm text-muted-foreground">아직 답변하지 않았습니다.</p>
                ) : (
                  <ul className="m-0 grid list-none gap-2 p-0">
                    {question.responses.map((response) => (
                      <li key={response.id} className="text-sm">
                        <p className="m-0 break-words">답변: {response.answer}</p>
                        <p className="m-0 break-words">판정: {results[response.result]} · {response.feedback}</p>
                        {response.clarificationQuestion ? <p className="m-0 break-words">추가 질문: {response.clarificationQuestion}</p> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Replace `src/app/courses/[id]/page.tsx`**

First create `src/app/courses/[id]/context-bar.tsx` (a server component; it needs no browser state):

```tsx
import Link from "next/link.js";

export function CourseContextBar({ title, dayLabel }: { title: string; dayLabel: string | null }) {
  return (
    <div className="-mx-4 mb-4 flex min-w-0 items-center gap-3 bw-b border-sidebar-border bg-sidebar px-4 py-2 lg:hidden">
      <Link href="/courses" className="tap-target inline-flex shrink-0 items-center px-2 text-sm text-sidebar-foreground no-underline">
        <span aria-hidden="true">←</span>
        <span className="ml-1">과정</span>
      </Link>
      <span className="min-w-0 flex-1 truncate text-sm font-bold text-sidebar-foreground">{title}</span>
      {dayLabel ? <span className="shrink-0 text-xs text-sidebar-foreground">{dayLabel}</span> : null}
    </div>
  );
}
```

The course page renders it as its first element below the mobile shell header and hides the desktop breadcrumb on mobile, so the two never appear together. Keeping it in Task 9 prevents an unused route component in the combined Tasks 5/6 commit.

```tsx
import Link from "next/link.js";
import { notFound } from "next/navigation.js";

import {
  courseCardModel,
  normalizeTab,
  RESUME_COMMAND,
  STAGE_LABELS,
  STATUS_LABELS,
} from "../../../server/dashboard-view.ts";
import {
  getCourseHistory,
  getLearningSnapshot,
  LearningStateError,
  type LearningSnapshot,
} from "../../../server/learning.ts";
import { getRuntime, requireDatabase } from "../../../server/runtime.ts";
import { StorageError } from "../../../server/storage.ts";
import { CopyCommand } from "../../copy-command.tsx";
import { Alert, Badge, Card, ProgressBar } from "../../ui/primitives.tsx";
import { CourseContextBar } from "./context-bar.tsx";
import {
  CourseTabStrip,
  DocumentPanel,
  JournalPanel,
  OverviewPanel,
  PlanPanel,
  QuizPanel,
  SourcesPanel,
} from "./tabs.tsx";

export const dynamic = "force-dynamic";

export default async function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const tab = normalizeTab((await searchParams).tab);
  const runtime = getRuntime();

  if (!runtime.db) {
    return (
      <Alert title="과정을 불러올 수 없습니다." tone="danger">
        <p className="mt-0 mb-2">데이터베이스를 사용할 수 없습니다.</p>
        <Link href="/status" className="underline">상태 화면에서 복구 방법 확인하기</Link>
      </Alert>
    );
  }

  const history = getCourseHistory(requireDatabase(runtime), id);
  if (!history) notFound();

  // Only a storage/checksum failure means "the prose is damaged". Any other error
  // must not be reported to the user as a checksum problem.
  let snapshot: LearningSnapshot | null = null;
  let verified = true;
  let stateError = false;
  try {
    snapshot = getLearningSnapshot(requireDatabase(runtime), runtime.dataRoot, id);
  } catch (error) {
    if (error instanceof StorageError) {
      verified = false;
    } else if (error instanceof LearningStateError) {
      stateError = true;
    } else {
      throw error;
    }
  }

  const { course } = history;
  const card = courseCardModel({
    id: course.id,
    title: course.title,
    goal: course.goal,
    status: course.status,
    currentDayNumber: snapshot?.currentDay?.dayNumber ?? history.days.find(({ id: dayId }) => dayId === course.currentDayId)?.dayNumber ?? null,
    currentDayObjective: null,
    currentStage: course.currentStage,
    approvedDayCount: history.days.length,
    completedDayCount: history.days.filter(({ completedAt }) => completedAt !== null).length,
    hasQuizResponse: false,
    revision: course.revision,
    outlineApprovedAt: course.outlineApprovedAt,
    completedAt: course.completedAt,
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
  });

  return (
    <>
      <CourseContextBar title={course.title} dayLabel={card.dayLabel} />

      <p className="mt-0 mb-2 text-sm max-lg:hidden">
        <Link href="/courses" className="underline">과정</Link>
        <span aria-hidden="true"> / </span>
        <span className="text-muted-foreground">{course.title}</span>
      </p>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="mt-0 mb-2 text-3xl font-extrabold break-words">{course.title}</h1>
          <p className="m-0 flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={course.status === "active" ? "accent" : "muted"}>{STATUS_LABELS[course.status]}</Badge>
            {card.dayLabel ? <span className="font-semibold">{card.dayLabel}</span> : null}
            {course.currentStage ? <span className="font-semibold">{STAGE_LABELS[course.currentStage]}</span> : null}
          </p>
        </div>
        {course.status === "completed" ? (
          <p className="m-0 font-bold">완료됨</p>
        ) : course.status === "draft" ? (
          <p className="m-0 max-w-xs text-sm">Codex에서 <code className="font-mono">$just-study</code>로 리서치와 30일 계획을 완성해 주세요.</p>
        ) : (
          <CopyCommand command={RESUME_COMMAND} />
        )}
      </div>

      {card.progress ? <div className="mb-5"><ProgressBar {...card.progress} label={`${course.title} 진도`} /></div> : null}

      {!verified ? (
        <div className="mb-5">
          <Alert title="일부 학습 문서를 확인할 수 없습니다." tone="danger">
            <p className="mt-0 mb-2">체크섬 검증에 실패한 문서는 표시하지 않았습니다. 구조화된 진도·출처·퀴즈 기록은 아래에서 그대로 확인할 수 있습니다.</p>
            <Link href="/status" className="underline">상태 화면에서 복구 방법 확인하기</Link>
          </Alert>
        </div>
      ) : null}

      {stateError ? (
        <div className="mb-5">
          <Alert title="저장된 학습 상태가 일치하지 않습니다." tone="danger">
            <p className="mt-0 mb-2">현재 Day 또는 문서 등록 정보가 어긋나 긴 학습 문서를 읽지 않았습니다. 저장된 내용은 변경하지 않았습니다.</p>
            <Link href="/status" className="underline">상태 화면에서 복구 방법 확인하기</Link>
          </Alert>
        </div>
      ) : null}

      <CourseTabStrip courseId={course.id} active={tab} />

      {tab === "overview" ? <OverviewPanel course={course} history={history} snapshot={snapshot} verified={verified} /> : null}
      {tab === "plan" ? <PlanPanel history={history} currentDayId={course.currentDayId} /> : null}
      {tab === "today" ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="grid gap-4">
            <Card>
              <h3 className="mt-0 mb-2 text-base font-bold">오늘의 목표</h3>
              <p className="m-0 break-words">
                {snapshot?.currentDay?.objective ?? (course.status === "completed" ? "모든 Day를 마쳤습니다." : "아직 시작한 Day가 없습니다.")}
              </p>
              <p className="mt-2 mb-0 text-sm text-muted-foreground">
                단계: {course.currentStage === null ? "없음" : STAGE_LABELS[course.currentStage]}
              </p>
            </Card>
            <DocumentPanel
              markdown={snapshot?.documents.currentDay ?? null}
              verified={verified}
              emptyTitle="오늘 저장된 학습 내용이 없습니다"
              emptyDescription="Codex에서 $just-study 계속을 호출해 오늘의 리서치와 강의를 진행해 주세요."
            />
          </div>
          <aside className="grid gap-4">
            {course.status === "active" ? <Card><h3 className="mt-0 mb-2 text-base font-bold">Codex에서 이어가기</h3><CopyCommand command={RESUME_COMMAND} /></Card> : null}
            <Card>
              <h3 className="mt-0 mb-2 text-base font-bold">현재 Day 선정 출처</h3>
              {(() => {
                const sources = history.researchRuns
                  .filter((run) => run.scope === "day" && run.dayId === course.currentDayId)
                  .flatMap((run) => run.sources.filter(({ selected }) => selected));
                return sources.length === 0 ? (
                  <p className="m-0 text-sm text-muted-foreground">아직 오늘의 리서치가 저장되지 않았습니다.</p>
                ) : (
                  <ul className="m-0 grid list-none gap-2 p-0 text-sm">
                    {sources.map((source) => (
                      <li key={source.id}>
                        <a href={source.url} target="_blank" rel="noreferrer" className="underline break-words">
                          {source.title}<span className="sr-only"> (새 창에서 열림)</span>
                        </a>
                        <span className="block text-xs text-muted-foreground">{source.totalScore} / 100</span>
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </Card>
          </aside>
        </div>
      ) : null}
      {tab === "sources" ? <SourcesPanel history={history} /> : null}
      {tab === "quiz" ? <QuizPanel history={history} /> : null}
      {tab === "journal" ? <JournalPanel history={history} snapshot={snapshot} verified={verified} /> : null}
    </>
  );
}
```

- [ ] **Step 7: Verify**

```bash
node --test tests/dashboard.test.ts
npm test
npm run lint
npx tsc --noEmit
npm run build
git diff --check
```

Expected: all pass.

- [ ] **Step 8: Commit Task 9**

```bash
git add src/server/dashboard-view.ts src/app/ui/markdown-view.tsx src/app/courses/[id]/context-bar.tsx src/app/courses/[id]/tabs.tsx src/app/courses/[id]/page.tsx tests/dashboard.test.ts
git commit -m "feat: explore a course in six tabs"
```

### Task 10: Atomic draft editing

**Files:**

- Modify: `src/server/courses.ts`
- Modify: `src/server/learning.ts`
- Modify: `src/app/actions.ts`
- Create: `src/app/action-state.ts`
- Create: `src/app/error-messages.ts`
- Create: `src/app/draft-form.tsx`
- Modify: `src/app/courses/[id]/tabs.tsx` (OverviewPanel)
- Modify: `src/app/courses/[id]/page.tsx` (pass the form into OverviewPanel)
- Modify: `tests/dashboard.test.ts`

**Interfaces:**

- Consumes: `prepareMarkdownUpdate`, `commitPreparedUpdate`, `assertRevision`, `advanceRevision`, `getCourse`.
- Produces: `normalizeCourseTitleAndGoal(title, goal)`, `renderCourseShellMarkdown(title, goal)`, `updateCourseDraft(db, dataRoot, input): Course`, `DraftEditState`, `initialDraftEditState`, `ReflectionState`, `initialReflectionState`, `updateCourseDraftAction`, `DraftForm`.

Execute Steps 1–5b as the **Task 10 service/action boundary** immediately after the combined Tasks 5/6 batch. It is its own tested and committed batch before Task 7. Execute the remaining UI Steps 6–10 only after Task 9, because they modify the workspace panels created there.

- [ ] **Step 1: Write the failing service test**

Append to `tests/dashboard.test.ts` (add `updateCourseDraft`, `LearningRevisionConflictError`, `LearningStateError` to the `../src/server/learning.ts` import and `CourseValidationError`, `getCourseDocument` to the `../src/server/courses.ts` import):

```ts
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
```

- [ ] **Step 2: Run the focused test and observe RED**

Run: `node --test --test-name-pattern='draft editing' tests/dashboard.test.ts`

Expected: FAIL — `updateCourseDraft is not exported`.

- [ ] **Step 3: Export the reusable validation and renderer from `src/server/courses.ts`**

Replace the private `normalizeInput` and `renderMarkdown` definitions with exported functions and keep every existing message and rule identical:

```ts
export function normalizeCourseTitleAndGoal(title: unknown, goal: unknown): { title: string; goal: string } {
  if (typeof title !== "string" || typeof goal !== "string") {
    throw new CourseValidationError("과정 요청 형식이 올바르지 않습니다.");
  }
  const normalizedTitle = title.trim();
  const normalizedGoal = goal.trim();
  if (normalizedTitle.length < 1 || normalizedTitle.length > 120 || /[\r\n]/.test(normalizedTitle)) {
    throw new CourseValidationError("과정 제목은 줄바꿈 없이 1~120자여야 합니다.");
  }
  if (normalizedGoal.length < 1 || normalizedGoal.length > 2_000) {
    throw new CourseValidationError("학습 목표는 1~2,000자여야 합니다.");
  }
  return { title: normalizedTitle, goal: normalizedGoal };
}

export function renderCourseShellMarkdown(title: string, goal: string): string {
  const quotedGoal = goal
    .split(/\r\n?|\n/)
    .map((line) => `> ${escapeMarkdown(line)}`)
    .join("\n");
  return `# ${escapeMarkdown(title)}\n\n## 학습 목표\n\n${quotedGoal}\n`;
}

function normalizeInput(input: CreateCourseInput): CreateCourseInput {
  if (typeof input !== "object" || input === null || typeof input.requestId !== "string") {
    throw new CourseValidationError("과정 요청 형식이 올바르지 않습니다.");
  }
  if (!UUID_PATTERN.test(input.requestId)) {
    throw new CourseValidationError("요청 ID가 올바른 UUID가 아닙니다.");
  }
  return { requestId: input.requestId, ...normalizeCourseTitleAndGoal(input.title, input.goal) };
}
```

Replace the `renderMarkdown(input.title, input.goal)` call inside `createCourse` with `renderCourseShellMarkdown(input.title, input.goal)` and delete the old private `renderMarkdown`.

- [ ] **Step 4: Add `updateCourseDraft` to `src/server/learning.ts`**

Add `normalizeCourseTitleAndGoal` and `renderCourseShellMarkdown` to the existing `./courses.ts` import, then append:

```ts
export function updateCourseDraft(
  db: DatabaseHandle,
  dataRoot: string,
  input: { courseId: string; expectedRevision: number; title: string; goal: string },
): Course {
  if (typeof input !== "object" || input === null || Array.isArray(input) || !UUID_PATTERN.test(input.courseId)) {
    throw new LearningValidationError("courseId is invalid");
  }
  const { title, goal } = normalizeCourseTitleAndGoal(input.title, input.goal);

  const course = getCourse(db, input.courseId);
  if (!course) throw new LearningStateError("Course does not exist");
  assertRevision(course, input.expectedRevision);
  if (course.status !== "draft") throw new LearningStateError("Only a draft course can be edited");

  const now = new Date().toISOString();
  const update = prepareMarkdownUpdate(dataRoot, course.id, [
    {
      file: "course.md",
      expectedSha256: course.markdownSha256,
      content: renderCourseShellMarkdown(title, goal),
    },
  ]);

  commitPreparedUpdate(db, update, () => {
    const latest = getCourse(db, course.id);
    if (!latest || latest.status !== "draft") throw new LearningStateError("Course is no longer a draft");
    assertRevision(latest, input.expectedRevision);
    db.prepare(`UPDATE courses SET title = ?, goal = ?, markdown_sha256 = ? WHERE id = ?`)
      .run(title, goal, update.checksums["course.md"]!, course.id);
    advanceRevision(db, course.id, input.expectedRevision, now);
  });

  return getCourse(db, course.id)!;
}
```

Reusing `commitPreparedUpdate` guarantees the Markdown is rolled back if the SQLite transaction fails, so no partial state can survive.

- [ ] **Step 4b: Prove the write is atomic under a mid-transaction failure**

Append to `tests/dashboard.test.ts`:

```ts
test("a failure inside the draft transaction leaves neither SQLite nor Markdown changed", () => {
  withRuntime((db, dataRoot) => {
    const created = createCourse(db, dataRoot, {
      requestId: crypto.randomUUID(),
      title: "원래 제목",
      goal: "원래 목표",
    }).course;
    const before = getCourseDocument(db, dataRoot, created.id)!;

    // A concurrent writer bumps the revision after the caller read it. The inner
    // re-check inside the transaction must reject and roll the Markdown back.
    const original = db.prepare.bind(db);
    let armed = true;
    (db as { prepare: typeof db.prepare }).prepare = ((sql: string) => {
      if (armed && sql.includes("UPDATE courses SET title = ?")) {
        armed = false;
        original("UPDATE courses SET revision = revision + 1 WHERE id = ?").run(created.id);
      }
      return original(sql);
    }) as typeof db.prepare;

    try {
      assert.throws(
        () => updateCourseDraft(db, dataRoot, {
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
    // better-sqlite3 rolls the whole transaction back, including the injected bump,
    // so nothing at all survives the aborted write.
    assert.equal(after.course.revision, 0);
    // A surviving tmp/update-* directory would make getHealth report this course as
    // needing recovery, so cleanup is part of the atomicity contract.
    assert.deepEqual(listTemporaryEntries(dataRoot), []);
  });
});
```

Add `listTemporaryEntries` to the `../src/server/storage.ts` import.

Why this exercises the real rollback path: `commitPreparedUpdate` runs
`db.transaction(() => { mutateDatabase(); applyMarkdownUpdate(update); })()`, so the
injected revision bump lands inside the transaction, `advanceRevision`'s
`WHERE revision = 0` then matches zero rows and throws
`LearningRevisionConflictError`, `applyMarkdownUpdate` never runs, SQLite rolls
everything back, and `rollbackMarkdownUpdate` discards the staged file. If `revision`
reads 1 instead of 0 the transaction is not rolling back, which is a real defect — do
not relax the assertion.

Run: `node --test --test-name-pattern='failure inside the draft transaction' tests/dashboard.test.ts`

Expected: PASS once `updateCourseDraft` exists. If the Markdown differs or a temporary
entry survives, the bug is in the write path, not the test.

- [ ] **Step 5: Add the shared form-state module and the server action**

A `"use server"` module may export only async functions; Next.js fails the build on
any other export. The existing `src/app/actions.ts` starts with `"use server"`, so
state types and their initial values live in a plain module.

Create `src/app/action-state.ts`. `draft-form.tsx` and `reflection-form.tsx` are
`"use client"` and import `initialDraftEditState` / `initialReflectionState` from it, so
this module must import **nothing at all**. Importing the engine's error classes here
would drag `src/server/courses.ts` → `src/server/storage.ts` → `node:fs` and
`src/server/learning.ts` → `better-sqlite3` into the browser bundle. The error mappers
therefore live in a separate server-only module created in the next sub-step.

```ts
export type DraftEditState = {
  status: "idle" | "saved" | "error" | "conflict";
  message: string | null;
  title: string;
  goal: string;
};

export const initialDraftEditState: DraftEditState = {
  status: "idle",
  message: null,
  title: "",
  goal: "",
};

export type ReflectionState = {
  status: "idle" | "saved" | "error" | "conflict";
  message: string | null;
  learned: string;
  confusing: string;
  feeling: string;
};

export const initialReflectionState: ReflectionState = {
  status: "idle",
  message: null,
  learned: "",
  confusing: "",
  feeling: "",
};
```

Create `src/app/error-messages.ts`. Only `actions.ts` (a server module) and the Node
test import it, so it may reference the engine's error classes.

```ts
import { CourseValidationError } from "../server/courses.ts";
import { LearningStateError, LearningValidationError } from "../server/learning.ts";

// The engine's LearningValidationError / LearningStateError messages are internal
// English strings ("Only a draft course can be edited"). Only CourseValidationError
// carries user-facing Korean copy, so everything else is mapped here.
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
```

Append to `src/app/actions.ts`:

```ts
import { revalidatePath } from "next/cache.js";

import {
  LearningRevisionConflictError,
  LearningStateError,
  LearningValidationError,
  updateCourseDraft,
} from "../server/learning.ts";

import type { DraftEditState } from "./action-state.ts";
import { draftErrorMessage } from "./error-messages.ts";

export async function updateCourseDraftAction(
  _previous: DraftEditState,
  formData: FormData,
): Promise<DraftEditState> {
  const title = String(formData.get("title") ?? "");
  const goal = String(formData.get("goal") ?? "");
  const courseId = String(formData.get("courseId") ?? "");
  const expectedRevision = Number(formData.get("expectedRevision"));

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
        message: "다른 곳에서 이 과정이 먼저 저장됐습니다. 입력한 내용은 그대로 두었습니다. 최신 상태를 불러온 뒤 다시 저장해 주세요.",
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
```

The action never retries and never re-reads-and-overwrites on conflict; it hands the decision back to the user with their text intact. It also never forwards `error.message` from the learning engine, whose strings are internal English.

Add a deterministic test that proves it:

```ts
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
    ...engineMessages.map((raw) => draftErrorMessageForTest(new LearningStateError(raw))),
    ...engineMessages.map((raw) => draftErrorMessageForTest(new LearningValidationError(raw))),
    ...engineMessages.map((raw) => reflectionErrorMessageForTest(new LearningStateError(raw))),
    ...engineMessages.map((raw) => reflectionErrorMessageForTest(new LearningValidationError(raw))),
    draftErrorMessageForTest(new Error("SQLITE_BUSY: database is locked")),
    reflectionErrorMessageForTest(new Error("EACCES: permission denied, open '/private/data/x.md'")),
  ];

  for (const message of mapped) {
    assert.ok(message.length > 0);
    // Korean copy, not the engine's internal English. "/status" is the only Latin
    // run the product copy is allowed to contain, so strip it before checking.
    const latin = message.replaceAll("/status", "").match(/[A-Za-z]{3,}/g) ?? [];
    assert.deepEqual(latin, [], message);
    for (const raw of engineMessages) assert.equal(message.includes(raw), false, message);
    assert.equal(message.includes("SQLITE"), false, message);
    assert.equal(message.includes("/private/"), false, message);
  }

  // CourseValidationError already carries Korean product copy and is passed through.
  assert.equal(
    draftErrorMessageForTest(new CourseValidationError("과정 제목은 줄바꿈 없이 1~120자여야 합니다.")),
    "과정 제목은 줄바꿈 없이 1~120자여야 합니다.",
  );
});
```

Add `CourseValidationError` to the `../src/server/courses.ts` import in the test if it
is not already there.

Import them in the test as:

```ts
import {
  draftErrorMessage as draftErrorMessageForTest,
  reflectionErrorMessage as reflectionErrorMessageForTest,
} from "../src/app/error-messages.ts";
```

Three constraints force this split, and all three must hold:

1. A `"use server"` module may export only async functions, so neither the state
   values nor the mappers can live in `actions.ts`.
2. `action-state.ts` is reached from `"use client"` components, so it must import
   nothing — otherwise `node:fs` and `better-sqlite3` enter the browser bundle.
3. The Node test runner cannot load `.tsx`, so both modules must stay `.ts`.

- [ ] **Step 5b: Prove the client bundle stays free of server-only modules**

Append to `tests/dashboard.test.ts`:

```ts
test("modules reachable from client components import no server-only code", () => {
  const appRoot = resolve(import.meta.dirname, "../src/app");
  const clientEntry = ["draft-form.tsx", "reflection-form.tsx", "copy-command.tsx", "theme-picker.tsx", "new-course-panel.tsx", "nav.tsx"];
  const seen = new Set<string>();

  function walk(file: string): void {
    if (seen.has(file) || !existsSync(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    // Next treats a `"use server"` module as a server-action reference. It is a
    // terminal in this client-import graph, not a module whose server imports are
    // bundled into the client.
    if (/^[\s\S]*?^["']use server["'];/m.test(source)) return;
    assert.equal(/from "node:/.test(source), false, `${file} imports a Node builtin`);
    assert.equal(source.includes("better-sqlite3"), false, `${file} imports better-sqlite3`);
    assert.equal(/from "\.\.\/server\//.test(source) || /from "\.\.\/\.\.\/server\//.test(source) || /from "\.\.\/\.\.\/\.\.\/server\//.test(source), false, `${file} reaches into src/server`);
    for (const [, specifier] of source.matchAll(/from "(\.[^"]+)"/g)) {
      walk(resolve(file, "..", specifier));
    }
  }

  for (const entry of clientEntry) walk(resolve(appRoot, entry));
  assert.ok(seen.size >= clientEntry.length);
});
```

Add `existsSync` to the `node:fs` import. This test fails the moment any client
component gains a transitive server-only import. `src/server/dashboard-view.ts` is a
pure module, but it lives under `src/server/`, so client components must not import it
either — pass the view-model results down as props from server components instead.

- [ ] **Step 5c: Verify and commit the service/action boundary before Task 7**

```bash
node --test tests/dashboard.test.ts
npm test
npm run lint
npx tsc --noEmit
git diff --check
git add src/server/courses.ts src/server/learning.ts src/app/action-state.ts src/app/error-messages.ts src/app/actions.ts tests/dashboard.test.ts
git commit -m "feat: add safe draft editing service"
```

Expected: all commands pass before the commit. Do not create `DraftForm` or modify course workspace UI in this boundary batch.

- [ ] **Step 6: After Task 9, implement the draft form**

Create `src/app/draft-form.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation.js";
import { useActionState } from "react";

import { initialDraftEditState } from "./action-state.ts";
import { updateCourseDraftAction } from "./actions.ts";
import { buttonClass } from "./ui/primitives.tsx";

export function DraftForm({
  courseId,
  revision,
  title,
  goal,
}: {
  courseId: string;
  revision: number;
  title: string;
  goal: string;
}) {
  const [state, action, pending] = useActionState(updateCourseDraftAction, initialDraftEditState);
  const router = useRouter();
  const currentTitle = state.status === "idle" ? title : state.title;
  const currentGoal = state.status === "idle" ? goal : state.goal;

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="expectedRevision" value={revision} />

      <label htmlFor="draft-title" className="grid gap-1 font-semibold">과정 이름</label>
      <input
        id="draft-title"
        name="title"
        defaultValue={currentTitle}
        key={`title-${state.status}-${revision}`}
        required
        minLength={1}
        maxLength={120}
        aria-describedby="draft-title-help"
        className="tap-target w-full bw border-border radius-md bg-input px-3 py-2 text-foreground"
      />
      <p id="draft-title-help" className="mt-0 mb-2 text-xs text-muted-foreground">줄바꿈 없이 1~120자.</p>

      <label htmlFor="draft-goal" className="grid gap-1 font-semibold">30일 뒤 학습 목표</label>
      <textarea
        id="draft-goal"
        name="goal"
        defaultValue={currentGoal}
        key={`goal-${state.status}-${revision}`}
        required
        minLength={1}
        maxLength={2000}
        rows={5}
        aria-describedby="draft-goal-help"
        className="w-full resize-y bw border-border radius-md bg-input px-3 py-2 text-foreground"
      />
      <p id="draft-goal-help" className="mt-0 mb-2 text-xs text-muted-foreground">1~2,000자. 목차를 승인하기 전까지만 수정할 수 있습니다.</p>

      {state.status === "conflict" ? (
        <div role="alert" className="surface border-destructive p-3">
          <p className="mt-0 mb-2 text-sm">{state.message}</p>
          <button type="button" className={buttonClass("secondary")} onClick={() => { router.refresh(); }}>
            최신 상태 불러오기
          </button>
        </div>
      ) : null}
      {state.status === "error" ? <p role="alert" className="m-0 text-sm text-destructive">{state.message}</p> : null}
      <p aria-live="polite" className="m-0 text-sm">{state.status === "saved" ? state.message : ""}</p>

      <div>
        <button type="submit" className={buttonClass("primary")} disabled={pending}>
          {pending ? "저장 중…" : "저장"}
        </button>
      </div>
    </form>
  );
}
```

The `key` includes the revision so a successful save re-seeds the fields from the freshly revalidated server values, while a conflict or validation error keeps the user's typed text.

- [ ] **Step 7: Show the form only for a draft**

In `src/app/courses/[id]/tabs.tsx`, add `import type { ReactNode } from "react";` at the top, add an optional `editor?: ReactNode` prop to `OverviewPanel`, and render it in its own card directly after the "학습 목표" card:

```tsx
{editor ? (
  <Card>
    <CardHeader title="과정 정보 수정" description="목차를 승인하기 전인 초안에서만 제목과 목표를 바꿀 수 있습니다." headingLevel={3} />
    {editor}
  </Card>
) : null}
```

In `src/app/courses/[id]/page.tsx`, import `DraftForm` and pass it only for drafts:

```tsx
<OverviewPanel
  course={course}
  history={history}
  snapshot={snapshot}
  verified={verified}
  editor={course.status === "draft"
    ? <DraftForm courseId={course.id} revision={course.revision} title={course.title} goal={course.goal} />
    : null}
/>
```

- [ ] **Step 8: Add the standalone-link tap targets**

Give `.tap-target inline-flex items-center` to every standalone action link created so far: `전체 보기` and `학습 기록 보기` in `src/app/page.tsx`, the `/status` links in every `Alert`, `상태 화면에서 자세히 보기` in `src/app/settings/page.tsx`, `과정 목록으로 돌아가기` in `src/app/not-found.tsx`, and `상태 화면에서 복구 방법 확인하기` in `src/app/courses/[id]/tabs.tsx`. Leave breadcrumb text, table-cell source titles, and Markdown-rendered links as inline links.

- [ ] **Step 9: Verify**

```bash
node --test tests/dashboard.test.ts
npm test
npm run lint
npx tsc --noEmit
npm run build
git diff --check
```

Expected: all pass, including the existing platform-foundation tests that cover `createCourse` validation messages.

- [ ] **Step 10: Verify and commit the remaining Task 10 UI**

```bash
git add src/app/draft-form.tsx src/app/courses/[id]/tabs.tsx src/app/courses/[id]/page.tsx src/app/page.tsx src/app/settings/page.tsx src/app/not-found.tsx tests/dashboard.test.ts
git commit -m "feat: add draft editing controls"
```

### Task 11: Reflection submission

**Files:**

- Modify: `src/app/actions.ts`
- Create: `src/app/reflection-form.tsx`
- Modify: `src/app/courses/[id]/page.tsx` (today tab)
- Modify: `tests/dashboard.test.ts`

**Interfaces:**

- Consumes: the existing `completeDay` service, `LearningRevisionConflictError`, `LearningStateError`, `LearningValidationError`.
- Produces: `submitReflectionAction` and `ReflectionForm`. The state type and its initial value already exist in `src/app/action-state.ts`.

The UI adds no rule of its own. `completeDay` still decides quiz mastery, the current stage, Day 30 termination, and the revision.

- [ ] **Step 1: Write the failing gate test**

Append to `tests/dashboard.test.ts`:

```ts
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
    state = gradeQuiz(db, dataRoot, {
      courseId,
      expectedRevision: state.course.revision,
      attemptId,
      grades: grades(list, 2),
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
        inner = gradeQuiz(db, dataRoot, {
          courseId,
          expectedRevision: inner.course.revision,
          attemptId: secondAttempt,
          grades: grades(second, null),
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
```

Add `startRemediationQuiz` to the `../src/server/learning.ts` import.

- [ ] **Step 2: Run the focused test and observe RED or GREEN**

Run: `node --test --test-name-pattern='reflection cannot bypass' tests/dashboard.test.ts`

Expected: PASS immediately, because the learning engine already enforces these rules. Record that this test locks the contract the UI must not bypass; it is not a driver for new service code. If it fails, stop and report the engine defect rather than changing the assertion.

- [ ] **Step 3: Add the reflection action**

`ReflectionState` and `initialReflectionState` already live in
`src/app/action-state.ts` from Task 10; do not add value exports to `actions.ts`.
Append to `src/app/actions.ts`:

```ts
import { completeDay } from "../server/learning.ts";

import type { ReflectionState } from "./action-state.ts";
import { reflectionErrorMessage } from "./error-messages.ts";

export async function submitReflectionAction(
  _previous: ReflectionState,
  formData: FormData,
): Promise<ReflectionState> {
  const learned = String(formData.get("learned") ?? "");
  const confusing = String(formData.get("confusing") ?? "");
  const feeling = String(formData.get("feeling") ?? "");
  const courseId = String(formData.get("courseId") ?? "");
  const expectedRevision = Number(formData.get("expectedRevision"));
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
        message: "학습 상태가 먼저 변경됐습니다. 작성한 회고는 그대로 두었습니다. 최신 상태를 불러온 뒤 다시 제출해 주세요.",
        ...kept,
      };
    }
    return { status: "error", message: reflectionErrorMessage(error), ...kept };
  }

  revalidatePath(`/courses/${courseId}`);
  revalidatePath("/");
  return { status: "saved", message: "회고를 저장하고 다음 Day로 이동했습니다.", learned: "", confusing: "", feeling: "" };
}
```

- [ ] **Step 4: Implement the reflection form**

Create `src/app/reflection-form.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation.js";
import { useActionState } from "react";

import { initialReflectionState } from "./action-state.ts";
import { submitReflectionAction } from "./actions.ts";
import { buttonClass } from "./ui/primitives.tsx";

const FIELDS = [
  { name: "learned", label: "오늘 무엇을 배웠나요?", help: "1~10,000자." },
  { name: "confusing", label: "아직 헷갈리는 것은 무엇인가요?", help: "1~10,000자." },
  { name: "feeling", label: "오늘 공부에 대한 한 줄 소감은 무엇인가요?", help: "1~10,000자." },
] as const;

export function ReflectionForm({ courseId, revision }: { courseId: string; revision: number }) {
  const [state, action, pending] = useActionState(submitReflectionAction, initialReflectionState);
  const router = useRouter();

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="expectedRevision" value={revision} />

      {FIELDS.map(({ name, label, help }) => (
        <div key={name} className="grid gap-1">
          <label htmlFor={`reflection-${name}`} className="font-semibold">{label}</label>
          <textarea
            id={`reflection-${name}`}
            name={name}
            defaultValue={state[name]}
            key={`${name}-${state.status}-${revision}`}
            required
            minLength={1}
            maxLength={10000}
            rows={3}
            aria-describedby={`reflection-${name}-help`}
            className="w-full resize-y bw border-border radius-md bg-input px-3 py-2 text-foreground"
          />
          <p id={`reflection-${name}-help`} className="m-0 text-xs text-muted-foreground">{help}</p>
        </div>
      ))}

      {state.status === "conflict" ? (
        <div role="alert" className="surface border-destructive p-3">
          <p className="mt-0 mb-2 text-sm">{state.message}</p>
          <button type="button" className={buttonClass("secondary")} onClick={() => { router.refresh(); }}>
            최신 상태 불러오기
          </button>
        </div>
      ) : null}
      {state.status === "error" ? <p role="alert" className="m-0 text-sm text-destructive">{state.message}</p> : null}
      <p aria-live="polite" className="m-0 text-sm">{state.status === "saved" ? state.message : ""}</p>

      <div>
        <button type="submit" className={buttonClass("primary")} disabled={pending}>
          {pending ? "제출 중…" : "회고 제출하고 다음 Day로"}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 5: Render it only during the reflection stage**

In the `today` tab of `src/app/courses/[id]/page.tsx`, add this card directly after the "오늘의 목표" card:

```tsx
{course.currentStage === "reflection" ? (
  <Card>
    <h3 className="mt-0 mb-2 text-base font-bold">오늘의 회고</h3>
    <p className="mt-0 mb-3 text-sm text-muted-foreground">
      세 답변을 모두 제출하면 학습 기록에 저장되고 다음 Day로 이동합니다. 제출 전에는 저장되지 않습니다.
    </p>
    <ReflectionForm courseId={course.id} revision={course.revision} />
  </Card>
) : null}
```

Import `ReflectionForm` at the top of the file. Do not render the form in any other stage and do not add a client-side check of quiz results.

- [ ] **Step 6: Verify**

```bash
node --test tests/dashboard.test.ts
npm test
npm run lint
npx tsc --noEmit
npm run build
git diff --check
```

Expected: all pass.

- [ ] **Step 7: Commit Task 11**

```bash
git add src/app/actions.ts src/app/reflection-form.tsx src/app/courses/[id]/page.tsx tests/dashboard.test.ts
git commit -m "feat: submit the daily reflection from the dashboard"
```

### Task 12: Route loading states and operator documentation

**Files:**

- Create: `src/app/loading.tsx`
- Create: `src/app/courses/loading.tsx`
- Create: `src/app/courses/[id]/loading.tsx`
- Modify: `README.md`
- Modify: `tests/dashboard.test.ts`

**Interfaces:**

- Consumes: `Skeleton`, `Card` from the combined Tasks 5/6 batch.
- Produces: three route-level loading boundaries whose shape matches the real content, and README sections that match actual behavior.

- [ ] **Step 1: Write the failing documentation test**

Append to `tests/dashboard.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the focused test and observe RED**

Run: `node --test --test-name-pattern='README documents' tests/dashboard.test.ts`

Expected: FAIL — the README does not yet mention `/settings` or the theme key.

- [ ] **Step 3: Add the three loading boundaries**

Create `src/app/loading.tsx`:

```tsx
import { Card, Skeleton } from "./ui/primitives.tsx";

export default function TodayLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <p className="sr-only">오늘 화면을 불러오는 중입니다.</p>
      <Skeleton className="mb-6 h-9 w-64" />
      <Card className="mb-6">
        <Skeleton className="mb-3 h-6 w-48" />
        <Skeleton className="mb-3 h-4 w-full" />
        <Skeleton className="h-11 w-40" />
      </Card>
      <Skeleton className="mb-3 h-6 w-40" />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-24 w-full" />)}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {[0, 1].map((index) => <Skeleton key={index} className="h-40 w-full" />)}
      </div>
    </div>
  );
}
```

Create `src/app/courses/loading.tsx`:

```tsx
import { Skeleton } from "../ui/primitives.tsx";

export default function CoursesLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <p className="sr-only">과정 목록을 불러오는 중입니다.</p>
      <Skeleton className="mb-4 h-9 w-40" />
      <Skeleton className="mb-5 h-11 w-72" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((index) => <Skeleton key={index} className="h-44 w-full" />)}
      </div>
    </div>
  );
}
```

Create `src/app/courses/[id]/loading.tsx`:

```tsx
import { Skeleton } from "../../ui/primitives.tsx";

export default function CourseLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <p className="sr-only">과정을 불러오는 중입니다.</p>
      <Skeleton className="mb-2 h-4 w-32" />
      <Skeleton className="mb-5 h-9 w-72" />
      <Skeleton className="mb-5 h-11 w-full max-w-xl" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
```

- [ ] **Step 4: Update the README**

Keep every existing install, data directory, recovery, Codex, and verification section. Append:

````markdown
## 학습 대시보드

`npm run dev` 뒤 브라우저에서 `http://127.0.0.1:3000`을 엽니다. 로그인·가입·계정이
없고 서버는 `127.0.0.1`에만 바인딩합니다.

| 경로 | 화면 | 주요 행동 |
|---|---|---|
| `/` | 오늘 | 이어갈 과정 확인, `$just-study 계속` 명령 복사 |
| `/courses` | 과정 | 상태 필터, 새 과정 만들기 |
| `/courses/[id]` | 과정 작업 공간 | 개요·30일 계획·오늘·출처·퀴즈·학습 기록 탭 |
| `/settings` | 설정 | 테마 선택, 시스템 상태 진입 |
| `/status` | 상태 | 데이터베이스·저장소 점검과 복구 안내 |

### 테마

Focus(기본), Calm, Focus Dark 세 가지를 제공합니다. 선택값은 이 브라우저의
`localStorage` 키 `just-study:theme`에만 저장되며 학습 데이터에는 영향을 주지
않습니다. 저장값을 읽지 못하면 Focus로 표시합니다.

### 대시보드에서 바꿀 수 있는 것

대시보드는 학습을 대신 진행하지 않습니다. 리서치·강의·채점은 Codex의
`$just-study`가 수행하고, 화면은 저장된 사실을 읽어서 보여 줍니다. 직접 수정할 수
있는 값은 다음 네 가지뿐입니다.

1. 새 과정 만들기
2. 초안 과정의 제목과 목표
3. 아직 제출하지 않은 세 개의 회고 답변
4. 테마 선택

승인된 30일 목차, 출처 점수, 퀴즈 문제와 응답, 완료된 Day는 읽기 전용입니다.
다른 곳에서 과정이 먼저 저장되면 저장이 거부되고 입력한 내용을 유지한 채 최신
상태를 다시 불러오도록 안내합니다. 체크섬 검증에 실패한 문서는 정상 내용처럼
표시하지 않고 `/status` 복구 안내로 연결합니다.
````

- [ ] **Step 5: Verify**

```bash
node --test tests/dashboard.test.ts
npm test
npm run lint
npx tsc --noEmit
npm run build
git diff --check
```

Expected: all pass.

- [ ] **Step 6: Commit Task 12**

```bash
git add src/app/loading.tsx src/app/courses/loading.tsx src/app/courses/[id]/loading.tsx README.md tests/dashboard.test.ts
git commit -m "docs: document the learning dashboard"
```

### Task 13: Real browser verification

**Files:**

- Verify only: the running application, a temporary `JUST_STUDY_DATA_DIR` outside the repository.
- Modify: none unless a defect is found; then fix the exact source file and note it in the ledger.
- Evidence: `$justStudyUiRoot/evidence/ledger.md` and `$justStudyUiRoot/evidence/screenshots/`; keep both until Task 14 cleanup.

**Interfaces:**

- Consumes: everything from Tasks 1–12.
- Produces: recorded evidence for every state, viewport, keyboard path, and theme required by the design.

- [ ] **Step 1: Seed a deterministic data root covering every state**

Run all Task 13 shell commands in one dedicated shell session from the worktree. The setup below names the evidence directory and ledger, stops a live test server, and restores SQLite permissions on normal exit, interruption, or failure; it deliberately does **not** delete the evidence root, which Task 14 handles after review.

```bash
set -o pipefail
justStudyUiRoot="$(mktemp -d /private/tmp/just-study-dashboard-ui.XXXXXX)"
case "$justStudyUiRoot" in /private/tmp/just-study-dashboard-ui.*) ;; *) exit 1 ;; esac
justStudyEvidenceDir="$justStudyUiRoot/evidence"
justStudyEvidenceLedger="$justStudyEvidenceDir/ledger.md"
justStudyUiPid=""
justStudyUiDbMode=""
mkdir -p "$justStudyEvidenceDir/screenshots"
printf '# Task 13 evidence\n\n' >"$justStudyEvidenceLedger"
just_study_ui_restore() {
  if [ -n "$justStudyUiDbMode" ] && [ -f "$justStudyUiRoot/just-study.sqlite" ]; then chmod "$justStudyUiDbMode" "$justStudyUiRoot/just-study.sqlite"; fi
  if [ -n "$justStudyUiPid" ] && kill -0 "$justStudyUiPid" 2>/dev/null; then kill "$justStudyUiPid"; wait "$justStudyUiPid" || true; fi
}
trap 'status=$?; just_study_ui_restore; exit "$status"' EXIT INT TERM
JUST_STUDY_DATA_DIR="$justStudyUiRoot" node --input-type=module -e '
import { createCourse } from "./src/server/courses.ts";
import { openDatabase } from "./src/server/database.ts";
import { approveOutline, completeDay, gradeQuiz, recordDailyResearch, saveLearningCheckpoint, startQuiz } from "./src/server/learning.ts";
const dataRoot = process.env.JUST_STUDY_DATA_DIR;
const db = openDatabase(dataRoot);
const bundle = (topic, a, b) => { const first = crypto.randomUUID(); const second = crypto.randomUUID(); return {
  questions: [`${topic}의 핵심 개념은 무엇인가?`], topicCriteria: ["공식·대학 자료를 우선한다"],
  narrativeMarkdown: `# ${topic}\n\n${topic}의 핵심 개념을 **교차 검증**했다.\n\n- 공식 문서\n- 대학 강의\n\n[참고](${a})`,
  sources: [
    { id: first, url: a, title: "Foundations", publisher: "Example University", independenceKey: "example-university", scores: { authority: 24, crossValidation: 23, relevance: 19, teachingQuality: 14, currency: 9, accessibility: 5 }, rank: 1, selected: true, selectionReason: "공개 기초 과정이며 예제가 명확하다.", limitation: null },
    { id: second, url: b, title: "Curriculum Standard", publisher: "Independent Standards Group", independenceKey: "standards-group", scores: { authority: 23, crossValidation: 24, relevance: 18, teachingQuality: 13, currency: 9, accessibility: 5 }, rank: 2, selected: true, selectionReason: "독립 기관의 학습 순서를 제공한다.", limitation: null },
  ],
  claims: [{ id: crypto.randomUUID(), statement: `${topic}은 설명과 적용을 함께 학습해야 한다.`, major: true, conclusion: "두 독립 자료가 같은 방향을 지지한다.", uncertainty: null, evidence: [{ sourceId: first, stance: "supports" }, { sourceId: second, stance: "supports" }] }],
}; };
const lesson = { recallMarkdown: "전날 개념을 회상한다.", preciseExplanationMarkdown: "## 정확한 설명\n\n정의와 원리를 설명한다.", eli5Markdown: "다섯 살도 이해할 말로 설명한다.", analogyMarkdown: "정리함에 비유한다.", exampleMarkdown: "```ts\nconst a = 1;\n```", applicationMarkdown: "새 문제에 적용한다.", interviewMarkdown: "선택 이유를 설명한다." };
const qs = (p) => Array.from({ length: 5 }, (_, i) => ({ id: crypto.randomUUID(), conceptKey: `${p}-${i + 1}`, conceptLabel: `${p} 개념 ${i + 1}`, prompt: `${p} 질문 ${i + 1}: 핵심 원리를 설명하세요.`, gradingCriteria: "핵심 원리와 적용 이유를 설명한다." }));
const gr = (list, bad) => list.map((q, i) => ({ questionId: q.id, answer: `${q.conceptLabel} 답변`, result: i === bad ? "incorrect" : "correct", feedback: i === bad ? "적용 이유를 보완하세요." : "정확합니다." }));
const start = (title, a, b) => { const c = createCourse(db, dataRoot, { requestId: crypto.randomUUID(), title, goal: `${title}의 핵심을 30일 안에 설명한다.` }).course;
  return approveOutline(db, dataRoot, { courseId: c.id, expectedRevision: 0, priorKnowledge: "기초 용어만 안다.", learningPreference: "examples", knowledgeMapMarkdown: "# 지식 지도\n\n기초 → 적용", research: bundle(title, a, b), days: Array.from({ length: 30 }, (_, i) => ({ objective: `${title} 목표 ${i + 1}을 설명한다` })) }); };
const day = (id, rev, p) => { let s = recordDailyResearch(db, dataRoot, { courseId: id, expectedRevision: rev, research: bundle(p, `https://${p}.example.edu/a`, `https://${p}.example.org/b`) });
  s = saveLearningCheckpoint(db, dataRoot, { courseId: id, expectedRevision: s.course.revision, lesson, understoodConcepts: [{ key: `${p}-known`, label: `${p} 이해` }], remediationConcepts: [] });
  const list = qs(p); s = startQuiz(db, dataRoot, { courseId: id, expectedRevision: s.course.revision, questions: list });
  s = gradeQuiz(db, dataRoot, { courseId: id, expectedRevision: s.course.revision, attemptId: s.quizAttempts.at(-1).id, grades: gr(list, null) });
  return completeDay(db, dataRoot, { courseId: id, expectedRevision: s.course.revision, reflection: { learned: `${p}의 핵심 원리`, confusing: "상각 분석", feeling: "적용할 수 있다" } }).course.revision; };
createCourse(db, dataRoot, { requestId: crypto.randomUUID(), title: "초안 과정", goal: "아직 목차를 승인하지 않았다." });
let a = start("자료구조", "https://ds.example.edu/a", "https://ds.example.org/b"); let r = a.course.revision;
for (let i = 1; i <= 3; i += 1) r = day(a.course.id, r, `ds-${i}`);
let b = start("운영체제", "https://os.example.edu/a", "https://os.example.org/b"); let rb = b.course.revision;
let s = recordDailyResearch(db, dataRoot, { courseId: b.course.id, expectedRevision: rb, research: bundle("os-1", "https://os1.example.edu/a", "https://os1.example.org/b") });
s = saveLearningCheckpoint(db, dataRoot, { courseId: b.course.id, expectedRevision: s.course.revision, lesson, understoodConcepts: [{ key: "os-known", label: "이해" }], remediationConcepts: [] });
const ol = qs("os-1"); s = startQuiz(db, dataRoot, { courseId: b.course.id, expectedRevision: s.course.revision, questions: ol });
gradeQuiz(db, dataRoot, { courseId: b.course.id, expectedRevision: s.course.revision, attemptId: s.quizAttempts.at(-1).id, grades: gr(ol, 1) });
let c = start("짧은 과정", "https://sh.example.edu/a", "https://sh.example.org/b"); let rc = c.course.revision;
for (let i = 1; i <= 30; i += 1) rc = day(c.course.id, rc, `sh-${i}`);
db.close();
' 2>&1
```

The seed is explicitly prefixed with `JUST_STUDY_DATA_DIR="$justStudyUiRoot"`. Then assert the seeded shape before starting the server:

```bash
env JUST_STUDY_DATA_DIR="$justStudyUiRoot" node --input-type=module -e '
import { openDatabase } from "./src/server/database.ts";
import { getDashboardOverview } from "./src/server/dashboard.ts";
const db = openDatabase(process.env.JUST_STUDY_DATA_DIR);
const { courses } = getDashboardOverview(db);
db.close();
const shape = courses.map((c) => `${c.status}:${c.currentStage ?? "none"}:${c.completedDayCount}`).sort().join(",");
if (shape !== "active:lecture:3,active:remediation:0,completed:none:30,draft:none:0") {
  console.error("unexpected seed shape:", shape);
  process.exit(1);
}
'
```

Expected: exit zero. The four required states — draft, active `lecture` with three completed Days, active `remediation`, and completed — all exist.

- [ ] **Step 2: Start the application on the temporary root**

```bash
if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then exit 1; fi
env JUST_STUDY_DATA_DIR="$justStudyUiRoot" node node_modules/next/dist/bin/next dev -H 127.0.0.1 -p 3000 >"$justStudyUiRoot/dev-server.log" 2>&1 &
justStudyUiPid=$!
curl --retry 20 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:3000/api/health
```

Record `justStudyUiRoot`, `justStudyUiPid`, the evidence directory, and every screenshot path in `$justStudyEvidenceLedger`.

- [ ] **Step 3: Check every data state at 1280px**

Open the in-app browser at 1280×800 and confirm each of the following, capturing a screenshot for each line:

1. `/` shows the resume card for the most recently updated active course with `Day N / 30`, a Korean stage name, the objective, a progress bar, and the `Codex에서 계속` button.
2. `/` attention list shows the `remediation` course first with `보완 학습이 필요합니다`, and at most three items.
3. `/` metrics show four cards whose numbers match the seeded data, each with helper text.
4. `/` recent Days shows five entries newest first.
5. `/courses` lists all four courses; each filter chip changes the URL and the visible set; `?filter=completed` shows only the completed course.
6. The draft card shows `초안` and `30일 계획 승인 대기` with no Day, stage, or progress bar.
7. `/courses/[draft]?tab=overview` shows the edit form; the other five tabs show their empty states.
8. `/courses/[active]` — every one of the six tabs renders real data: 30 plan rows with 완료/현재/예정, both research runs with 100-point scores, quiz attempts with answers and feedback, today's Markdown, and the journal.
9. `/courses/[completed]` shows `완료됨` instead of a resume CTA and `Day 30 / 30` at 100%.
10. An unknown course ID returns the 404 page with a link back to `/courses`.

- [ ] **Step 4: Check the write paths**

1. Edit the draft's title and goal, save, and confirm the page shows the new values and `/courses` reflects them.
2. Submit the draft form with an empty title and confirm the browser's own constraint blocks it; then remove `required` in devtools, submit, and confirm the server returns the Korean validation message with the typed text preserved.
3. In one tab load the draft edit form, in a second tab save a different title, then save the first tab. Confirm the conflict alert appears, the typed text is preserved, no value was overwritten, and `최신 상태 불러오기` reloads the current values.
4. Move the `remediation` course to `reflection` with this script, then reload `/courses/[id]?tab=today`:

   ```bash
   env JUST_STUDY_DATA_DIR="$justStudyUiRoot" node --input-type=module -e '
   import { openDatabase } from "./src/server/database.ts";
   import { getDashboardOverview } from "./src/server/dashboard.ts";
   import { gradeQuiz, getLearningSnapshot, saveLearningCheckpoint, startRemediationQuiz } from "./src/server/learning.ts";
   const dataRoot = process.env.JUST_STUDY_DATA_DIR;
   const db = openDatabase(dataRoot);
   const target = getDashboardOverview(db).courses.find((c) => c.currentStage === "remediation");
   let s = saveLearningCheckpoint(db, dataRoot, { courseId: target.id, expectedRevision: target.revision, lesson: { remediationMarkdown: "다른 비유와 반례로 취약 개념을 다시 설명한다." } });
   const need = s.remediationConcepts.map(({ key, label }) => ({ key, label }));
   const questions = Array.from({ length: 5 }, (_, i) => ({ id: crypto.randomUUID(), conceptKey: need[i]?.key ?? `fix-${i + 1}`, conceptLabel: need[i]?.label ?? `보완 개념 ${i + 1}`, prompt: `보완 질문 ${i + 1}: 새 예제로 설명하세요.`, gradingCriteria: "핵심 원리와 적용 이유를 설명한다." }));
   s = startRemediationQuiz(db, dataRoot, { courseId: target.id, expectedRevision: s.course.revision, remediationMarkdown: "새 예제로 다시 적용한다.", questions });
   s = gradeQuiz(db, dataRoot, { courseId: target.id, expectedRevision: s.course.revision, attemptId: s.quizAttempts.at(-1).id, grades: questions.map((q) => ({ questionId: q.id, answer: `${q.conceptLabel} 답변`, result: "correct", feedback: "정확합니다." })) });
   const final = getLearningSnapshot(db, dataRoot, target.id);
   db.close();
   if (final.course.currentStage !== "reflection") process.exit(1);
   console.log(target.id);
   '
   ```

   Confirm the reflection form appears only in that stage, that submitting all three answers advances to the next Day and clears the fields, that submitting with one field emptied via devtools returns the Korean validation message with the other two answers preserved, and that a stale `expectedRevision` (edited in devtools) produces the conflict alert with all three answers intact.
5. Click `Codex에서 계속` and confirm `복사됨` appears and the clipboard holds `$just-study 계속`. Deny clipboard permission in the browser settings and confirm the manual-copy fallback text appears instead.

- [ ] **Step 5: Check the three viewports and the keyboard**

1. At 375px: the bottom navigation is visible with three items and safe-area padding, the sidebar is hidden, the course tab strip scrolls horizontally, and the page body does not scroll horizontally on any route. Every **standalone control** — buttons, navigation items, filter chips, course tabs, form fields, and action links such as `전체 보기`, `상태 화면에서 복구 방법 확인하기`, and `학습 기록 보기` — is at least 44px tall via `.tap-target`. Inline links inside a sentence of prose (breadcrumbs, source titles inside a table cell, links inside rendered Markdown) are exempt, matching WCAG 2.5.8's inline exception; verify they are still separated by at least 8px of vertical rhythm.
2. At 768px: the same mobile shell is used and cards reflow to two columns where specified.
3. At 1280px: the fixed sidebar is visible, the content is capped at 1280px, and the today tab splits into main and rail.
4. Keyboard only: `Tab` from page load reaches the skip link first, activating it moves focus into `#main`; `Tab` order then follows the visual order; every navigation item, filter chip, course tab, form field, and the theme radio group are reachable and operable with `Enter`/`Space`/arrow keys; the new-course dialog traps focus, closes with `Escape`, and returns focus to the `새 과정` button.
5. Confirm the focus ring is clearly visible on every focusable element in all three themes.

- [ ] **Step 6: Check the themes**

1. Clear `localStorage` and load `/`. Confirm the first paint is Focus with no flash of another theme.
2. Choose Calm in `/settings`, reload every route, and confirm Calm persists.
3. Choose Focus Dark, confirm `<html>` has `data-theme="focus-dark"` and the `dark` class, and that reload keeps it with no flash.
4. Set `localStorage['just-study:theme'] = 'nope'` and reload; confirm Focus renders.
5. Block `localStorage` (browser setting or private-mode restriction) and confirm the page still renders in Focus and the picker reports that it could not save.
6. Run an axe accessibility scan supplied by the browser/verification environment (not an added project dependency) on `/`, `/courses`, all six course tabs, `/settings`, and `/status` in all three themes. Zero serious or critical violations is required; record each route/theme result in `$justStudyEvidenceLedger`.

- [ ] **Step 7: Check the failure states**

1. Stop the server, save `justStudyUiDbMode="$(stat -f '%Lp' "$justStudyUiRoot/just-study.sqlite")"`, run `chmod 000 "$justStudyUiRoot/just-study.sqlite"`, restart, and confirm `/`, `/courses`, and `/courses/[id]` each show the database alert with a `/status` link and never an empty state. Restore with `chmod "$justStudyUiDbMode" "$justStudyUiRoot/just-study.sqlite"` and then set `justStudyUiDbMode=""`; the trap is the fallback if any check aborts.
2. Append a byte to one course's `journal.md`, reload `/courses/[id]?tab=journal`, and confirm the damaged-document alert appears, the prose is not shown, the structured tabs still work, and the file on disk is unchanged.
3. Confirm `/status` still reports the corrupt course.

- [ ] **Step 8: Stop the server and record evidence**

```bash
kill "$justStudyUiPid"
wait "$justStudyUiPid" || true
justStudyUiPid=""
```

Record in `$justStudyEvidenceLedger`: each checked item with pass/fail, the axe result per route and theme, permission/corruption setup and restoration, every screenshot path, and any defect found with the exact file fixed. Any fix must be made with TDD, must add or extend a test in `tests/dashboard.test.ts` when the defect is deterministic, and must be committed as `fix: <what>` before Task 14 starts. Keep `justStudyUiRoot` until Task 14 finishes.

- [ ] **Step 9: Commit any fixes**

```bash
git add <only the exact fixed files>
git commit -m "fix: <specific browser defect>"
```

If no defect was found, record that Task 13 produced verification evidence and no code change.

### Task 14: Independent phase review and gate

**Files:**

- Verify only: the Phase 4 commit range and the Task 13 evidence.

**Interfaces:**

- Consumes: the approved design, this plan, the commit range, and the Task 13 records.
- Produces: an independent score, findings, fixes, and a re-review until the gate passes.

- [ ] **Step 1: Run the full deterministic gate from a clean tree**

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
git diff --check
git status --short
git log --oneline <phase-base>..HEAD
```

Expected: everything passes and `git status` shows only the recorded pre-existing generated baseline artifacts `tsconfig.json`, `next-env.d.ts`, and `tsconfig.tsbuildinfo`; inspect them but never stage or commit them.

- [ ] **Step 2: Dispatch a fresh read-only reviewer**

Give a new reviewer with no implementation history only: the approved design document, this plan, the phase commit range, the complete diff, and the Task 13 evidence. Require this rubric:

```text
User value and product intent: 25
Information architecture and usability: 20
Responsive and accessibility: 20
Visual quality and theme consistency: 15
Data integrity and error recovery: 15
Performance and simplicity: 5
Pass: >=95/100, Critical 0, Important 0
```

Require the reviewer to check specifically:

- No screen derives status, progress, source scores, or quiz results from Markdown.
- Every write passes `expectedRevision`; no conflict is retried or overwritten; no partial SQLite/Markdown state is possible.
- The only writable values are the four approved ones.
- No raw HTML rendering, no unverified document rendered, no error converted to an empty state.
- No absolute path, checksum, SQL, or stack trace reaches the UI.
- No Phase 5 placeholder, empty menu, unused table, pomodoro artifact, or weekly-status widget exists.
- The three themes share one component tree and differ only in custom properties; Focus is the default; `focus-dark` sets both `data-theme` and `.dark`.
- Every new dependency is justified; nothing beyond `tailwindcss` and `@tailwindcss/postcss` was added.

- [ ] **Step 3: Fix findings with TDD and re-review**

Every Critical or Important finding gets a reproducing test first, then the minimal fix, then the full gate again, then a *different* fresh reviewer. Minor findings are either fixed or explicitly justified against the approved design in the ledger.

- [ ] **Step 4: Clean the temporary evidence root**

Revalidate that the recorded path begins exactly with `/private/tmp/just-study-dashboard-ui.` and delete only that directory. Report that its data and screenshots are unrecoverable. Never use a glob, an unresolved variable, a workspace path, or a home directory.

- [ ] **Step 5: Report the phase**

Report to the user: implementation result, key commits, test/lint/typecheck/build results, the independent score, known limitations, and the next phase. Do not push, open a PR, deploy, or call the overall product goal complete — Phase 5, Phase 6, and the final cross-phase E2E remain.

## Final Evidence Checklist

- [ ] `getDashboardOverview` and `getCourseHistory` are the only new read functions and neither reads Markdown or leaks a path or checksum.
- [ ] `getLearningSnapshot` behavior is unchanged after the loader extraction, proven by the untouched learning-engine tests.
- [ ] The view model is pure, has no filesystem or database import, and owns every label, priority, and normalization rule.
- [ ] Draft cards never show a fabricated Day, stage, or 0% progress.
- [ ] Attention ordering is remediation, reflection, in-progress quiz, waiting quiz, draft, lecture, capped at three, tie-broken by `updatedAt`.
- [ ] `selectedSourceCount` deduplicates normalized URLs across all courses.
- [ ] Markdown is parsed by one parser that never emits HTML and keeps unsafe URLs as text.
- [ ] A checksum failure shows a recovery alert, hides only the prose, and never overwrites the file.
- [ ] `updateCourseDraft` and `completeDay` are the only domain writes from the UI, both revision-checked and atomic across SQLite and Markdown.
- [ ] A revision conflict preserves the user's input and offers an explicit reload.
- [ ] Focus is the default, all three themes persist across reload, and there is no first-paint flash.
- [ ] Sidebar at >=1024px and context bar plus bottom navigation below it come from one component tree.
- [ ] 375px, 768px, and 1280px pass with no horizontal body scroll and 44px targets.
- [ ] Keyboard-only operation covers skip link, navigation, tabs, filters, dialog, forms, and theme picker.
- [ ] axe reports zero serious or critical violations on every route in every theme.
- [ ] Only `tailwindcss` and `@tailwindcss/postcss` were added.
- [ ] No Phase 5 or pomodoro artifact exists anywhere in the diff.
- [ ] Focused tests, full tests, lint, typecheck, and build pass at the final commit.
- [ ] Independent score is >=95/100 with Critical 0 and Important 0.
