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

The server does not call an LLM or research the web. The `$just-study` Codex
skill supplies research, teaching, and grading through the service/MCP
contract.

## Current scope

This phase includes single-user local course creation, the 30-Day learning
engine, SQLite/Markdown restart persistence, health checks, the MCP server,
and the learning dashboard. PDF and other attachment files, schedules,
assignments and to-dos, Docker packaging, backup/restore, multi-user support,
and login are separate phases.

## Codex integration

1. Start the server first: `npm run dev`. The MCP endpoint is only reachable
   while the server is running.
2. Codex reads the connection from `.codex/config.toml`:

   ```toml
   [mcp_servers.just-study]
   url = "http://127.0.0.1:3000/mcp"
   required = false
   default_tools_approval_mode = "writes"
   ```

3. In Codex, invoke `$just-study` to create a course; the skill first checks
   for a matching saved course and asks whether to continue it instead. Invoke
   `$just-study 계속` to resume a saved course, choosing one when several
   exist.
4. The skill (`.agents/skills/just-study/SKILL.md`) does the research,
   teaching, and grading itself; the server only stores and validates state
   over MCP — it never calls a model or browses the web.

Real Codex CLI acceptance testing of this end-to-end flow has not been run
yet.

## 학습 대시보드

`npm run dev` 뒤 브라우저에서 `http://127.0.0.1:3000`을 엽니다. 로그인·가입·계정이
없고 서버는 `127.0.0.1`에만 바인딩합니다.

| 경로 | 화면 | 주요 행동 |
|---|---|---|
| `/` | 오늘 | 이어갈 과정 확인, `$just-study 계속` 명령 복사 |
| `/courses` | 과정 | 상태 필터, 새 과정 만들기 |
| `/courses/[id]` | 과정 작업 공간 | 개요·30일 계획·오늘·출처·퀴즈·학습 기록 탭 |
| `/settings` | 설정 | 테마 선택, 시스템 상태 진입 |
| `/status` | 상태 | 데이터베이스·저장소 점검과 복구 안내 |

### 테마

Focus(기본), Calm, Focus Dark 세 가지를 제공합니다. 선택값은 이 브라우저의
`localStorage` 키 `just-study:theme`에만 저장되며 학습 데이터에는 영향을 주지
않습니다. 저장값을 읽지 못하면 Focus로 표시합니다.

### 대시보드에서 바꿀 수 있는 것

대시보드는 학습을 대신 진행하지 않습니다. 리서치·강의·채점은 Codex의
`$just-study`가 수행하고, 화면은 저장된 사실을 읽어서 보여 줍니다. 직접 수정할 수
있는 값은 다음 네 가지뿐입니다.

1. 새 과정 만들기
2. 초안 과정의 제목과 목표
3. 아직 제출하지 않은 세 개의 회고 답변
4. 테마 선택

승인된 30일 목차, 출처 점수, 퀴즈 문제와 응답, 완료된 Day는 읽기 전용입니다.
다른 곳에서 과정이 먼저 저장되면 저장이 거부되고 입력한 내용을 유지한 채 최신
상태를 다시 불러오도록 안내합니다. 체크섬 검증에 실패한 문서는 정상 내용처럼
표시하지 않고 `/status` 복구 안내로 연결합니다.
