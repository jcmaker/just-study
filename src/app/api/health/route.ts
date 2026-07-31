import { NextResponse } from "next/server.js";

import { getHealth } from "../../../server/health.ts";
import { getRuntime } from "../../../server/runtime.ts";

export function GET(): NextResponse {
  const { db, dataRoot } = getRuntime();
  const health = getHealth(db, dataRoot);
  return NextResponse.json(health, { status: health.ok ? 200 : 503 });
}
