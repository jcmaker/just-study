import type { DatabaseHandle } from "./database.ts";
import { SCHEMA_VERSION } from "./database.ts";
import {
  listCourseDirectoryIds,
  listTemporaryEntries,
  probeStorageWritable,
  readVerifiedMarkdown,
} from "./storage.ts";

export type HealthReport = {
  ok: boolean;
  database: "ok" | "error";
  storage: "ok" | "error";
  schemaVersion: number | null;
  expectedSchemaVersion: number;
  orphanCourseIds: string[];
  missingCourseIds: string[];
  corruptCourseIds: string[];
  temporaryEntries: string[];
  message: string;
};

type StoredCourse = {
  id: string;
  status: "draft" | "active" | "completed";
  markdown_path: string;
  markdown_sha256: string;
  progress_markdown_path: string | null;
  progress_markdown_sha256: string | null;
  journal_markdown_path: string | null;
  journal_markdown_sha256: string | null;
  current_day_markdown_path: string | null;
  current_day_markdown_sha256: string | null;
};

export function getHealth(
  db: DatabaseHandle | null,
  dataRoot: string,
): HealthReport {
  let database: HealthReport["database"] = "ok";
  let storage: HealthReport["storage"] = "ok";
  let schemaVersion: number | null = null;
  let courses: StoredCourse[] = [];
  let courseDirectoryIds: string[] = [];
  let courseInventoryComplete = false;
  let temporaryEntries: string[] = [];

  if (db) {
    try {
      db.prepare("SELECT 1").get();
      schemaVersion = db.pragma("user_version", { simple: true }) as number;
      courses = db
        .prepare(
          `SELECT
            id, status, markdown_path, markdown_sha256,
            progress_markdown_path, progress_markdown_sha256,
            journal_markdown_path, journal_markdown_sha256,
            current_day_markdown_path, current_day_markdown_sha256
          FROM courses ORDER BY id`,
        )
        .all() as StoredCourse[];
    } catch {
      database = "error";
    }
  } else {
    database = "error";
  }

  try {
    probeStorageWritable(dataRoot);
  } catch {
    storage = "error";
  }

  try {
    courseDirectoryIds = listCourseDirectoryIds(dataRoot);
    courseInventoryComplete = true;
  } catch {
    storage = "error";
  }

  try {
    temporaryEntries = listTemporaryEntries(dataRoot);
  } catch {
    storage = "error";
  }

  const known = new Set(courses.map(({ id }) => id));
  const stored = new Set(courseDirectoryIds);
  const canInspectCourses = database === "ok" && courseInventoryComplete;
  const orphanCourseIds =
    canInspectCourses
      ? courseDirectoryIds.filter((id) => !known.has(id))
      : [];
  const missingCourseIds =
    canInspectCourses
      ? courses.map(({ id }) => id).filter((id) => !stored.has(id))
      : [];
  const corruptCourseIds =
    canInspectCourses
      ? courses
          .filter(({
            id,
            status,
            markdown_path,
            markdown_sha256,
            progress_markdown_path,
            progress_markdown_sha256,
            journal_markdown_path,
            journal_markdown_sha256,
            current_day_markdown_path,
            current_day_markdown_sha256,
          }) => {
            if (!stored.has(id)) return false;
            if (
              (status === "draft" && [
                progress_markdown_path,
                progress_markdown_sha256,
                journal_markdown_path,
                journal_markdown_sha256,
                current_day_markdown_path,
                current_day_markdown_sha256,
              ].some((value) => value !== null)) ||
              (status === "completed" && (
                current_day_markdown_path !== null ||
                current_day_markdown_sha256 !== null
              ))
            ) return true;

            const registeredDocuments = [
              [`courses/${id}/course.md`, markdown_path, markdown_sha256],
              ...(status === "draft"
                ? []
                : [
                    [`courses/${id}/progress.md`, progress_markdown_path, progress_markdown_sha256],
                    [`courses/${id}/journal.md`, journal_markdown_path, journal_markdown_sha256],
                  ]),
              ...(status === "active"
                ? [[
                    `courses/${id}/current-day.md`,
                    current_day_markdown_path,
                    current_day_markdown_sha256,
                  ]]
                : []),
            ] as const;

            return registeredDocuments.some(([expectedPath, path, checksum]) => {
              if (path === null || checksum === null || path !== expectedPath) return true;
              try {
                readVerifiedMarkdown(dataRoot, path, checksum);
                return false;
              } catch {
                return true;
              }
            });
          })
          .map(({ id }) => id)
      : [];
  const consistent =
    orphanCourseIds.length === 0 &&
    missingCourseIds.length === 0 &&
    corruptCourseIds.length === 0 &&
    temporaryEntries.length === 0;
  const schemaOk = schemaVersion === SCHEMA_VERSION;
  const ok =
    database === "ok" &&
    storage === "ok" &&
    schemaOk &&
    consistent;
  const message =
    database === "error" && storage === "error"
      ? "데이터 저장소 권한과 데이터베이스 파일, 스키마 및 권한을 확인해 주세요."
      : storage === "error"
        ? "데이터 저장소를 사용할 수 없습니다. 데이터 디렉터리 권한을 확인해 주세요."
        : database === "error" || !schemaOk
          ? "데이터베이스를 사용할 수 없습니다. 데이터베이스 파일, 스키마 및 권한을 확인해 주세요."
          : !consistent
            ? "저장 데이터가 일치하지 않습니다. 데이터 복구가 필요합니다."
            : "시스템이 정상입니다. 서비스를 계속 사용할 수 있습니다.";

  return {
    ok,
    database,
    storage,
    schemaVersion,
    expectedSchemaVersion: SCHEMA_VERSION,
    orphanCourseIds,
    missingCourseIds,
    corruptCourseIds,
    temporaryEntries,
    message,
  };
}
