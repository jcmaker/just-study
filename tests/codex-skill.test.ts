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
    "start_quiz", "grade_quiz", "start_remediation_quiz", "complete_day",
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

test("keeps project MCP config aligned with the skill dependency", () => {
  assert.match(config, /\[mcp_servers\.just-study\]/);
  assert.match(config, /url = "http:\/\/127\.0\.0\.1:3000\/mcp"/);
  assert.match(config, /required = false/);
  assert.match(config, /default_tools_approval_mode = "writes"/);
  assert.equal(existsSync(resolve(skillRoot, "scripts")), false);
  assert.equal(existsSync(resolve(skillRoot, "references")), false);
  assert.equal(existsSync(resolve(skillRoot, "assets")), false);
});
