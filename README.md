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

## Current scope

This phase includes course shell creation, listing, reading, health checks,
atomic Markdown writes, and restart persistence. Research, the 30-Day learning
engine, MCP, PDF files, schedules, login, Docker, and multi-user support are
separate phases.
