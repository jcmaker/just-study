import type { CourseStatus, LearningStage } from "./courses.ts";
import type { DatabaseHandle } from "./database.ts";

export type DashboardCourseSummary = {
  id: string;
  title: string;
  goal: string;
  status: CourseStatus;
  currentDayNumber: number | null;
  currentDayObjective: string | null;
  currentStage: LearningStage | null;
  approvedDayCount: number;
  completedDayCount: number;
  hasQuizResponse: boolean;
  revision: number;
  outlineApprovedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DashboardRecentDay = {
  courseId: string;
  courseTitle: string;
  dayId: string;
  dayNumber: number;
  objective: string;
  completedAt: string;
};

export type DashboardTotals = {
  activeCourseCount: number;
  completedCourseCount: number;
  approvedDayCount: number;
  completedDayCount: number;
  selectedSourceCount: number;
};

export type DashboardOverview = {
  courses: DashboardCourseSummary[];
  totals: DashboardTotals;
  recentDays: DashboardRecentDay[];
};

type SummaryRow = {
  id: string;
  title: string;
  goal: string;
  status: CourseStatus;
  current_stage: LearningStage | null;
  current_day_number: number | null;
  current_day_objective: string | null;
  approved_day_count: number;
  completed_day_count: number;
  quiz_response_count: number;
  revision: number;
  outline_approved_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type RecentDayRow = {
  course_id: string;
  course_title: string;
  day_id: string;
  day_number: number;
  objective: string;
  completed_at: string;
};

export const RECENT_DAY_LIMIT = 5;

function normalizeSourceUrl(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

export function getDashboardOverview(db: DatabaseHandle): DashboardOverview {
  const summaryRows = db.prepare(`
    SELECT
      course.id,
      course.title,
      course.goal,
      course.status,
      course.current_stage,
      current_day.day_number AS current_day_number,
      current_day.objective AS current_day_objective,
      (SELECT COUNT(*) FROM course_days WHERE course_id = course.id) AS approved_day_count,
      (SELECT COUNT(*) FROM course_days WHERE course_id = course.id AND completed_at IS NOT NULL) AS completed_day_count,
      (
        SELECT COUNT(*)
        FROM quiz_responses AS response
        JOIN quiz_questions AS question ON question.id = response.question_id
        WHERE question.day_id = course.current_day_id
      ) AS quiz_response_count,
      course.revision,
      course.outline_approved_at,
      course.completed_at,
      course.created_at,
      course.updated_at
    FROM courses AS course
    LEFT JOIN course_days AS current_day ON current_day.id = course.current_day_id
    ORDER BY course.created_at DESC, course.id ASC
  `).all() as SummaryRow[];

  const recentRows = db.prepare(`
    SELECT
      course.id AS course_id,
      course.title AS course_title,
      day.id AS day_id,
      day.day_number,
      day.objective,
      day.completed_at
    FROM course_days AS day
    JOIN courses AS course ON course.id = day.course_id
    WHERE day.completed_at IS NOT NULL
    ORDER BY day.completed_at DESC, day.day_number DESC, day.id ASC
    LIMIT ?
  `).all(RECENT_DAY_LIMIT) as RecentDayRow[];

  const selectedUrls = db.prepare(`
    SELECT url FROM research_sources WHERE selected = 1
  `).all() as { url: string }[];

  const courses = summaryRows.map((row): DashboardCourseSummary => ({
    id: row.id,
    title: row.title,
    goal: row.goal,
    status: row.status,
    currentDayNumber: row.current_day_number,
    currentDayObjective: row.current_day_objective,
    currentStage: row.current_stage,
    approvedDayCount: row.approved_day_count,
    completedDayCount: row.completed_day_count,
    hasQuizResponse: row.quiz_response_count > 0,
    revision: row.revision,
    outlineApprovedAt: row.outline_approved_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return {
    courses,
    totals: {
      activeCourseCount: courses.filter(({ status }) => status === "active").length,
      completedCourseCount: courses.filter(({ status }) => status === "completed").length,
      approvedDayCount: courses.reduce((total, { approvedDayCount }) => total + approvedDayCount, 0),
      completedDayCount: courses.reduce((total, { completedDayCount }) => total + completedDayCount, 0),
      selectedSourceCount: new Set(selectedUrls.map(({ url }) => normalizeSourceUrl(url))).size,
    },
    recentDays: recentRows.map((row) => ({
      courseId: row.course_id,
      courseTitle: row.course_title,
      dayId: row.day_id,
      dayNumber: row.day_number,
      objective: row.objective,
      completedAt: row.completed_at,
    })),
  };
}
