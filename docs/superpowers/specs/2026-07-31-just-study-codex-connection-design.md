# just-study Codex 연결 설계

## 상태

2026-07-31 브레인스토밍과 사용자 최종 검토에서 승인됨.

## 목적

학습 엔진의 공통 서비스 계층을 로컬 MCP 도구로 공개하고, 저장소 범위의
`$just-study` Codex 스킬이 실제 웹 리서치, 강의, 평가와 재개 흐름을 수행한다.

이 단계가 끝나면 사용자는 `just-study` 서버를 로컬에서 실행한 뒤 Codex에서
`$just-study` 또는 `$just-study 계속`을 호출해 과정 생성부터 일일 학습까지
진행할 수 있어야 한다.

## 확정된 경계

- 서버는 모델이나 웹 검색 API를 호출하지 않는다.
- Codex가 웹을 조사하고, MCP에는 Codex가 실제로 확인한 자료만 전달한다.
- SQLite와 Markdown의 소유권 및 학습 상태 규칙은 기존 서비스 계층이 유지한다.
- MCP는 서비스 계층을 우회하는 SQL, 파일 경로, 셸 도구를 제공하지 않는다.
- 첫 연결은 단일 사용자·로컬 전용이며 `127.0.0.1` 바인딩을 유지한다.
- 로컬 사용에는 로그인·가입·계정, OAuth와 MCP 토큰을 추가하지 않는다.
- 외부 네트워크 접속은 현재 E2E 범위에서 제외하고 관련 인증 추상화도 미리 만들지
  않는다.
- Claude, 플러그인 디렉터리 배포와 서버 측 모델 호출은 제외한다.

## 선택한 구조

```text
Codex + repo-scoped $just-study skill
                  |
                  | Streamable HTTP
                  v
        http://127.0.0.1:3000/mcp
                  |
                  v
       existing TypeScript services
                  |
                  v
           SQLite + Markdown
```

MCP는 Next.js 애플리케이션의 `/mcp` Route Handler로 제공한다. 이 구조에서는
Next 프로세스 하나가 데이터베이스와 Markdown을 소유하므로, 별도 MCP 프로세스와
웹 프로세스가 동일한 파일을 교체하면서 일시적인 체크섬 불일치를 노출하지 않는다.

MCP 핸들러는 세션 없는 도구 호출만 제공한다. 대화와 학습 상태는 MCP 메모리가
아니라 Codex 대화 및 SQLite·Markdown에 존재한다. 서버를 재시작해도 새 요청은
`getLearningSnapshot`으로 저장된 상태를 복원한다.

### 제외한 대안

- **DB를 직접 여는 stdio MCP:** 로컬 실행은 단순하지만 Next와 별도 저장소
  소유자가 생긴다. 최종 대시보드와 동시에 쓸 수 없어 제외한다.
- **stdio-to-HTTP 프록시:** 단일 저장소 소유자는 지키지만 별도 프로세스와 내부
  API 계층만 늘어난다.
- **자체 JSON-RPC 구현:** 프로토콜, 협상과 스키마 검증을 재구현해야 하므로
  제외한다.

## 의존성

구현 시 현재 안정 배포선인 다음 패키지를 정확히 고정하고 lockfile에 기록한다.

- `@modelcontextprotocol/server` 2.0.0
- `@modelcontextprotocol/client` 2.0.0 — 프로토콜 통합 테스트 전용
- `zod` 4.4.3 — MCP 입력·출력 스키마

서버는 공식 `createMcpHandler`의 Web Standard `Request`/`Response` 인터페이스를
사용한다. 직접 프로토콜 코드를 작성하거나 별도 웹 프레임워크를 추가하지 않는다.

## 저장소 구성

```text
.agents/skills/just-study/
├── SKILL.md
└── agents/openai.yaml
.codex/config.toml
src/app/mcp/route.ts
src/server/mcp.ts
tests/mcp.test.ts
tests/codex-skill.test.ts
```

- `.agents/skills`는 Codex가 저장소 루트에서 자동 발견하는 프로젝트 스킬 위치다.
- `.codex/config.toml`은 신뢰된 프로젝트에서만 읽히는 프로젝트 범위 MCP 설정이다.
- `src/server/mcp.ts`는 서버 생성, Zod 스키마, 도구 등록과 오류 변환만 담당한다.
- `src/app/mcp/route.ts`는 로컬 요청 보안과 크기 제한 후 공식 MCP 핸들러에 전달한다.
- 제품 서비스 규칙은 `courses.ts`, `learning.ts`, `health.ts`에 계속 존재한다.
  `learning.ts`에는 고정 enum으로 한 문서만 검증해 읽는 `getLearningDocument`를
  추가하고, `storage.ts`의 기존 `StorageError`만 공개해 안전한 오류 분류에 사용한다.

프로젝트 설정의 기본 URL은 `http://127.0.0.1:3000/mcp`다. MCP 연결은
`required = false`로 두어 서버가 꺼졌다는 이유로 Codex 자체가 시작되지 않는
상황을 피한다. `$just-study`는 첫 단계에서 health 도구를 호출하고 서버가 없으면
정확한 실행 명령을 안내한다. 최소 설정 계약은 다음과 같다.

```toml
[mcp_servers.just-study]
url = "http://127.0.0.1:3000/mcp"
required = false
default_tools_approval_mode = "writes"
```

`writes`는 read-only annotation이 없는 도구만 사용자 승인을 요청한다. 서버별·도구별
추가 설정은 현재 요구에 필요하지 않으므로 넣지 않는다.

## MCP 도구 계약

### 공통 응답

성공 응답은 짧은 사람용 요약과 구조화 데이터를 함께 반환한다. 실패 응답은
`isError: true`와 다음 형태의 안전한 구조화 오류를 반환한다.

```text
{
  ok: false,
  error: {
    code: VALIDATION | STATE | REVISION_CONFLICT |
          STORAGE_CORRUPT | UNAVAILABLE | INTERNAL,
    message: string,
    retryable: boolean
  }
}
```

절대 경로, SQL, 스택과 원시 내부 오류는 응답에 포함하지 않는다. 알 수 없는 오류는
`INTERNAL`로 변환한다. `REVISION_CONFLICT`는 상태 재조회만 허용하고 같은 쓰기를
자동 재시도하지 않는다. `STORAGE_CORRUPT`는 덮어쓰지 않고 복구 화면을 안내한다.

### 조회 도구

| 도구 | 입력 | 출력 |
|---|---|---|
| `health` | 없음 | DB·스토리지·스키마·복구 상태 |
| `list_courses` | 없음 | ID, 제목, 목표, 상태, 현재 Day·단계, revision |
| `get_learning_state` | `courseId` | 전체 Day 상태, 현재 연구·개념·퀴즈, 현재 Day Markdown |
| `read_learning_document` | `courseId`, `document` | 검증된 `course`, `progress`, `journal`, `current-day` 중 하나 |

`get_learning_state`는 재개에 필요한 현재 Day 내용은 반환하지만 매번 전체 journal을
반환하지 않는다. 긴 문서는 `read_learning_document`로 명시적으로 읽는다. 파일명은
고정 enum이며 호출자가 경로를 전달할 수 없다.

### 쓰기 도구

| 도구 | 서비스 함수 | 핵심 입력 |
|---|---|---|
| `create_course` | `createCourse` | `requestId`, `title`, `goal` |
| `approve_outline` | `approveOutline` | 시작 인터뷰, 검증된 전체 연구, 30개 목표, revision |
| `record_daily_research` | `recordDailyResearch` | 당일 검증 연구, revision |
| `save_checkpoint` | `saveLearningCheckpoint` | 강의/인터뷰 또는 보충 내용, 개념 상태, revision |
| `start_quiz` | `startQuiz` | 답변 전 확정한 정확히 5문제, 각 문제의 보기 4개·정답 인덱스·해설, revision |
| `answer_quiz` | `answerQuiz` | 시도 ID, 학습자가 고른 보기 번호, revision |
| `start_remediation_quiz` | `startRemediationQuiz` | 다른 설명·예제와 새 5문제, revision |
| `complete_day` | `completeDay` | 세 회고 답변, revision |

모든 상태 변경은 기존 서비스 함수에 그대로 위임한다. 어댑터는 학습 단계를 추측해
바꾸거나 revision을 대신 보정하지 않는다. 각 성공 응답은 새 revision과 다음 Day·
단계를 포함한 compact state를 반환한다.

> **ERRATUM (2026-08-02, 퀴즈 사지선다 전환):** 원문의 `grade_quiz`는 호출자가
> `사용자 답변, 판정과 피드백`을 보내는 계약이었다. 즉 에이전트가 정·오답을
> 지정했고 서버는 그 값을 검증 없이 저장했다. 사용자 요청으로 퀴즈를 사지선다로
> 바꾸면서 **채점 주체가 서버로 옮겨졌다.** 도구 이름도 `answer_quiz`로 바뀌었고,
> 호출자는 학습자가 고른 보기 번호만 보낸다. 서버가 `start_quiz` 시점에 저장한 정답
> 인덱스와 비교해 결과를 정하므로 **어떤 클라이언트도 채점 결과를 지정할 수 없다.**
> 이 변경은 웹과 에이전트가 같은 퀴즈에서 같은 결과를 내야 한다는 요구에서 나왔고,
> 부수적으로 기존 계약의 신뢰 구멍을 막는다.

읽기 도구는 MCP read-only annotation을 사용한다. 쓰기 도구는 read-only로 표시하지
않고, `create_course` 외에는 재호출을 idempotent하다고 선언하지 않는다.

## `$just-study` 스킬

스킬은 instruction-only로 유지한다. 결정적인 저장과 검증은 MCP가 담당하므로 별도
스크립트를 넣지 않는다. `agents/openai.yaml`에는 다음 정책을 둔다.

- 명시적 `$just-study` 호출에서만 실행되도록 implicit invocation을 끈다.
- `just-study` MCP 의존성을 선언한다.
- 서버가 실행 중이지 않을 때 `npm run dev` 또는 production 실행 방법을 안내한다.

MCP 서버 instructions의 첫 512자에는 다음 불변식을 자족적으로 기록한다.

- 실제로 확인하지 않은 출처를 만들지 않는다.
- 쓰기 전 최신 revision을 사용한다.
- 충돌·손상 시 자동 재시도나 덮어쓰기를 하지 않는다.
- 현재 Day와 stage에 맞는 도구만 호출한다.

### 새 과정

1. `health`를 확인한다.
2. `list_courses`로 같은 주제의 과정을 찾고, 있으면 이어갈지 새로 만들지 묻는다.
3. 기존 지식, Day 30 목표, 선호 학습 방식을 한 번에 하나씩 묻는다.
4. 재사용할 UUID request ID를 만든 뒤 `create_course`로 draft를 저장한다.
5. 검색 전 연구 질문, 고정 루브릭과 주제별 기준을 정한다.
6. Codex 웹 도구로 1차·공식·교육 자료를 실제 조사한다.
7. 후보 점수, 순위, 선정 이유, 한계, 주요 주장 교차 검증과 불확실성을 만든다.
8. 하나의 목표만 가진 정확히 30개 Day를 사용자에게 보여준다.
9. 명시적 승인을 받은 뒤에만 `approve_outline`을 호출한다.

### 이어하기

1. 과정이 없으면 새 과정 흐름을 안내한다.
2. 과정이 여러 개면 제목과 현재 위치를 보여주고 하나를 선택하게 한다.
3. `get_learning_state`를 호출하고 저장된 Day·stage에서만 재개한다.
4. `lecture`, `quiz`, `remediation`, `reflection`별 절차를 분기한다.
5. 새 대화에서도 저장된 문제·응답·현재 Day Markdown을 그대로 사용한다.

### 웹을 사용할 수 없을 때

새 조사를 수행했다고 주장하거나 URL을 생성하지 않는다. 관련성이 확인된 기존 승인
자료가 있으면 그 자료를 재사용할지, 웹이 가능할 때까지 멈출지 묻는다. 사용자가
재사용을 승인하면 기존 저장 URL과 현재 한계를 명시한 당일 연구 묶음을 제출한다.
관련 자료가 없으면 진행을 중단한다.

## 로컬 HTTP 보안

- 애플리케이션 실행 스크립트는 계속 `127.0.0.1`에만 바인딩한다.
- `/mcp`는 `127.0.0.1`, `localhost` Host만 허용한다.
- Origin이 없으면 Codex의 서버 간 요청으로 허용하고, 있으면 요청 Host와 같은 로컬
  Origin만 허용한다.
- CORS 허용 헤더를 추가하지 않는다.
- 세션·알림·구독을 제공하지 않고 POST 도구 요청만 처리한다.
- 본문은 스트림을 읽는 동안 상한을 확인하고 초과 즉시 중단한다.
- 승인된 4 MiB보다 서비스의 합법적 최대 연구 묶음이 클 수 있어 자체 검토에서
  상한을 **8 MiB**로 조정한다. 이는 무제한 입력을 허용하는 변경이 아니다.
- 잘못된 Host·Origin·메서드·본문 크기는 MCP 파싱이나 서비스 호출 전에 거부한다.
- `/mcp` 오류 응답에도 스택, 절대 데이터 경로와 비밀값을 넣지 않는다.

`0.0.0.0` 바인딩은 문서화하거나 허용하지 않는다. 추후 외부 접속 수요가 확인되면
이 endpoint를 그대로 공개하지 않고 단일 소유자용 접근 보호, HTTPS와 MCP 인증을
별도 위협 모델에서 함께 설계한다.

## 데이터 흐름과 원자성

MCP Route Handler, 기존 HTTP API와 이후 대시보드는 같은 Next 런타임의
`getRuntime()`을 사용한다. MCP 도구는 다음 순서를 지킨다.

1. Zod가 JSON 형태와 기본 크기를 검사한다.
2. 기존 서비스가 도메인 규칙과 revision을 다시 검사한다.
3. 서비스가 SQLite와 Markdown을 하나의 조정된 변경으로 커밋한다.
4. MCP는 커밋 후 조회된 상태만 성공으로 반환한다.

MCP 응답을 별도 저장하거나 MCP 세션을 기준 데이터로 사용하지 않는다. 진행 상태를
복구할 때는 항상 SQLite와 체크섬이 검증된 Markdown을 다시 읽는다.

## 검증 전략

### 결정적 자동 테스트

1. 모든 MCP 입력·출력 스키마의 정상, 잘못된 타입, 경계, 과대 입력을 검사한다.
2. 각 도구가 정확한 기존 서비스 함수와 오류 코드에 연결되는지 검사한다.
3. 잘못된 Host, Origin, 메서드와 8 MiB 초과 스트림이 어떤 변경도 만들지 않는지
   검사한다.
4. 공식 MCP client 2.0.0이 실제 `/mcp` handler와 협상하고 도구를 조회·호출하는지
   in-process로 검사한다.
5. 임시 데이터 루트에서 MCP만 사용해 과정 생성, 전체 연구, 강의 체크포인트,
   부분 응답, 4/5, 보충 학습, 새 5문제, 5/5와 회고를 통과한다.
   (2026-08-02 정정: 원문의 "애매한 답변"은 사지선다 전환으로 사라졌다. 대신
   다섯 문항 중 일부만 답한 중간 상태를 검사한다.)
6. 런타임을 닫고 다시 연 뒤 동일 Day·stage·문제·응답·Markdown에서 재개한다.
7. MCP를 통해 30개 Day를 완료하고 Day 31, 현재 Day 파일과 손상 상태가 없음을
   확인한다.
8. 스킬 frontmatter, 명시 호출 정책, MCP 의존성, 필수 안전 문구를 검사한다.

### 실제 Codex 수용 테스트

자동 테스트와 별도로 설치된 Codex CLI를 실제로 실행해 대화 transcript를 검토한다.

1. 웹 도구를 사용할 수 없는 실행에서 `$just-study`가 가짜 출처를 만들지 않고
   기존 자료 재사용 또는 중단을 묻는다.
2. 웹 도구를 사용할 수 있는 실행에서 실제 자료를 조사하고, 저장된 모든 URL이
   transcript에서 호출자가 제공한 URL인지 비교한다.
3. 새 Codex 대화에서 `$just-study 계속`이 저장된 Day와 stage를 정확히 복원한다.

실제 Codex 실행은 비밀을 파일에 저장하거나 전역 MCP 설정을 수정하지 않는다.
프로젝트 범위 설정과 임시 데이터 루트만 사용한다. 외부 모델 또는 웹 실행이 현재
환경에서 승인되어 있지 않으면 구현을 통과했다고 간주하지 않고 사용자에게 정확한
수용 테스트 blocker를 보고한다.

## 품질 게이트

- MCP·스킬 집중 테스트와 전체 회귀 테스트 통과
- lint, TypeScript, production build와 diff 검사 통과
- 실제 MCP 프로토콜 및 Codex 수용 증거 존재
- Critical 0, Important 0
- 독립 QA 95/100 이상
- 서버의 웹/LLM 호출, 가짜 출처, 단계 우회, revision 우회, 체크섬 우회 없음
- 설명되지 않은 파일이나 프로세스가 남지 않음

## 구현 단위

1. 공식 MCP 패키지와 서버 factory, 스키마, 오류 계약
2. 보안이 적용된 `/mcp` Route Handler와 프로젝트 Codex 설정
3. 모든 서비스 도구와 compact 출력
4. 저장소 범위 `$just-study` 스킬
5. 프로토콜·재시작·30-Day MCP 수용 테스트
6. 실제 Codex 웹 가능/불가 수용 테스트와 운영 문서

각 단위는 TDD 구현, 자체 검토, 독립 검토, 수정과 총괄 검증을 통과한 뒤 다음 단위로
진행한다.

## 공식 참고 자료

- Codex MCP: <https://developers.openai.com/codex/mcp>
- Codex skills: <https://developers.openai.com/codex/skills>
- MCP TypeScript SDK v2: <https://ts.sdk.modelcontextprotocol.io/v2/>
- Web Standard MCP handler: <https://ts.sdk.modelcontextprotocol.io/v2/api/%40modelcontextprotocol/server/server/createMcpHandler.html>
