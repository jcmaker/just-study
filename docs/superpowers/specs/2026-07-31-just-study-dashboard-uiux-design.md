# just-study 학습 대시보드 UI/UX 설계

## 상태

2026-07-31 브레인스토밍, 시각 시안 검토와 사용자 최종 승인에서 확정됨.

## 목적

기존 SQLite·Markdown 학습 엔진을 단일 사용자용 웹·모바일 대시보드로 보여준다.
사용자는 가장 먼저 지금 이어갈 학습을 확인하고, 과정·30일 진도·검증된 출처·퀴즈·
회고를 탐색하며, 데이터 무결성을 해치지 않는 범위에서 직접 입력을 수정할 수 있어야
한다.

이 단계는 브라우저 안에 두 번째 학습 엔진을 만들지 않는다. 리서치·강의·채점은
Codex의 `$just-study`가 담당하고, 대시보드는 같은 Next.js 런타임의 서비스 계층을
통해 저장된 사실을 읽고 제한된 쓰기만 수행한다.

## 확정된 제품 경계

- 단일 사용자·자기 기기 사용이므로 로그인, 가입, 계정, 프로필과 조직 메뉴를 만들지
  않는다.
- 기본 서버 바인딩은 계속 `127.0.0.1`이다.
- SQLite가 과정·Day·stage·퀴즈·출처 점수의 기준이고 Markdown이 긴 본문의 기준이다.
- 화면은 Markdown을 역으로 파싱해 진도나 상태를 추론하지 않는다.
- 서버가 LLM 또는 웹 검색 API를 호출하지 않는다.
- 학습 단계와 완료 기록은 UI에서 임의 변경하지 않는다.
- 일정·과제·할 일·PDF·첨부파일은 Phase 5로 남긴다.
- 뽀모도로와 주간 현황은 실제 일정 또는 집중 세션 데이터가 생긴 뒤 설계한다.
- 미래 기능을 위한 빈 메뉴, 비활성 탭, DB 테이블과 추상화를 미리 만들지 않는다.
- 별도 프런트엔드 앱, 전역 클라이언트 스토어, UI용 데이터베이스를 추가하지 않는다.

## 참고 프로젝트에서 채택한 원칙

[OpenStudy](https://github.com/OpenStudy-dev/OpenStudy)는 다음 원칙을 검토하기 위한
시각·제품 참고 자료로만 사용했다.

- 데스크톱 사이드바와 모바일 하단 탐색을 포함한 안정적인 app shell
- 첫 화면에서 다음 행동을 하나로 좁히는 계층
- 경고, 지표, 현재 과정과 최근 기록을 단계적으로 보여주는 구성
- 과정마다 일관된 accent를 부여하는 CSS 변수
- Settings에서 즉시 적용되고 지속되는 테마 선택
- 명시적인 empty, loading, error 상태와 모바일 safe area
- 과정 상세의 탭 기반 정보 분리

다음 요소는 채택하지 않는다.

- 로그인·프로필·학기·시험·과제·일정·파일 UI
- 일정 데이터 없이 만드는 falling-behind 또는 streak 지표
- 테마마다 dashboard, sidebar와 route 컴포넌트를 복제하는 구조
- OpenStudy 소스 코드나 CSS의 직접 복사

참고한 공개 소스:

- [App shell](https://github.com/OpenStudy-dev/OpenStudy/blob/main/web/src/components/layout/app-shell.tsx)
- [Dashboard](https://github.com/OpenStudy-dev/OpenStudy/blob/main/web/src/routes/dashboard.tsx)
- [Theme settings](https://github.com/OpenStudy-dev/OpenStudy/blob/main/web/src/routes/settings.tsx)
- [Theme persistence](https://github.com/OpenStudy-dev/OpenStudy/blob/main/web/src/lib/themes.ts)
- [Course accent](https://github.com/OpenStudy-dev/OpenStudy/blob/main/web/src/lib/theme.ts)

## 정보 구조

| 경로 | 역할 | 주요 행동 |
|---|---|---|
| `/` | Today 대시보드 | 현재 과정 확인, Codex 재개 명령 복사 |
| `/courses` | 전체 과정 | 상태별 확인, draft 생성·편집 |
| `/courses/[id]` | 과정 작업 공간 | 개요·계획·오늘·출처·퀴즈·기록 탐색 |
| `/settings` | 로컬 설정 | 테마 선택, 시스템 상태 진입 |
| `/status` | 복구 화면 | DB·저장소 상태와 복구 방법 확인 |

`/status`는 평상시 주 탐색 항목이 아니다. Settings의 시스템 섹션과 데이터 오류
alert에서 연결하고, 장애 시 직접 URL로 접근할 수 있게 유지한다.

### App shell

데스크톱은 고정 사이드바와 최대 1280px 콘텐츠 영역을 사용한다. 사이드바의 주 메뉴는
`Today`, `Courses`, `Settings` 세 개뿐이다. 과정 내부 기능은 사이드바에 늘리지 않고
과정 상세 탭에 둔다.

1024px 미만에서는 상단 context bar와 하단 탐색으로 전환한다. 하단 메뉴도 동일한 세
항목이며 `env(safe-area-inset-bottom)`을 반영한다. 과정 상세에서는 상단에 뒤로 가기와
현재 Day를 표시한다.

모든 breakpoints에서 React·DOM 구조는 동일하다. CSS grid, flex와 media query만으로
배치를 바꾸며 모바일 전용 페이지를 복제하지 않는다.

## Today 대시보드

사용자가 승인한 **다음 행동 우선** 배치를 기본으로 한다. 데이터 흐름은 위에서 아래로
다음 순서를 고정한다.

1. 현재 문맥과 짧은 환영 문구
2. 재개 카드
3. 주의가 필요한 상태
4. 실제 집계 지표
5. 과정 카드
6. 최근 완료 Day

### 재개 카드

재개 대상은 `updatedAt`이 가장 최근인 `active` 과정이다. active 과정이 없으면 가장
최근 draft를 보여주고, 과정이 전혀 없으면 첫 과정 생성 안내로 바꾼다. completed
과정만 있으면 새 과정 생성이 주 행동이다.

active 카드에는 다음 값만 표시한다.

- 과정 제목
- `Day N / 30`
- 현재 Day 목표
- `lecture`, `quiz`, `remediation`, `reflection`의 한국어 stage 이름
- 완료 Day 기준 progress
- 하나의 주 CTA

주 CTA의 레이블은 `Codex에서 계속`이다. 클릭하면 `$just-study 계속`을 clipboard에
복사하고 `복사됨` 상태를 알린다. 브라우저가 Codex를 직접 실행하는 것처럼 표현하거나
동작하지 않는 deep link를 만들지 않는다. clipboard 권한이 없으면 선택 가능한 명령을
보여주고 직접 복사하도록 한다.

### 주의 항목

일정 지연을 추측하지 않고 저장된 학습 상태만 사용한다. 우선순위는 다음과 같다.

| 저장 상태 | 표시 문구 | 이동 대상 |
|---|---|---|
| `remediation` | 보완 학습이 필요합니다 | 오늘 |
| `reflection` | 회고를 완료하면 다음 Day로 이동합니다 | 오늘 |
| `quiz` + 진행 중 응답 | 퀴즈 답변을 이어가세요 | 퀴즈 |
| `quiz` + 응답 없음 | 오늘의 퀴즈가 기다리고 있습니다 | 오늘 |
| `draft` | 30일 계획 승인이 필요합니다 | 과정 개요 |
| `lecture` | 오늘 학습을 이어가세요 | 오늘 |
| `completed` | 주의 항목 없음 | 해당 없음 |

동일 과정에서 가장 긴급한 항목 하나만 표시하고 전체 목록은 최대 세 개로 제한한다.
`remediation`, `reflection`, 진행 중 quiz, draft, lecture 순으로 정렬하며 동일 우선순위는
`updatedAt` 내림차순으로 정렬한다.

### 지표

가짜 streak나 학습 시간을 만들지 않고 네 값만 집계한다.

- 진행 중 과정 수
- 완료 Day 수 / 전체 승인 Day 수
- `selected = true`인 고유 연구 출처 수
- 완료 과정 수

값이 0이어도 카드를 숨기지 않는다. 지표 의미를 보조 텍스트 또는 tooltip로 설명한다.

### 과정 카드와 최근 기록

과정 카드는 제목, 목표 요약, 상태 badge, `Day N / 30`, progress, 현재 stage와 최근
갱신 시각을 표시한다. 과정 ID를 고정 palette에 매핑한 accent는 식별용일 뿐 상태나
점수를 뜻하지 않는다.

draft에는 존재하지 않는 Day·stage·progress를 0으로 꾸며 표시하지 않는다. 대신 `초안`,
`30일 계획 승인 대기`를 표시하고 progress bar를 생략한다. active만 현재 Day와 stage를
표시하며 completed는 `Day 30 / 30`, `완료`, 100% progress를 표시한다.

최근 기록은 `completedAt`이 있는 Day를 최신순으로 최대 다섯 개 보여준다. 과정 제목,
Day 번호, 목표와 완료 시각을 사용하며 journal Markdown을 파싱해 목록을 만들지 않는다.
회고 본문은 해당 과정의 `학습 기록` 탭에서 검증된 journal 문서로 읽는다.

## Courses 화면

페이지 상단에는 제목과 `새 과정` 행동을 두고, 아래에 과정 카드를 표시한다. 과정 생성은
기존 service/action 흐름을 재사용하며 데스크톱에서는 Sheet, 좁은 화면에서는 전체 폭
Sheet로 열린다.

필터는 `전체`, `진행 중`, `초안`, `완료` 네 개다. 검색, 정렬 설정, pagination은 실제
과정 수가 문제를 만들기 전에는 추가하지 않는다. 필터는 URL search parameter로
표현해 새로고침과 뒤로 가기가 동작하게 한다.

빈 상태는 다음처럼 구분한다.

- 과정 0개: 첫 과정 생성과 `$just-study` 시작 방법
- 현재 필터 결과 0개: 필터 해제 행동
- DB unavailable: 정상 empty state로 위장하지 않고 `/status` 복구 alert

고정 FAB는 콘텐츠를 가릴 수 있으므로 사용하지 않는다. 모바일에서도 상단 또는 empty
state의 44px 이상 버튼을 사용한다.

## 과정 상세 작업 공간

사용자가 승인한 **상단 문맥 + 가로 탭 + 현재 학습 중심 본문** 구조를 사용한다.

### 공통 헤더

- breadcrumb 또는 모바일 뒤로 가기
- 과정 제목과 상태
- `Day N / 30`, stage, progress
- `Codex에서 계속` 명령 복사

완료 과정은 재개 CTA 대신 `완료됨`을 보여준다. draft는 `$just-study`로 계획을 완성하는
안내를 보여준다.

### 탭

| 탭 | 기준 데이터 | 내용 |
|---|---|---|
| 개요 | `Course`, `LearningSnapshot` | 목표, 사전 지식, 선호 방식, 진도, 최근 활동 |
| 30일 계획 | `LearningDay[]` | 완료·현재·예정 Day와 각 목표 |
| 오늘 | current Day, current-day Markdown | 목표, stage stepper, 현재 강의·체크포인트·보완 내용 |
| 출처 | `ResearchRun[]` | 과정·일일 연구, 순위, 100점 점수, 선정 이유·한계, 주장 근거 |
| 퀴즈 | `QuizAttempt[]` | Day별 시도, 문제와 보기, 고른 답, 정·오답과 해설 |
| 학습 기록 | completed Days, journal Markdown | 완료 Day 목록과 검증된 긴 회고 기록 |

탭은 `?tab=overview|plan|today|sources|quiz|journal`로 표현한다. 알 수 없는 값은 `overview`
로 정규화한다. 탭 trigger는 link semantics를 유지하고 현재 탭에 `aria-current`를 둔다.

데스크톱 `today` 탭은 본문과 보조 rail로 나눈다. 본문에는 오늘 목표와 stage stepper,
검증된 학습 내용이 있고, rail에는 Codex 명령과 선정 출처 요약이 있다. 모바일에서는
동일 순서로 한 열에 쌓으며 탭을 가로 스크롤한다.

> **ERRATUM (2026-08-02, rail 제거):** 실제 화면을 본 사용자가 rail의 두 카드를
> 빼라고 지시해 현재 구현에는 rail이 없다. `Codex에서 이어가기`는 과정 헤더의 같은
> 버튼과 중복이었고, `현재 Day 선정 출처`는 `출처` 탭과 겹쳤다. 본문이 전체 폭을
> 쓴다.
>
> 위 문단은 지우지 않고 남긴다. rail을 되살릴지는 아직 정하지 않았고, 되살린다면
> 무엇을 담을지 다시 결정해야 한다. 지금 기준은 rail 없음이다.
>
> 같은 시점에 본문 순서도 바뀌었다. 원래 구현은 회고·퀴즈 폼을 학습 내용보다 위에
> 두어 "배우기 전에 시험부터 보는" 화면이 됐다. 이제 목표 → stage stepper → 강의 →
> 퀴즈 → 회고 순서이며, 현재 단계가 아닌 강의는 접어 둔다. 이 문단이 요구한 stage
> stepper는 이때 처음 구현됐다.

### Markdown 표시

Markdown은 체크섬 검증을 통과한 문서만 표시한다. raw HTML은 실행하지 않는다. 제목,
목록, 링크, 인용, 코드와 표를 읽기 좋은 구성으로 표시하되 Markdown에서 course 상태,
진도, 출처 점수와 quiz 결과를 재구성하지 않는다.

외부 링크에는 새 창 동작과 목적을 명확히 표시하고 `rel="noreferrer"`를 사용한다. URL은
학습 엔진이 이미 허용한 `http:` 또는 `https:` 값만 링크로 만든다. 렌더링 오류는 원문을
손실하거나 수정하지 않고 안전한 plain-text fallback을 보여준다.

## 직접 편집 범위

Phase 4의 편집은 사용자 입력이며 아직 학습 기록이 되지 않은 값으로 제한한다.

### 허용

1. 새 과정 shell 생성
2. `draft` 과정의 제목과 목표 수정
3. 현재 stage가 `quiz`일 때 아직 답하지 않은 문항의 보기 선택
4. 현재 stage가 `reflection`일 때 아직 제출하지 않은 세 회고 답변 작성·수정
5. 로컬 테마 선택

> **ERRATUM (2026-08-02, 퀴즈 응답 추가):** 원문은 편집 허용을 네 가지로 두고 퀴즈
> 응답을 읽기 전용으로 분류했다. 사용자가 "웹에서도 에이전트에서도 같은 사지선다를
> 풀 수 있어야 한다"고 요구해 퀴즈 응답이 다섯 번째 쓰기 경로가 됐다.
>
> 이 값이 다른 읽기 전용 값과 다른 이유는 명확하다. **학습자 본인의 입력이고 아직
> 제출되지 않은 값**이라는 이 절의 원칙을 그대로 만족한다. 문제·보기·정답·해설은
> 여전히 읽기 전용이며 UI에서 만들 수 없다. 정답 인덱스는 답하기 전까지 브라우저로
> 전송되지 않는다. 채점은 서버가 하므로 UI가 결과를 지정할 수 없다.

draft 수정은 새 `updateCourseDraft` 서비스 함수로 처리한다. 제목·목표의 기존 길이와
문자 검증을 재사용하고 `expectedRevision`을 요구한다. SQLite와 `course.md`를 기존
rollback-capable Markdown update 경로로 함께 변경한다. 실패 시 둘 중 하나만 바뀐
상태를 남기지 않는다.

회고 제출은 기존 `completeDay`를 호출한다. 빈 값과 크기 검증, quiz 통과 여부, 현재
stage, revision과 Day 30 종료 규칙은 서비스가 그대로 결정한다. 제출 성공 전까지
브라우저의 입력값을 유지하고 성공한 뒤에만 다음 Day UI로 전환한다.

### 읽기 전용

- 승인된 30일 목표
- 과정·일일 연구 질문, 출처 점수, 순위와 주장 검증
- 강의·보완 Markdown
- quiz 문제, 보기, 정답, 해설과 채점 결과 (2026-08-02 정정: 원문의 `기준`은
  사지선다 전환으로 문항별 `해설`이 됐고, 아직 답하지 않은 문항의 보기 선택만
  위 편집 허용 3번으로 예외 처리된다. 저장된 응답과 채점 결과는 계속 읽기 전용이다.)
- 완료된 Day, 제출된 회고와 현재 stage

이 값을 UI에서 직접 SQL 또는 Markdown 수정으로 바꾸지 않는다. 변경 요구가 생기면
학습 이력·검증 의미를 먼저 별도 설계한다.

### Revision 충돌

모든 domain write는 화면이 읽은 `expectedRevision`을 전달한다. 충돌 시 자동 재시도나
last-write-wins를 사용하지 않는다. 입력을 보존한 alert에서 `최신 상태 불러오기`를
제공하고, 새 revision을 확인한 뒤 사용자가 다시 제출하게 한다.

## 테마 시스템

모든 테마는 정확히 같은 React 컴포넌트와 DOM을 사용하고 CSS custom properties만
교체한다.

| 값 | 이름 | 역할 |
|---|---|---|
| `focus` | Focus | 기본, 첨부한 black/white/red/yellow 테마 |
| `calm` | Calm | 긴 읽기를 위한 따뜻한 neutral 테마 |
| `focus-dark` | Focus Dark | 첨부 테마의 dark token |
| `bubblegum` | Bubblegum | 크림 종이에 분홍·하늘·노랑. Focus와 같은 구조 |
| `terminal` | Terminal | 검은 배경에 인광 초록, 화면 전체 고정폭 |

> **ERRATUM (2026-08-02, 테마 추가):** 원문은 세 테마를 전제했다. 사용자 요청으로
> Bubblegum과 Terminal을 추가해 다섯이 됐다. 두 테마 모두 새 컴포넌트를 만들지 않고
> 토큰만 교체하므로 이 절의 원칙은 그대로 지켜진다.
>
> 어두운 테마가 둘이 되면서 `focus-dark` 하나를 가정하던 코드를 목록으로 바꿨다.
> `focus-dark`와 `terminal`이 `.dark` class와 `color-scheme: dark`를 받는다.
>
> 두 테마 모두 원본 팔레트를 그대로 쓰지 않았다. Bubblegum의 분홍은 버튼 글자
> 2.85:1, 포커스 링 2.63:1로 미달이라 같은 색조의 더 진한 값으로 바꿨다. Terminal은
> 테두리가 배경 대비 1.63:1이고 입력 배경이 페이지와 같은 순검정이라 입력칸이 보이지
> 않았고, destructive 위 흰 글자가 4.00:1이었다. 셋 다 조정했다. 이 절 아래의
> "시각 유사성보다 접근성을 우선한다"를 따른 것이다.
>
> 두 테마가 요구한 원격 폰트(Work Sans/Caveat/DM Mono, VT323)는 이 문서의 원격 폰트
> 금지에 따라 도입하지 않았다. Terminal은 기존 monospace 스택을 화면 전체에 적용해
> 질감을 낸다.

### 기본 Focus 토큰

사용자가 제공한 Tailwind v4/shadcn 테마를 기본값으로 사용한다. 핵심 원본 값은 다음과
같다.

| token | Focus | Focus Dark |
|---|---|---|
| background | `oklch(1 0 0)` | `oklch(0 0 0)` |
| foreground | `oklch(0 0 0)` | `oklch(1 0 0)` |
| card | `oklch(1 0 0)` | `oklch(0.1457 0 0)` |
| primary | `hsl(0 100% 43%)` | `oklch(0.628 0.2577 29.2339)` |
| accent | `oklch(0.8408 0.1725 84.2008)` | `oklch(0.8533 0.1706 86.7515)` |
| border | `oklch(0 0 0)` | `oklch(1 0 0)` |
| muted | `oklch(0.9696 0 0)` | `oklch(0.2376 0 0)` |
| radius | `0px` | `0px` |
| shadow | `3px 3px 0` black | `3px 3px 0` white |
| tracking | `-0.02em` | `-0.02em` |

sidebar, chart, destructive, input와 ring 토큰도 첨부 값 그대로 사용한다. 구현 시 다음 세
오류만 정규화한다.

- `--font-sans: var(--font-sans)` 같은 순환 mapping 대신 literal font stack을 별도
  source token에 둔다.
- base radius가 0일 때 `calc(0px - 4px)`가 되지 않게 모든 derived radius를 0으로
  고정한다.
- `shadow-2xl`의 alpha `2.50`은 유효 최대 `1`로 clamp한다.

Inter는 외부 네트워크에서 내려받지 않는다. `'Inter', 'Helvetica Neue', Helvetica,
Arial, sans-serif` fallback stack을 사용한다. Georgia와 SF Mono fallback도 원본을
유지한다.

### Calm 토큰 방향

Calm은 구조를 바꾸지 않고 warm off-white 배경, 진한 brown-gray 본문, muted green
primary, soft amber accent, 1px 경계, 8~12px radius와 낮은 blur shadow를 사용한다.
Focus의 굵은 테두리나 hard shadow를 컴포넌트 class에 직접 쓰지 않고 token으로
표현해야 Calm에서도 같은 컴포넌트가 자연스럽게 보인다.

구현 계획에서 contrast를 측정해 최종 OKLCH 값을 고정한다. primary button, 본문,
muted text, focus ring은 WCAG AA를 통과해야 하며 시각 유사성보다 접근성을 우선한다.

### 적용과 지속

- 저장 key: `just-study:theme`
- 유효 값: `focus`, `calm`, `focus-dark`
- 기본과 잘못된 값 fallback: `focus`
- 적용 위치: `<html data-theme="...">`
- `focus-dark`일 때 shadcn dark variant 호환을 위해 `.dark` class도 함께 설정
- theme picker: Settings의 native radio group과 label 전체를 사용하는 세 preview cards

`layout.tsx`의 작은 inline bootstrap script가 hydration 전에 저장값을 검증하고
`data-theme`, `.dark`, `color-scheme`을 적용한다. localStorage 접근이 실패하면 Focus로
계속 렌더링한다. 같은 helper를 ThemePicker가 재사용해 초기 적용과 상호작용의 규칙이
갈라지지 않게 한다. 저장된 테마 때문에 서버의 기본 Focus attribute와 첫 hydration이
달라질 수 있는 `<html>` 경계에만 `suppressHydrationWarning`을 사용한다.

View Transitions나 테마별 animation은 추가하지 않는다. 기본 CSS transition도
`prefers-reduced-motion`에서 제거한다.

## 컴포넌트와 기술 방향

- Next.js App Router와 server rendering을 기본으로 한다.
- DB 읽기와 view model 계산은 서버에서 수행한다.
- client component는 active navigation, theme picker, clipboard feedback와 편집 form
  같이 브라우저 상태가 필요한 작은 경계에만 둔다.
- 전역 client store, hydration 후 재조회, optimistic domain mutation을 추가하지 않는다.
- 기존 `getRuntime()`, `listCourses`, `getLearningSnapshot`, server action 패턴을
  재사용한다.
- 현재 `getLearningSnapshot`은 MCP 재개 계약에 맞게 과정 연구와 현재 Day의 연구·quiz만
  반환하므로 의미를 바꾸거나 전체 이력을 실어 보내지 않는다.
- 대시보드용 구조화 집계 `getDashboardOverview(db)`와 과정 전체 이력 조회
  `getCourseHistory(db, courseId)`만 서비스 계층에 추가한다.
- 집계와 상태 문구는 순수 view-model 함수 하나에서 계산해 페이지별 중복을 막는다.
- shadcn/ui는 Tailwind CSS v4, `new-york` 스타일과 Radix primitives를 사용한다.
- Button, Card, Badge, Progress, Tabs, Sheet, Select, Tooltip, Skeleton, Alert,
  DropdownMenu를 허용 목록으로 두되 실제 화면에서 필요한 항목만 복사한다.
- 테마 색, radius와 shadow는 전부 semantic token을 사용한다. `bg-red-*` 같은 임의
  색상은 course accent처럼 명시된 예외 외에는 사용하지 않는다.
- raw HTML Markdown renderer, 차트 라이브러리, 애니메이션 라이브러리와 날짜
  라이브러리는 추가하지 않는다.

## View model 규칙

화면 전용 계산은 SQLite나 Markdown을 쓰지 않는 순수 함수로 둔다.

### 읽기 계약

`getDashboardOverview(db)`는 Markdown을 읽지 않는 한 번의 대시보드 read model이다.
과정 요약, 현재 Day 목표, 전체 승인·완료 Day 수, 정규화된 URL 기준 선정 출처 수와
최근 완료 Day를 반환한다. SQL 결과는 기존 `Course` 상태와 같은 enum·ISO 시간 계약을
사용하며 UI 전용 기준 데이터를 저장하지 않는다.

`getCourseHistory(db, courseId)`는 과정이 없으면 `null`, 있으면 모든 course/day
`ResearchRun`과 모든 Day의 `QuizAttempt`를 반환한다. Day 단위 항목에는 `dayId`,
`dayNumber`, `objective`를 붙여 탭에서 문맥을 잃지 않게 한다. 출처·주장·문제·응답
mapping과 JSON 검증은 기존 `getLearningSnapshot`의 loader를 추출해 함께 사용하고,
서로 다른 두 변환 경로를 만들지 않는다.

두 함수는 읽기 전용이며 raw SQL row, Markdown 경로 또는 체크섬을 UI에 노출하지
않는다. `getLearningSnapshot`의 현재 Day 중심 반환 범위와 MCP compact 응답은 그대로
유지한다.

- progress: `completedAt !== null` Day 수 / 승인된 Day 수
- current Day: `snapshot.currentDay`; 없으면 completed 또는 draft 상태로 분기
- stage label: 고정 enum mapping
- selected source count: 전체 과정에서 정규화된 URL 기준 중복 제거 후
  `selected = true` 집계
- resume course: active 과정 중 `updatedAt` 최신
- recent Days: `completedAt` 최신순, 최대 5개
- attention: 앞에서 정의한 고정 priority, 최대 3개
- course accent: course ID를 고정 palette index로 mapping

시간 표시는 서버가 생성한 ISO 값을 기준으로 한다. hydration 차이를 피하기 위해 첫
render에서는 고정된 절대 날짜 또는 server에서 완성한 표시값을 사용하고, 불필요한
실시간 ticker를 만들지 않는다.

## 오류·빈 상태·로딩

| 상태 | 표현 | 복구 |
|---|---|---|
| DB unavailable | 페이지 수준 Alert | `/status` |
| storage/checksum error | 손상 자료를 숨긴 Alert | `/status`, 원문 덮어쓰기 금지 |
| course not found | 명확한 404 | Courses로 이동 |
| revision conflict | 입력을 유지한 inline Alert | 최신 상태 불러오기 |
| clipboard 실패 | 선택 가능한 명령 text | 수동 복사 |
| 과정 0개 | onboarding empty state | 새 과정 생성 |
| 탭 데이터 없음 | 탭별 empty state | 가능한 다음 행동 안내 |
| route loading | 실제 layout과 같은 skeleton | 자동 완료 |

오류를 빈 데이터로 바꾸거나 `catch { return [] }` 형태로 숨기지 않는다. 저장 실패 시
form 값을 지우지 않고, 성공 상태는 `aria-live="polite"`, 오류는 적절한 alert로
알린다.

## 반응형과 접근성

검증 기준 viewport는 375px, 768px, 1280px 이상이다.

- 모든 button, link, input의 최소 pointer target은 44px이다.
- 문서 구조는 landmark와 heading 순서를 지킨다.
- active navigation과 tab은 색만이 아니라 형태와 ARIA로 구분한다.
- 모든 form control은 연결된 label, 도움말과 오류 설명을 가진다.
- focus ring은 theme보다 우선하며 배경에서 명확히 보인다.
- `:focus-visible`, 키보드 tab 순서와 skip link를 제공한다.
- 모바일 bottom navigation에 safe-area padding을 둔다.
- 긴 제목, URL, 한국어와 영문 혼합 text가 레이아웃을 넘지 않게 한다.
- horizontal scroll은 과정 상세 tab과 code block처럼 의도된 곳에만 허용한다.
- 상태 badge, 차트 색과 course accent만으로 의미를 전달하지 않는다.
- `prefers-reduced-motion`을 존중한다.
- 모든 테마의 본문·버튼·muted text·focus ring contrast를 확인한다.

## 성능과 단순성

- Today는 `getDashboardOverview` 한 번으로 카드와 집계를 렌더링한다.
- course detail은 현재 상태·검증된 Markdown을 위한 `getLearningSnapshot`과 구조화된
  전체 출처·quiz 이력을 위한 `getCourseHistory`를 각각 한 번 읽는다.
- client-side polling과 background refresh를 만들지 않는다.
- 이미지 hero, 원격 font, chart library와 대형 icon set을 추가하지 않는다.
- 과정 수가 실제 병목이 되기 전에는 pagination과 virtual list를 만들지 않는다.
- route-level loading boundary는 실제 콘텐츠 구조와 같은 최소 skeleton만 제공한다.
- theme bootstrap은 blocking network request 없이 짧은 inline script 하나로 끝낸다.

## 검증 전략

### 결정적 검사

1. view model이 course 상태와 snapshot으로 정확한 resume, attention, 지표, progress와
   최근 Day를 계산하는지 Node test로 검증한다.
2. dashboard overview가 전체 완료 Day와 URL 중복을 제거한 선정 출처를 정확히
   집계하고 draft의 null Day·stage를 거짓 progress로 바꾸지 않는지 검증한다.
3. course history가 완료된 Day와 completed 과정의 출처·quiz·응답까지 반환하고 현재
   snapshot과 동일한 row mapping을 사용하는지 검증한다.
4. draft 수정이 잘못된 입력과 stale revision을 거부하고 SQLite·Markdown 부분 성공을
   남기지 않는지 검증한다.
5. reflection 제출이 기존 `completeDay` 규칙과 Day 30 종료를 우회하지 않는지 검증한다.
6. tab parameter와 course filter의 정상·잘못된 값을 결정적으로 정규화한다.
7. theme 값 검증, 기본 Focus, localStorage 실패 fallback과 Focus Dark `.dark` mapping을
   검증한다.
8. 손상된 Markdown을 정상 콘텐츠로 렌더링하지 않고 복구 경로를 보여주는지 검증한다.
9. 기존 플랫폼·학습 엔진·MCP 테스트를 모두 회귀 실행한다.

### 실제 브라우저 검사

1. 0개, draft, active, remediation, reflection, completed 과정 상태를 확인한다.
2. 375px, 768px, 1280px에서 Today, Courses, 여섯 course tab과 Settings를 확인한다.
3. 키보드만으로 skip link, sidebar 또는 bottom nav, tab, form과 theme picker를
   이동·조작한다.
4. Focus가 첫 방문 기본이고 모든 테마가 reload 뒤 유지되며 첫 paint에서 깜빡이지 않는지
   확인한다.
5. clipboard 성공·실패, draft 저장 성공·검증 실패·revision 충돌을 확인한다.
6. reflection 제출 성공·실패 시 입력 보존, stage 전환과 다음 Day 표시를 확인한다.
7. DB unavailable, checksum 손상, 404와 empty state의 복구 링크를 확인한다.
8. axe 또는 동등한 브라우저 accessibility 검사와 수동 focus/contrast 검토를 수행한다.

마지막 코드 상태에서 `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`와
실제 브라우저 검증을 새로 실행한다.

## UI 품질 루브릭

| 영역 | 점수 | 통과 기준 |
|---|---:|---|
| 사용자 가치와 기획 의도 | 25 | 재개·탐색·제한된 편집 흐름이 실제 데이터로 연결됨 |
| 정보 구조와 사용성 | 20 | 다음 행동이 명확하고 과정 정보가 예측 가능한 위치에 있음 |
| 반응형과 접근성 | 20 | 세 viewport, 키보드, touch, contrast와 reduced motion 통과 |
| 시각 품질과 테마 일관성 | 15 | 모든 테마가 같은 구조에서 완성되고 Focus가 정확한 기본값임 |
| 데이터 무결성과 오류 복구 | 15 | revision·체크섬·원자성 우회가 없고 입력·복구 경로가 보존됨 |
| 성능과 단순성 | 5 | 불필요한 client state·의존성·복제 없이 필요한 UI만 구현됨 |

총점은 **95/100 이상**, Critical 0개, Important 0개여야 한다. 관련 테스트, 전체
회귀, lint, TypeScript, production build와 실제 브라우저 검증 중 하나라도 실패하면
점수와 관계없이 통과하지 못한다.

## 완료 조건

- Today가 실제 현재 과정과 다음 행동을 정확히 보여준다.
- 과정 목록과 상세 여섯 탭이 SQLite·검증된 Markdown의 실제 데이터를 표시한다.
- draft 편집과 reflection 제출이 서비스 계층, revision과 원자성 규칙을 지킨다.
- Focus가 기본이며 Calm과 Focus Dark 선택이 reload와 첫 paint에서 안정적으로 유지된다.
- 데스크톱 sidebar와 모바일 context bar·bottom navigation이 승인된 구조로 동작한다.
- 모든 empty, loading, error와 recovery 상태가 구현된다.
- 375px, 768px, 1280px, 키보드와 모든 테마에서 품질 게이트를 통과한다.
- 일정·뽀모도로·파일 등 후속 범위의 placeholder나 speculative code가 없다.

## 후속 확장점

Phase 5에서 일정·과제·할 일·PDF·첨부파일의 실제 데이터와 화면이 생기면 app shell의
menu definition과 course detail에 필요한 항목만 추가한다. 일정 또는 focus session
데이터가 생긴 뒤 Today 하단에 승인된 C안의 주간 현황을 검토한다. 뽀모도로는 이때
일정·과제와 연결되는 별도 집중 학습 세션으로 설계하며 현재 단계에서는 어떤 저장
모델도 예약하지 않는다.
