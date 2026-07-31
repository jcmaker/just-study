import { resolve } from "node:path";

import type { DatabaseHandle } from "./database.ts";
import { openDatabase } from "./database.ts";

export type Runtime = {
  dataRoot: string;
  db: DatabaseHandle | null;
};

export class DatabaseUnavailableError extends Error {}

const runtimeGlobal = globalThis as typeof globalThis & {
  __justStudyRuntime?: Runtime;
};

export function getRuntime(): Runtime {
  if (!runtimeGlobal.__justStudyRuntime) {
    const dataRoot = resolve(
      process.env.JUST_STUDY_DATA_DIR ?? resolve(process.cwd(), "data"),
    );
    let db: DatabaseHandle | null = null;

    try {
      db = openDatabase(dataRoot);
    } catch {
      // Health remains callable with storage checks after database startup fails.
    }

    runtimeGlobal.__justStudyRuntime = { dataRoot, db };
  }

  return runtimeGlobal.__justStudyRuntime;
}

export function requireDatabase(runtime: Runtime): DatabaseHandle {
  if (!runtime.db) throw new DatabaseUnavailableError("Database is unavailable");
  return runtime.db;
}
