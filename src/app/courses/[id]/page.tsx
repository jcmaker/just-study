import Link from "next/link.js";
import { notFound } from "next/navigation.js";

import { getCourseDocument } from "../../../server/courses.ts";
import {
  getRuntime,
  requireDatabase,
} from "../../../server/runtime.ts";

export const dynamic = "force-dynamic";

export default async function CoursePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let document: ReturnType<typeof getCourseDocument>;

  try {
    const runtime = getRuntime();
    document = getCourseDocument(
      requireDatabase(runtime),
      runtime.dataRoot,
      id,
    );
  } catch {
    return (
      <>
        <h1>복구가 필요합니다.</h1>
        <section className="recovery" role="alert">
          <h2>과정 데이터를 확인할 수 없습니다.</h2>
          <p>저장된 내용을 정상 과정으로 표시하지 않았습니다.</p>
          <Link href="/status">상태에서 복구 방법 확인하기</Link>
        </section>
      </>
    );
  }

  if (!document) notFound();

  return (
    <>
      <h1>{document.course.title}</h1>
      <p className="lead">검증된 원본 과정 문서입니다.</p>
      <article>
        <pre>{document.markdown}</pre>
      </article>
    </>
  );
}
