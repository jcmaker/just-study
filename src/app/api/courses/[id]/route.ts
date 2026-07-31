import { NextResponse } from "next/server.js";

import { getCourseDocument } from "../../../../server/courses.ts";
import {
  DatabaseUnavailableError,
  getRuntime,
  requireDatabase,
} from "../../../../server/runtime.ts";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const runtime = getRuntime();
    const document = getCourseDocument(
      requireDatabase(runtime),
      runtime.dataRoot,
      id,
    );
    return document
      ? NextResponse.json(document)
      : NextResponse.json(
          { error: "과정을 찾을 수 없습니다." },
          { status: 404 },
        );
  } catch (error) {
    return error instanceof DatabaseUnavailableError
      ? NextResponse.json(
          {
            error:
              "데이터베이스를 사용할 수 없습니다. 데이터베이스 파일, 스키마 및 권한을 확인해 주세요.",
          },
          { status: 503 },
        )
      : NextResponse.json(
          {
            error:
              "과정을 읽지 못했습니다. 저장 데이터 복구가 필요한지 확인해 주세요.",
          },
          { status: 500 },
        );
  }
}
