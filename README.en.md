<p align="center">
  <img src="docs/images/banner.svg" alt="just-study" width="100%">
</p>

<p align="center">
  <img alt="self-hosted" src="https://img.shields.io/badge/self--host-only-000?style=flat-square">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-22.23.1%2B-000?style=flat-square">
  <img alt="storage" src="https://img.shields.io/badge/storage-SQLite%20%2B%20Markdown-000?style=flat-square">
  <img alt="MCP" src="https://img.shields.io/badge/MCP-12%20tools-c60000?style=flat-square">
  <img alt="tests" src="https://img.shields.io/badge/tests-268%20passing-000?style=flat-square">
</p>

<p align="center">
  <strong>Pick a topic. The agent does the research.</strong><br>
  A 30-day course builder that runs only on your own machine.
</p>

<p align="center">
  <a href="README.md">한국어</a> · <strong>English</strong>
</p>

> The product interface is Korean. This page describes the same system in English.

---

## What it does

The slowest part of studying something new is rarely the studying. It is deciding where to start.

`just-study` takes that part. Say you want to learn operating systems, and the agent actually searches the web, scores what it finds against a fixed 100-point rubric, cross-checks the load-bearing claims against independent sources, and comes back with a **30-day outline** — one objective per day — for you to approve.

Once you approve it, the agent teaches. It explains, gives an analogy, works an example, checks that you followed, then quizzes you. Get something wrong and it explains again a different way.

> This is the opposite of a dashboard where you upload your own material.
> Here, **you never gather the sources.**

<p align="center">
  <img src="docs/images/architecture.svg" alt="Architecture: only the agent reaches the open web, and it owns research, teaching, and question authoring. The MCP server validates, stores, and grades — it never calls an LLM or searches the web. Storage is SQLite plus Markdown under the home directory, and the dashboard is a second client of the same server." width="100%">
</p>

Judgment and storage are split. Research, teaching, and question authoring all happen in the agent; the server only validates what comes back and files it. **There is no LLM in the server.** That separation is what lets a rule, rather than good intentions, stop an invented URL from being stored.

## Getting started

```bash
git clone https://github.com/jcmaker/just-study.git
cd just-study
npm install
npm run dev
```

Open <http://127.0.0.1:5878>. Then, from a Codex session opened in this repository — or `/just-study` in Claude Code:

```
$just-study
```

The agent asks three things: what you already know, what you want to be able to do after 30 days, and whether you learn best from examples, theory, or practice. Answer those and the research begins.

To pick up where you left off:

```
$just-study 계속
```

## How a day goes

A day moves in one fixed order. You cannot skip ahead.

<p align="center">
  <img src="docs/images/day-flow.svg" alt="The day flow: lecture leads to the quiz. Five out of five opens reflection and completes the day. A single wrong answer routes into remediation and back into the quiz with five new questions." width="100%">
</p>

The line is not straight. **Reflection opens only at 5/5**, so the day loops between quiz and remediation until you clear it. (The diagram is labelled in Korean, like the product.)

| Stage | What happens |
|---|---|
| **Lecture** | The agent researches today's objective fresh, then teaches: precise explanation, ELI5, analogy, worked example, application — checking your understanding along the way. |
| **Quiz** | Five multiple-choice questions. **The server grades them.** It compares your pick against the stored answer key, so the agent cannot manufacture a result and you get the same outcome whether you answer in the browser or in Codex. |
| **Remediation** | One wrong answer sends you here. The agent re-explains the missed concepts with a different analogy and new examples, then writes five fresh questions that repeat none of the originals. |
| **Reflection** | Unlocked at 5/5. Write what you learned, what still confuses you, and a one-line reaction. That goes into the journal and the next day opens. |

Thirty days means **thirty completed sessions**, not thirty consecutive calendar days. Skip a day and nothing falls behind; you also cannot double up tomorrow.

## Why you can trust the sources

Ask an agent to "find good sources" and sooner or later it invents a plausible URL. This project spends its rules on preventing that.

**A fixed 100-point rubric.** The criteria are written down before the search starts, and only those criteria are scored.

<p align="center">
  <img src="docs/images/rubric.svg" alt="Point allocation: authority 25, cross-validation 25, fit 20, teaching quality 15, currency 10, accessibility 5. A source scoring under 80 is never selected." width="100%">
</p>

Where the points sit is the argument. **Authority and cross-validation are half the rubric on their own** — whether a source can be trusted outranks how well it is written.

| Criterion | Points |
|---|---:|
| Authority of the author or institution | 25 |
| Cross-validation against independent sources | 25 |
| Fit for your goal and current stage | 20 |
| Teaching quality — explanation, examples | 15 |
| Currency and maintenance | 10 |
| Free accessibility | 5 |

**Nothing below 80 gets selected.** When good sources are scarce, the agent shows the score and the limitation instead of quietly lowering the bar.

**Load-bearing claims need two independent sources.** With only one, the claim is demoted and the uncertainty is recorded.

**A URL that was never opened cannot be stored.** The server never searches the web itself. Only addresses the agent actually visited come through.

## Where this stands

Written plainly: this is not a finished product.

| Area | Status |
|---|---|
| Course creation, 30-day outline, research validation | Working |
| Daily lecture, quiz, remediation, reflection | Working |
| Web dashboard (five screens, five themes) | Working |
| MCP server (12 tools) | Working |
| **A real Codex CLI run, start to finish** | **Not yet done** |
| Schedules, assignments, PDFs, attachments | Next phase |
| Docker packaging, backup and restore | Next phase |

The automated tests drive all thirty days through an MCP client, but nobody has yet completed the flow with the actual Codex CLI. That line disappears once they have.

## Dashboard

After `npm run dev`, open <http://127.0.0.1:5878>. There is no login, signup, or account, and the server binds to `127.0.0.1` only.

| Route | Screen | What you do there |
|---|---|---|
| `/` | Today | See what to resume, copy the `$just-study 계속` command |
| `/courses` | Courses | Filter by status, create a course |
| `/courses/[id]` | Course workspace | Overview, 30-day plan, today, sources, quiz, journal |
| `/settings` | Settings | Pick a theme, reach system status |
| `/status` | Status | Database and storage checks with recovery guidance |

### Themes

Five are available: Focus (default), Calm, Focus Dark, Bubblegum, and Terminal. Focus Dark and Terminal are dark; Terminal sets the whole interface in a monospace face. Your choice lives in this browser's `localStorage` under `just-study:theme` and never touches your learning data. If that value cannot be read, Focus renders.

All five share one component tree and swap only CSS custom properties. No screen is duplicated per theme.

### What the dashboard lets you change

The dashboard does not study for you. Research and teaching happen in Codex through `$just-study`; the screen reads stored facts back. Exactly five values are editable:

1. Creating a course
2. A draft course's title and goal
3. Picking an option on a quiz question you have not answered
4. The three reflection answers, before you submit them
5. The theme

Quiz answer keys are not sent to the browser until you answer, so you cannot open another tab and read them early.

The approved 30-day outline, source scores, quiz questions and results, and completed days are read-only. If the course was saved elsewhere first, your save is refused, your input is kept, and you are asked to reload the current state. A document that fails its checksum is never shown as if it were intact; you get a recovery link to `/status`.

## Connecting an agent

The MCP endpoint is open only while the server runs. Codex reads the connection from `.codex/config.toml`:

```toml
[mcp_servers.just-study]
url = "http://127.0.0.1:5878/mcp"
required = false
default_tools_approval_mode = "writes"
```

Claude Code reads the same endpoint from `.mcp.json` in the repository, and asks once per session whether to trust the server.

To use it outside the repository, install it as a plugin. The skill and the MCP config travel together, so `/just-study` works from any directory.

```
/plugin marketplace add jcmaker/just-study
/plugin install just-study@just-study
```

The agent starts the server itself when you call `/just-study`, so you do not need to keep `npm run dev` running. If the session began while the server was down, the MCP client will not reconnect within that session — restart the session once, and it stays connected from then on.

There is one copy of the skill, at `.agents/skills/just-study/SKILL.md`. The path Claude Code reads, `.claude/skills/just-study/SKILL.md`, is a symlink to it, so both agents follow the same rules. Research, teaching, and question authoring are the skill's job; the server only stores and validates.

`$just-study` (`/just-study` in Claude Code) first checks for a course on the same topic and asks whether to continue it. `$just-study 계속` resumes a saved course, asking which one when several exist.

### MCP tools

| Tool | Kind | What it does |
|---|---|---|
| `health` | read | Checks the database, storage, schema, and recovery state. |
| `list_courses` | read | Lists saved courses with their day, stage, and revision. |
| `get_learning_state` | read | Reads the current day, stage, research, concepts, quiz, and today's document. |
| `read_learning_document` | read | Reads one checksum-verified document. |
| `create_course` | write | Creates a draft course idempotently from a request UUID. |
| `approve_outline` | write | Activates a draft after the interview, research, knowledge map, and 30 objectives are approved. |
| `record_daily_research` | write | Stores the sources and cross-checked claims researched that day. |
| `save_checkpoint` | write | Stores what was actually taught and the concept status. |
| `start_quiz` | write | Stores five questions fixed before any answer is seen. |
| `answer_quiz` | write | Stores the option the learner picked. The server decides correctness. |
| `start_remediation_quiz` | write | Stores a different explanation and five new questions. |
| `complete_day` | write | Stores the three reflections and advances the day. |

## Where your data lives

Everything persistent sits under `~/.just-study/data/`. The location is fixed and independent of the working directory, so the repository and an installed plugin both read the same store.

```
~/.just-study/data/
├── just-study.sqlite              structured state
└── courses/<course-id>/
    ├── course.md                  research narrative, knowledge map, 30-day outline
    ├── progress.md                read-only snapshot generated from SQLite
    ├── journal.md                 lectures and reflections for completed days
    └── current-day.md             the day in progress (removed after day 30)
```

**SQLite is the source of truth** for course state, the current day and stage, quiz results, and source scores. **Markdown is the source of truth** for long prose: research narratives, lecture content, reflections. SQLite stores each Markdown path alongside its checksum, so a damaged file is never presented as intact — you get the recovery screen instead.

Point `JUST_STUDY_DATA_DIR` somewhere else to use a different location.

Do not copy `just-study.sqlite` alone while the app is running in WAL mode. Safe live backup belongs to a later phase. For now, stop the app and copy the whole `~/.just-study/data/` directory.

## Development

```bash
npm test          # Node's built-in test runner, 268 tests
npm run lint
npx tsc --noEmit
npm run build
```

Dependencies stay minimal. No ORM, no state management library, no test framework, no chart or date library. No remote fonts either.

SQLite comes from Node's built-in `node:sqlite`, so **nothing in the tree needs compiling**. Plugin installs run with `--ignore-scripts`, and a native module installed that way arrives unbuilt — the server starts but never reaches the database. `node:sqlite` is marked experimental on Node 22.23.1 and prints one warning line at startup.

### About the dependency overrides

`package.json` carries two:

```json
"overrides": {
  "postcss": "^8.5.25",
  "sharp": "^0.35.3"
}
```

`next` pins `postcss` to exactly `8.4.31` and takes `sharp` as an optional dependency, and both of those versions carry advisories. The overrides raise only those two transitive packages. `npm audit` reports zero.

**Do not run `npm audit fix --force`.** It proposes rolling `next` back to `9.3.3`, which is years old. This project keeps `next` on 16. The advisories were never in `next` itself — they were transitive, and the overrides above resolve them.

For what it's worth, the app never uses `next/image`, so the `sharp` path is never exercised.

Design documents and implementation plans live under `docs/superpowers/`. Where a change altered a contract, the original text stays and a dated erratum sits beside it.

## What this project does not do

- Call an LLM or search the web from the server
- Login, signup, accounts, multiple users
- Expose itself beyond `127.0.0.1`
- Cloud SaaS or billing
- Notifications, streaks, badges, or other gamification

No data model or abstraction is built for these until there is real demand for them.

## Credits

[OpenStudy](https://github.com/OpenStudy-dev/OpenStudy) was read as a reference for how a self-hosted study tool is operated and shaped. `just-study` is a separate product and reuses none of its code.

## License

[MIT](LICENSE).

The `"private": true` field in `package.json` blocks publishing to the npm registry. It says nothing about the source or the license — this is an app you run yourself, not a package.
