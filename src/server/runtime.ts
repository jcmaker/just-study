import { existsSync } from "node:fs";
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

function resolveDataRoot(): string {
  return resolve(
    process.env.JUST_STUDY_DATA_DIR ?? resolve(process.cwd(), "data"),
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
