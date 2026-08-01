import Link from "next/link.js";
import { notFound } from "next/navigation.js";

import {
  courseCardModel,
  normalizeTab,
  RESUME_COMMAND,
  STAGE_LABELS,
  STATUS_LABELS,
} from "../../../server/dashboard-view.ts";
import {
  getCourseHistory,
  getLearningSnapshot,
  LearningStateError,
  type CourseHistory,
  type LearningSnapshot,
} from "../../../server/learning.ts";
import { getRuntime, requireDatabase } from "../../../server/runtime.ts";
import { StorageError } from "../../../server/storage.ts";
import { CopyCommand } from "../../copy-command.tsx";
import { DraftForm } from "../../draft-form.tsx";
import { Alert, Badge, ProgressBar } from "../../ui/primitives.tsx";
import { CourseContextBar } from "./context-bar.tsx";
import {
  CourseTabStrip,
  JournalPanel,
  OverviewPanel,
  PlanPanel,
  QuizPanel,
  SourcesPanel,
  TodayPanel,
} from "./tabs.tsx";

export const dynamic = "force-dynamic";

type CourseSearchParams = Record<string, string | string[] | undefined>;

function CourseRecovery({ message }: { message: string }) {
  return (
    <Alert title="과정을 불러올 수 없습니다." tone="danger">
      <p className="mt-0 mb-2">{message}</p>
      <Link href="/status" className="tap-target inline-flex items-center underline">상태 화면에서 복구 방법 확인하기</Link>
    </Alert>
  );
}

export default async function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<CourseSearchParams>;
}) {
  const { id } = await params;
  const tab = normalizeTab((await searchParams).tab);
  const runtime = getRuntime();

  if (!runtime.db) {
    return <CourseRecovery message="데이터베이스를 사용할 수 없습니다. 저장된 과정이 없는 것이 아니라 읽지 못한 상태입니다." />;
  }

  let history: CourseHistory | null;
  try {
    history = getCourseHistory(requireDatabase(runtime), id);
  } catch {
    return <CourseRecovery message="저장된 과정 정보를 읽는 중 문제가 발생했습니다. 저장된 내용을 빈 과정으로 표시하지 않았습니다." />;
  }
  if (!history) notFound();

  let snapshot: LearningSnapshot | null = null;
  let verified = true;
  let stateError = false;
  try {
    snapshot = getLearningSnapshot(requireDatabase(runtime), runtime.dataRoot, id);
  } catch (error) {
    if (error instanceof StorageError) {
      verified = false;
    } else if (error instanceof LearningStateError) {
      stateError = true;
    } else {
      return <CourseRecovery message="학습 문서를 읽는 중 문제가 발생했습니다. 저장된 내용을 빈 문서로 표시하지 않았습니다." />;
    }
  }

  const { course } = history;
  const card = courseCardModel({
    id: course.id,
    title: course.title,
    goal: course.goal,
    status: course.status,
    currentDayNumber: snapshot?.currentDay?.dayNumber
      ?? history.days.find(({ id: dayId }) => dayId === course.currentDayId)?.dayNumber
      ?? null,
    currentDayObjective: null,
    currentStage: course.currentStage,
    approvedDayCount: history.days.length,
    completedDayCount: history.days.filter(({ completedAt }) => completedAt !== null).length,
    hasQuizResponse: false,
    revision: course.revision,
    outlineApprovedAt: course.outlineApprovedAt,
    completedAt: course.completedAt,
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
  });

  return (
    <>
      <CourseContextBar title={course.title} dayLabel={card.dayLabel} />

      <p className="mt-0 mb-2 text-sm max-lg:hidden">
        <Link href="/courses" className="tap-target inline-flex items-center underline">과정</Link>
        <span aria-hidden="true"> / </span>
        <span className="text-muted-foreground">{course.title}</span>
      </p>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="mt-0 mb-2 text-3xl font-extrabold break-words">{course.title}</h1>
          <p className="m-0 flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={course.status === "active" ? "accent" : "muted"}>{STATUS_LABELS[course.status]}</Badge>
            {card.dayLabel ? <span className="font-semibold">{card.dayLabel}</span> : null}
            {course.currentStage ? <span className="font-semibold">{STAGE_LABELS[course.currentStage]}</span> : null}
          </p>
        </div>
        {course.status === "completed" ? (
          <p className="m-0 font-bold">완료됨</p>
        ) : course.status === "draft" ? (
          <p className="m-0 max-w-xs text-sm">Codex에서 <code className="font-mono">$just-study</code>로 리서치와 30일 계획을 완성해 주세요.</p>
        ) : (
          <CopyCommand command={RESUME_COMMAND} />
        )}
      </div>

      {card.progress ? <div className="mb-5"><ProgressBar {...card.progress} label={`${course.title} 진도`} /></div> : null}

      {!verified ? (
        <div className="mb-5">
          <Alert title="일부 학습 문서를 확인할 수 없습니다." tone="danger">
            <p className="mt-0 mb-2">체크섬 검증에 실패한 문서는 표시하지 않았습니다. 구조화된 진도·출처·퀴즈 기록은 아래에서 그대로 확인할 수 있습니다.</p>
            <Link href="/status" className="tap-target inline-flex items-center underline">상태 화면에서 복구 방법 확인하기</Link>
          </Alert>
        </div>
      ) : null}

      {stateError ? (
        <div className="mb-5">
          <Alert title="저장된 학습 상태가 일치하지 않습니다." tone="danger">
            <p className="mt-0 mb-2">현재 Day 또는 문서 등록 정보가 어긋나 긴 학습 문서를 읽지 않았습니다. 저장된 내용은 변경하지 않았습니다.</p>
            <Link href="/status" className="tap-target inline-flex items-center underline">상태 화면에서 복구 방법 확인하기</Link>
          </Alert>
        </div>
      ) : null}

      <CourseTabStrip courseId={course.id} active={tab} />

      {tab === "overview" ? (
        <OverviewPanel
          course={course}
          history={history}
          snapshot={snapshot}
          verified={verified}
          unavailable={stateError}
          editor={
            course.status === "draft" ? (
              <DraftForm
                courseId={course.id}
                revision={course.revision}
                title={course.title}
                goal={course.goal}
              />
            ) : undefined
          }
        />
      ) : null}
      {tab === "plan" ? <PlanPanel history={history} currentDayId={course.currentDayId} /> : null}
      {tab === "today" ? <TodayPanel course={course} history={history} snapshot={snapshot} verified={verified} unavailable={stateError} /> : null}
      {tab === "sources" ? <SourcesPanel history={history} /> : null}
      {tab === "quiz" ? <QuizPanel history={history} /> : null}
      {tab === "journal" ? <JournalPanel history={history} snapshot={snapshot} verified={verified} unavailable={stateError} /> : null}
    </>
  );
}
