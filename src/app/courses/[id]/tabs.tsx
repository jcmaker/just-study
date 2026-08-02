import Link from "next/link.js";
import type { ReactNode } from "react";

import {
  COURSE_TABS,
  COURSE_TAB_LABELS,
  documentState,
  STAGE_LABELS,
  stageSteps,
  type CourseTab,
} from "../../../server/dashboard-view.ts";
import type { CourseHistory, CourseHistoryCourse, LearningSnapshot } from "../../../server/learning.ts";
import { MarkdownView } from "../../ui/markdown-view.tsx";
import { Badge, Card, CardHeader } from "../../ui/primitives.tsx";

export function CourseTabStrip({ courseId, active }: { courseId: string; active: CourseTab }) {
  return (
    <nav aria-label="과정 정보" className="mb-5 overflow-x-auto">
      <ul className="m-0 flex w-max list-none gap-2 p-0">
        {COURSE_TABS.map((tab) => {
          const selected = tab === active;
          return (
            <li key={tab} className="shrink-0">
              <Link
                href={`/courses/${courseId}?tab=${tab}`}
                aria-current={selected ? "page" : undefined}
                className={[
                  "tap-target inline-flex items-center px-3 py-2 text-sm no-underline radius-md bw",
                  selected
                    ? "border-border bg-card font-extrabold underline underline-offset-4"
                    : "border-transparent text-muted-foreground",
                ].join(" ")}
              >
                {COURSE_TAB_LABELS[tab]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function EmptyPanel({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <h3 className="mt-0 mb-2 text-base font-bold">{title}</h3>
      <p className="m-0 text-sm text-muted-foreground">{description}</p>
    </Card>
  );
}

function RecoveryLink() {
  return <Link href="/status" className="tap-target inline-flex items-center underline">상태 화면에서 복구 방법 확인하기</Link>;
}

function ExternalSourceLink({ href, title }: { href: string; title: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="tap-target inline-flex items-center break-words underline">
      {title}
      <span className="sr-only"> (새 창에서 열림)</span>
    </a>
  );
}

export function DocumentPanel({
  markdown,
  verified,
  unavailable = false,
  emptyTitle,
  emptyDescription,
}: {
  markdown: string | null;
  verified: boolean;
  unavailable?: boolean;
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (unavailable) {
    return (
      <Card>
        <h3 className="mt-0 mb-2 text-base font-bold text-destructive">학습 문서 상태를 확인할 수 없습니다</h3>
        <p className="mt-0 mb-3 text-sm">현재 Day 또는 문서 등록 정보가 어긋나 긴 학습 문서를 표시하지 않았습니다. 저장된 내용은 변경하지 않았습니다.</p>
        <RecoveryLink />
      </Card>
    );
  }
  const state = documentState(markdown, verified);
  if (state?.kind === "damaged") {
    return (
      <Card>
        <h3 className="mt-0 mb-2 text-base font-bold text-destructive">{state.title}</h3>
        <p className="mt-0 mb-3 text-sm">{state.description}</p>
        <RecoveryLink />
      </Card>
    );
  }
  if (state) return <EmptyPanel title={emptyTitle} description={emptyDescription} />;
  return <Card><MarkdownView markdown={markdown!} /></Card>;
}

export function OverviewPanel({ course, history, snapshot, verified, unavailable, editor }: {
  course: CourseHistoryCourse;
  history: CourseHistory;
  snapshot: LearningSnapshot | null;
  verified: boolean;
  unavailable: boolean;
  editor?: ReactNode;
}) {
  const preference = { examples: "예제 중심", theory: "이론 중심", practice: "실습 중심" } as const;
  const events = [
    ...history.days
      .filter(({ completedAt }) => completedAt !== null)
      .map((day) => ({ at: day.completedAt!, text: `Day ${day.dayNumber} 완료 · ${day.objective}` })),
    ...history.researchRuns.map((run) => ({
      at: run.createdAt,
      text: run.scope === "course" ? "과정 리서치 저장" : `Day ${run.dayNumber} 리서치 저장`,
    })),
  ].sort((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0)).slice(0, 5);

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader title="학습 목표" headingLevel={3} />
        <p className="m-0 break-words">{course.goal}</p>
      </Card>
      {editor ? (
        <Card>
          <CardHeader
            title="과정 정보 수정"
            description="목차를 승인하기 전인 초안에서만 제목과 목표를 바꿀 수 있습니다."
            headingLevel={3}
          />
          {editor}
        </Card>
      ) : null}
      <Card>
        <CardHeader title="시작 인터뷰" headingLevel={3} />
        <dl className="m-0 grid gap-2">
          <dt className="m-0 text-sm text-muted-foreground">사전 지식</dt>
          <dd className="m-0 break-words">{course.priorKnowledge ?? "아직 저장되지 않았습니다."}</dd>
          <dt className="m-0 text-sm text-muted-foreground">선호 학습 방식</dt>
          <dd className="m-0">{course.learningPreference === null ? "아직 저장되지 않았습니다." : preference[course.learningPreference]}</dd>
        </dl>
      </Card>
      <Card>
        <CardHeader title="진도" headingLevel={3} />
        <p className="m-0">
          승인된 Day {history.days.length}개 중 {history.days.filter(({ completedAt }) => completedAt !== null).length}개 완료
          {course.currentStage === null ? "" : ` · 현재 단계 ${STAGE_LABELS[course.currentStage]}`}
        </p>
      </Card>
      <Card>
        <CardHeader title="최근 활동" description="저장된 완료 기록과 리서치만 표시합니다." headingLevel={3} />
        {events.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">아직 저장된 활동이 없습니다.</p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0 text-sm">
            {events.map((event) => (
              <li key={`${event.at}-${event.text}`} className="flex flex-wrap gap-2">
                <time dateTime={event.at} className="shrink-0 text-muted-foreground">{event.at.slice(0, 10)}</time>
                <span className="min-w-0 break-words">{event.text}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div>
        <h3 className="mt-0 mb-2 text-base font-bold">과정 문서</h3>
        <DocumentPanel
          markdown={snapshot?.documents.course ?? null}
          verified={verified}
          unavailable={unavailable}
          emptyTitle="과정 문서가 비어 있습니다"
          emptyDescription="Codex에서 $just-study로 리서치와 30일 목차를 승인하면 여기에 표시됩니다."
        />
      </div>
    </div>
  );
}

export function PlanPanel({ history, currentDayId }: { history: CourseHistory; currentDayId: string | null }) {
  if (history.days.length === 0) {
    return <EmptyPanel title="아직 승인된 30일 계획이 없습니다" description="Codex에서 $just-study로 리서치를 마치고 30개 Day 목차를 승인해 주세요." />;
  }
  return (
    <Card>
      <ol className="m-0 grid list-none gap-2 p-0">
        {history.days.map((day) => {
          const current = day.id === currentDayId;
          const done = day.completedAt !== null;
          return (
            <li key={day.id} className={`flex flex-wrap items-center gap-3 border-b border-solid border-border pb-2 ${current ? "font-bold" : ""}`}>
              <span className="w-16 shrink-0 text-sm text-muted-foreground">Day {day.dayNumber}</span>
              <span className="min-w-0 flex-1 break-words">{day.objective}</span>
              <Badge tone={done ? "muted" : current ? "accent" : "neutral"}>
                {done ? "완료" : current ? "현재" : "예정"}
              </Badge>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

export function SourcesPanel({ history }: { history: CourseHistory }) {
  if (history.researchRuns.length === 0) {
    return <EmptyPanel title="아직 저장된 리서치가 없습니다" description="Codex가 실제로 조사하고 평가한 자료만 여기에 기록됩니다." />;
  }
  return (
    <div className="grid gap-4">
      {history.researchRuns.map((run) => (
        <Card key={run.id}>
          <CardHeader
            title={run.scope === "course" ? "과정 리서치" : `Day ${run.dayNumber} 리서치`}
            description={run.dayObjective ?? "전체 주제 범위와 학습 순서를 조사한 기록입니다."}
            headingLevel={3}
          />
          <h4 className="mt-0 mb-1 text-sm font-bold">리서치 질문</h4>
          <ul className="mt-0 mb-3 list-disc pl-5 text-sm">
            {run.questions.map((question) => <li key={question} className="break-words">{question}</li>)}
          </ul>
          <h4 className="mt-0 mb-1 text-sm font-bold">주제별 선정 기준</h4>
          <ul className="mt-0 mb-3 list-disc pl-5 text-sm">
            {run.topicCriteria.map((criterion) => <li key={criterion} className="break-words">{criterion}</li>)}
          </ul>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">자료 평가 결과</caption>
              <thead>
                <tr>
                  <th scope="col" className="bw border-border p-2 text-left">순위</th>
                  <th scope="col" className="bw border-border p-2 text-left">자료</th>
                  <th scope="col" className="bw border-border p-2 text-right">점수</th>
                  <th scope="col" className="bw border-border p-2 text-left">선정</th>
                </tr>
              </thead>
              <tbody>
                {run.sources.map((source) => (
                  <tr key={source.id}>
                    <td className="bw border-border p-2">{source.rank}</td>
                    <td className="bw border-border p-2">
                      <ExternalSourceLink href={source.url} title={source.title} />
                      <span className="block break-words text-xs text-muted-foreground">{source.publisher}</span>
                      {source.selectionReason ? <span className="block break-words text-xs">선정 이유: {source.selectionReason}</span> : null}
                      {source.limitation ? <span className="block break-words text-xs">한계: {source.limitation}</span> : null}
                    </td>
                    <td className="bw border-border p-2 text-right">{source.totalScore} / 100</td>
                    <td className="bw border-border p-2">{source.selected ? "선정됨" : "미선정"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h4 className="mt-4 mb-1 text-sm font-bold">주장 교차 검증</h4>
          <ul className="m-0 grid list-none gap-2 p-0 text-sm">
            {run.claims.map((claim) => (
              <li key={claim.id} className="border-t border-solid border-border pt-2">
                <p className="m-0 break-words font-semibold">{claim.statement}</p>
                <p className="m-0 break-words">{claim.conclusion}</p>
                {claim.uncertainty ? <p className="m-0 break-words">남은 불확실성: {claim.uncertainty}</p> : null}
                <p className="m-0 text-xs text-muted-foreground">
                  {claim.major ? "핵심 주장 · " : ""}
                  근거 {claim.evidence.length}건 (지지 {claim.evidence.filter(({ stance }) => stance === "supports").length}, 반대 {claim.evidence.filter(({ stance }) => stance === "opposes").length})
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

export function JournalPanel({ history, snapshot, verified, unavailable }: {
  history: CourseHistory;
  snapshot: LearningSnapshot | null;
  verified: boolean;
  unavailable: boolean;
}) {
  const completed = history.days.filter(({ completedAt }) => completedAt !== null);
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader
          title="완료한 Day"
          description={`승인된 ${history.days.length}일 중 ${completed.length}일을 마쳤습니다.`}
          headingLevel={3}
        />
        {completed.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">아직 완료한 Day가 없습니다.</p>
        ) : (
          <ol className="m-0 grid list-none gap-2 p-0">
            {completed.map((day) => (
              <li key={day.id} className="flex flex-wrap items-baseline gap-3 border-b border-solid border-border pb-2">
                <span className="w-16 shrink-0 text-sm text-muted-foreground">Day {day.dayNumber}</span>
                <span className="min-w-0 flex-1 break-words">{day.objective}</span>
                <time dateTime={day.completedAt!} className="shrink-0 text-xs text-muted-foreground">{day.completedAt!.slice(0, 10)}</time>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <div>
        <h3 className="mt-0 mb-2 text-base font-bold">검증된 학습 기록</h3>
        <DocumentPanel
          markdown={snapshot?.documents.journal ?? null}
          verified={verified}
          unavailable={unavailable}
          emptyTitle="아직 저장된 회고 기록이 없습니다"
          emptyDescription="Day를 완료하면 강의와 회고가 검증된 학습 기록으로 저장됩니다."
        />
      </div>
    </div>
  );
}

export function QuizPanel({ history }: { history: CourseHistory }) {
  if (history.quizAttempts.length === 0) {
    return <EmptyPanel title="아직 저장된 퀴즈가 없습니다" description="강의를 마치면 Codex가 다섯 문제를 저장하고 채점 기록이 여기에 남습니다." />;
  }
  return (
    <div className="grid gap-4">
      {history.quizAttempts.map((attempt) => (
        <Card key={attempt.id}>
          <CardHeader
            title={`Day ${attempt.dayNumber} · ${attempt.attemptNumber}번째 시도`}
            description={attempt.dayObjective}
            headingLevel={3}
            action={<Badge tone={attempt.status === "passed" ? "accent" : "muted"}>
              {attempt.status === "passed" ? "통과" : attempt.status === "failed" ? "보완 필요" : "진행 중"}
              {attempt.score === null ? "" : ` · ${attempt.score} / 5`}
            </Badge>}
          />
          <ol className="m-0 grid list-none gap-3 p-0">
            {attempt.questions.map((question) => (
              <li key={question.id} className="border-t border-solid border-border pt-3">
                <p className="m-0 break-words font-semibold">{question.position}. {question.prompt}</p>
                <ol className="mt-1 mb-0 grid gap-1 pl-5 text-sm">
                  {question.choices.map((choice, index) => (
                    <li
                      key={choice}
                      className={index === question.correctChoiceIndex ? "font-semibold" : undefined}
                    >
                      {choice}
                      {index === question.correctChoiceIndex ? <span className="ml-1 text-xs">(정답)</span> : null}
                      {question.response?.selectedChoiceIndex === index ? <span className="ml-1 text-xs text-muted-foreground">← 고른 답</span> : null}
                    </li>
                  ))}
                </ol>
                {question.response === null ? (
                  <p className="mt-2 mb-0 text-sm text-muted-foreground">아직 답변하지 않았습니다.</p>
                ) : (
                  <p className="mt-2 mb-0 break-words text-sm">
                    판정: {question.response.correct ? "정답" : "오답"} · {question.explanation}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </Card>
      ))}
    </div>
  );
}

export function TodayPanel({ course, history, snapshot, verified, unavailable, quiz, reflection }: {
  course: CourseHistoryCourse;
  history: CourseHistory;
  snapshot: LearningSnapshot | null;
  verified: boolean;
  unavailable: boolean;
  quiz?: ReactNode;
  reflection?: ReactNode;
}) {
  const currentDay = snapshot?.currentDay ?? history.days.find(({ id }) => id === course.currentDayId) ?? null;
  const steps = stageSteps(course.currentStage, course.status === "completed");
  const onLecture = course.currentStage === "lecture" || course.currentStage === null;
  const lesson = (
    <DocumentPanel
      markdown={snapshot?.documents.currentDay ?? null}
      verified={verified}
      unavailable={unavailable}
      emptyTitle="오늘 저장된 학습 내용이 없습니다"
      emptyDescription="Codex에서 $just-study 계속을 호출해 오늘의 리서치와 강의를 진행해 주세요."
    />
  );
  return (
    <div className="grid gap-4">
      <div className="grid gap-4">
        <Card>
          <h3 className="mt-0 mb-2 text-base font-bold">오늘의 목표</h3>
          <p className="m-0 break-words">
            {currentDay?.objective ?? (course.status === "completed" ? "모든 Day를 마쳤습니다." : "아직 시작한 Day가 없습니다.")}
          </p>
          <ol aria-label="오늘의 진행 단계" className="mt-3 mb-0 flex flex-wrap items-center gap-x-1 gap-y-2 p-0 text-sm">
            {steps.map((step, index) => (
              <li key={step.key} className="flex list-none items-center gap-1">
                {index > 0 ? <span aria-hidden="true" className="text-muted-foreground">→</span> : null}
                <span
                  aria-current={step.state === "current" ? "step" : undefined}
                  className={[
                    "inline-flex items-center gap-1 px-2 py-1 radius-md",
                    step.state === "current" ? "bw border-border font-bold" : "text-muted-foreground",
                  ].join(" ")}
                >
                  {step.state === "done" ? <span aria-hidden="true">✓</span> : null}
                  {step.label}
                  {step.state === "current" ? <span className="sr-only"> (현재 단계)</span> : null}
                  {step.state === "done" ? <span className="sr-only"> (완료)</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </Card>
        {/* 현재 단계에 맞는 내용만 펼친다. 강의 단계가 아니면 강의는 접어 둔다. */}
        {onLecture ? lesson : (
          <details className="surface p-0">
            <summary className="tap-target flex cursor-pointer items-center px-4 py-3 font-semibold">
              1단계 · 오늘의 강의 다시 보기
            </summary>
            <div className="px-4 pb-4">{lesson}</div>
          </details>
        )}
        {quiz ? (
          <Card>
            <h3 id="today-quiz" className="mt-0 mb-2 text-base font-bold">2단계 · 오늘의 퀴즈</h3>
            <p className="mt-0 mb-3 text-sm text-muted-foreground">
              위 강의를 다 읽었다면 풀어 주세요. 다섯 문제를 모두 맞히면 회고로 넘어가고, 하나라도 틀리면 보완 학습을 거칩니다.
            </p>
            {quiz}
          </Card>
        ) : null}
        {reflection ? (
          <Card>
            <h3 id="today-reflection" className="mt-0 mb-2 text-base font-bold">3단계 · 오늘의 회고</h3>
            <p className="mt-0 mb-3 text-sm text-muted-foreground">
              퀴즈를 통과했습니다. 세 답변을 모두 제출하면 학습 기록에 저장되고 다음 Day로 이동합니다. 제출 전에는 저장되지 않습니다.
            </p>
            {reflection}
          </Card>
        ) : null}
        {!quiz && !reflection && course.status === "active" ? (
          <Card>
            <h3 className="mt-0 mb-2 text-base font-bold">다음 단계</h3>
            <p className="m-0 text-sm text-muted-foreground">
              {course.currentStage === "remediation"
                ? "틀린 개념을 다시 설명받을 차례입니다. 위의 Codex에서 계속으로 이어가면 보완 강의와 새 퀴즈가 준비됩니다."
                : "오늘의 강의를 다 읽었다면 위의 Codex에서 계속으로 이어가 주세요. 다섯 문제가 준비되면 이 화면에서 바로 풀 수 있습니다."}
            </p>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
