import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { createCourse } from "../src/server/courses.ts";
import {
  openDatabase,
  SCHEMA_VERSION,
  type DatabaseHandle,
} from "../src/server/database.ts";
import { getHealth } from "../src/server/health.ts";

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
