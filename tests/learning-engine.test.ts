import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { UUID_PATTERN, createCourse } from "../src/server/courses.ts";
import {
  LearningRevisionConflictError,
  LearningStateError,
  LearningValidationError,
  approveOutline,
  completeDay,
  getLearningSnapshot,
  gradeQuiz,
  recordDailyResearch,
  saveLearningCheckpoint,
  startQuiz,
  startRemediationQuiz,
  type ApproveOutlineInput,
  type LearningSnapshot,
  type QuestionGradeInput,
  type QuizAttempt,
  type ResearchBundleInput,
} from "../src/server/learning.ts";
import {
  openDatabase,
  SCHEMA_VERSION,
  type DatabaseHandle,
} from "../src/server/database.ts";
import { getHealth } from "../src/server/health.ts";
import {
  applyMarkdownUpdate,
  completeMarkdownUpdate,
  listTemporaryEntries,
  prepareMarkdownUpdate,
  readVerifiedMarkdown,
  rollbackMarkdownUpdate,
} from "../src/server/storage.ts";

function withDataRoot(run: (dataRoot: string, db: DatabaseHandle) => void): void {
  const dataRoot = mkdtempSync(join(tmpdir(), "just-study-learning-"));
  const db = openDatabase(dataRoot);
  try {
    run(dataRoot, db);
  } finally {
    if (db.open) db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
}

function createShell(db: DatabaseHandle, dataRoot: string) {
  return createCourse(db, dataRoot, {
    requestId: crypto.randomUUID(),
    title: "비전공자를 위한 컴퓨터 과학",
    goal: "핵심 개념을 설명하고 작은 시스템을 설계한다.",
  }).course;
}

const DAY_OBJECTIVES = Array.from({ length: 30 }, (_, index) => ({
  objective: `컴퓨터 과학 핵심 목표 ${index + 1}을 자기 말로 설명한다`,
}));

const CS_NON_MAJOR_OBJECTIVES = [
  "시스템과 추상화의 관계를 자기 말로 설명한다",
  "이진수로 정보가 표현되는 원리를 설명한다",
  "불 논리로 간단한 조건을 계산한다",
  "알고리즘을 명확한 단계로 표현한다",
  "변수와 제어 흐름으로 작은 절차를 추적한다",
  "함수로 문제를 분해하는 이유를 설명한다",
  "디버깅과 테스트로 오류를 좁힌다",
  "시간 복잡도로 두 접근을 비교한다",
  "배열과 리스트의 접근 특성을 비교한다",
  "스택과 큐를 알맞은 문제에 적용한다",
  "해시 테이블의 조회 원리를 설명한다",
  "재귀 호출의 종료 조건을 설계한다",
  "트리 구조로 계층 데이터를 표현한다",
  "그래프로 관계와 경로를 표현한다",
  "검색과 정렬 방법을 입력 특성에 맞게 고른다",
  "메모리와 프로세스의 역할을 구분한다",
  "운영체제가 자원을 중재하는 방식을 설명한다",
  "동시성에서 공유 상태 문제가 생기는 이유를 설명한다",
  "파일과 영구 저장의 차이를 설명한다",
  "관계형 데이터베이스의 테이블 관계를 설계한다",
  "SQL로 필요한 데이터를 질의한다",
  "네트워크에서 계층과 주소의 역할을 설명한다",
  "HTTP 요청과 응답의 흐름을 추적한다",
  "입력 검증과 최소 권한을 보안 사례에 적용한다",
  "모듈 경계로 변경 영향을 줄이는 방법을 설명한다",
  "Git으로 변경 이력을 안전하게 공유한다",
  "API 계약으로 두 프로그램의 협업을 설명한다",
  "데이터와 AI 모델의 기본 관계를 설명한다",
  "작은 캡스톤 시스템의 구조를 설계한다",
  "캡스톤을 구현하고 선택한 구조를 설명한다",
] as const;

function validResearch(): ResearchBundleInput {
  const firstId = crypto.randomUUID();
  const secondId = crypto.randomUUID();
  return {
    questions: ["핵심 개념은 무엇인가?", "어떤 순서로 학습해야 하는가?"],
    topicCriteria: ["공식·대학 자료를 우선한다", "실행 가능한 예제를 포함한다"],
    narrativeMarkdown: "컴퓨터 과학은 계산과 정보 시스템을 다룬다.",
    sources: [
      {
        id: firstId,
        url: "https://cs.example.edu/foundations",
        title: "Computer Science Foundations",
        publisher: "Example University",
        independenceKey: "example-university",
        scores: {
          authority: 24,
          crossValidation: 23,
          relevance: 19,
          teachingQuality: 14,
          currency: 9,
          accessibility: 5,
        },
        rank: 1,
        selected: true,
        selectionReason: "대학의 공개 기초 과정이며 예제와 선수 지식 설명이 명확하다.",
        limitation: null,
      },
      {
        id: secondId,
        url: "https://standards.example.org/computing",
        title: "Computing Curriculum",
        publisher: "Independent Standards Group",
        independenceKey: "standards-group",
        scores: {
          authority: 23,
          crossValidation: 24,
          relevance: 18,
          teachingQuality: 13,
          currency: 9,
          accessibility: 5,
        },
        rank: 2,
        selected: true,
        selectionReason: "독립 교육 표준이 핵심 개념과 학습 순서를 뒷받침한다.",
        limitation: null,
      },
    ],
    claims: [{
      id: crypto.randomUUID(),
      statement: "추상화와 문제 분해가 이후 주제의 공통 기반이다.",
      major: true,
      conclusion: "두 독립 자료가 기초 단계의 공통 출발점으로 제시한다.",
      uncertainty: null,
      evidence: [
        { sourceId: firstId, stance: "supports" },
        { sourceId: secondId, stance: "supports" },
      ],
    }],
  };
}

function validApproval(courseId: string): ApproveOutlineInput {
  return {
    courseId,
    expectedRevision: 0,
    priorKnowledge: "웹을 사용하지만 컴퓨터 과학을 체계적으로 배운 적은 없다.",
    learningPreference: "examples",
    knowledgeMapMarkdown: "정보 표현 → 알고리즘 → 시스템 → 네트워크",
    research: validResearch(),
    days: DAY_OBJECTIVES,
  };
}

function activateCourse(db: DatabaseHandle, dataRoot: string) {
  const shell = createShell(db, dataRoot);
  return approveOutline(db, dataRoot, validApproval(shell.id));
}

function dailyResearch(dayNumber: number): ResearchBundleInput {
  const bundle = validResearch();
  bundle.questions = [`Day ${dayNumber} 목표를 설명하는 핵심 질문은 무엇인가?`];
  bundle.topicCriteria = ["공식 자료와 실행 가능한 예제를 우선한다"];
  bundle.narrativeMarkdown = `Day ${dayNumber} 심화 조사 본문`;
  bundle.sources = bundle.sources.map((source, index) => ({
    ...source,
    id: crypto.randomUUID(),
    url: `${source.url}/day-${dayNumber}-${index + 1}`,
  }));
  bundle.claims = [{
    ...bundle.claims[0]!,
    id: crypto.randomUUID(),
    evidence: bundle.sources.map(({ id }) => ({ sourceId: id, stance: "supports" as const })),
  }];
  return bundle;
}

function withLocalResearchKeys(bundle: ResearchBundleInput): ResearchBundleInput {
  const sourceKeys = new Map(bundle.sources.map((source, index) => [source.id, `s-${index + 1}`]));
  return {
    ...bundle,
    sources: bundle.sources.map((source, index) => ({ ...source, id: `s-${index + 1}` })),
    claims: bundle.claims.map((claim, index) => ({
      ...claim,
      id: `c-${index + 1}`,
      evidence: claim.evidence.map((evidence) => ({ ...evidence, sourceId: sourceKeys.get(evidence.sourceId)! })),
    })),
  };
}

function quizQuestions(prefix: string) {
  return Array.from({ length: 5 }, (_, index) => ({
    id: crypto.randomUUID(),
    conceptKey: `concept-${index + 1}`,
    conceptLabel: `개념 ${index + 1}`,
    prompt: `${prefix} 문제 ${index + 1}`,
    gradingCriteria: `${prefix} 기준 ${index + 1}을 정확히 설명한다`,
  }));
}

function readyForQuiz(db: DatabaseHandle, dataRoot: string) {
  let snapshot = activateCourse(db, dataRoot);
  snapshot = recordDailyResearch(db, dataRoot, {
    courseId: snapshot.course.id,
    expectedRevision: snapshot.course.revision,
    research: dailyResearch(1),
  });
  return saveLearningCheckpoint(db, dataRoot, {
    courseId: snapshot.course.id,
    expectedRevision: snapshot.course.revision,
    lesson: {
      recallMarkdown: "Day 1 선수 지식을 떠올렸다.",
      preciseExplanationMarkdown: "Day 1 정확한 설명",
      eli5Markdown: "Day 1 ELI5 설명",
      analogyMarkdown: "Day 1 비유",
      exampleMarkdown: "Day 1 구체적 예제",
      applicationMarkdown: "Day 1 사용자 적용",
      interviewMarkdown: "Day 1 사용자 자기 설명과 피드백",
    },
    understoodConcepts: [],
    remediationConcepts: [],
  });
}

function lessonCheckpoint(dayNumber: number) {
  return {
    recallMarkdown: `Day ${dayNumber} 전날 핵심 개념 회상`,
    preciseExplanationMarkdown: `Day ${dayNumber} 정확한 설명`,
    eli5Markdown: `Day ${dayNumber} ELI5 설명`,
    analogyMarkdown: `Day ${dayNumber} 비유`,
    exampleMarkdown: `Day ${dayNumber} 구체적 예제`,
    applicationMarkdown: `Day ${dayNumber} 사용자 적용`,
    interviewMarkdown: `Day ${dayNumber} 사용자 자기 설명과 피드백`,
  };
}

function reflection(dayNumber: number) {
  return {
    learned: `Day ${dayNumber}에는 핵심 원리를 배웠다.`,
    confusing: `Day ${dayNumber}의 경계 조건은 더 연습하고 싶다.`,
    feeling: `Day ${dayNumber} 공부를 마친 실제 소감이다.`,
  };
}

function passCurrentDayQuiz(db: DatabaseHandle, dataRoot: string) {
  let snapshot = readyForQuiz(db, dataRoot);
  snapshot = startQuiz(db, dataRoot, {
    courseId: snapshot.course.id,
    expectedRevision: snapshot.course.revision,
    questions: quizQuestions("Day 1 통과"),
  });
  return gradeQuiz(db, dataRoot, {
    courseId: snapshot.course.id,
    expectedRevision: snapshot.course.revision,
    attemptId: snapshot.quizAttempts.at(-1)!.id,
    grades: terminalGrades(snapshot.quizAttempts.at(-1)!),
  });
}

function passSnapshotDay(
  db: DatabaseHandle,
  dataRoot: string,
  initial: LearningSnapshot,
  dayNumber: number,
) {
  let snapshot = recordDailyResearch(db, dataRoot, {
    courseId: initial.course.id,
    expectedRevision: initial.course.revision,
    research: dailyResearch(dayNumber),
  });
  snapshot = saveLearningCheckpoint(db, dataRoot, {
    courseId: snapshot.course.id,
    expectedRevision: snapshot.course.revision,
    lesson: lessonCheckpoint(dayNumber),
    understoodConcepts: [],
    remediationConcepts: [],
  });
  snapshot = startQuiz(db, dataRoot, {
    courseId: snapshot.course.id,
    expectedRevision: snapshot.course.revision,
    questions: quizQuestions(`Day ${dayNumber} 통과`),
  });
  return gradeQuiz(db, dataRoot, {
    courseId: snapshot.course.id,
    expectedRevision: snapshot.course.revision,
    attemptId: snapshot.quizAttempts.at(-1)!.id,
    grades: terminalGrades(snapshot.quizAttempts.at(-1)!),
  });
}

function terminalGrades(attempt: QuizAttempt, incorrectPosition?: number): QuestionGradeInput[] {
  return attempt.questions.map((question) => ({
    questionId: question.id,
    answer: `${question.position}번 답변`,
    result: question.position === incorrectPosition ? "incorrect" : "correct",
    feedback: question.position === incorrectPosition ? "개념 적용을 보완해야 한다." : "정확하다.",
  }));
}

function seedVersionOne(dataRoot: string): string {
  const databasePath = join(dataRoot, "just-study.sqlite");
  const seeded = new Database(databasePath);
  seeded.exec(`
    CREATE TABLE courses (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
      goal TEXT NOT NULL CHECK(length(goal) BETWEEN 1 AND 2000),
      markdown_path TEXT NOT NULL UNIQUE,
      markdown_sha256 TEXT NOT NULL CHECK(length(markdown_sha256) = 64),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO courses VALUES (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '기존 과정',
      '기존 목표',
      'courses/11111111-1111-4111-8111-111111111111/course.md',
      '${"a".repeat(64)}',
      '2026-07-31T00:00:00.000Z',
      '2026-07-31T00:00:00.000Z'
    );
    PRAGMA user_version = 1;
  `);
  seeded.close();
  return databasePath;
}

test("migrates a version-1 course without changing its identity or checksum", () => {
  const dataRoot = mkdtempSync(join(tmpdir(), "just-study-v1-"));
  seedVersionOne(dataRoot);

  const db = openDatabase(dataRoot);
  try {
    const row = db.prepare("SELECT * FROM courses").get() as Record<string, unknown>;
    assert.equal(db.pragma("user_version", { simple: true }), 2);
    assert.equal(row.id, "11111111-1111-4111-8111-111111111111");
    assert.equal(row.markdown_sha256, "a".repeat(64));
    assert.equal(row.status, "draft");
    assert.equal(row.revision, 0);
    assert.equal(row.current_day_id, null);
    assert.equal(row.current_stage, null);
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("creates the complete version-2 learning schema", () => {
  withDataRoot((_dataRoot, db) => {
    assert.equal(SCHEMA_VERSION, 2);
    assert.equal(db.pragma("user_version", { simple: true }), 2);
    const names = (
      db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      ).all() as { name: string }[]
    ).map(({ name }) => name);
    for (const name of [
      "course_days",
      "day_concepts",
      "day_lesson_parts",
      "quiz_attempts",
      "quiz_questions",
      "quiz_responses",
      "research_claim_evidence",
      "research_claims",
      "research_runs",
      "research_sources",
    ]) {
      assert.ok(names.includes(name), name);
    }
  });
});

test("new course shells start as revision-zero drafts", () => {
  withDataRoot((dataRoot, db) => {
    const course = createShell(db, dataRoot);
    assert.equal(course.status, "draft");
    assert.equal(course.currentDayId, null);
    assert.equal(course.currentStage, null);
    assert.equal(course.revision, 0);
    assert.equal(course.progressMarkdownPath, null);
    assert.equal(course.journalMarkdownPath, null);
    assert.equal(course.currentDayMarkdownPath, null);
  });
});

test("database constraints reject cross-course Day ownership", () => {
  withDataRoot((dataRoot, db) => {
    const first = createShell(db, dataRoot);
    const second = createShell(db, dataRoot);
    const firstDay = crypto.randomUUID();
    const secondDay = crypto.randomUUID();
    const insertDay = db.prepare(`
      INSERT INTO course_days (id, course_id, day_number, objective)
      VALUES (?, ?, 1, 'one objective')
    `);
    insertDay.run(firstDay, first.id);
    insertDay.run(secondDay, second.id);

    assert.throws(
      () => db.prepare("UPDATE courses SET current_day_id = ? WHERE id = ?")
        .run(secondDay, first.id),
      /current Day belongs to another course/,
    );
    assert.throws(
      () => db.prepare(`
        INSERT INTO research_runs (
          id, course_id, day_id, scope, questions_json, topic_criteria_json, created_at
        ) VALUES (?, ?, ?, 'day', '["question"]', '["criterion"]', ?)
      `).run(crypto.randomUUID(), first.id, secondDay, new Date().toISOString()),
      /FOREIGN KEY constraint failed/,
    );
  });
});

test("rolls back a forced version-2 migration failure", { concurrency: false }, () => {
  const dataRoot = mkdtempSync(join(tmpdir(), "just-study-v1-failure-"));
  const path = seedVersionOne(dataRoot);

  const originalPragma = Database.prototype.pragma;
  const originalClose = Database.prototype.close;
  let closed = false;
  Database.prototype.pragma = function (
    this: Database.Database,
    source: string,
    options?: Database.PragmaOptions,
  ): unknown {
    if (source === "user_version = 2") throw new Error("forced v2 migration failure");
    return originalPragma.call(this, source, options);
  };
  Database.prototype.close = function (this: Database.Database): Database.Database {
    closed = true;
    return originalClose.call(this);
  };

  try {
    assert.throws(() => openDatabase(dataRoot), /forced v2 migration failure/);
    assert.equal(closed, true);
  } finally {
    Database.prototype.pragma = originalPragma;
    Database.prototype.close = originalClose;
  }

  const db = new Database(path);
  try {
    assert.equal(db.pragma("user_version", { simple: true }), 1);
    const columns = (
      db.prepare("PRAGMA table_info(courses)").all() as { name: string }[]
    ).map(({ name }) => name);
    assert.equal(columns.includes("status"), false);
    assert.equal(
      (db.prepare("SELECT title FROM courses").get() as { title: string }).title,
      "기존 과정",
    );
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("health validates learning-document registrations by lifecycle status", () => {
  withDataRoot((dataRoot, db) => {
    const course = createShell(db, dataRoot);
    const checksum = (content: string) => createHash("sha256").update(content).digest("hex");
    const progressPath = `courses/${course.id}/progress.md`;
    const journalPath = `courses/${course.id}/journal.md`;
    const currentDayPath = `courses/${course.id}/current-day.md`;

    db.prepare("UPDATE courses SET progress_markdown_path = ? WHERE id = ?")
      .run(progressPath, course.id);
    assert.deepEqual(getHealth(db, dataRoot).corruptCourseIds, [course.id]);

    const progress = "# Progress\n";
    const journal = "# Journal\n";
    const currentDay = "# Day 1\n";
    writeFileSync(join(dataRoot, progressPath), progress, "utf8");
    writeFileSync(join(dataRoot, journalPath), journal, "utf8");
    writeFileSync(join(dataRoot, currentDayPath), currentDay, "utf8");
    db.prepare(`
      UPDATE courses SET
        status = 'active',
        progress_markdown_path = ?, progress_markdown_sha256 = ?,
        journal_markdown_path = ?, journal_markdown_sha256 = ?,
        current_day_markdown_path = ?, current_day_markdown_sha256 = ?
      WHERE id = ?
    `).run(
      progressPath, checksum(progress), journalPath, checksum(journal),
      currentDayPath, checksum(currentDay), course.id,
    );
    assert.deepEqual(getHealth(db, dataRoot).corruptCourseIds, []);

    db.prepare("UPDATE courses SET status = 'completed' WHERE id = ?").run(course.id);
    assert.deepEqual(getHealth(db, dataRoot).corruptCourseIds, [course.id]);
  });
});

test("stages and applies a verified multi-file Markdown update", () => {
  withDataRoot((dataRoot, db) => {
    const course = createShell(db, dataRoot);
    const update = prepareMarkdownUpdate(dataRoot, course.id, [
      {
        file: "course.md",
        expectedSha256: course.markdownSha256,
        content: "# 승인된 과정\n",
      },
      {
        file: "progress.md",
        expectedSha256: null,
        content: "# 진도\n",
      },
      {
        file: "journal.md",
        expectedSha256: null,
        content: "# 학습 기록\n",
      },
      {
        file: "current-day.md",
        expectedSha256: null,
        content: "# Day 1\n",
      },
    ]);
    applyMarkdownUpdate(update);
    completeMarkdownUpdate(update);

    assert.equal(
      readVerifiedMarkdown(dataRoot, `courses/${course.id}/course.md`, update.checksums["course.md"]!),
      "# 승인된 과정\n",
    );
    assert.equal(readFileSync(join(dataRoot, "courses", course.id, "progress.md"), "utf8"), "# 진도\n");
    assert.equal(readFileSync(join(dataRoot, "courses", course.id, "journal.md"), "utf8"), "# 학습 기록\n");
    assert.equal(readFileSync(join(dataRoot, "courses", course.id, "current-day.md"), "utf8"), "# Day 1\n");
    assert.deepEqual(listTemporaryEntries(dataRoot), []);
  });
});

test("rolls every applied Markdown file back to its verified content", () => {
  withDataRoot((dataRoot, db) => {
    const course = createShell(db, dataRoot);
    const original = readFileSync(join(dataRoot, course.markdownPath), "utf8");
    const update = prepareMarkdownUpdate(dataRoot, course.id, [
      {
        file: "course.md",
        expectedSha256: course.markdownSha256,
        content: "# replacement\n",
      },
      {
        file: "progress.md",
        expectedSha256: null,
        content: "# progress\n",
      },
    ]);
    applyMarkdownUpdate(update);
    rollbackMarkdownUpdate(update);

    assert.equal(readFileSync(join(dataRoot, course.markdownPath), "utf8"), original);
    assert.throws(
      () => readFileSync(join(dataRoot, "courses", course.id, "progress.md"), "utf8"),
      { code: "ENOENT" },
    );
    assert.deepEqual(listTemporaryEntries(dataRoot), []);
  });
});

test("rejects stale checksums before touching any course file", () => {
  withDataRoot((dataRoot, db) => {
    const course = createShell(db, dataRoot);
    const original = readFileSync(join(dataRoot, course.markdownPath), "utf8");
    assert.throws(() =>
      prepareMarkdownUpdate(dataRoot, course.id, [{
        file: "course.md",
        expectedSha256: "0".repeat(64),
        content: "# must not write\n",
      }]),
    );
    assert.equal(readFileSync(join(dataRoot, course.markdownPath), "utf8"), original);
    assert.deepEqual(listTemporaryEntries(dataRoot), []);
  });
});

test("deletes current-day Markdown only after an applied update", () => {
  withDataRoot((dataRoot, db) => {
    const course = createShell(db, dataRoot);
    const create = prepareMarkdownUpdate(dataRoot, course.id, [{
      file: "current-day.md",
      expectedSha256: null,
      content: "# Day 30\n",
    }]);
    applyMarkdownUpdate(create);
    completeMarkdownUpdate(create);
    const remove = prepareMarkdownUpdate(dataRoot, course.id, [{
      file: "current-day.md",
      expectedSha256: create.checksums["current-day.md"]!,
      content: null,
    }]);
    applyMarkdownUpdate(remove);
    completeMarkdownUpdate(remove);
    assert.throws(
      () => readFileSync(join(dataRoot, "courses", course.id, "current-day.md"), "utf8"),
      { code: "ENOENT" },
    );
  });
});

test("restores all files when SQLite COMMIT fails after apply", () => {
  withDataRoot((dataRoot, db) => {
    const course = createShell(db, dataRoot);
    const original = readFileSync(join(dataRoot, course.markdownPath), "utf8");
    db.exec(`
      CREATE TABLE learning_commit_parent (id INTEGER PRIMARY KEY);
      CREATE TABLE learning_commit_gate (
        course_id TEXT NOT NULL,
        missing_parent INTEGER NOT NULL,
        FOREIGN KEY (missing_parent) REFERENCES learning_commit_parent(id)
          DEFERRABLE INITIALLY DEFERRED
      );
      CREATE TRIGGER fail_learning_commit
      AFTER UPDATE OF revision ON courses
      BEGIN
        INSERT INTO learning_commit_gate (course_id, missing_parent)
        VALUES (NEW.id, 1);
      END;
    `);
    const update = prepareMarkdownUpdate(dataRoot, course.id, [
      {
        file: "course.md",
        expectedSha256: course.markdownSha256,
        content: "# replacement\n",
      },
      {
        file: "progress.md",
        expectedSha256: null,
        content: "# progress\n",
      },
    ]);

    assert.throws(() => db.transaction(() => {
      applyMarkdownUpdate(update);
      db.prepare("UPDATE courses SET revision = revision + 1 WHERE id = ?")
        .run(course.id);
    })(), /FOREIGN KEY constraint failed/);
    rollbackMarkdownUpdate(update);

    assert.equal(readFileSync(join(dataRoot, course.markdownPath), "utf8"), original);
    assert.equal(
      (db.prepare("SELECT revision FROM courses WHERE id = ?").get(course.id) as {
        revision: number;
      }).revision,
      0,
    );
    assert.throws(
      () => readFileSync(join(dataRoot, "courses", course.id, "progress.md"), "utf8"),
      { code: "ENOENT" },
    );
    assert.deepEqual(listTemporaryEntries(dataRoot), []);
  });
});

test("rejects symlinked, invalid, and duplicate update targets before staging", () => {
  withDataRoot((dataRoot, db) => {
    const course = createShell(db, dataRoot);
    const outside = join(dataRoot, "outside.md");
    writeFileSync(outside, "# outside\n", "utf8");
    unlinkSync(join(dataRoot, course.markdownPath));
    symlinkSync(outside, join(dataRoot, course.markdownPath));

    assert.throws(() => prepareMarkdownUpdate(dataRoot, course.id, [{
      file: "course.md",
      expectedSha256: course.markdownSha256,
      content: "# replacement\n",
    }]), /symbolic link/);
    assert.throws(() => prepareMarkdownUpdate(dataRoot, "../outside", [{
      file: "progress.md",
      expectedSha256: null,
      content: "# progress\n",
    }]), /Invalid course ID/);
    assert.throws(() => prepareMarkdownUpdate(dataRoot, course.id, [
      { file: "progress.md", expectedSha256: null, content: "# one\n" },
      { file: "progress.md", expectedSha256: null, content: "# two\n" },
    ]), /duplicate Markdown filename/);
    assert.deepEqual(listTemporaryEntries(dataRoot), []);
  });
});

test("terminalizes a committed update when cleanup leaves symlinked residue", () => {
  withDataRoot((dataRoot, db) => {
    const course = createShell(db, dataRoot);
    const update = prepareMarkdownUpdate(dataRoot, course.id, [{
      file: "course.md",
      expectedSha256: course.markdownSha256,
      content: "# committed\n",
    }]);
    applyMarkdownUpdate(update);
    const [draftName] = listTemporaryEntries(dataRoot);
    const draftRoot = join(dataRoot, "tmp", draftName);
    const outside = join(dataRoot, "outside.md");
    writeFileSync(outside, "# outside\n", "utf8");
    rmSync(draftRoot, { recursive: true, force: true });
    symlinkSync(outside, draftRoot);

    completeMarkdownUpdate(update);

    assert.equal(readFileSync(join(dataRoot, course.markdownPath), "utf8"), "# committed\n");
    assert.throws(() => listTemporaryEntries(dataRoot), /symbolic link/);
    assert.equal(getHealth(db, dataRoot).storage, "error");
    assert.throws(() => rollbackMarkdownUpdate(update), /Invalid Markdown update/);
    assert.equal(readFileSync(join(dataRoot, course.markdownPath), "utf8"), "# committed\n");
  });
});

test("rejects a symlinked rollback draft before touching update targets", () => {
  withDataRoot((dataRoot, db) => {
    const course = createShell(db, dataRoot);
    const original = readFileSync(join(dataRoot, course.markdownPath), "utf8");
    const update = prepareMarkdownUpdate(dataRoot, course.id, [{
      file: "course.md",
      expectedSha256: course.markdownSha256,
      content: "# replacement\n",
    }]);
    applyMarkdownUpdate(update);
    const [draftName] = listTemporaryEntries(dataRoot);
    const draftRoot = join(dataRoot, "tmp", draftName);
    const preservedDraftRoot = join(dataRoot, "tmp", `${draftName}-preserved`);
    const outside = join(dataRoot, "outside.md");
    writeFileSync(outside, "# outside\n", "utf8");
    renameSync(draftRoot, preservedDraftRoot);
    symlinkSync(outside, draftRoot);

    assert.throws(() => rollbackMarkdownUpdate(update), /symbolic link/);

    assert.equal(readFileSync(join(dataRoot, course.markdownPath), "utf8"), "# replacement\n");
    assert.throws(() => listTemporaryEntries(dataRoot), /symbolic link/);
    assert.equal(getHealth(db, dataRoot).storage, "error");
    unlinkSync(draftRoot);
    renameSync(preservedDraftRoot, draftRoot);
    rollbackMarkdownUpdate(update);
    assert.equal(readFileSync(join(dataRoot, course.markdownPath), "utf8"), original);
    assert.deepEqual(listTemporaryEntries(dataRoot), []);
  });
});

test("rejects a symlinked rollback backup before touching update targets", () => {
  withDataRoot((dataRoot, db) => {
    const course = createShell(db, dataRoot);
    const original = readFileSync(join(dataRoot, course.markdownPath), "utf8");
    const update = prepareMarkdownUpdate(dataRoot, course.id, [{
      file: "course.md",
      expectedSha256: course.markdownSha256,
      content: "# replacement\n",
    }]);
    applyMarkdownUpdate(update);
    const [draftName] = listTemporaryEntries(dataRoot);
    const backup = join(dataRoot, "tmp", draftName, "backup", "course.md");
    const preservedBackup = `${backup}.preserved`;
    const outside = join(dataRoot, "outside.md");
    writeFileSync(outside, "# outside\n", "utf8");
    renameSync(backup, preservedBackup);
    symlinkSync(outside, backup);

    assert.throws(() => rollbackMarkdownUpdate(update), /symbolic link/);

    assert.equal(readFileSync(join(dataRoot, course.markdownPath), "utf8"), "# replacement\n");
    unlinkSync(backup);
    renameSync(preservedBackup, backup);
    rollbackMarkdownUpdate(update);
    assert.equal(readFileSync(join(dataRoot, course.markdownPath), "utf8"), original);
  });
});

test("rejects a missing rollback backup before touching update targets", () => {
  withDataRoot((dataRoot, db) => {
    const course = createShell(db, dataRoot);
    const original = readFileSync(join(dataRoot, course.markdownPath), "utf8");
    const update = prepareMarkdownUpdate(dataRoot, course.id, [{
      file: "course.md",
      expectedSha256: course.markdownSha256,
      content: "# replacement\n",
    }]);
    applyMarkdownUpdate(update);
    const [draftName] = listTemporaryEntries(dataRoot);
    const backup = join(dataRoot, "tmp", draftName, "backup", "course.md");
    const preservedBackup = `${backup}.preserved`;
    renameSync(backup, preservedBackup);

    assert.throws(() => rollbackMarkdownUpdate(update), /Markdown update backup is missing/);

    assert.equal(readFileSync(join(dataRoot, course.markdownPath), "utf8"), "# replacement\n");
    renameSync(preservedBackup, backup);
    rollbackMarkdownUpdate(update);
    assert.equal(readFileSync(join(dataRoot, course.markdownPath), "utf8"), original);
    assert.deepEqual(listTemporaryEntries(dataRoot), []);
  });
});

test("approves exactly 30 objectives and activates only Day 1", () => {
  withDataRoot((dataRoot, db) => {
    const shell = createShell(db, dataRoot);
    const snapshot = approveOutline(db, dataRoot, validApproval(shell.id));
    assert.equal(snapshot.course.status, "active");
    assert.equal(snapshot.course.revision, 1);
    assert.equal(snapshot.course.currentStage, "lecture");
    assert.equal(snapshot.currentDay?.dayNumber, 1);
    assert.equal(snapshot.days.length, 30);
    assert.equal(snapshot.days.filter(({ completedAt }) => completedAt !== null).length, 0);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM research_runs").get() as { count: number }).count,
      1,
    );
    assert.match(snapshot.documents.course, /## 30일 목차/);
    assert.match(snapshot.documents.course, /Computer Science Foundations/);
    assert.match(snapshot.documents.progress!, /Day 1\/30/);
    assert.equal(snapshot.documents.journal, "# 학습 기록\n");
    assert.match(snapshot.documents.currentDay!, /# Day 1/);
  });
});

test("rejects an outline that does not contain exactly 30 Days", () => {
  withDataRoot((dataRoot, db) => {
    const shell = createShell(db, dataRoot);
    for (const count of [29, 31]) {
      const input = validApproval(shell.id);
      input.days = DAY_OBJECTIVES.slice(0, count);
      if (count === 31) input.days = [...DAY_OBJECTIVES, { objective: "Day 31" }];
      assert.throws(() => approveOutline(db, dataRoot, input), LearningValidationError);
    }
    assert.equal(getLearningSnapshot(db, dataRoot, shell.id)?.course.status, "draft");
  });
});

test("requires a limitation for a selected source scoring below 80", () => {
  withDataRoot((dataRoot, db) => {
    const shell = createShell(db, dataRoot);
    const input = validApproval(shell.id);
    input.research.sources[0]!.scores.authority = 0;
    assert.throws(() => approveOutline(db, dataRoot, input), LearningValidationError);
    input.research.sources[0]!.limitation = "권위 점수가 낮아 독립 표준 자료로만 보완한다.";
    input.research.sources[0]!.rank = 2;
    input.research.sources[1]!.rank = 1;
    input.research.claims = input.research.claims.map((claim) => ({ ...claim, major: false }));
    assert.equal(approveOutline(db, dataRoot, input).course.status, "active");
  });
});

test("requires two independent high-scoring supports for every major claim", () => {
  withDataRoot((dataRoot, db) => {
    const shell = createShell(db, dataRoot);
    const input = validApproval(shell.id);
    input.research.sources[1]!.independenceKey = input.research.sources[0]!.independenceKey;
    assert.throws(() => approveOutline(db, dataRoot, input), LearningValidationError);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM course_days").get() as { count: number }).count,
      0,
    );
  });
});

test("normalizes independence keys before checking major-claim support", () => {
  withDataRoot((dataRoot, db) => {
    const shell = createShell(db, dataRoot);
    const original = readFileSync(join(dataRoot, shell.markdownPath), "utf8");
    const input = validApproval(shell.id);
    input.research.sources[0]!.independenceKey = "same";
    input.research.sources[1]!.independenceKey = " same ";

    assert.throws(() => approveOutline(db, dataRoot, input), LearningValidationError);
    assert.equal(getLearningSnapshot(db, dataRoot, shell.id)?.course.status, "draft");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM course_days").get() as { count: number }).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM research_runs").get() as { count: number }).count, 0);
    assert.equal(readFileSync(join(dataRoot, shell.markdownPath), "utf8"), original);
  });
});

test("persists opposing evidence and explicit uncertainty", () => {
  withDataRoot((dataRoot, db) => {
    const shell = createShell(db, dataRoot);
    const input = validApproval(shell.id);
    input.research.claims = [{
      ...input.research.claims[0]!,
      major: false,
      uncertainty: "초보자에게 가장 좋은 첫 개념의 표현은 자료마다 다르다.",
      evidence: [
        input.research.claims[0]!.evidence[0]!,
        { sourceId: input.research.sources[1]!.id, stance: "opposes" },
      ],
    }];
    const snapshot = approveOutline(db, dataRoot, input);
    assert.match(snapshot.documents.course, /초보자에게 가장 좋은 첫 개념/);
    assert.equal(
      (db.prepare(
        "SELECT COUNT(*) AS count FROM research_claim_evidence WHERE stance = 'opposes'",
      ).get() as { count: number }).count,
      1,
    );
  });
});

test("canonicalizes reusable local research keys on every persisted run", () => {
  withDataRoot((dataRoot, db) => {
    const shell = createShell(db, dataRoot);
    const approval = validApproval(shell.id);
    approval.research = withLocalResearchKeys(approval.research);
    let snapshot = approveOutline(db, dataRoot, approval);
    const courseRun = snapshot.researchRuns[0]!;

    const daily = withLocalResearchKeys(dailyResearch(1));
    snapshot = recordDailyResearch(db, dataRoot, {
      courseId: shell.id,
      expectedRevision: snapshot.course.revision,
      research: daily,
    });
    const dayRun = snapshot.researchRuns.find(({ scope }) => scope === "day")!;

    const sourceIds = [...courseRun.sources, ...dayRun.sources].map(({ id }) => id);
    const claimIds = [...courseRun.claims, ...dayRun.claims].map(({ id }) => id);
    assert.equal(new Set(sourceIds).size, sourceIds.length);
    assert.equal(new Set(claimIds).size, claimIds.length);
    assert.ok(sourceIds.every((id) => UUID_PATTERN.test(id)));
    assert.ok(claimIds.every((id) => UUID_PATTERN.test(id)));
    for (const run of [courseRun, dayRun]) {
      const runSourceIds = new Set(run.sources.map(({ id }) => id));
      assert.ok(run.claims.every((claim) => claim.evidence.every(({ sourceId }) => UUID_PATTERN.test(sourceId) && runSourceIds.has(sourceId))));
    }

    const storedSourceIds = (db.prepare("SELECT id FROM research_sources").all() as { id: string }[]).map(({ id }) => id);
    const storedClaimIds = (db.prepare("SELECT id FROM research_claims").all() as { id: string }[]).map(({ id }) => id);
    const storedEvidence = db.prepare("SELECT claim_id, source_id FROM research_claim_evidence").all() as { claim_id: string; source_id: string }[];
    assert.ok(storedSourceIds.every((id) => UUID_PATTERN.test(id)));
    assert.ok(storedClaimIds.every((id) => UUID_PATTERN.test(id)));
    assert.ok(storedEvidence.every(({ claim_id, source_id }) => UUID_PATTERN.test(claim_id) && UUID_PATTERN.test(source_id)));
  });
});

test("a rejected or stale approval leaves the shell and Markdown unchanged", () => {
  withDataRoot((dataRoot, db) => {
    const shell = createShell(db, dataRoot);
    const original = readFileSync(join(dataRoot, shell.markdownPath), "utf8");
    const invalid = validApproval(shell.id);
    invalid.days = [{ objective: "line one\nline two" }, ...invalid.days.slice(1)];
    assert.throws(() => approveOutline(db, dataRoot, invalid), LearningValidationError);
    assert.equal(readFileSync(join(dataRoot, shell.markdownPath), "utf8"), original);

    const stale = validApproval(shell.id);
    stale.expectedRevision = 1;
    assert.throws(() => approveOutline(db, dataRoot, stale), LearningRevisionConflictError);
    assert.equal(getLearningSnapshot(db, dataRoot, shell.id)?.course.revision, 0);
  });
});

test("rejects invalid research inputs without side effects", async (t) => {
  const cases: [string, (input: ApproveOutlineInput) => void][] = [
    ["blank prior knowledge", (input) => { input.priorKnowledge = " "; }],
    ["too many questions", (input) => { input.research.questions = Array.from({ length: 21 }, (_, index) => `q${index}`); }],
    ["oversized narrative", (input) => { input.research.narrativeMarkdown = "x".repeat(1_000_001); }],
    ["non-http URL", (input) => { input.research.sources[0]!.url = "file:///private/source"; }],
    ["score over maximum", (input) => { input.research.sources[0]!.scores.authority = 26; }],
    ["duplicate URL", (input) => { input.research.sources[1]!.url = input.research.sources[0]!.url; }],
    ["non-contiguous rank", (input) => { input.research.sources[1]!.rank = 3; }],
    ["missing selection reason", (input) => { input.research.sources[0]!.selectionReason = null; }],
    ["no selected source", (input) => {
      input.research.sources = input.research.sources.map((source) => ({ ...source, selected: false, selectionReason: null }));
      input.research.claims = input.research.claims.map((claim) => ({ ...claim, major: false }));
    }],
    ["missing evidence source", (input) => { input.research.claims = [{ ...input.research.claims[0]!, evidence: [{ sourceId: crypto.randomUUID(), stance: "supports" }] }]; }],
    ["path-like source key", (input) => { input.research.sources[0]!.id = "s/1"; }],
    ["spaced claim key", (input) => { input.research.claims[0]!.id = "c 1"; }],
    ["overlength evidence source key", (input) => { input.research.claims = [{ ...input.research.claims[0]!, evidence: [{ sourceId: "s".repeat(65), stance: "supports" }] }]; }],
    ["duplicate evidence", (input) => {
      const evidence = input.research.claims[0]!.evidence[0]!;
      input.research.claims = [{ ...input.research.claims[0]!, evidence: [evidence, evidence] }];
    }],
    ["conflict without uncertainty", (input) => {
      input.research.claims = [{ ...input.research.claims[0]!, major: false, uncertainty: null, evidence: [{ sourceId: input.research.sources[0]!.id, stance: "opposes" }] }];
    }],
    ["malformed Day", (input) => { input.days = [null as unknown as { objective: string }, ...input.days.slice(1)]; }],
    ["malformed source", (input) => { (input.research.sources as unknown[])[0] = null; }],
    ["non-boolean source selection", (input) => { (input.research.sources[0] as { selected: unknown }).selected = 1; }],
    ["malformed score object", (input) => { (input.research.sources[0] as { scores: unknown }).scores = null; }],
    ["malformed claim", (input) => { (input.research.claims as unknown[])[0] = null; }],
    ["non-boolean major claim", (input) => { (input.research.claims[0] as { major: unknown }).major = "yes"; }],
    ["malformed evidence", (input) => { (input.research.claims[0]!.evidence as unknown[])[0] = null; }],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, () => withDataRoot((dataRoot, db) => {
      const shell = createShell(db, dataRoot);
      const original = readFileSync(join(dataRoot, shell.markdownPath), "utf8");
      const input = validApproval(shell.id);
      mutate(input);
      assert.throws(() => approveOutline(db, dataRoot, input), LearningValidationError);
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM course_days").get() as { count: number }).count, 0);
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM research_runs").get() as { count: number }).count, 0);
      assert.equal(readFileSync(join(dataRoot, shell.markdownPath), "utf8"), original);
    }));
  }
});

test("research trims accepted fields and rejects overlength outer whitespace without side effects", async (t) => {
  const padding = " ".repeat(50_000);
  const cases: [string, (input: ApproveOutlineInput) => void][] = [
    ["question", (input) => { input.research.questions = [`${padding}핵심 질문`]; }],
    ["criterion", (input) => { input.research.topicCriteria = [`${padding}선정 조건`]; }],
    ["source URL", (input) => { input.research.sources[0]!.url = `${padding}https://cs.example.edu/foundations`; }],
    ["source title", (input) => { input.research.sources[0]!.title = `${padding}Computer Science Foundations`; }],
    ["selection reason", (input) => { input.research.sources[0]!.selectionReason = `${padding}대학의 공개 기초 과정이다.`; }],
    ["claim", (input) => { input.research.claims[0]!.statement = `${padding}추상화와 문제 분해가 이후 주제의 공통 기반이다.`; }],
  ];

  for (const [name, mutate] of cases) {
    await t.test(`rejects padded ${name}`, () => withDataRoot((dataRoot, db) => {
      const shell = createShell(db, dataRoot);
      const original = readFileSync(join(dataRoot, shell.markdownPath), "utf8");
      const input = validApproval(shell.id);
      mutate(input);
      assert.throws(() => approveOutline(db, dataRoot, input), LearningValidationError);
      const after = getLearningSnapshot(db, dataRoot, shell.id)!;
      assert.equal(after.course.revision, 0);
      assert.equal(after.course.status, "draft");
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM research_runs").get() as { count: number }).count, 0);
      assert.equal(readFileSync(join(dataRoot, shell.markdownPath), "utf8"), original);
    }));
  }

  await t.test("persists and renders accepted padded values in normalized form", () => withDataRoot((dataRoot, db) => {
    const shell = createShell(db, dataRoot);
    const approval = validApproval(shell.id);
    const courseQuestion = approval.research.questions[0]!;
    const courseCriterion = approval.research.topicCriteria[0]!;
    const courseNarrative = approval.research.narrativeMarkdown;
    const courseSource = approval.research.sources[0]!;
    const courseClaim = approval.research.claims[0]!;
    approval.research = {
      ...approval.research,
      questions: approval.research.questions.map((value) => `  ${value}  `),
      topicCriteria: approval.research.topicCriteria.map((value) => `  ${value}  `),
      narrativeMarkdown: `  ${courseNarrative}  `,
      sources: approval.research.sources.map((source) => ({
        ...source,
        url: `  ${source.url}  `,
        title: `  ${source.title}  `,
        publisher: `  ${source.publisher}  `,
        independenceKey: `  ${source.independenceKey}  `,
        selectionReason: source.selectionReason === null ? null : `  ${source.selectionReason}  `,
        limitation: source.id === courseSource.id ? "  보완 범위를 기록한다.  " : source.limitation,
      })),
      claims: approval.research.claims.map((claim) => ({
        ...claim,
        statement: `  ${claim.statement}  `,
        conclusion: `  ${claim.conclusion}  `,
        uncertainty: "  추가 예제로 확인한다.  ",
      })),
    };
    let snapshot = approveOutline(db, dataRoot, approval);
    const courseRun = snapshot.researchRuns[0]!;
    assert.equal(courseRun.questions[0], courseQuestion);
    assert.equal(courseRun.topicCriteria[0], courseCriterion);
    assert.equal(courseRun.sources[0]!.url, courseSource.url);
    assert.equal(courseRun.sources[0]!.title, courseSource.title);
    assert.equal(courseRun.sources[0]!.publisher, courseSource.publisher);
    assert.equal(courseRun.sources[0]!.independenceKey, courseSource.independenceKey);
    assert.equal(courseRun.sources[0]!.selectionReason, courseSource.selectionReason);
    assert.equal(courseRun.sources[0]!.limitation, "보완 범위를 기록한다.");
    assert.equal(courseRun.claims[0]!.statement, courseClaim.statement);
    assert.equal(courseRun.claims[0]!.conclusion, courseClaim.conclusion);
    assert.equal(courseRun.claims[0]!.uncertainty, "추가 예제로 확인한다.");
    assert.match(snapshot.documents.course, new RegExp(`\\| 1 \\| 예 \\| ${courseSource.title} \\| ${courseSource.url} \\|`));
    assert.match(snapshot.documents.course, new RegExp(courseNarrative));

    const daily = dailyResearch(1);
    const dailyQuestion = daily.questions[0]!;
    const dailyCriterion = daily.topicCriteria[0]!;
    const dailyNarrative = daily.narrativeMarkdown;
    const dailySource = daily.sources[0]!;
    const dailyClaim = daily.claims[0]!;
    daily.questions = daily.questions.map((value) => `  ${value}  `);
    daily.topicCriteria = daily.topicCriteria.map((value) => `  ${value}  `);
    daily.narrativeMarkdown = `  ${daily.narrativeMarkdown}  `;
    daily.sources = daily.sources.map((source) => ({
      ...source,
      url: `  ${source.url}  `,
      title: `  ${source.title}  `,
      publisher: `  ${source.publisher}  `,
      independenceKey: `  ${source.independenceKey}  `,
      selectionReason: source.selectionReason === null ? null : `  ${source.selectionReason}  `,
      limitation: source.id === dailySource.id ? "  보완 범위를 기록한다.  " : source.limitation,
    }));
    daily.claims = daily.claims.map((claim) => ({
      ...claim,
      statement: `  ${claim.statement}  `,
      conclusion: `  ${claim.conclusion}  `,
      uncertainty: "  추가 예제로 확인한다.  ",
    }));
    snapshot = recordDailyResearch(db, dataRoot, {
      courseId: snapshot.course.id,
      expectedRevision: snapshot.course.revision,
      research: daily,
    });
    const dailyRun = snapshot.researchRuns.find(({ scope }) => scope === "day")!;
    assert.equal(dailyRun.questions[0], dailyQuestion);
    assert.equal(dailyRun.topicCriteria[0], dailyCriterion);
    assert.equal(dailyRun.sources[0]!.url, dailySource.url);
    assert.equal(dailyRun.sources[0]!.title, dailySource.title);
    assert.equal(dailyRun.sources[0]!.publisher, dailySource.publisher);
    assert.equal(dailyRun.sources[0]!.independenceKey, dailySource.independenceKey);
    assert.equal(dailyRun.sources[0]!.selectionReason, dailySource.selectionReason);
    assert.equal(dailyRun.sources[0]!.limitation, "보완 범위를 기록한다.");
    assert.equal(dailyRun.claims[0]!.statement, dailyClaim.statement);
    assert.equal(dailyRun.claims[0]!.conclusion, dailyClaim.conclusion);
    assert.equal(dailyRun.claims[0]!.uncertainty, "추가 예제로 확인한다.");
    // 매일 읽는 학습 문서는 점수와 루브릭 없이 선정 자료 링크만 싣는다.
    assert.ok(snapshot.documents.currentDay!.includes(`](${dailySource.url})`));
    assert.ok(snapshot.documents.currentDay!.includes(dailySource.title));
    assert.doesNotMatch(snapshot.documents.currentDay!, /고정 평가 루브릭/);
    assert.doesNotMatch(snapshot.documents.currentDay!, /독립성 키/);
    // 감사용 전체 점수표는 과정 문서에 그대로 남는다.
    assert.match(snapshot.documents.course, /고정 평가 루브릭/);
    assert.match(snapshot.documents.currentDay!, new RegExp(dailyNarrative));
  }));
});

test("approval commit failure restores the draft course and all files", () => {
  withDataRoot((dataRoot, db) => {
    const shell = createShell(db, dataRoot);
    const original = readFileSync(join(dataRoot, shell.markdownPath), "utf8");
    db.exec(`
      CREATE TABLE approval_parent (id INTEGER PRIMARY KEY);
      CREATE TABLE approval_gate (
        course_id TEXT NOT NULL,
        missing_parent INTEGER NOT NULL,
        FOREIGN KEY (missing_parent) REFERENCES approval_parent(id)
          DEFERRABLE INITIALLY DEFERRED
      );
      CREATE TRIGGER fail_approval_commit
      AFTER UPDATE OF revision ON courses
      BEGIN
        INSERT INTO approval_gate VALUES (NEW.id, 1);
      END;
    `);

    assert.throws(() => approveOutline(db, dataRoot, validApproval(shell.id)), /FOREIGN KEY constraint failed/);
    const snapshot = getLearningSnapshot(db, dataRoot, shell.id)!;
    assert.equal(snapshot.course.status, "draft");
    assert.equal(snapshot.course.revision, 0);
    assert.equal(snapshot.days.length, 0);
    assert.equal(readFileSync(join(dataRoot, shell.markdownPath), "utf8"), original);
    for (const file of ["progress.md", "journal.md", "current-day.md"]) {
      assert.throws(() => readFileSync(join(dataRoot, "courses", shell.id, file), "utf8"), { code: "ENOENT" });
    }
  });
});

test("records current-Day research without changing the lecture stage", () => {
  withDataRoot((dataRoot, db) => {
    const active = activateCourse(db, dataRoot);
    const snapshot = recordDailyResearch(db, dataRoot, {
      courseId: active.course.id,
      expectedRevision: 1,
      research: dailyResearch(1),
    });
    assert.equal(snapshot.course.revision, 2);
    assert.equal(snapshot.course.currentStage, "lecture");
    assert.equal(snapshot.currentDay?.dayNumber, 1);
    assert.match(snapshot.documents.currentDay!, /Day 1 심화 조사 본문/);
    assert.equal(
      (db.prepare(
        "SELECT COUNT(*) AS count FROM research_runs WHERE scope = 'day'",
      ).get() as { count: number }).count,
      1,
    );
  });
});

test("saves an interruption without changing Day or stage", () => {
  withDataRoot((dataRoot, db) => {
    let snapshot = activateCourse(db, dataRoot);
    snapshot = recordDailyResearch(db, dataRoot, {
      courseId: snapshot.course.id,
      expectedRevision: snapshot.course.revision,
      research: dailyResearch(1),
    });
    snapshot = saveLearningCheckpoint(db, dataRoot, {
      courseId: snapshot.course.id,
      expectedRevision: snapshot.course.revision,
      lesson: {
        recallMarkdown: "Day 1 선수 지식을 떠올렸다.",
        preciseExplanationMarkdown:
          "정확한 설명을 마치고 ELI5 설명 직전까지 진행했다.",
      },
      understoodConcepts: [{ key: "abstraction", label: "추상화" }],
      remediationConcepts: [{ key: "binary", label: "이진 표현" }],
    });
    assert.equal(snapshot.course.currentStage, "lecture");
    assert.equal(snapshot.currentDay?.dayNumber, 1);

    db.close();
    const reopened = openDatabase(dataRoot);
    try {
      const resumed = getLearningSnapshot(reopened, dataRoot, snapshot.course.id)!;
      assert.equal(resumed.course.revision, snapshot.course.revision);
      assert.equal(resumed.course.currentStage, "lecture");
      assert.match(resumed.documents.currentDay!, /Day 1 심화 조사 본문/);
      assert.match(resumed.documents.currentDay!, /ELI5 설명 직전/);
      // 학습자가 여는 문서이므로 배울 내용이 먼저 오고 근거 자료가 뒤에 온다.
      const lessonIndex = resumed.documents.currentDay!.indexOf("ELI5 설명 직전");
      const referenceIndex = resumed.documents.currentDay!.indexOf("### 참고 자료와 근거");
      assert.notEqual(referenceIndex, -1, "근거 자료 구획이 있어야 한다");
      assert.ok(
        lessonIndex < referenceIndex,
        `강의(${lessonIndex})가 근거 자료(${referenceIndex})보다 앞에 와야 한다`,
      );
      assert.deepEqual(resumed.understoodConcepts, [{ key: "abstraction", label: "추상화" }]);
      assert.deepEqual(resumed.remediationConcepts, [{ key: "binary", label: "이진 표현" }]);
    } finally {
      reopened.close();
    }
  });
});

test("rejects a lesson checkpoint before daily research without side effects", () => {
  withDataRoot((dataRoot, db) => {
    const before = activateCourse(db, dataRoot);
    assert.throws(() => saveLearningCheckpoint(db, dataRoot, {
      courseId: before.course.id,
      expectedRevision: before.course.revision,
      lesson: { preciseExplanationMarkdown: "must not be saved before research" },
      understoodConcepts: [{ key: "premature", label: "너무 이른 개념" }],
      remediationConcepts: [],
    }), LearningStateError);

    const after = getLearningSnapshot(db, dataRoot, before.course.id)!;
    assert.equal(after.course.revision, before.course.revision);
    assert.equal(after.currentDay?.id, before.currentDay?.id);
    assert.deepEqual(after.understoodConcepts, []);
    assert.deepEqual(after.remediationConcepts, []);
    assert.equal(after.documents.currentDay, before.documents.currentDay);
    assert.equal(after.documents.progress, before.documents.progress);
    assert.deepEqual(listTemporaryEntries(dataRoot), []);
    assert.equal(
      (db.prepare(
        "SELECT COUNT(*) AS count FROM day_concepts WHERE day_id = ?",
      ).get(before.currentDay!.id) as { count: number }).count,
      0,
    );
    assert.equal(
      (db.prepare(
        "SELECT COUNT(*) AS count FROM day_lesson_parts WHERE day_id = ?",
      ).get(before.currentDay!.id) as { count: number }).count,
      0,
    );
  });
});

test("rejects daily research on a draft or twice for one Day", () => {
  withDataRoot((dataRoot, db) => {
    const draft = createShell(db, dataRoot);
    assert.throws(() => recordDailyResearch(db, dataRoot, {
      courseId: draft.id,
      expectedRevision: 0,
      research: dailyResearch(1),
    }), LearningStateError);

    let snapshot = approveOutline(db, dataRoot, validApproval(draft.id));
    snapshot = recordDailyResearch(db, dataRoot, {
      courseId: snapshot.course.id,
      expectedRevision: snapshot.course.revision,
      research: dailyResearch(1),
    });
    assert.throws(() => recordDailyResearch(db, dataRoot, {
      courseId: snapshot.course.id,
      expectedRevision: snapshot.course.revision,
      research: dailyResearch(1),
    }), LearningStateError);
    assert.equal(snapshot.researchRuns.filter(({ scope }) => scope === "day").length, 1);
  });
});

test("rejects invalid or stale checkpoints without changing persisted state", async (t) => {
  const cases: [string, (input: Parameters<typeof saveLearningCheckpoint>[2]) => void][] = [
    ["no lesson field", (input) => { input.lesson = {}; }],
    ["invalid concept key", (input) => {
      input.understoodConcepts = [{ key: "../bad", label: "bad" }];
    }],
    ["concept in both lists", (input) => {
      input.understoodConcepts = [{ key: "same", label: "같은 개념" }];
      input.remediationConcepts = [{ key: "same", label: "같은 개념" }];
    }],
    ["oversized lesson", (input) => {
      input.lesson = { eli5Markdown: "x".repeat(1_000_001) };
    }],
    ["stale revision", (input) => { input.expectedRevision -= 1; }],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, () => withDataRoot((dataRoot, db) => {
      let snapshot = activateCourse(db, dataRoot);
      snapshot = recordDailyResearch(db, dataRoot, {
        courseId: snapshot.course.id,
        expectedRevision: snapshot.course.revision,
        research: dailyResearch(1),
      });
      const before = snapshot.documents.currentDay;
      const input: Parameters<typeof saveLearningCheckpoint>[2] = {
        courseId: snapshot.course.id,
        expectedRevision: snapshot.course.revision,
        lesson: { preciseExplanationMarkdown: "checkpoint" },
        understoodConcepts: [],
        remediationConcepts: [],
      };
      mutate(input);
      assert.throws(() => saveLearningCheckpoint(db, dataRoot, input));
      const after = getLearningSnapshot(db, dataRoot, snapshot.course.id)!;
      assert.equal(after.course.revision, snapshot.course.revision);
      assert.equal(after.documents.currentDay, before);
      assert.deepEqual(after.understoodConcepts, []);
      assert.deepEqual(after.remediationConcepts, []);
    }));
  }
});

test("a tampered current-Day file blocks checkpoint mutation", () => {
  withDataRoot((dataRoot, db) => {
    let snapshot = activateCourse(db, dataRoot);
    snapshot = recordDailyResearch(db, dataRoot, {
      courseId: snapshot.course.id,
      expectedRevision: snapshot.course.revision,
      research: dailyResearch(1),
    });
    writeFileSync(
      join(dataRoot, snapshot.course.currentDayMarkdownPath!),
      "# tampered\n",
      "utf8",
    );
    assert.throws(() => saveLearningCheckpoint(db, dataRoot, {
      courseId: snapshot.course.id,
      expectedRevision: snapshot.course.revision,
      lesson: { preciseExplanationMarkdown: "must not save" },
      understoodConcepts: [],
      remediationConcepts: [],
    }), /checksum mismatch/);
    assert.equal(
      (db.prepare("SELECT revision FROM courses WHERE id = ?")
        .get(snapshot.course.id) as { revision: number }).revision,
      snapshot.course.revision,
    );
  });
});

test("checkpoint COMMIT failure restores concepts, revision, and Markdown", () => {
  withDataRoot((dataRoot, db) => {
    let snapshot = activateCourse(db, dataRoot);
    snapshot = recordDailyResearch(db, dataRoot, {
      courseId: snapshot.course.id,
      expectedRevision: snapshot.course.revision,
      research: dailyResearch(1),
    });
    const beforeCurrentDay = snapshot.documents.currentDay;
    const beforeProgress = snapshot.documents.progress;
    db.exec(`
      CREATE TABLE checkpoint_parent (id INTEGER PRIMARY KEY);
      CREATE TABLE checkpoint_gate (
        course_id TEXT NOT NULL,
        missing_parent INTEGER NOT NULL,
        FOREIGN KEY (missing_parent) REFERENCES checkpoint_parent(id)
          DEFERRABLE INITIALLY DEFERRED
      );
      CREATE TRIGGER fail_checkpoint_commit
      AFTER UPDATE OF revision ON courses
      BEGIN
        INSERT INTO checkpoint_gate VALUES (NEW.id, 1);
      END;
    `);

    assert.throws(() => saveLearningCheckpoint(db, dataRoot, {
      courseId: snapshot.course.id,
      expectedRevision: snapshot.course.revision,
      lesson: { preciseExplanationMarkdown: "must roll back" },
      understoodConcepts: [{ key: "rollback", label: "롤백" }],
      remediationConcepts: [],
    }), /FOREIGN KEY constraint failed/);

    const after = getLearningSnapshot(db, dataRoot, snapshot.course.id)!;
    assert.equal(after.course.revision, snapshot.course.revision);
    assert.equal(after.course.currentStage, "lecture");
    assert.deepEqual(after.understoodConcepts, []);
    assert.equal(after.documents.currentDay, beforeCurrentDay);
    assert.equal(after.documents.progress, beforeProgress);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM day_lesson_parts").get() as {
        count: number;
      }).count,
      0,
    );
  });
});

test("stores exactly five immutable questions and criteria before any answer", () => {
  withDataRoot((dataRoot, db) => {
    const ready = readyForQuiz(db, dataRoot);
    const snapshot = startQuiz(db, dataRoot, {
      courseId: ready.course.id, expectedRevision: ready.course.revision, questions: quizQuestions("첫 시도"),
    });
    assert.equal(snapshot.course.currentStage, "quiz");
    assert.equal(snapshot.quizAttempts.length, 1);
    assert.equal(snapshot.quizAttempts[0]!.questions.length, 5);
    assert.equal(snapshot.quizAttempts[0]!.status, "in_progress");
    assert.equal(snapshot.quizAttempts[0]!.score, null);
    assert.ok(snapshot.quizAttempts[0]!.questions.every(({ responses }) => responses.length === 0));
    assert.match(snapshot.documents.progress!, /답변 0\/5/);
  });
});

test("rejects invalid immutable quiz questions without mutation", () => {
  withDataRoot((dataRoot, db) => {
    const ready = readyForQuiz(db, dataRoot);
    for (const questions of [quizQuestions("four").slice(0, 4), [...quizQuestions("six"), { id: crypto.randomUUID(), conceptKey: "concept-6", conceptLabel: "개념 6", prompt: "six 문제 6", gradingCriteria: "six 기준 6을 정확히 설명한다" }]]) {
      assert.throws(() => startQuiz(db, dataRoot, { courseId: ready.course.id, expectedRevision: ready.course.revision, questions }), LearningValidationError);
    }
    const duplicate = quizQuestions("duplicate");
    duplicate[1]!.id = duplicate[0]!.id;
    assert.throws(() => startQuiz(db, dataRoot, { courseId: ready.course.id, expectedRevision: ready.course.revision, questions: duplicate }), LearningValidationError);
    const blank = quizQuestions("blank");
    blank[2]!.gradingCriteria = " ";
    assert.throws(() => startQuiz(db, dataRoot, { courseId: ready.course.id, expectedRevision: ready.course.revision, questions: blank }), LearningValidationError);
    const malformed = quizQuestions("malformed");
    (malformed as unknown[])[4] = null;
    assert.throws(() => startQuiz(db, dataRoot, { courseId: ready.course.id, expectedRevision: ready.course.revision, questions: malformed }), LearningValidationError);
    assert.equal(getLearningSnapshot(db, dataRoot, ready.course.id)!.course.currentStage, "lecture");
  });
});

test("persists answer and clarification history, then transitions 5/5 to reflection", () => {
  withDataRoot((dataRoot, db) => {
    let snapshot = readyForQuiz(db, dataRoot);
    snapshot = startQuiz(db, dataRoot, { courseId: snapshot.course.id, expectedRevision: snapshot.course.revision, questions: quizQuestions("명료화") });
    const attempt = snapshot.quizAttempts[0]!;
    const grades = terminalGrades(attempt);
    grades[1] = { questionId: attempt.questions[1]!.id, answer: "상황에 따라 다르다.", result: "needs_clarification", feedback: "판정에 설명이 더 필요하다.", clarificationQuestion: "어떤 조건에서 달라지는지 예를 들어 설명해 주세요." };
    snapshot = gradeQuiz(db, dataRoot, { courseId: snapshot.course.id, expectedRevision: snapshot.course.revision, attemptId: attempt.id, grades });
    assert.equal(snapshot.course.currentStage, "quiz");
    assert.equal(snapshot.quizAttempts[0]!.questions[1]!.responses.length, 1);
    snapshot = gradeQuiz(db, dataRoot, { courseId: snapshot.course.id, expectedRevision: snapshot.course.revision, attemptId: attempt.id, grades: [{ questionId: attempt.questions[1]!.id, answer: "입력 범위가 유한할 때의 구체적인 예다.", result: "correct", feedback: "조건과 예를 명확히 설명했다." }] });
    assert.equal(snapshot.course.currentStage, "reflection");
    assert.equal(snapshot.quizAttempts[0]!.score, 5);
    assert.equal(snapshot.quizAttempts[0]!.questions[1]!.responses.length, 2);
  });
});

test("a 4/5 attempt moves to remediation and only a new five-question attempt may resume", () => {
  withDataRoot((dataRoot, db) => {
    let snapshot = readyForQuiz(db, dataRoot);
    const firstQuestions = quizQuestions("첫 시도");
    snapshot = startQuiz(db, dataRoot, { courseId: snapshot.course.id, expectedRevision: snapshot.course.revision, questions: firstQuestions });
    snapshot = gradeQuiz(db, dataRoot, { courseId: snapshot.course.id, expectedRevision: snapshot.course.revision, attemptId: snapshot.quizAttempts[0]!.id, grades: terminalGrades(snapshot.quizAttempts[0]!, 3) });
    assert.equal(snapshot.course.currentStage, "remediation");
    assert.equal(snapshot.quizAttempts[0]!.score, 4);
    const repeated = quizQuestions("새 시도");
    repeated[0]!.prompt = firstQuestions[0]!.prompt;
    assert.throws(() => startRemediationQuiz(db, dataRoot, { courseId: snapshot.course.id, expectedRevision: snapshot.course.revision, remediationMarkdown: "틀린 개념을 다른 예제로 다시 설명한다.", questions: repeated }), LearningValidationError);
    snapshot = startRemediationQuiz(db, dataRoot, { courseId: snapshot.course.id, expectedRevision: snapshot.course.revision, remediationMarkdown: "틀린 개념을 다른 예제로 다시 설명한다.", questions: quizQuestions("새 시도") });
    assert.equal(snapshot.course.currentStage, "quiz");
    assert.equal(snapshot.quizAttempts[1]!.attemptNumber, 2);
    snapshot = gradeQuiz(db, dataRoot, { courseId: snapshot.course.id, expectedRevision: snapshot.course.revision, attemptId: snapshot.quizAttempts[1]!.id, grades: terminalGrades(snapshot.quizAttempts[1]!) });
    assert.equal(snapshot.course.currentStage, "reflection");
    assert.equal(snapshot.remediationConcepts.length, 0);
    assert.ok(snapshot.understoodConcepts.some(({ key }) => key === "concept-3"));
  });
});

test("rejects invalid grade submissions without mutating responses or revision", () => {
  withDataRoot((dataRoot, db) => {
    let snapshot = readyForQuiz(db, dataRoot);
    snapshot = startQuiz(db, dataRoot, { courseId: snapshot.course.id, expectedRevision: snapshot.course.revision, questions: quizQuestions("invalid") });
    const attempt = snapshot.quizAttempts[0]!;
    const assertNoMutation = (revision: number, responseCount: number) => {
      const after = getLearningSnapshot(db, dataRoot, snapshot.course.id)!;
      assert.equal(after.course.revision, revision);
      assert.equal(after.quizAttempts[0]!.questions.flatMap(({ responses }) => responses).length, responseCount);
    };
    const firstGrade = terminalGrades(attempt)[0]!;
    const input: Parameters<typeof gradeQuiz>[2] = { courseId: snapshot.course.id, expectedRevision: snapshot.course.revision, attemptId: attempt.id, grades: [] };
    assert.throws(() => gradeQuiz(db, dataRoot, input), LearningValidationError);
    assertNoMutation(snapshot.course.revision, 0);
    input.grades = [firstGrade, { ...firstGrade, answer: "중복 답변" }];
    assert.throws(() => gradeQuiz(db, dataRoot, input), LearningValidationError);
    assertNoMutation(snapshot.course.revision, 0);
    input.grades = [firstGrade];
    input.attemptId = crypto.randomUUID();
    assert.throws(() => gradeQuiz(db, dataRoot, input), LearningStateError);
    assertNoMutation(snapshot.course.revision, 0);
    input.attemptId = attempt.id;
    input.expectedRevision = snapshot.course.revision - 1;
    assert.throws(() => gradeQuiz(db, dataRoot, input), LearningRevisionConflictError);
    assertNoMutation(snapshot.course.revision, 0);
    snapshot = gradeQuiz(db, dataRoot, { courseId: snapshot.course.id, expectedRevision: snapshot.course.revision, attemptId: attempt.id, grades: terminalGrades(attempt) });
    assert.throws(() => gradeQuiz(db, dataRoot, { courseId: snapshot.course.id, expectedRevision: snapshot.course.revision, attemptId: attempt.id, grades: [firstGrade] }), LearningStateError);
    assertNoMutation(snapshot.course.revision, 5);
  });
});

test("retains five questions and every response after reopening", () => {
  withDataRoot((dataRoot, db) => {
    let snapshot = readyForQuiz(db, dataRoot);
    snapshot = startQuiz(db, dataRoot, { courseId: snapshot.course.id, expectedRevision: snapshot.course.revision, questions: quizQuestions("resume") });
    const attempt = snapshot.quizAttempts[0]!;
    snapshot = gradeQuiz(db, dataRoot, { courseId: snapshot.course.id, expectedRevision: snapshot.course.revision, attemptId: attempt.id, grades: [terminalGrades(attempt)[0]!] });
    db.close();
    const reopened = openDatabase(dataRoot);
    try {
      const resumed = getLearningSnapshot(reopened, dataRoot, snapshot.course.id)!;
      assert.equal(resumed.quizAttempts[0]!.questions.length, 5);
      assert.equal(resumed.quizAttempts[0]!.questions[0]!.responses.length, 1);
      assert.ok(resumed.quizAttempts[0]!.questions.slice(1).every(({ responses }) => responses.length === 0));
    } finally { reopened.close(); }
  });
});

test("quiz creation requires daily research, all lesson parts, unique normalized prompts, and current revision", () => {
  withDataRoot((dataRoot, db) => {
    let snapshot = activateCourse(db, dataRoot);
    assert.throws(() => startQuiz(db, dataRoot, { courseId: snapshot.course.id, expectedRevision: snapshot.course.revision, questions: quizQuestions("early") }), LearningStateError);
    snapshot = recordDailyResearch(db, dataRoot, { courseId: snapshot.course.id, expectedRevision: snapshot.course.revision, research: dailyResearch(1) });
    assert.throws(() => startQuiz(db, dataRoot, { courseId: snapshot.course.id, expectedRevision: snapshot.course.revision, questions: quizQuestions("incomplete") }), LearningStateError);
    snapshot = saveLearningCheckpoint(db, dataRoot, { courseId: snapshot.course.id, expectedRevision: snapshot.course.revision, lesson: { recallMarkdown: "a", preciseExplanationMarkdown: "b", eli5Markdown: "c", analogyMarkdown: "d", exampleMarkdown: "e", applicationMarkdown: "f", interviewMarkdown: "g" }, understoodConcepts: [], remediationConcepts: [] });
    const duplicate = quizQuestions("normalized prompt");
    duplicate[1]!.prompt = `  ${duplicate[0]!.prompt}  `;
    assert.throws(() => startQuiz(db, dataRoot, { courseId: snapshot.course.id, expectedRevision: snapshot.course.revision, questions: duplicate }), LearningValidationError);
    const nfcDuplicate = quizQuestions("NFC normalized prompt");
    nfcDuplicate[0]!.prompt = "café에서 추상화의 역할을 설명한다.";
    nfcDuplicate[1]!.prompt = "cafe\u0301에서 추상화의 역할을 설명한다.";
    assert.throws(() => startQuiz(db, dataRoot, { courseId: snapshot.course.id, expectedRevision: snapshot.course.revision, questions: nfcDuplicate }), LearningValidationError);
    assert.throws(() => startQuiz(db, dataRoot, { courseId: snapshot.course.id, expectedRevision: snapshot.course.revision - 1, questions: quizQuestions("stale") }), LearningRevisionConflictError);
  });
});

test("persists a partial quiz answer and reopens at the unanswered question set", () => {
  withDataRoot((dataRoot, db) => {
    let snapshot = readyForQuiz(db, dataRoot);
    snapshot = startQuiz(db, dataRoot, { courseId: snapshot.course.id, expectedRevision: snapshot.course.revision, questions: quizQuestions("partial") });
    const attempt = snapshot.quizAttempts[0]!;
    snapshot = gradeQuiz(db, dataRoot, { courseId: snapshot.course.id, expectedRevision: snapshot.course.revision, attemptId: attempt.id, grades: [terminalGrades(attempt)[0]!] });
    assert.equal(snapshot.course.currentStage, "quiz");
    assert.match(snapshot.documents.progress!, /답변 1\/5/);
    db.close();
    const reopened = openDatabase(dataRoot);
    try {
      const resumed = getLearningSnapshot(reopened, dataRoot, snapshot.course.id)!;
      assert.equal(resumed.quizAttempts[0]!.questions[0]!.responses.length, 1);
      assert.ok(resumed.quizAttempts[0]!.questions.slice(1).every(({ responses }) => responses.length === 0));
      const completed = gradeQuiz(reopened, dataRoot, { courseId: resumed.course.id, expectedRevision: resumed.course.revision, attemptId: resumed.quizAttempts[0]!.id, grades: terminalGrades(resumed.quizAttempts[0]!).slice(1) });
      assert.equal(completed.course.currentStage, "reflection");
      assert.equal(completed.quizAttempts[0]!.score, 5);
    } finally { reopened.close(); }
  });
});

test("reopens at remediation with the failed attempt intact", () => {
  withDataRoot((dataRoot, db) => {
    let snapshot = readyForQuiz(db, dataRoot);
    snapshot = startQuiz(db, dataRoot, { courseId: snapshot.course.id, expectedRevision: snapshot.course.revision, questions: quizQuestions("restart") });
    snapshot = gradeQuiz(db, dataRoot, { courseId: snapshot.course.id, expectedRevision: snapshot.course.revision, attemptId: snapshot.quizAttempts[0]!.id, grades: terminalGrades(snapshot.quizAttempts[0]!, 2) });
    snapshot = saveLearningCheckpoint(db, dataRoot, { courseId: snapshot.course.id, expectedRevision: snapshot.course.revision, lesson: { remediationMarkdown: "틀린 개념을 새 비유로 설명하다가 체크포인트를 저장했다." } });
    db.close();
    const reopened = openDatabase(dataRoot);
    try {
      const resumed = getLearningSnapshot(reopened, dataRoot, snapshot.course.id)!;
      assert.equal(resumed.course.currentStage, "remediation");
      assert.equal(resumed.quizAttempts[0]!.status, "failed");
      assert.equal(resumed.quizAttempts[0]!.score, 4);
      assert.match(resumed.documents.currentDay!, /새 비유로 설명하다가 체크포인트/);
      assert.deepEqual(resumed.remediationConcepts, [{ key: "concept-2", label: "개념 2" }]);
    } finally { reopened.close(); }
  });
});

test("rejects an attempt that belongs to another active course", () => {
  withDataRoot((dataRoot, db) => {
    let first = readyForQuiz(db, dataRoot), second = readyForQuiz(db, dataRoot);
    first = startQuiz(db, dataRoot, { courseId: first.course.id, expectedRevision: first.course.revision, questions: quizQuestions("first") });
    second = startQuiz(db, dataRoot, { courseId: second.course.id, expectedRevision: second.course.revision, questions: quizQuestions("second") });
    assert.throws(() => gradeQuiz(db, dataRoot, { courseId: first.course.id, expectedRevision: first.course.revision, attemptId: second.quizAttempts[0]!.id, grades: terminalGrades(second.quizAttempts[0]!) }), LearningStateError);
    assert.ok(getLearningSnapshot(db, dataRoot, first.course.id)!.quizAttempts[0]!.questions.every(({ responses }) => responses.length === 0));
    assert.ok(getLearningSnapshot(db, dataRoot, second.course.id)!.quizAttempts[0]!.questions.every(({ responses }) => responses.length === 0));
  });
});

test("quiz grading COMMIT failure restores responses, stage, and progress", () => {
  withDataRoot((dataRoot, db) => {
    let snapshot = readyForQuiz(db, dataRoot);
    snapshot = startQuiz(db, dataRoot, { courseId: snapshot.course.id, expectedRevision: snapshot.course.revision, questions: quizQuestions("rollback") });
    const beforeProgress = snapshot.documents.progress;
    db.exec(`CREATE TABLE quiz_commit_parent (id INTEGER PRIMARY KEY); CREATE TABLE quiz_commit_gate (course_id TEXT NOT NULL, missing_parent INTEGER NOT NULL, FOREIGN KEY (missing_parent) REFERENCES quiz_commit_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER fail_quiz_commit AFTER UPDATE OF revision ON courses BEGIN INSERT INTO quiz_commit_gate VALUES (NEW.id, 1); END;`);
    assert.throws(() => gradeQuiz(db, dataRoot, { courseId: snapshot.course.id, expectedRevision: snapshot.course.revision, attemptId: snapshot.quizAttempts[0]!.id, grades: [terminalGrades(snapshot.quizAttempts[0]!)[0]!] }), /FOREIGN KEY constraint failed/);
    const after = getLearningSnapshot(db, dataRoot, snapshot.course.id)!;
    assert.equal(after.course.revision, snapshot.course.revision);
    assert.equal(after.course.currentStage, "quiz");
    assert.equal(after.quizAttempts[0]!.score, null);
    assert.ok(after.quizAttempts[0]!.questions.every(({ responses }) => responses.length === 0));
    assert.equal(after.documents.progress, beforeProgress);
  });
});

test("5/5 stays in reflection and cannot advance with a missing answer", () => {
  withDataRoot((dataRoot, db) => {
    const snapshot = passCurrentDayQuiz(db, dataRoot);
    assert.equal(snapshot.course.currentStage, "reflection");
    assert.equal(snapshot.currentDay?.completedAt, null);
    assert.equal(snapshot.documents.journal, "# 학습 기록\n");
    const missing = reflection(1);
    missing.confusing = " ";
    assert.throws(() => completeDay(db, dataRoot, {
      courseId: snapshot.course.id,
      expectedRevision: snapshot.course.revision,
      reflection: missing,
    }), LearningValidationError);
    assert.equal(getLearningSnapshot(db, dataRoot, snapshot.course.id)?.currentDay?.dayNumber, 1);
  });
});

test("completes exactly one Day and preserves reflection wording", () => {
  withDataRoot((dataRoot, db) => {
    const passed = passCurrentDayQuiz(db, dataRoot);
    const actualReflection = {
      learned: "포인터가 아니라 ‘주소를 다루는 값’이라고 이해했다.",
      confusing: "캐시와 메모리의 경계는 아직 헷갈린다.\n예제를 더 보고 싶다.",
      feeling: "처음엔 막막했지만 오늘은 조금 연결됐다.",
    };
    const snapshot = completeDay(db, dataRoot, {
      courseId: passed.course.id,
      expectedRevision: passed.course.revision,
      reflection: actualReflection,
    });
    assert.equal(snapshot.currentDay?.dayNumber, 2);
    assert.equal(snapshot.course.currentStage, "lecture");
    assert.equal(snapshot.days[0]!.completedAt !== null, true);
    assert.equal(snapshot.days[1]!.completedAt, null);
    for (const text of Object.values(actualReflection)) {
      for (const line of text.split("\n")) assert.match(snapshot.documents.journal!, new RegExp(line));
    }
    assert.match(snapshot.documents.currentDay!, /# Day 2/);
  });
});

test("a retry with the old revision never advances a second Day", () => {
  withDataRoot((dataRoot, db) => {
    const passed = passCurrentDayQuiz(db, dataRoot);
    const input = {
      courseId: passed.course.id,
      expectedRevision: passed.course.revision,
      reflection: reflection(1),
    };
    const completed = completeDay(db, dataRoot, input);
    assert.throws(() => completeDay(db, dataRoot, input), LearningRevisionConflictError);
    const resumed = getLearningSnapshot(db, dataRoot, passed.course.id)!;
    assert.equal(resumed.currentDay?.dayNumber, 2);
    assert.equal(resumed.days.filter(({ completedAt }) => completedAt !== null).length, 1);
    assert.equal(resumed.course.revision, completed.course.revision);
  });
});

test("completion rejects the wrong stage, oversized reflection, and damaged journal", async (t) => {
  await t.test("wrong stage", () => withDataRoot((dataRoot, db) => {
    const lecture = readyForQuiz(db, dataRoot);
    assert.throws(() => completeDay(db, dataRoot, {
      courseId: lecture.course.id,
      expectedRevision: lecture.course.revision,
      reflection: reflection(1),
    }), LearningStateError);
    assert.equal(getLearningSnapshot(db, dataRoot, lecture.course.id)?.currentDay?.dayNumber, 1);
  }));

  await t.test("oversized reflection", () => withDataRoot((dataRoot, db) => {
    const passed = passCurrentDayQuiz(db, dataRoot);
    const invalid = reflection(1);
    invalid.learned = "x".repeat(10_001);
    assert.throws(() => completeDay(db, dataRoot, {
      courseId: passed.course.id,
      expectedRevision: passed.course.revision,
      reflection: invalid,
    }), LearningValidationError);
    assert.equal(getLearningSnapshot(db, dataRoot, passed.course.id)?.course.currentStage, "reflection");
  }));

  await t.test("damaged journal", () => withDataRoot((dataRoot, db) => {
    const passed = passCurrentDayQuiz(db, dataRoot);
    writeFileSync(join(dataRoot, passed.course.journalMarkdownPath!), "# damaged\n", "utf8");
    assert.throws(() => completeDay(db, dataRoot, {
      courseId: passed.course.id,
      expectedRevision: passed.course.revision,
      reflection: reflection(1),
    }), /checksum mismatch/);
    assert.equal(
      (db.prepare("SELECT completed_at FROM course_days WHERE id = ?")
        .get(passed.currentDay!.id) as { completed_at: string | null }).completed_at,
      null,
    );
  }));
});

test("Day completion COMMIT failure restores Day, stage, and all Markdown", () => {
  withDataRoot((dataRoot, db) => {
    const passed = passCurrentDayQuiz(db, dataRoot);
    const before = {
      journal: passed.documents.journal,
      progress: passed.documents.progress,
      currentDay: passed.documents.currentDay,
    };
    db.exec(`
      CREATE TABLE day_commit_parent (id INTEGER PRIMARY KEY);
      CREATE TABLE day_commit_gate (
        course_id TEXT NOT NULL,
        missing_parent INTEGER NOT NULL,
        FOREIGN KEY (missing_parent) REFERENCES day_commit_parent(id)
          DEFERRABLE INITIALLY DEFERRED
      );
      CREATE TRIGGER fail_day_commit
      AFTER UPDATE OF revision ON courses
      BEGIN
        INSERT INTO day_commit_gate VALUES (NEW.id, 1);
      END;
    `);

    assert.throws(() => completeDay(db, dataRoot, {
      courseId: passed.course.id,
      expectedRevision: passed.course.revision,
      reflection: reflection(1),
    }), /FOREIGN KEY constraint failed/);

    const after = getLearningSnapshot(db, dataRoot, passed.course.id)!;
    assert.equal(after.course.revision, passed.course.revision);
    assert.equal(after.course.currentStage, "reflection");
    assert.equal(after.currentDay?.dayNumber, 1);
    assert.equal(after.currentDay?.completedAt, null);
    assert.equal(after.documents.journal, before.journal);
    assert.equal(after.documents.progress, before.progress);
    assert.equal(after.documents.currentDay, before.currentDay);
  });
});

test("Day 30 completes the course without creating Day 31", () => {
  withDataRoot((dataRoot, db) => {
    let snapshot = activateCourse(db, dataRoot);
    for (let dayNumber = 1; dayNumber <= 30; dayNumber += 1) {
      snapshot = passSnapshotDay(db, dataRoot, snapshot, dayNumber);
      snapshot = completeDay(db, dataRoot, {
        courseId: snapshot.course.id,
        expectedRevision: snapshot.course.revision,
        reflection: reflection(dayNumber),
      });
    }
    assert.equal(snapshot.course.status, "completed");
    assert.equal(snapshot.course.currentDayId, null);
    assert.equal(snapshot.course.currentStage, null);
    assert.equal(snapshot.currentDay, null);
    assert.equal(snapshot.days.length, 30);
    assert.equal(snapshot.days.every(({ completedAt }) => completedAt !== null), true);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM course_days WHERE day_number = 31")
        .get() as { count: number }).count,
      0,
    );
    assert.equal(snapshot.course.currentDayMarkdownPath, null);
    assert.equal(snapshot.documents.currentDay, null);
    assert.throws(
      () => readFileSync(join(dataRoot, "courses", snapshot.course.id, "current-day.md"), "utf8"),
      { code: "ENOENT" },
    );
  });
});

test("completes the CS non-major course through every persisted stage", () => {
  withDataRoot((dataRoot, initialDb) => {
    let db = initialDb;
    const shell = createShell(db, dataRoot);
    assert.equal(shell.status, "draft");

    const approval = validApproval(shell.id);
    approval.days = CS_NON_MAJOR_OBJECTIVES.map((objective) => ({ objective }));
    const suppliedUrls = approval.research.sources.map(({ url }) => url);
    let snapshot = approveOutline(db, dataRoot, approval);

    const reopen = (): LearningSnapshot => {
      if (db.open) db.close();
      db = openDatabase(dataRoot);
      return getLearningSnapshot(db, dataRoot, shell.id)!;
    };

    try {
      snapshot = reopen();
      assert.equal(snapshot.currentDay?.dayNumber, 1);
      assert.equal(snapshot.course.currentStage, "lecture");

      const dayOneResearch = dailyResearch(1);
      suppliedUrls.push(...dayOneResearch.sources.map(({ url }) => url));
      snapshot = recordDailyResearch(db, dataRoot, {
        courseId: shell.id,
        expectedRevision: snapshot.course.revision,
        research: dayOneResearch,
      });
      snapshot = saveLearningCheckpoint(db, dataRoot, {
        courseId: shell.id,
        expectedRevision: snapshot.course.revision,
        lesson: lessonCheckpoint(1),
        understoodConcepts: [{ key: "abstraction", label: "추상화" }],
        remediationConcepts: [],
      });
      const exactCheckpoint = snapshot.documents.currentDay;
      snapshot = reopen();
      assert.equal(snapshot.documents.currentDay, exactCheckpoint);

      snapshot = startQuiz(db, dataRoot, {
        courseId: shell.id,
        expectedRevision: snapshot.course.revision,
        questions: quizQuestions("Day 1 첫 시도"),
      });
      const firstAttempt = snapshot.quizAttempts[0]!;
      const firstGrades = terminalGrades(firstAttempt, 3);
      firstGrades[1] = {
        questionId: firstAttempt.questions[1]!.id,
        answer: "상황에 따라 다르다.",
        result: "needs_clarification",
        feedback: "조건을 더 설명해야 판정할 수 있다.",
        clarificationQuestion: "어떤 조건에서 달라지는지 예를 들어 설명해 주세요.",
      };
      snapshot = gradeQuiz(db, dataRoot, {
        courseId: shell.id,
        expectedRevision: snapshot.course.revision,
        attemptId: firstAttempt.id,
        grades: firstGrades,
      });
      snapshot = reopen();
      assert.equal(snapshot.course.currentStage, "quiz");
      assert.equal(snapshot.quizAttempts[0]!.questions[1]!.responses.length, 1);

      snapshot = gradeQuiz(db, dataRoot, {
        courseId: shell.id,
        expectedRevision: snapshot.course.revision,
        attemptId: firstAttempt.id,
        grades: [{
          questionId: firstAttempt.questions[1]!.id,
          answer: "입력 범위가 유한한 조건에서 달라진다.",
          result: "correct",
          feedback: "조건을 구체적으로 설명했다.",
        }],
      });
      assert.equal(snapshot.course.currentStage, "remediation");
      assert.equal(snapshot.quizAttempts[0]!.score, 4);
      assert.throws(() => completeDay(db, dataRoot, {
        courseId: shell.id,
        expectedRevision: snapshot.course.revision,
        reflection: reflection(1),
      }), LearningStateError);

      snapshot = startRemediationQuiz(db, dataRoot, {
        courseId: shell.id,
        expectedRevision: snapshot.course.revision,
        remediationMarkdown: "틀린 개념을 다른 설명과 새 예제로 다시 학습했다.",
        questions: quizQuestions("Day 1 보충"),
      });
      snapshot = gradeQuiz(db, dataRoot, {
        courseId: shell.id,
        expectedRevision: snapshot.course.revision,
        attemptId: snapshot.quizAttempts.at(-1)!.id,
        grades: terminalGrades(snapshot.quizAttempts.at(-1)!),
      });
      assert.equal(snapshot.course.currentStage, "reflection");
      assert.equal(snapshot.documents.journal, "# 학습 기록\n");

      snapshot = reopen();
      const actualDayOneReflection = {
        learned: "추상화가 복잡한 세부를 감추는 방법임을 배웠다.",
        confusing: "추상화 경계를 어디에 둘지는 더 연습하고 싶다.",
        feeling: "비전공자도 예제를 따라가니 연결되는 느낌이 들었다.",
      };
      snapshot = completeDay(db, dataRoot, {
        courseId: shell.id,
        expectedRevision: snapshot.course.revision,
        reflection: actualDayOneReflection,
      });
      assert.equal(snapshot.currentDay?.dayNumber, 2);

      for (let dayNumber = 2; dayNumber <= 30; dayNumber += 1) {
        if (dayNumber === 30) {
          snapshot = reopen();
          assert.equal(snapshot.currentDay?.dayNumber, 30);
          assert.equal(snapshot.course.currentStage, "lecture");
        }
        const research = dailyResearch(dayNumber);
        suppliedUrls.push(...research.sources.map(({ url }) => url));
        snapshot = recordDailyResearch(db, dataRoot, {
          courseId: shell.id,
          expectedRevision: snapshot.course.revision,
          research,
        });
        snapshot = saveLearningCheckpoint(db, dataRoot, {
          courseId: shell.id,
          expectedRevision: snapshot.course.revision,
          lesson: lessonCheckpoint(dayNumber),
          understoodConcepts: [],
          remediationConcepts: [],
        });
        snapshot = startQuiz(db, dataRoot, {
          courseId: shell.id,
          expectedRevision: snapshot.course.revision,
          questions: quizQuestions(`Day ${dayNumber} 통과`),
        });
        snapshot = gradeQuiz(db, dataRoot, {
          courseId: shell.id,
          expectedRevision: snapshot.course.revision,
          attemptId: snapshot.quizAttempts.at(-1)!.id,
          grades: terminalGrades(snapshot.quizAttempts.at(-1)!),
        });
        snapshot = completeDay(db, dataRoot, {
          courseId: shell.id,
          expectedRevision: snapshot.course.revision,
          reflection: reflection(dayNumber),
        });
      }

      assert.equal(snapshot.course.status, "completed");
      assert.equal(snapshot.days.length, 30);
      assert.equal(snapshot.currentDay, null);
      assert.equal((snapshot.documents.journal!.match(/^## Day \d+ — /gm) ?? []).length, 30);
      assert.equal(
        (db.prepare("SELECT COUNT(*) AS count FROM course_days WHERE day_number = 31")
          .get() as { count: number }).count,
        0,
      );
      for (const text of Object.values(actualDayOneReflection)) {
        assert.match(snapshot.documents.journal!, new RegExp(text));
      }
      const health = getHealth(db, dataRoot);
      assert.equal(health.ok, true);
      assert.deepEqual(health.corruptCourseIds, []);

      const storedUrls = (
        db.prepare("SELECT url FROM research_sources ORDER BY url").all() as {
          url: string;
        }[]
      ).map(({ url }) => url);
      assert.deepEqual(storedUrls, suppliedUrls.slice().sort());
    } finally {
      if (db.open) db.close();
    }
  });
});
