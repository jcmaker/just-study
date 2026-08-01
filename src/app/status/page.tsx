import { getHealth } from "../../server/health.ts";
import { getReadOnlyRuntime } from "../../server/runtime.ts";

export const dynamic = "force-dynamic";

function stateLabel(ok: boolean): string {
  return ok ? "정상" : "확인 필요";
}

export default function StatusPage() {
  const runtime = getReadOnlyRuntime();
  try {
    const health = getHealth(runtime.db, runtime.dataRoot);
    const schemaOk = health.schemaVersion === health.expectedSchemaVersion;

    return (
      <>
        <h1>플랫폼 상태</h1>
        <p className="lead">
          과정이 안전하게 저장되고 읽히는지 한눈에 확인합니다.
        </p>
        <section>
          <h2>
            <span
              className={`status ${health.ok ? "status-ok" : "status-error"}`}
            >
              {stateLabel(health.ok)}
            </span>
          </h2>
          <p>{health.message}</p>
          <h3>조치 방법</h3>
          <p>
            {health.ok
              ? "추가 조치는 없습니다. 과정을 계속 이용해 주세요."
              : "아래 항목을 확인한 뒤 문제를 해결하고 이 페이지를 다시 열어 주세요."}
          </p>
        </section>
        <section aria-labelledby="status-details">
          <h2 id="status-details">점검 항목</h2>
          <dl>
            <dt>데이터베이스</dt>
            <dd>{stateLabel(health.database !== "error")}</dd>
            <dt>스키마</dt>
            <dd>
              {stateLabel(schemaOk)} ({health.schemaVersion ?? "읽기 실패"} /{" "}
              {health.expectedSchemaVersion})
            </dd>
            <dt>저장소</dt>
            <dd>{stateLabel(health.storage === "ok")}</dd>
            <dt>고아 과정</dt>
            <dd>{health.orphanCourseIds.length}개</dd>
            <dt>누락 과정</dt>
            <dd>{health.missingCourseIds.length}개</dd>
            <dt>손상 과정</dt>
            <dd>{health.corruptCourseIds.length}개</dd>
            <dt>임시 항목</dt>
            <dd>{health.temporaryEntries.length}개</dd>
          </dl>
        </section>
      </>
    );
  } finally {
    runtime.close();
  }
}
