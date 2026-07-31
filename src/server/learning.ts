import { randomUUID } from "node:crypto";

import type { DatabaseHandle } from "./database.ts";
import { UUID_PATTERN, getCourse, type Course, type LearningPreference } from "./courses.ts";
import {
  applyMarkdownUpdate,
  completeMarkdownUpdate,
  prepareMarkdownUpdate,
  readVerifiedMarkdown,
  rollbackMarkdownUpdate,
  type PreparedMarkdownUpdate,
} from "./storage.ts";
import {
  renderApprovedCourseMarkdown,
  renderCurrentDayMarkdown,
  renderInitialJournalMarkdown,
  renderProgressMarkdown,
} from "./learning-markdown.ts";

export type { LearningPreference } from "./courses.ts";

export type RubricScores = { authority: number; crossValidation: number; relevance: number; teachingQuality: number; currency: number; accessibility: number };
export type ResearchSourceInput = { id: string; url: string; title: string; publisher: string; independenceKey: string; scores: RubricScores; rank: number; selected: boolean; selectionReason: string | null; limitation: string | null };
export type ResearchClaimInput = { id: string; statement: string; major: boolean; conclusion: string; uncertainty: string | null; evidence: readonly { sourceId: string; stance: "supports" | "opposes" | "context" }[] };
export type ResearchBundleInput = { questions: readonly string[]; topicCriteria: readonly string[]; narrativeMarkdown: string; sources: readonly ResearchSourceInput[]; claims: readonly ResearchClaimInput[] };
export type ApproveOutlineInput = { courseId: string; expectedRevision: number; priorKnowledge: string; learningPreference: LearningPreference; knowledgeMapMarkdown: string; research: ResearchBundleInput; days: readonly { objective: string }[] };
export type ConceptInput = { key: string; label: string };
export type QuizQuestionInput = { id: string; conceptKey: string; conceptLabel: string; prompt: string; gradingCriteria: string };
export type QuestionGradeInput = { questionId: string; answer: string; result: "correct" | "incorrect" | "needs_clarification"; feedback: string; clarificationQuestion?: string };
export type LessonContentInput = { recallMarkdown: string; preciseExplanationMarkdown: string; eli5Markdown: string; analogyMarkdown: string; exampleMarkdown: string; applicationMarkdown: string; interviewMarkdown: string; remediationMarkdown?: string };
export type ReflectionInput = { learned: string; confusing: string; feeling: string };
export type LearningDay = { id: string; dayNumber: number; objective: string; completedAt: string | null };
export type QuizResponse = { id: string; questionId: string; responseNumber: number; answer: string; result: "correct" | "incorrect" | "needs_clarification"; feedback: string; clarificationQuestion: string | null; createdAt: string };
export type QuizQuestion = { id: string; position: number; conceptKey: string; conceptLabel: string; prompt: string; gradingCriteria: string; responses: QuizResponse[] };
export type QuizAttempt = { id: string; attemptNumber: number; status: "in_progress" | "passed" | "failed"; score: number | null; questions: QuizQuestion[]; createdAt: string; gradedAt: string | null };
export type ResearchRun = { id: string; scope: "course" | "day"; dayId: string | null; questions: string[]; topicCriteria: string[]; sources: (ResearchSourceInput & { totalScore: number })[]; claims: ResearchClaimInput[]; createdAt: string };
export type LearningSnapshot = { course: Course; days: LearningDay[]; currentDay: LearningDay | null; researchRuns: ResearchRun[]; understoodConcepts: ConceptInput[]; remediationConcepts: ConceptInput[]; quizAttempts: QuizAttempt[]; documents: { course: string; progress: string | null; journal: string | null; currentDay: string | null } };

export class LearningValidationError extends Error {}
export class LearningStateError extends Error {}
export class LearningRevisionConflictError extends Error {}

function commitPreparedUpdate(db: DatabaseHandle, update: PreparedMarkdownUpdate, mutateDatabase: () => void): void {
  try {
    db.transaction(() => { mutateDatabase(); applyMarkdownUpdate(update); })();
  } catch (error) {
    try { rollbackMarkdownUpdate(update); } catch { /* The transaction/apply failure remains actionable. */ }
    throw error;
  }
  completeMarkdownUpdate(update);
}

function assertRevision(course: Course, expectedRevision: number): void {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new LearningValidationError("expectedRevision must be a non-negative integer");
  if (course.revision !== expectedRevision) throw new LearningRevisionConflictError("Course revision changed");
}

function requiredText(value: unknown, name: string, maximum: number): string {
  if (typeof value !== "string") throw new LearningValidationError(`${name} must be text`);
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maximum || trimmed.includes("\0")) throw new LearningValidationError(`${name} is outside its allowed length`);
  return trimmed;
}

function validateStringList(value: unknown, name: string, maximumEntries: number): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumEntries) throw new LearningValidationError(`${name} must contain 1..${maximumEntries} entries`);
  const result = value.map((entry, index) => requiredText(entry, `${name}[${index}]`, 1_000));
  if (new Set(result).size !== result.length) throw new LearningValidationError(`${name} contains duplicates`);
  return result;
}

function rubricTotal(scores: unknown): number {
  if (typeof scores !== "object" || scores === null || Array.isArray(scores)) throw new LearningValidationError("scores are invalid");
  const values = scores as Partial<RubricScores>;
  const limits: [keyof RubricScores, number][] = [["authority", 25], ["crossValidation", 25], ["relevance", 20], ["teachingQuality", 15], ["currency", 10], ["accessibility", 5]];
  let total = 0;
  for (const [name, maximum] of limits) {
    const score = values[name];
    if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > maximum) throw new LearningValidationError(`${name} score is invalid`);
    total += score;
  }
  return total;
}

function validateResearchBundle(input: unknown): Map<string, number> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new LearningValidationError("research is required");
  const research = input as Partial<ResearchBundleInput>;
  validateStringList(research.questions, "research questions", 20);
  validateStringList(research.topicCriteria, "topic criteria", 20);
  requiredText(research.narrativeMarkdown, "research narrative", 1_000_000);
  if (!Array.isArray(research.sources) || research.sources.length < 1 || research.sources.length > 100) throw new LearningValidationError("research sources must contain 1..100 entries");
  if (!Array.isArray(research.claims) || research.claims.length < 1 || research.claims.length > 100) throw new LearningValidationError("research claims must contain 1..100 entries");
  const sources = research.sources as readonly ResearchSourceInput[];
  const claims = research.claims as readonly ResearchClaimInput[];
  const sourceIds = new Set<string>(), urls = new Set<string>(), ranks = new Set<number>(), totals = new Map<string, number>(), independenceKeys = new Map<string, string>();
  let selectedCount = 0;
  for (const source of sources) {
    if (typeof source !== "object" || source === null || Array.isArray(source)) throw new LearningValidationError("research source is invalid");
    if (!UUID_PATTERN.test(source.id) || sourceIds.has(source.id)) throw new LearningValidationError("source ID is invalid or duplicated");
    const urlText = requiredText(source.url, "source URL", 2_048);
    let url: URL;
    try { url = new URL(urlText); } catch { throw new LearningValidationError("source URL is invalid or duplicated"); }
    if (!['http:', 'https:'].includes(url.protocol) || urls.has(url.href)) throw new LearningValidationError("source URL is invalid or duplicated");
    for (const [value, name, maximum] of [[source.title, "source title", 500], [source.publisher, "source publisher", 300]] as const) {
      if (/[\r\n]/.test(requiredText(value, name, maximum))) throw new LearningValidationError(`${name} must be single-line`);
    }
    const independenceKey = requiredText(source.independenceKey, "source independence key", 200);
    if (/[\r\n]/.test(independenceKey)) throw new LearningValidationError("source independence key must be single-line");
    if (!Number.isInteger(source.rank) || source.rank < 1 || ranks.has(source.rank)) throw new LearningValidationError("source rank is invalid or duplicated");
    if (typeof source.selected !== "boolean") throw new LearningValidationError("source selected is invalid");
    if (source.selectionReason !== null && typeof source.selectionReason !== "string") throw new LearningValidationError("selection reason is invalid");
    if (source.limitation !== null && typeof source.limitation !== "string") throw new LearningValidationError("source limitation is invalid");
    const total = rubricTotal(source.scores);
    if (source.selected) { selectedCount += 1; requiredText(source.selectionReason, "selection reason", 1_000); if (total < 80) requiredText(source.limitation, "source limitation", 2_000); }
    else if (source.selectionReason !== null) throw new LearningValidationError("unselected source reason must be null");
    if (source.limitation !== null) requiredText(source.limitation, "source limitation", 2_000);
    sourceIds.add(source.id); urls.add(url.href); ranks.add(source.rank); totals.set(source.id, total); independenceKeys.set(source.id, independenceKey);
  }
  if (selectedCount === 0) throw new LearningValidationError("select at least one source");
  const ranked = [...sources].sort((left, right) => left.rank - right.rank);
  if (ranked.some((source, index) => source.rank !== index + 1)) throw new LearningValidationError("source ranks must be contiguous");
  if (ranked.some((source, index) => index > 0 && totals.get(ranked[index - 1]!.id)! < totals.get(source.id)!)) throw new LearningValidationError("source ranks must follow total score");
  const claimIds = new Set<string>();
  for (const claim of claims) {
    if (typeof claim !== "object" || claim === null || Array.isArray(claim)) throw new LearningValidationError("research claim is invalid");
    if (!UUID_PATTERN.test(claim.id) || claimIds.has(claim.id)) throw new LearningValidationError("claim ID is invalid or duplicated");
    requiredText(claim.statement, "claim statement", 5_000); requiredText(claim.conclusion, "claim conclusion", 5_000);
    if (typeof claim.major !== "boolean") throw new LearningValidationError("claim major is invalid");
    if (claim.uncertainty !== null && typeof claim.uncertainty !== "string") throw new LearningValidationError("claim uncertainty is invalid");
    if (claim.uncertainty !== null) requiredText(claim.uncertainty, "claim uncertainty", 5_000);
    if (!Array.isArray(claim.evidence) || claim.evidence.length === 0) throw new LearningValidationError("claim evidence is required");
    const evidenceKeys = new Set<string>();
    for (const evidence of claim.evidence) {
      if (typeof evidence !== "object" || evidence === null || Array.isArray(evidence) || typeof evidence.sourceId !== "string") throw new LearningValidationError("claim evidence is invalid");
      if (!sourceIds.has(evidence.sourceId)) throw new LearningValidationError("claim evidence source is missing");
      if (!['supports', 'opposes', 'context'].includes(evidence.stance)) throw new LearningValidationError("claim evidence stance is invalid");
      const key = `${evidence.sourceId}:${evidence.stance}`;
      if (evidenceKeys.has(key)) throw new LearningValidationError("claim evidence is duplicated");
      evidenceKeys.add(key);
    }
    if (claim.evidence.some(({ stance }) => stance === "opposes") && claim.uncertainty === null) throw new LearningValidationError("conflicting claim requires uncertainty");
    if (claim.major) {
      const independent = new Set(claim.evidence.filter(({ sourceId, stance }) => stance === "supports" && totals.get(sourceId)! >= 80 && sources.find(({ id }) => id === sourceId)!.selected).map(({ sourceId }) => independenceKeys.get(sourceId)!));
      if (independent.size < 2) throw new LearningValidationError("major claim needs two independent supports");
    }
    claimIds.add(claim.id);
  }
  return totals;
}

function insertResearchRun(db: DatabaseHandle, courseId: string, dayId: string | null, research: ResearchBundleInput, createdAt: string): string {
  const runId = randomUUID();
  db.prepare(`INSERT INTO research_runs (id, course_id, day_id, scope, questions_json, topic_criteria_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(runId, courseId, dayId, dayId === null ? "course" : "day", JSON.stringify(research.questions), JSON.stringify(research.topicCriteria), createdAt);
  const insertSource = db.prepare(`INSERT INTO research_sources (id, run_id, url, title, publisher, independence_key, authority_score, cross_validation_score, relevance_score, teaching_quality_score, currency_score, accessibility_score, rank, selected, selection_reason, limitation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const source of research.sources) insertSource.run(source.id, runId, source.url, source.title, source.publisher, source.independenceKey, source.scores.authority, source.scores.crossValidation, source.scores.relevance, source.scores.teachingQuality, source.scores.currency, source.scores.accessibility, source.rank, source.selected ? 1 : 0, source.selectionReason, source.limitation);
  const insertClaim = db.prepare(`INSERT INTO research_claims (id, run_id, statement, major, conclusion, uncertainty) VALUES (?, ?, ?, ?, ?, ?)`);
  const insertEvidence = db.prepare(`INSERT INTO research_claim_evidence (run_id, claim_id, source_id, stance) VALUES (?, ?, ?, ?)`);
  for (const claim of research.claims) { insertClaim.run(claim.id, runId, claim.statement, claim.major ? 1 : 0, claim.conclusion, claim.uncertainty); for (const evidence of claim.evidence) insertEvidence.run(runId, claim.id, evidence.sourceId, evidence.stance); }
  return runId;
}

export function approveOutline(db: DatabaseHandle, dataRoot: string, input: ApproveOutlineInput): LearningSnapshot {
  if (typeof input !== "object" || input === null || Array.isArray(input) || !UUID_PATTERN.test(input.courseId)) throw new LearningValidationError("courseId is invalid");
  const priorKnowledge = requiredText(input.priorKnowledge, "prior knowledge", 10_000);
  if (!['examples', 'theory', 'practice'].includes(input.learningPreference)) throw new LearningValidationError("learning preference is invalid");
  requiredText(input.knowledgeMapMarkdown, "knowledge map", 1_000_000);
  validateResearchBundle(input.research);
  if (!Array.isArray(input.days) || input.days.length !== 30) throw new LearningValidationError("outline must contain exactly 30 Days");
  const objectives = input.days.map((day, index) => {
    if (typeof day !== "object" || day === null || Array.isArray(day)) throw new LearningValidationError(`Day ${index + 1} objective must be text`);
    const value = requiredText(day.objective, `Day ${index + 1} objective`, 500);
    if (/[\r\n]/.test(value)) throw new LearningValidationError("Day objective must be single-line");
    return value;
  });
  const course = getCourse(db, input.courseId);
  if (!course) throw new LearningStateError("Course does not exist");
  assertRevision(course, input.expectedRevision);
  if (course.status !== "draft") throw new LearningStateError("Course is not a draft");
  const now = new Date().toISOString();
  const days: LearningDay[] = objectives.map((objective, index) => ({ id: randomUUID(), dayNumber: index + 1, objective, completedAt: null }));
  const progressPath = `courses/${course.id}/progress.md`, journalPath = `courses/${course.id}/journal.md`, currentDayPath = `courses/${course.id}/current-day.md`;
  const projectedCourse: Course = { ...course, status: "active", priorKnowledge, learningPreference: input.learningPreference, currentDayId: days[0]!.id, currentStage: "lecture", revision: course.revision + 1, progressMarkdownPath: progressPath, progressMarkdownSha256: null, journalMarkdownPath: journalPath, journalMarkdownSha256: null, currentDayMarkdownPath: currentDayPath, currentDayMarkdownSha256: null, outlineApprovedAt: now, updatedAt: now };
  const projected: Omit<LearningSnapshot, "documents"> = { course: projectedCourse, days, currentDay: days[0]!, researchRuns: [], understoodConcepts: [], remediationConcepts: [], quizAttempts: [] };
  const update = prepareMarkdownUpdate(dataRoot, course.id, [
    { file: "course.md", expectedSha256: course.markdownSha256, content: renderApprovedCourseMarkdown(course, { ...input, priorKnowledge, days: objectives.map((objective) => ({ objective })) }) },
    { file: "progress.md", expectedSha256: null, content: renderProgressMarkdown(projected, now) },
    { file: "journal.md", expectedSha256: null, content: renderInitialJournalMarkdown() },
    { file: "current-day.md", expectedSha256: null, content: renderCurrentDayMarkdown(days[0]!) },
  ]);
  commitPreparedUpdate(db, update, () => {
    const latest = getCourse(db, course.id);
    if (!latest || latest.status !== "draft") throw new LearningStateError("Course is no longer a draft");
    assertRevision(latest, input.expectedRevision);
    const insertDay = db.prepare(`INSERT INTO course_days (id, course_id, day_number, objective) VALUES (?, ?, ?, ?)`);
    for (const day of days) insertDay.run(day.id, course.id, day.dayNumber, day.objective);
    insertResearchRun(db, course.id, null, input.research, now);
    const changed = db.prepare(`UPDATE courses SET status = 'active', prior_knowledge = ?, learning_preference = ?, current_day_id = ?, current_stage = 'lecture', revision = revision + 1, outline_approved_at = ?, progress_markdown_path = ?, progress_markdown_sha256 = ?, journal_markdown_path = ?, journal_markdown_sha256 = ?, current_day_markdown_path = ?, current_day_markdown_sha256 = ?, updated_at = ? WHERE id = ? AND revision = ? AND status = 'draft'`).run(priorKnowledge, input.learningPreference, days[0]!.id, now, progressPath, update.checksums["progress.md"]!, journalPath, update.checksums["journal.md"]!, currentDayPath, update.checksums["current-day.md"]!, now, course.id, input.expectedRevision);
    if (changed.changes !== 1) throw new LearningRevisionConflictError("Course revision changed");
    db.prepare(`UPDATE courses SET markdown_sha256 = ? WHERE id = ?`).run(update.checksums["course.md"]!, course.id);
  });
  return getLearningSnapshot(db, dataRoot, course.id)!;
}

type DayRow = { id: string; day_number: number; objective: string; completed_at: string | null };
type ResearchRunRow = { id: string; scope: "course" | "day"; day_id: string | null; questions_json: string; topic_criteria_json: string; created_at: string };
type ResearchSourceRow = { id: string; url: string; title: string; publisher: string; independence_key: string; authority_score: number; cross_validation_score: number; relevance_score: number; teaching_quality_score: number; currency_score: number; accessibility_score: number; total_score: number; rank: number; selected: number; selection_reason: string | null; limitation: string | null };
type ResearchClaimRow = { id: string; statement: string; major: number; conclusion: string; uncertainty: string | null };
type EvidenceRow = { source_id: string; stance: "supports" | "opposes" | "context" };
type AttemptRow = { id: string; attempt_number: number; status: "in_progress" | "passed" | "failed"; score: number | null; created_at: string; graded_at: string | null };
type QuestionRow = { id: string; position: number; concept_key: string; concept_label: string; prompt: string; grading_criteria: string };
type ResponseRow = { id: string; question_id: string; response_number: number; answer: string; result: "correct" | "incorrect" | "needs_clarification"; feedback: string; clarification_question: string | null; created_at: string };

export function getLearningSnapshot(db: DatabaseHandle, dataRoot: string, courseId: string): LearningSnapshot | null {
  const course = getCourse(db, courseId); if (!course) return null;
  const days = (db.prepare(`SELECT id, day_number, objective, completed_at FROM course_days WHERE course_id = ? ORDER BY day_number`).all(courseId) as DayRow[]).map((row) => ({ id: row.id, dayNumber: row.day_number, objective: row.objective, completedAt: row.completed_at }));
  const currentDay = course.currentDayId === null ? null : days.find(({ id }) => id === course.currentDayId) ?? null;
  if (course.currentDayId !== null && currentDay === null) throw new LearningStateError("Current Day is missing");
  const runRows = db.prepare(`SELECT id, scope, day_id, questions_json, topic_criteria_json, created_at FROM research_runs WHERE course_id = ? AND (scope = 'course' OR day_id = ?) ORDER BY CASE scope WHEN 'course' THEN 0 ELSE 1 END, created_at, id`).all(courseId, currentDay?.id ?? null) as ResearchRunRow[];
  const researchRuns = runRows.map((run): ResearchRun => {
    const sourceRows = db.prepare(`SELECT * FROM research_sources WHERE run_id = ? ORDER BY rank`).all(run.id) as ResearchSourceRow[];
    const claimRows = db.prepare(`SELECT id, statement, major, conclusion, uncertainty FROM research_claims WHERE run_id = ? ORDER BY id`).all(run.id) as ResearchClaimRow[];
    return { id: run.id, scope: run.scope, dayId: run.day_id, questions: JSON.parse(run.questions_json) as string[], topicCriteria: JSON.parse(run.topic_criteria_json) as string[], sources: sourceRows.map((source) => ({ id: source.id, url: source.url, title: source.title, publisher: source.publisher, independenceKey: source.independence_key, scores: { authority: source.authority_score, crossValidation: source.cross_validation_score, relevance: source.relevance_score, teachingQuality: source.teaching_quality_score, currency: source.currency_score, accessibility: source.accessibility_score }, totalScore: source.total_score, rank: source.rank, selected: source.selected === 1, selectionReason: source.selection_reason, limitation: source.limitation })), claims: claimRows.map((claim) => ({ id: claim.id, statement: claim.statement, major: claim.major === 1, conclusion: claim.conclusion, uncertainty: claim.uncertainty, evidence: (db.prepare(`SELECT source_id, stance FROM research_claim_evidence WHERE run_id = ? AND claim_id = ? ORDER BY source_id, stance`).all(run.id, claim.id) as EvidenceRow[]).map((evidence) => ({ sourceId: evidence.source_id, stance: evidence.stance })) })), createdAt: run.created_at };
  });
  const conceptRows = currentDay === null ? [] : db.prepare(`SELECT concept_key, label, status FROM day_concepts WHERE day_id = ? ORDER BY concept_key`).all(currentDay.id) as { concept_key: string; label: string; status: "understood" | "remediation" }[];
  const attemptRows = currentDay === null ? [] : db.prepare(`SELECT id, attempt_number, status, score, created_at, graded_at FROM quiz_attempts WHERE day_id = ? ORDER BY attempt_number`).all(currentDay.id) as AttemptRow[];
  const quizAttempts = attemptRows.map((attempt): QuizAttempt => {
    const questions = db.prepare(`SELECT id, position, concept_key, concept_label, prompt, grading_criteria FROM quiz_questions WHERE attempt_id = ? ORDER BY position`).all(attempt.id) as QuestionRow[];
    return { id: attempt.id, attemptNumber: attempt.attempt_number, status: attempt.status, score: attempt.score, createdAt: attempt.created_at, gradedAt: attempt.graded_at, questions: questions.map((question) => ({ id: question.id, position: question.position, conceptKey: question.concept_key, conceptLabel: question.concept_label, prompt: question.prompt, gradingCriteria: question.grading_criteria, responses: (db.prepare(`SELECT id, question_id, response_number, answer, result, feedback, clarification_question, created_at FROM quiz_responses WHERE question_id = ? ORDER BY response_number`).all(question.id) as ResponseRow[]).map((response) => ({ id: response.id, questionId: response.question_id, responseNumber: response.response_number, answer: response.answer, result: response.result, feedback: response.feedback, clarificationQuestion: response.clarification_question, createdAt: response.created_at })) })) };
  });
  const readOptional = (path: string | null, checksum: string | null): string | null => { if (path === null && checksum === null) return null; if (path === null || checksum === null) throw new LearningStateError("Document registration is incomplete"); return readVerifiedMarkdown(dataRoot, path, checksum); };
  return { course, days, currentDay, researchRuns, understoodConcepts: conceptRows.filter(({ status }) => status === "understood").map(({ concept_key, label }) => ({ key: concept_key, label })), remediationConcepts: conceptRows.filter(({ status }) => status === "remediation").map(({ concept_key, label }) => ({ key: concept_key, label })), quizAttempts, documents: { course: readVerifiedMarkdown(dataRoot, course.markdownPath, course.markdownSha256), progress: readOptional(course.progressMarkdownPath, course.progressMarkdownSha256), journal: readOptional(course.journalMarkdownPath, course.journalMarkdownSha256), currentDay: readOptional(course.currentDayMarkdownPath, course.currentDayMarkdownSha256) } };
}
