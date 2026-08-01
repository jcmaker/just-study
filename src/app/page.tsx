import Link from "next/link.js";

import { getDashboardOverview } from "../server/dashboard.ts";
import {
  attentionItems,
  courseCardModel,
  resumeCardModel,
} from "../server/dashboard-view.ts";
import { getRuntime } from "../server/runtime.ts";
import { CopyCommand, LocalDate } from "./copy-command.tsx";
import { CourseCard } from "./course-card.tsx";
import { Alert, Card, CardHeader, ProgressBar, buttonClass } from "./ui/primitives.tsx";

export const dynamic = "force-dynamic";

export default function TodayPage() {
  const runtime = getRuntime();
  if (!runtime.db) {
    return (
      <>
        <h1 className="mt-0 mb-2 text-3xl font-extrabold">오늘</h1>
        <Alert title="학습 데이터를 불러올 수 없습니다." tone="danger">
          <p className="mt-0 mb-2">데이터베이스를 사용할 수 없어 진행 상황을 표시하지 않았습니다. 저장된 학습 기록은 변경되지 않았습니다.</p>
          <Link href="/status" className="tap-target inline-flex items-center underline">상태 화면에서 복구 방법 확인하기</Link>
        </Alert>
      </>
    );
  }

  let overview: ReturnType<typeof getDashboardOverview>;
  try {
    overview = getDashboardOverview(runtime.db);
  } catch {
    return (
      <>
        <h1 className="mt-0 mb-2 text-3xl font-extrabold">오늘</h1>
        <Alert title="학습 데이터를 불러올 수 없습니다." tone="danger">
          <p className="mt-0 mb-2">데이터베이스를 읽는 중 문제가 발생했습니다. 저장된 학습 기록은 변경되지 않았습니다.</p>
          <Link href="/status" className="tap-target inline-flex items-center underline">상태 화면에서 복구 방법 확인하기</Link>
        </Alert>
      </>
    );
  }
  const resume = resumeCardModel(overview.courses);
  const attention = attentionItems(overview.courses);
  const { totals, recentDays } = overview;

  return (
    <>
      <p className="mt-0 mb-1 text-sm text-muted-foreground">내 컴퓨터에 저장된 학습</p>
      <h1 className="mt-0 mb-6 text-3xl font-extrabold">오늘 이어갈 학습</h1>

      <Card className="mb-6">
        <CardHeader title={resume.title} description={resume.description} />
        {resume.dayLabel || resume.stageLabel ? (
          <p className="mt-0 mb-2 font-semibold">{[resume.dayLabel, resume.stageLabel].filter(Boolean).join(" · ")}</p>
        ) : null}
        {resume.objective ? <p className="mt-0 mb-3">{resume.objective}</p> : null}
        {resume.progress ? <div className="mb-4"><ProgressBar {...resume.progress} label="현재 과정 진도" /></div> : null}
        {resume.command ? (
          <CopyCommand command={resume.command} />
        ) : (
          <Link href={resume.href ?? "/courses"} className={buttonClass("primary")}>
            {resume.actionLabel ?? "새 과정 만들기"}
          </Link>
        )}
        {resume.command && resume.href ? (
          <p className="mt-3 mb-0"><Link href={resume.href} className="tap-target inline-flex items-center underline">{resume.actionLabel}</Link></p>
        ) : null}
      </Card>

      <section aria-labelledby="attention" className="mb-6">
        <h2 id="attention" className="mt-0 mb-3 text-xl font-bold">주의가 필요한 학습</h2>
        {attention.length === 0 ? (
          <Card><p className="m-0 text-sm text-muted-foreground">지금 주의가 필요한 과정이 없습니다.</p></Card>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0">
            {attention.map((item) => (
              <li key={item.courseId}>
                <Card className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="m-0 font-semibold break-words">{item.courseTitle}</p>
                    <p className="m-0 text-sm text-muted-foreground">{item.message}</p>
                  </div>
                  <Link href={item.href} className={buttonClass("secondary")}>바로 가기</Link>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="metrics" className="mb-6">
        <h2 id="metrics" className="mt-0 mb-3 text-xl font-bold">저장된 학습 집계</h2>
        <dl className="m-0 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { term: "진행 중 과정", value: `${totals.activeCourseCount}개`, hint: "목차를 승인하고 아직 완료하지 않은 과정" },
            { term: "완료 Day", value: `${totals.completedDayCount} / ${totals.approvedDayCount}`, hint: "회고까지 마친 Day 수 / 승인된 전체 Day 수" },
            { term: "선정 출처", value: `${totals.selectedSourceCount}개`, hint: "중복 URL을 제외하고 선정된 검증 자료" },
            { term: "완료 과정", value: `${totals.completedCourseCount}개`, hint: "Day 30까지 마친 과정" },
          ].map(({ term, value, hint }) => (
            <div key={term} className="surface p-4">
              <dt className="m-0 text-sm text-muted-foreground">{term}</dt>
              <dd className="mt-1 mb-0">
                <span className="block text-2xl font-extrabold">{value}</span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="courses" className="mb-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="courses" className="m-0 text-xl font-bold">과정</h2>
          <Link href="/courses" className="tap-target inline-flex items-center underline">전체 보기</Link>
        </div>
        {overview.courses.length === 0 ? (
          <Card>
            <p className="mt-0 mb-3">아직 저장된 과정이 없습니다.</p>
            <Link href="/courses" className={buttonClass("primary")}>첫 과정 만들기</Link>
          </Card>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2">
            {overview.courses.map((course) => (
              <li key={course.id}><CourseCard card={courseCardModel(course)} /></li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="recent">
        <h2 id="recent" className="mt-0 mb-3 text-xl font-bold">최근 완료한 Day</h2>
        {recentDays.length === 0 ? (
          <Card><p className="m-0 text-sm text-muted-foreground">아직 완료한 Day가 없습니다. 첫 Day를 마치면 여기에 기록이 남습니다.</p></Card>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0">
            {recentDays.map((day) => (
              <li key={day.dayId}>
                <Card>
                  <p className="m-0 text-sm text-muted-foreground">{day.courseTitle}</p>
                  <p className="m-0 font-semibold">Day {day.dayNumber} · {day.objective}</p>
                  <p className="m-0 text-xs text-muted-foreground">
                    완료 <LocalDate iso={day.completedAt} /> ·{" "}
                    <Link href={`/courses/${day.courseId}?tab=journal`} className="tap-target inline-flex items-center underline">학습 기록 보기</Link>
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
