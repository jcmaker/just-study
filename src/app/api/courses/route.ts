import { NextResponse } from "next/server.js";

import {
  CourseValidationError,
  type CreateCourseInput,
  createCourse,
  listCourses,
} from "../../../server/courses.ts";
import {
  DatabaseUnavailableError,
  getRuntime,
  requireDatabase,
} from "../../../server/runtime.ts";

export function GET(): NextResponse {
  try {
    return NextResponse.json(listCourses(requireDatabase(getRuntime())));
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
          { error: "과정 목록을 읽지 못했습니다. 잠시 후 다시 시도해 주세요." },
          { status: 500 },
        );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return NextResponse.json(
      { error: "Content-Type은 application/json이어야 합니다." },
      { status: 415 },
    );
  }

  const origin = request.headers.get("origin");
  if (
    request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site" ||
    (origin !== null && origin !== new URL(request.url).origin)
  ) {
    return NextResponse.json(
      { error: "교차 사이트 요청은 허용되지 않습니다." },
      { status: 403 },
    );
  }

  try {
    const input = (await request.json()) as CreateCourseInput;
    const runtime = getRuntime();
    const result = createCourse(
      requireDatabase(runtime),
      runtime.dataRoot,
      input,
    );
    return NextResponse.json(result.course, {
      status: result.created ? 201 : 200,
    });
  } catch (error) {
    if (error instanceof CourseValidationError || error instanceof SyntaxError) {
      return NextResponse.json(
        {
          error:
            error instanceof CourseValidationError
              ? error.message
              : "요청 본문이 올바른 JSON이 아닙니다.",
        },
        { status: 400 },
      );
    }
    if (error instanceof DatabaseUnavailableError) {
      return NextResponse.json(
        {
          error:
            "데이터베이스를 사용할 수 없습니다. 데이터베이스 파일, 스키마 및 권한을 확인해 주세요.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      {
        error:
          "과정을 저장하지 못했습니다. 데이터 저장소 권한을 확인한 뒤 다시 시도해 주세요.",
      },
      { status: 500 },
    );
  }
}
