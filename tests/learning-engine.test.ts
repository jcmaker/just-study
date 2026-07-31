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

import { createCourse } from "../src/server/courses.ts";
import {
  LearningRevisionConflictError,
  LearningValidationError,
  approveOutline,
  getLearningSnapshot,
  type ApproveOutlineInput,
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
