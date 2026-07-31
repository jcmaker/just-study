# just-study

Agent-researched, self-hosted learning. The current foundation stores course
shells in SQLite and human-readable Markdown.

## Requirements

- Node.js 22.23.1 or newer
- npm

## Run locally

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:3000>. The scripts bind to localhost only.

## Verify

```bash
npm test
npm run lint
npm run build
```

## Data

Runtime data defaults to `./data` and is ignored by Git:

- `data/just-study.sqlite`: structured course records
- `data/courses/<course-id>/course.md`: long-form course Markdown

Set `JUST_STUDY_DATA_DIR` to use another local directory.

Do not copy only `just-study.sqlite` while the app is running in WAL mode.
Live backup is outside this phase. Stop the app before copying the `data`
directory.

## Learning engine

The server stores a fixed 30-session course and enforces:

- one current Day and one persisted stage;
- rubric-validated, caller-supplied research evidence;
- five-question 5/5 mastery with clarification and fresh remediation quizzes;
- three-answer reflection before advancing;
- exact restart from SQLite plus verified Markdown.

The course directory contains `course.md`, generated `progress.md`, completed
`journal.md`, and transient `current-day.md`. The transient file is removed
when Day 30 completes.

The server does not call an LLM or research the web. The future `$just-study`
Codex skill supplies research, teaching, and grading through the service/MCP
contract.

## Current scope

This phase includes single-user local course creation, the 30-Day learning
engine, SQLite/Markdown restart persistence, and health checks. MCP, PDF
files, schedules, login, Docker, dashboards, and multi-user support are
separate phases.
