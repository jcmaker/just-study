import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import type { DatabaseHandle } from "./database.ts";
import {
  discardCourseDraft,
  finalizeCourseFiles,
  prepareCourseFiles,
  readVerifiedMarkdown,
} from "./storage.ts";

export type Course = {
  id: string;
  requestId: string;
  title: string;
  goal: string;
  markdownPath: string;
  markdownSha256: string;
  createdAt: string;
  updatedAt: string;
};

export type CourseDocument = {
  course: Course;
  markdown: string;
};

export type CreateCourseInput = {
  requestId: string;
  title: string;
  goal: string;
};

type CourseRow = {
  id: string;
  request_id: string;
  title: string;
  goal: string;
  markdown_path: string;
  markdown_sha256: string;
  created_at: string;
  updated_at: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MARKDOWN_PUNCTUATION = /[!-/:-@[-`{-~]/g;

export class CourseValidationError extends Error {}

function rowToCourse(row: CourseRow): Course {
  return {
    id: row.id,
    requestId: row.request_id,
    title: row.title,
    goal: row.goal,
    markdownPath: row.markdown_path,
    markdownSha256: row.markdown_sha256,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeInput(input: CreateCourseInput): CreateCourseInput {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.requestId !== "string" ||
    typeof input.title !== "string" ||
    typeof input.goal !== "string"
  ) {
    throw new CourseValidationError("과정 요청 형식이 올바르지 않습니다.");
  }

  if (!UUID_PATTERN.test(input.requestId)) {
    throw new CourseValidationError("요청 ID가 올바른 UUID가 아닙니다.");
  }

  const title = input.title.trim();
  const goal = input.goal.trim();

  if (title.length < 1 || title.length > 120 || /[\r\n]/.test(title)) {
    throw new CourseValidationError("과정 제목은 줄바꿈 없이 1~120자여야 합니다.");
  }
  if (goal.length < 1 || goal.length > 2_000) {
    throw new CourseValidationError("학습 목표는 1~2,000자여야 합니다.");
  }

  return { requestId: input.requestId, title, goal };
}

function escapeMarkdown(value: string): string {
  return value.replace(MARKDOWN_PUNCTUATION, "\\$&");
}

function renderMarkdown(title: string, goal: string): string {
  const quotedGoal = goal
    .split(/\r\n?|\n/)
    .map((line) => `> ${escapeMarkdown(line)}`)
    .join("\n");
  return `# ${escapeMarkdown(title)}\n\n## 학습 목표\n\n${quotedGoal}\n`;
}

function findByRequestId(db: DatabaseHandle, requestId: string): Course | null {
  const row = db
    .prepare("SELECT * FROM courses WHERE request_id = ?")
    .get(requestId) as CourseRow | undefined;
  return row ? rowToCourse(row) : null;
}

export function getCourse(db: DatabaseHandle, id: string): Course | null {
  const row = db
    .prepare("SELECT * FROM courses WHERE id = ?")
    .get(id) as CourseRow | undefined;
  return row ? rowToCourse(row) : null;
}

export function listCourses(db: DatabaseHandle): Course[] {
  return (
    db
      .prepare("SELECT * FROM courses ORDER BY created_at DESC, id ASC")
      .all() as CourseRow[]
  ).map(rowToCourse);
}

export function createCourse(
  db: DatabaseHandle,
  dataRoot: string,
  rawInput: CreateCourseInput,
): { course: Course; created: boolean } {
  const input = normalizeInput(rawInput);
  const existing = findByRequestId(db, input.requestId);
  if (existing) return { course: existing, created: false };

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO courses (
      id, request_id, title, goal, markdown_path, markdown_sha256, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const draft = prepareCourseFiles(dataRoot, id, renderMarkdown(input.title, input.goal));

  try {
    db.transaction(() => {
      insert.run(
        id,
        input.requestId,
        input.title,
        input.goal,
        draft.relativeMarkdownPath,
        draft.sha256,
        createdAt,
        createdAt,
      );
      finalizeCourseFiles(draft);
    })();
  } catch (error) {
    if (existsSync(draft.tempDirectory)) {
      try {
        discardCourseDraft(draft);
      } catch {
        // The transaction or finalization failure is the actionable error.
      }
    }

    const duplicate = findByRequestId(db, input.requestId);
    if (duplicate) return { course: duplicate, created: false };
    throw error;
  }

  const course = getCourse(db, id);
  if (!course) throw new Error("Created course could not be read");
  return { course, created: true };
}

export function getCourseDocument(
  db: DatabaseHandle,
  dataRoot: string,
  id: string,
): CourseDocument | null {
  const course = getCourse(db, id);
  if (!course) return null;

  return {
    course,
    markdown: readVerifiedMarkdown(
      dataRoot,
      course.markdownPath,
      course.markdownSha256,
    ),
  };
}
