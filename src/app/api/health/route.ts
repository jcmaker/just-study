import { NextResponse } from "next/server.js";

import { getHealth } from "../../../server/health.ts";
import {
  getReadOnlyRuntime,
  initializeExistingRuntime,
} from "../../../server/runtime.ts";

export function GET(): NextResponse {
  initializeExistingRuntime();
  const runtime = getReadOnlyRuntime();
  try {
    const health = getHealth(runtime.db, runtime.dataRoot);
    return NextResponse.json(health, { status: health.ok ? 200 : 503 });
  } finally {
    runtime.close();
  }
}
