import { mkdirSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";

export const SCHEMA_VERSION = 2;
export type DatabaseHandle = Database.Database;

const INITIAL_SCHEMA = `
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
`;

const LEARNING_SCHEMA = `
  ALTER TABLE courses ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'
    CHECK(status IN ('draft', 'active', 'completed'));
  ALTER TABLE courses ADD COLUMN prior_knowledge TEXT;
  ALTER TABLE courses ADD COLUMN learning_preference TEXT
    CHECK(learning_preference IN ('examples', 'theory', 'practice'));
  ALTER TABLE courses ADD COLUMN current_stage TEXT
    CHECK(current_stage IN ('lecture', 'quiz', 'remediation', 'reflection'));
  ALTER TABLE courses ADD COLUMN revision INTEGER NOT NULL DEFAULT 0
    CHECK(revision >= 0);
  ALTER TABLE courses ADD COLUMN outline_approved_at TEXT;
  ALTER TABLE courses ADD COLUMN completed_at TEXT;
  ALTER TABLE courses ADD COLUMN progress_markdown_path TEXT;
  ALTER TABLE courses ADD COLUMN progress_markdown_sha256 TEXT
    CHECK(progress_markdown_sha256 IS NULL OR length(progress_markdown_sha256) = 64);
  ALTER TABLE courses ADD COLUMN journal_markdown_path TEXT;
  ALTER TABLE courses ADD COLUMN journal_markdown_sha256 TEXT
    CHECK(journal_markdown_sha256 IS NULL OR length(journal_markdown_sha256) = 64);
  ALTER TABLE courses ADD COLUMN current_day_markdown_path TEXT;
  ALTER TABLE courses ADD COLUMN current_day_markdown_sha256 TEXT
    CHECK(current_day_markdown_sha256 IS NULL OR length(current_day_markdown_sha256) = 64);

  CREATE TABLE course_days (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    day_number INTEGER NOT NULL CHECK(day_number BETWEEN 1 AND 30),
    objective TEXT NOT NULL CHECK(length(objective) BETWEEN 1 AND 500),
    completed_at TEXT,
    UNIQUE(course_id, day_number),
    UNIQUE(course_id, id)
  );

  ALTER TABLE courses ADD COLUMN current_day_id TEXT REFERENCES course_days(id);

  CREATE TRIGGER courses_current_day_owner_insert
  BEFORE INSERT ON courses
  WHEN NEW.current_day_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM course_days
      WHERE id = NEW.current_day_id AND course_id = NEW.id
    )
  BEGIN
    SELECT RAISE(ABORT, 'current Day belongs to another course');
  END;

  CREATE TRIGGER courses_current_day_owner_update
  BEFORE UPDATE OF current_day_id, id ON courses
  WHEN NEW.current_day_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM course_days
      WHERE id = NEW.current_day_id AND course_id = NEW.id
    )
  BEGIN
    SELECT RAISE(ABORT, 'current Day belongs to another course');
  END;

  CREATE UNIQUE INDEX courses_progress_path
    ON courses(progress_markdown_path) WHERE progress_markdown_path IS NOT NULL;
  CREATE UNIQUE INDEX courses_journal_path
    ON courses(journal_markdown_path) WHERE journal_markdown_path IS NOT NULL;
  CREATE UNIQUE INDEX courses_current_day_path
    ON courses(current_day_markdown_path) WHERE current_day_markdown_path IS NOT NULL;

  CREATE TABLE research_runs (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    day_id TEXT,
    scope TEXT NOT NULL CHECK(scope IN ('course', 'day')),
    questions_json TEXT NOT NULL CHECK(json_valid(questions_json)),
    topic_criteria_json TEXT NOT NULL CHECK(json_valid(topic_criteria_json)),
    created_at TEXT NOT NULL,
    CHECK(
      (scope = 'course' AND day_id IS NULL) OR
      (scope = 'day' AND day_id IS NOT NULL)
    ),
    UNIQUE(id, course_id),
    FOREIGN KEY(course_id, day_id)
      REFERENCES course_days(course_id, id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX one_course_research
    ON research_runs(course_id) WHERE scope = 'course';
  CREATE UNIQUE INDEX one_day_research
    ON research_runs(day_id) WHERE scope = 'day';

  CREATE TABLE research_sources (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    publisher TEXT NOT NULL,
    independence_key TEXT NOT NULL,
    authority_score INTEGER NOT NULL CHECK(authority_score BETWEEN 0 AND 25),
    cross_validation_score INTEGER NOT NULL CHECK(cross_validation_score BETWEEN 0 AND 25),
    relevance_score INTEGER NOT NULL CHECK(relevance_score BETWEEN 0 AND 20),
    teaching_quality_score INTEGER NOT NULL CHECK(teaching_quality_score BETWEEN 0 AND 15),
    currency_score INTEGER NOT NULL CHECK(currency_score BETWEEN 0 AND 10),
    accessibility_score INTEGER NOT NULL CHECK(accessibility_score BETWEEN 0 AND 5),
    total_score INTEGER GENERATED ALWAYS AS (
      authority_score + cross_validation_score + relevance_score +
      teaching_quality_score + currency_score + accessibility_score
    ) STORED,
    rank INTEGER NOT NULL CHECK(rank > 0),
    selected INTEGER NOT NULL CHECK(selected IN (0, 1)),
    selection_reason TEXT,
    limitation TEXT,
    UNIQUE(run_id, url),
    UNIQUE(run_id, rank),
    UNIQUE(run_id, id)
  );

  CREATE TABLE research_claims (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    statement TEXT NOT NULL,
    major INTEGER NOT NULL CHECK(major IN (0, 1)),
    conclusion TEXT NOT NULL,
    uncertainty TEXT,
    UNIQUE(run_id, id)
  );

  CREATE TABLE research_claim_evidence (
    run_id TEXT NOT NULL,
    claim_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    stance TEXT NOT NULL CHECK(stance IN ('supports', 'opposes', 'context')),
    PRIMARY KEY(claim_id, source_id, stance),
    FOREIGN KEY(run_id, claim_id)
      REFERENCES research_claims(run_id, id) ON DELETE CASCADE,
    FOREIGN KEY(run_id, source_id)
      REFERENCES research_sources(run_id, id) ON DELETE CASCADE
  );

  CREATE TABLE day_concepts (
    day_id TEXT NOT NULL REFERENCES course_days(id) ON DELETE CASCADE,
    concept_key TEXT NOT NULL,
    label TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('understood', 'remediation')),
    updated_at TEXT NOT NULL,
    PRIMARY KEY(day_id, concept_key)
  );

  CREATE TABLE day_lesson_parts (
    day_id TEXT NOT NULL REFERENCES course_days(id) ON DELETE CASCADE,
    part TEXT NOT NULL CHECK(part IN (
      'recall', 'precise', 'eli5', 'analogy', 'example', 'application', 'interview'
    )),
    saved_at TEXT NOT NULL,
    PRIMARY KEY(day_id, part)
  );

  CREATE TABLE quiz_attempts (
    id TEXT PRIMARY KEY,
    day_id TEXT NOT NULL REFERENCES course_days(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL CHECK(attempt_number > 0),
    status TEXT NOT NULL CHECK(status IN ('in_progress', 'passed', 'failed')),
    score INTEGER CHECK(score BETWEEN 0 AND 5),
    created_at TEXT NOT NULL,
    graded_at TEXT,
    UNIQUE(day_id, attempt_number),
    UNIQUE(day_id, id)
  );

  CREATE TABLE quiz_questions (
    id TEXT PRIMARY KEY,
    day_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL,
    position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 5),
    concept_key TEXT NOT NULL,
    concept_label TEXT NOT NULL,
    prompt TEXT NOT NULL,
    prompt_sha256 TEXT NOT NULL CHECK(length(prompt_sha256) = 64),
    grading_criteria TEXT NOT NULL,
    UNIQUE(attempt_id, position),
    UNIQUE(day_id, prompt_sha256),
    UNIQUE(attempt_id, id),
    FOREIGN KEY(day_id, attempt_id)
      REFERENCES quiz_attempts(day_id, id) ON DELETE CASCADE
  );

  CREATE TABLE quiz_responses (
    id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL,
    question_id TEXT NOT NULL,
    response_number INTEGER NOT NULL CHECK(response_number > 0),
    answer TEXT NOT NULL,
    result TEXT NOT NULL
      CHECK(result IN ('correct', 'incorrect', 'needs_clarification')),
    feedback TEXT NOT NULL,
    clarification_question TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(question_id, response_number),
    FOREIGN KEY(attempt_id, question_id)
      REFERENCES quiz_questions(attempt_id, id) ON DELETE CASCADE
  );
`;

function migrateDatabase(db: DatabaseHandle): void {
  const current = db.pragma("user_version", { simple: true }) as number;

  if (current > SCHEMA_VERSION) {
    throw new Error(`Database schema ${current} is newer than supported ${SCHEMA_VERSION}`);
  }

  db.transaction(() => {
    let version = current;
    if (version === 0) {
      db.exec(INITIAL_SCHEMA);
      db.pragma("user_version = 1");
      version = 1;
    }
    if (version === 1) {
      db.exec(LEARNING_SCHEMA);
      db.pragma("user_version = 2");
    }
  })();
}

export function openDatabase(dataRoot: string): DatabaseHandle {
  mkdirSync(dataRoot, { recursive: true });
  const db = new Database(join(dataRoot, "just-study.sqlite"));

  try {
    const current = db.pragma("user_version", { simple: true }) as number;

    if (current > SCHEMA_VERSION) {
      throw new Error(`Database schema ${current} is newer than supported ${SCHEMA_VERSION}`);
    }

    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    migrateDatabase(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
