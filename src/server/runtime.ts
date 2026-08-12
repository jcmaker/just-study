import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { DatabaseHandle } from "./database.ts";
import { openDatabase, openDatabaseReadOnly } from "./database.ts";

export type Runtime = {
  dataRoot: string;
  db: DatabaseHandle | null;
};

export class DatabaseUnavailableError extends Error {}

const runtimeGlobal = globalThis as typeof globalThis & {
  __justStudyRuntime?: Runtime;
};

// 저장 위치는 실행 디렉터리와 무관해야 한다. cwd 기준이면 레포에서 띄울 때와
// 플러그인 캐시에서 띄울 때 저장소가 조용히 둘로 갈리고, 캐시 쪽은 플러그인을
// 업데이트하면 사라진다.
function resolveDataRoot(): string {
  return resolve(
    process.env.JUST_STUDY_DATA_DIR ?? join(homedir(), ".just-study", "data"),
  );
}

export function getRuntime(dataRoot?: string): Runtime {
  if (!runtimeGlobal.__justStudyRuntime) {
    const resolvedDataRoot = dataRoot ?? resolveDataRoot();
    let db: DatabaseHandle | null = null;

    try {
      db = openDatabase(resolvedDataRoot);
    } catch {
      // Health remains callable with storage checks after database startup fails.
    }

    runtimeGlobal.__justStudyRuntime = { dataRoot: resolvedDataRoot, db };
  }

  return runtimeGlobal.__justStudyRuntime;
}

export function initializeExistingRuntime(): void {
  if (runtimeGlobal.__justStudyRuntime) return;

  const dataRoot = resolveDataRoot();
  if (!existsSync(join(dataRoot, "just-study.sqlite"))) return;

  getRuntime(dataRoot);
}

export function getReadOnlyRuntime(): Runtime & { close(): void } {
  if (runtimeGlobal.__justStudyRuntime) {
    return { ...runtimeGlobal.__justStudyRuntime, close() {} };
  }

  const dataRoot = resolveDataRoot();
  let db: DatabaseHandle | null = null;

  try {
    db = openDatabaseReadOnly(dataRoot);
  } catch {
    // A missing or unreadable database is reported by the non-mutating health check.
  }

  return {
    dataRoot,
    db,
    close() { db?.close(); },
  };
}

export function requireDatabase(runtime: Runtime): DatabaseHandle {
  if (!runtime.db) throw new DatabaseUnavailableError("Database is unavailable");
  return runtime.db;
}
