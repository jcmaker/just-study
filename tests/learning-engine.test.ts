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
