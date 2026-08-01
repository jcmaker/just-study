import { getHealth } from "../../server/health.ts";
import { getReadOnlyRuntime } from "../../server/runtime.ts";
import { Badge, Card } from "../ui/primitives.tsx";

export const dynamic = "force-dynamic";

function stateLabel(ok: boolean): string {
  return ok ? "정상" : "확인 필요";
}

export default function StatusPage() {
  const runtime = getReadOnlyRuntime();
  try {
    const health = getHealth(runtime.db, runtime.dataRoot);
    const schemaOk = health.schemaVersion === health.expectedSchemaVersion;
    const schemaStatus = health.state === "uninitialized"
      ? "초기화 전"
      : `${stateLabel(schemaOk)} (${health.schemaVersion ?? "읽기 실패"} / ${health.expectedSchemaVersion})`;

    return (
      <>
        <h1 className="mt-0 mb-2 text-3xl font-extrabold">플랫폼 상태</h1>
        <p className="mt-0 mb-6 text-muted-foreground">
          과정이 안전하게 저장되고 읽히는지 한눈에 확인합니다.
        </p>
        <Card className="mb-4">
          <h2>
            <Badge tone={health.ok ? "muted" : "accent"}>
              {stateLabel(health.ok)}
            </Badge>
          </h2>
          <p>{health.message}</p>
          <h3>조치 방법</h3>
          <p>
            {health.ok
              ? "추가 조치는 없습니다. 과정을 계속 이용해 주세요."
              : "아래 항목을 확인한 뒤 문제를 해결하고 이 페이지를 다시 열어 주세요."}
          </p>
        </Card>
        <Card>
          <h2 id="status-details">점검 항목</h2>
          <dl className="grid gap-x-5 gap-y-2 sm:grid-cols-[minmax(10rem,1fr)_1fr]">
            <dt className="text-muted-foreground">데이터베이스</dt>
            <dd>{stateLabel(health.database !== "error")}</dd>
            <dt className="text-muted-foreground">스키마</dt>
            <dd>{schemaStatus}</dd>
            <dt className="text-muted-foreground">저장소</dt>
            <dd>{stateLabel(health.storage === "ok")}</dd>
            <dt className="text-muted-foreground">고아 과정</dt>
            <dd>{health.orphanCourseIds.length}개</dd>
            <dt className="text-muted-foreground">누락 과정</dt>
            <dd>{health.missingCourseIds.length}개</dd>
            <dt className="text-muted-foreground">손상 과정</dt>
            <dd>{health.corruptCourseIds.length}개</dd>
            <dt className="text-muted-foreground">임시 항목</dt>
            <dd>{health.temporaryEntries.length}개</dd>
          </dl>
        </Card>
      </>
    );
  } finally {
    runtime.close();
  }
}
