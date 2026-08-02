import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const skillRoot = resolve(root, ".agents/skills/just-study");
const skill = readFileSync(resolve(skillRoot, "SKILL.md"), "utf8");
const metadata = readFileSync(resolve(skillRoot, "agents/openai.yaml"), "utf8");
const config = readFileSync(resolve(root, ".codex/config.toml"), "utf8");

test("keeps the just-study skill explicit and instruction-only", () => {
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/)?.[1];
  assert.ok(frontmatter);
  assert.match(frontmatter, /^name: just-study$/m);
  assert.match(frontmatter, /^description: .+$/m);
  assert.equal([...frontmatter.matchAll(/^\w+:/gm)].length, 2);
  assert.ok(skill.split("\n").length < 500);
  assert.deepEqual(readdirSync(skillRoot).sort(), ["SKILL.md", "agents"]);
  for (const marker of ["TO" + "DO", "TB" + "D", "FIX" + "ME"])
    assert.equal(skill.includes(marker), false);
  assert.match(metadata, /allow_implicit_invocation: false/);
  assert.match(metadata, /value: "just-study"/);
  assert.match(metadata, /transport: "streamable_http"/);
  assert.match(metadata, /url: "http:\/\/127\.0\.0\.1:3000\/mcp"/);
});

test("names every approved tool and all research safety invariants", () => {
  for (const name of [
    "health", "list_courses", "get_learning_state", "read_learning_document",
    "create_course", "approve_outline", "record_daily_research", "save_checkpoint",
    "start_quiz", "answer_quiz", "start_remediation_quiz", "complete_day",
  ]) assert.match(skill, new RegExp(`\\b${name}\\b`));
  for (const phrase of [
    "never ask the server to browse",
    "Never invent a source",
    "Open every URL before submitting it",
    "latest saved `revision`",
    "Do not replay the write automatically",
    "saved current Day and stage",
    "When web is unavailable",
  ])
    assert.match(skill, new RegExp(phrase));
});

const escaped = (phrase: string) => new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

test("pins the rules a real Codex run would otherwise have to guess", () => {
  for (const phrase of [
    // 드라이런에서 실제로 막힌 지점. 이 문장이 없으면 첫 approve_outline이 거부된다.
    "unselected source reason must be null",
    "Only selected sources carry a reason",
    // 여섯 오류 코드 중 네 개는 대응 지침이 없으면 에이전트가 추측한다.
    "On `VALIDATION`",
    "On `STATE`",
    "On `UNAVAILABLE` or `INTERNAL`",
    "do not retry in a loop",
    // 웹에서 먼저 답했을 수 있다는 사실을 모르면 답한 문항을 다시 묻는다.
    "answer in the local dashboard",
    "never re-ask an answered question",
    // 기준을 낮추는 대신 major를 내리라는 지시.
    "set `major: false`",
  ])
    assert.match(skill, escaped(phrase));
});

test("pins the multiple-choice quiz contract", () => {
  for (const phrase of [
    "four distinct single-line choices",
    "zero-based `correctChoiceIndex`",
    "plausible mistake, not filler",
    "never reveal `correctChoiceIndex` before the learner answers",
    "The server grades",
    "never state a result you decided yourself",
    "There is no clarification round",
  ])
    assert.match(skill, escaped(phrase));
  // 옛 서술형 계약이 되살아나면 걸린다.
  for (const gone of ["grade_quiz", "needs_clarification", "gradingCriteria"]) {
    assert.equal(skill.includes(gone), false, gone);
  }
});

test("pins the mutually exclusive checkpoint shapes and the health ok:false rule", () => {
  for (const phrase of [
    "must include both `understoodConcepts` and `remediationConcepts`",
    "must never include `remediationMarkdown`",
    "must omit both `understoodConcepts` and `remediationConcepts`",
    "mutually exclusive shapes",
    "reports `ok: false`",
  ])
    assert.match(skill, new RegExp(phrase));
});

test("distinguishes new URL provenance from approved saved-source reuse", () => {
  assert.match(skill, /when it was newly researched/);
  assert.match(skill, /current persisted Codex thread/);
  assert.match(skill, /approved saved URLs/);
  assert.match(skill, /explicit reuse approval/);
  assert.match(skill, /does not require a new `openPage` event/);
});

test("uses nested local research keys before server canonicalization", () => {
  for (const phrase of [
    "Before `approve_outline` or `record_daily_research`, use",
    "simple unique local keys",
    "`sources[].id` and `claims[].id`",
    "`claims[].evidence[].sourceId`",
    "exactly reuse that source key",
    "`s-1` and `c-1`",
    "server stores and returns canonical UUIDs",
  ]) assert.ok(skill.includes(phrase));
});

test("keeps project MCP config aligned with the skill dependency", () => {
  assert.match(config, /\[mcp_servers\.just-study\]/);
  assert.match(config, /url = "http:\/\/127\.0\.0\.1:3000\/mcp"/);
  assert.match(config, /required = false/);
  assert.match(config, /default_tools_approval_mode = "writes"/);
  assert.equal(existsSync(resolve(skillRoot, "scripts")), false);
  assert.equal(existsSync(resolve(skillRoot, "references")), false);
  assert.equal(existsSync(resolve(skillRoot, "assets")), false);
});
