import type { CourseStatus, LearningStage } from "./courses.ts";
import type { DashboardCourseSummary } from "./dashboard.ts";

export const STAGE_LABELS: Record<LearningStage, string> = {
  lecture: "강의",
  quiz: "퀴즈",
  remediation: "보완 학습",
  reflection: "회고",
};

export const STATUS_LABELS: Record<CourseStatus, string> = {
  draft: "초안",
  active: "진행 중",
  completed: "완료",
};

export const RESUME_COMMAND = "$just-study 계속";
export const TOTAL_DAYS = 30;
export const ATTENTION_LIMIT = 3;
export const COURSE_ACCENT_COUNT = 6;

export const COURSE_TABS = ["overview", "plan", "today", "sources", "quiz", "journal"] as const;
export type CourseTab = (typeof COURSE_TABS)[number];

export const COURSE_TAB_LABELS: Record<CourseTab, string> = {
  overview: "개요",
  plan: "30일 계획",
  today: "오늘",
  sources: "출처",
  quiz: "퀴즈",
  journal: "학습 기록",
};

export const COURSE_FILTERS = ["all", "active", "draft", "completed"] as const;
export type CourseFilter = (typeof COURSE_FILTERS)[number];

export const COURSE_FILTER_LABELS: Record<CourseFilter, string> = {
  all: "전체",
  active: "진행 중",
  draft: "초안",
  completed: "완료",
};

export type CourseProgress = { completed: number; approved: number; percent: number };

export type CourseCardModel = {
  id: string;
  title: string;
  goal: string;
  statusLabel: string;
  status: CourseStatus;
  dayLabel: string | null;
  stageLabel: string | null;
  progress: CourseProgress | null;
  note: string | null;
  accentIndex: number;
  updatedAt: string;
  href: string;
};

export type AttentionItem = {
  courseId: string;
  courseTitle: string;
  message: string;
  tab: CourseTab;
  href: string;
};

export function normalizeTab(value: unknown): CourseTab {
  return typeof value === "string" && (COURSE_TABS as readonly string[]).includes(value)
    ? (value as CourseTab)
    : "overview";
}

export function normalizeCourseFilter(value: unknown): CourseFilter {
  return typeof value === "string" && (COURSE_FILTERS as readonly string[]).includes(value)
    ? (value as CourseFilter)
    : "all";
}

export function courseAccentIndex(courseId: string): number {
  let hash = 0;
  for (const character of courseId) {
    hash = (hash * 31 + character.codePointAt(0)!) % 1_000_003;
  }
  return hash % COURSE_ACCENT_COUNT;
}

export function courseProgress(course: DashboardCourseSummary): CourseProgress | null {
  if (course.approvedDayCount === 0) return null;
  return {
    completed: course.completedDayCount,
    approved: course.approvedDayCount,
    percent: Math.round((course.completedDayCount / course.approvedDayCount) * 100),
  };
}

export function courseCardModel(course: DashboardCourseSummary): CourseCardModel {
  const progress = courseProgress(course);
  const dayLabel = course.status === "completed"
    ? `Day ${course.approvedDayCount} / ${course.approvedDayCount}`
    : course.currentDayNumber === null
      ? null
      : `Day ${course.currentDayNumber} / ${course.approvedDayCount}`;
  return {
    id: course.id,
    title: course.title,
    goal: course.goal,
    status: course.status,
    statusLabel: STATUS_LABELS[course.status],
    dayLabel,
    stageLabel: course.currentStage === null ? null : STAGE_LABELS[course.currentStage],
    progress,
    note: course.status === "draft" ? "30일 계획 승인 대기" : course.status === "completed" ? "완료" : null,
    accentIndex: courseAccentIndex(course.id),
    updatedAt: course.updatedAt,
    href: `/courses/${course.id}`,
  };
}

function byUpdatedAtDescending(left: DashboardCourseSummary, right: DashboardCourseSummary): number {
  if (left.updatedAt === right.updatedAt) return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  return left.updatedAt < right.updatedAt ? 1 : -1;
}

export function resumeCourse(courses: readonly DashboardCourseSummary[]): DashboardCourseSummary | null {
  const active = courses.filter(({ status }) => status === "active").sort(byUpdatedAtDescending);
  if (active.length > 0) return active[0]!;
  const drafts = courses.filter(({ status }) => status === "draft").sort(byUpdatedAtDescending);
  return drafts[0] ?? null;
}

type AttentionRule = { rank: number; message: string; tab: CourseTab };

function attentionRule(course: DashboardCourseSummary): AttentionRule | null {
  if (course.status === "completed") return null;
  if (course.status === "draft") return { rank: 4, message: "30일 계획 승인이 필요합니다", tab: "overview" };
  switch (course.currentStage) {
    case "remediation":
      return { rank: 0, message: "보완 학습이 필요합니다", tab: "today" };
    case "reflection":
      return { rank: 1, message: "회고를 완료하면 다음 Day로 이동합니다", tab: "today" };
    case "quiz":
      return course.hasQuizResponse
        ? { rank: 2, message: "퀴즈 답변을 이어가세요", tab: "quiz" }
        : { rank: 3, message: "오늘의 퀴즈가 기다리고 있습니다", tab: "today" };
    case "lecture":
      return { rank: 5, message: "오늘 학습을 이어가세요", tab: "today" };
    default:
      return null;
  }
}

export function attentionItems(courses: readonly DashboardCourseSummary[]): AttentionItem[] {
  return courses
    .flatMap((course) => {
      const rule = attentionRule(course);
      return rule === null ? [] : [{ course, rule }];
    })
    .sort((left, right) => left.rule.rank - right.rule.rank || byUpdatedAtDescending(left.course, right.course))
    .slice(0, ATTENTION_LIMIT)
    .map(({ course, rule }) => ({
      courseId: course.id,
      courseTitle: course.title,
      message: rule.message,
      tab: rule.tab,
      href: `/courses/${course.id}?tab=${rule.tab}`,
    }));
}

export function filterCourses(
  courses: readonly DashboardCourseSummary[],
  filter: CourseFilter,
): DashboardCourseSummary[] {
  return filter === "all" ? [...courses] : courses.filter(({ status }) => status === filter);
}
