import { randomUUID } from "node:crypto";

import Link from "next/link.js";

import { getDashboardOverview } from "../../server/dashboard.ts";
import {
  COURSE_FILTERS,
  COURSE_FILTER_LABELS,
  coursesEmptyState,
  courseCardModel,
  filterCourses,
  normalizeCourseFilter,
} from "../../server/dashboard-view.ts";
import { getRuntime } from "../../server/runtime.ts";
import { CourseCard } from "../course-card.tsx";
import { NewCoursePanel } from "../new-course-panel.tsx";
import { Alert, Card, buttonClass } from "../ui/primitives.tsx";

export const dynamic = "force-dynamic";

type CourseSearchParams = Record<string, string | string[] | undefined>;

function CoursesRecovery({ message }: { message: string }) {
  return (
    <>
      <h1 className="mt-0 mb-2 text-3xl font-extrabold">과정</h1>
      <Alert title="과정 목록을 불러올 수 없습니다." tone="danger">
        <p className="mt-0 mb-2">{message}</p>
        <Link href="/status" className="tap-target inline-flex items-center underline">상태 화면에서 복구 방법 확인하기</Link>
      </Alert>
    </>
  );
}

export default async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<CourseSearchParams>;
}) {
  const params = await searchParams;
  const filter = normalizeCourseFilter(params?.filter);
  const runtime = getRuntime();

  if (!runtime.db) {
    return <CoursesRecovery message="데이터베이스를 사용할 수 없습니다. 저장된 과정이 없는 것이 아니라 읽지 못한 상태입니다." />;
  }

  let courses: ReturnType<typeof getDashboardOverview>["courses"];
  try {
    ({ courses } = getDashboardOverview(runtime.db));
  } catch {
    return <CoursesRecovery message="데이터베이스를 읽는 중 문제가 발생했습니다. 저장된 과정이 없는 것이 아니라 읽지 못한 상태입니다." />;
  }
  const visible = filterCourses(courses, filter);
  const empty = coursesEmptyState(courses.length, visible.length, filter);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-3xl font-extrabold">과정</h1>
        <NewCoursePanel requestId={randomUUID()} />
      </div>

      <nav aria-label="상태 필터" className="mb-5">
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {COURSE_FILTERS.map((value) => {
            const active = value === filter;
            return (
              <li key={value}>
                <Link
                  href={value === "all" ? "/courses" : `/courses?filter=${value}`}
                  aria-current={active ? "true" : undefined}
                  className={`${buttonClass(active ? "primary" : "secondary")} ${active ? "font-extrabold" : ""}`}
                >
                  {COURSE_FILTER_LABELS[value]}
                  {active ? <span className="sr-only"> (선택됨)</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {empty ? (
        <Card>
          <h2 className="mt-0 mb-2 text-xl font-bold">{empty.title}</h2>
          <p className="mt-0 mb-4">{empty.description}</p>
          {empty.kind === "no-courses"
            ? <NewCoursePanel requestId={randomUUID()} />
            : <Link href="/courses" className={buttonClass("secondary")}>{empty.actionLabel}</Link>}
        </Card>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((course) => (
            <li key={course.id}><CourseCard card={courseCardModel(course)} /></li>
          ))}
        </ul>
      )}
    </>
  );
}
