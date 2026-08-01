import type {
  ApproveOutlineInput,
  LessonContentInput,
  LearningDay,
  LearningSnapshot,
  QuizAttempt,
  ReflectionInput,
  ResearchBundleInput,
  ResearchRun,
} from "./learning.ts";
import type { Course } from "./courses.ts";

const RUBRIC_ROWS = [
  ["권위", 25], ["교차 검증", 25], ["관련성", 20], ["교육 품질", 15], ["최신성", 10], ["접근성", 5],
] as const;

const LESSON_SECTIONS: readonly [keyof LessonContentInput, string][] = [
  ["recallMarkdown", "회상"], ["preciseExplanationMarkdown", "정확한 설명"],
  ["eli5Markdown", "ELI5"], ["analogyMarkdown", "비유"], ["exampleMarkdown", "구체적 예제"],
  ["applicationMarkdown", "사용자 적용"], ["interviewMarkdown", "인터뷰와 이해 확인"],
  ["remediationMarkdown", "보충 학습"],
];

function escapeInline(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/([`*_[\]{}()#+.!|>-])/g, "\\$1");
}

function headingText(value: string): string {
  return escapeInline(value.replace(/[\r\n]+/g, " "));
}

function tableCell(value: unknown): string {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "\\n");
}

function rubricTotalForMarkdown(scores: ResearchBundleInput["sources"][number]["scores"]): number {
  return scores.authority + scores.crossValidation + scores.relevance + scores.teachingQuality + scores.currency + scores.accessibility;
}

function renderRubric(): string {
  return ["| 평가 기준 | 배점 |", "|---|---:|", ...RUBRIC_ROWS.map(([label, maximum]) => `| ${label} | ${maximum} |`), "| **합계** | **100** |"].join("\n");
}

// 감사용 전체 표는 과정 문서에만 넣는다. 매일 읽는 학습 문서에는 링크만 남긴다.
function renderResearchBundle(research: ResearchBundleInput, detailed = true): string {
  const sourcesById = new Map(research.sources.map((source) => [source.id, source]));
  const scoreTable = [
    "#### 고정 평가 루브릭", "", renderRubric(), "", "#### 리서치 본문", "", research.narrativeMarkdown.trim(), "",
    "#### 후보 자료", "", "| 순위 | 선정 | 제목 | URL | 발행처 | 독립성 키 | 권위 | 교차 검증 | 관련성 | 교육 품질 | 최신성 | 접근성 | 합계 | 선정 이유 | 한계 |",
    "|---:|:---:|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|",
    ...research.sources.slice().sort((left, right) => left.rank - right.rank).map((source) => [
      source.rank, source.selected ? "예" : "아니요", source.title, source.url, source.publisher, source.independenceKey,
      source.scores.authority, source.scores.crossValidation, source.scores.relevance, source.scores.teachingQuality,
      source.scores.currency, source.scores.accessibility, rubricTotalForMarkdown(source.scores), source.selectionReason, source.limitation,
    ].map(tableCell).join(" | ")).map((row) => `| ${row} |`), "",
  ];
  const linkList = [
    "#### 리서치 본문", "", research.narrativeMarkdown.trim(), "",
    "#### 사용한 자료", "",
    ...research.sources.filter(({ selected }) => selected).slice().sort((left, right) => left.rank - right.rank)
      .map((source) => `- [${escapeInline(source.title)}](${source.url}) — ${escapeInline(source.publisher)}`),
    "",
  ];
  const lines = [
    "#### 리서치 질문", "", ...research.questions.map((question) => `- ${escapeInline(question)}`), "",
    "#### 주제별 선정 조건", "", ...research.topicCriteria.map((criterion) => `- ${escapeInline(criterion)}`), "",
    ...(detailed ? scoreTable : linkList), "#### 검증된 주장",
  ];
  for (const [index, claim] of research.claims.entries()) {
    const evidence = claim.evidence.map(({ sourceId, stance }) => `${sourcesById.get(sourceId)?.title ?? sourceId} (${stance})`).join("; ");
    lines.push("", `##### 주장 ${index + 1}`, "", "| 항목 | 값 |", "|---|---|",
      `| 주요 주장 | ${claim.major ? "예" : "아니요"} |`, `| 내용 | ${tableCell(claim.statement)} |`,
      `| 근거 | ${tableCell(evidence)} |`, `| 결론 | ${tableCell(claim.conclusion)} |`, `| 불확실성 | ${tableCell(claim.uncertainty)} |`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderApprovedCourseMarkdown(course: Course, input: ApproveOutlineInput): string {
  const preference = { examples: "예제 중심", theory: "이론 중심", practice: "직접 실습 중심" }[input.learningPreference];
  return [
    `# ${headingText(course.title)}`, "", escapeInline(course.goal), "", "## 과정 정보", "", "| 항목 | 내용 |", "|---|---|",
    `| 기존 지식 | ${tableCell(input.priorKnowledge)} |`, `| 학습 목표 | ${tableCell(course.goal)} |`, `| 학습 방식 | ${preference} |`, "",
    "## 전체 과정 리서치", "", renderResearchBundle(input.research).trimEnd(), "", "## 지식 지도", "", input.knowledgeMapMarkdown.trim(), "",
    "## 30일 목차", "", ...input.days.map(({ objective }, index) => `${index + 1}. ${escapeInline(objective)}`), "",
  ].join("\n");
}

export function renderProgressMarkdown(snapshot: Omit<LearningSnapshot, "documents">, savedAt: string): string {
  const latestAttempt = snapshot.quizAttempts.at(-1);
  const answered = latestAttempt?.questions.filter(({ responses }) => responses.length > 0).length ?? 0;
  const position = snapshot.course.status === "completed" ? "30/30 완료" : `Day ${snapshot.currentDay?.dayNumber ?? 0}/30`;
  return [
    "# 학습 진도", "", `- 상태: ${snapshot.course.status}`, `- 위치: ${position}`,
    `- 단계: ${snapshot.course.currentStage ?? "완료"}`, `- 리비전: ${snapshot.course.revision}`, `- 저장 시각: ${savedAt}`,
    ...(latestAttempt ? [`- 퀴즈 시도: ${latestAttempt.attemptNumber}`, `- 답변 ${answered}/5`] : []), "",
    "| Day | 목표 | 상태 |", "|---:|---|---|", ...snapshot.days.map((day) =>
      `| ${day.dayNumber} | ${tableCell(day.objective)} | ${day.completedAt === null ? "진행 전/중" : `완료 (${tableCell(day.completedAt)})`} |`), "",
  ].join("\n");
}

export function renderInitialJournalMarkdown(): string { return "# 학습 기록\n"; }

// 학습자가 매일 여는 문서다. 배울 내용이 먼저 오고 근거 자료가 뒤에 온다.
export const CURRENT_DAY_REFERENCE_HEADING = "### 참고 자료와 근거";

export function renderCurrentDayMarkdown(day: LearningDay, research?: ResearchBundleInput): string {
  return [
    `## Day ${day.dayNumber} — ${headingText(day.objective)}`, "",
    ...(research ? [CURRENT_DAY_REFERENCE_HEADING, "", renderResearchBundle(research, false).trimEnd(), ""] : []),
  ].join("\n");
}

export function appendCurrentDayCheckpoint(existingCurrentDay: string, lesson: Partial<LessonContentInput>, savedAt: string): string {
  const sections: string[] = [];
  for (const [field, heading] of LESSON_SECTIONS) {
    const value = lesson[field];
    if (typeof value === "string" && value.trim().length > 0) sections.push(`### ${heading}`, "", value.trim(), "", `> 체크포인트 저장: ${savedAt}`, "");
  }
  if (sections.length === 0) return existingCurrentDay;
  const block = sections.join("\n");

  // 근거 자료 구획이 이미 있으면 그 앞에 끼워 넣어 학습 내용이 항상 위에 오게 한다.
  const referenceIndex = existingCurrentDay.indexOf(CURRENT_DAY_REFERENCE_HEADING);
  if (referenceIndex !== -1) {
    return `${existingCurrentDay.slice(0, referenceIndex)}${block}\n${existingCurrentDay.slice(referenceIndex)}`;
  }
  const separator = existingCurrentDay.endsWith("\n") ? "\n" : "\n\n";
  return `${existingCurrentDay}${separator}${block}`;
}

export function appendJournalDay(existingJournal: string, input: { day: LearningDay; currentDayMarkdown: string; dailyResearch: ResearchRun; quizAttempts: QuizAttempt[]; reflection: ReflectionInput; completedAt: string }): string {
  const sourceTitle = new Map(input.dailyResearch.sources.map((source) => [source.id, source.title]));
  const evidenceLines = ["#### 저장된 자료", "", "| 순위 | 제목 | URL | 합계 | 선정 | 한계 |", "|---:|---|---|---:|:---:|---|",
    ...input.dailyResearch.sources.map((source) => `| ${source.rank} | ${tableCell(source.title)} | ${tableCell(source.url)} | ${source.totalScore} | ${source.selected ? "예" : "아니요"} | ${tableCell(source.limitation)} |`),
    "", "#### 저장된 주장", "", ...input.dailyResearch.claims.flatMap((claim, index) => [
      `##### 주장 ${index + 1}`, "", `- 내용: ${escapeInline(claim.statement)}`, `- 주요 주장: ${claim.major ? "예" : "아니요"}`,
      `- 근거: ${claim.evidence.map(({ sourceId, stance }) => `${escapeInline(sourceTitle.get(sourceId) ?? sourceId)} (${stance})`).join("; ")}`,
      `- 결론: ${escapeInline(claim.conclusion)}`, `- 불확실성: ${escapeInline(claim.uncertainty ?? "없음")}`, "",
    ])];
  const quizLines = ["### 퀴즈 시도", "", ...input.quizAttempts.flatMap((attempt) => [
    `#### 시도 ${attempt.attemptNumber} — ${attempt.status}`, "", `- 점수: ${attempt.score === null ? "미채점" : `${attempt.score}/5`}`,
    `- 시작: ${attempt.createdAt}`, `- 채점 완료: ${attempt.gradedAt ?? "미완료"}`, "", ...attempt.questions.flatMap((question) => [
      `##### 문제 ${question.position}`, "", `- 개념: ${escapeInline(question.conceptLabel)} (${escapeInline(question.conceptKey)})`,
      `- 문제: ${escapeInline(question.prompt)}`, `- 채점 기준: ${escapeInline(question.gradingCriteria)}`,
      ...question.responses.flatMap((response) => [`- 응답 ${response.responseNumber}: ${escapeInline(response.answer)}`, `  - 결과: ${response.result}`, `  - 피드백: ${escapeInline(response.feedback)}`, ...(response.clarificationQuestion === null ? [] : [`  - 명료화 질문: ${escapeInline(response.clarificationQuestion)}`])]), "",
    ])]), "### 보충 학습", "", `- 실패한 시도: ${input.quizAttempts.filter(({ status }) => status === "failed").length}`, "", "### 회고", "",
    "#### 오늘 무엇을 배웠는가?", "", ...input.reflection.learned.split(/\r?\n/).map((line) => `> ${line}`), "", "#### 아직 헷갈리는 것은 무엇인가?", "", ...input.reflection.confusing.split(/\r?\n/).map((line) => `> ${line}`), "", "#### 한 줄 소감", "", ...input.reflection.feeling.split(/\r?\n/).map((line) => `> ${line}`), "", `완료 시각: ${input.completedAt}`, ""];
  const journalPrefix = existingJournal.endsWith("\n") ? existingJournal : `${existingJournal}\n`;
  const dayRecord = input.currentDayMarkdown.endsWith("\n") ? input.currentDayMarkdown : `${input.currentDayMarkdown}\n`;
  return `${journalPrefix}\n${dayRecord}\n${evidenceLines.join("\n")}\n${quizLines.join("\n")}`;
}
