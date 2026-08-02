import Link from "next/link.js";

import { getHealth } from "../../server/health.ts";
import { getRuntime } from "../../server/runtime.ts";
import { ThemePicker } from "../theme-picker.tsx";
import { Card, CardHeader } from "../ui/primitives.tsx";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const { db, dataRoot } = getRuntime();
  const health = getHealth(db, dataRoot);

  return (
    <>
      <h1 className="mt-0 mb-2 text-3xl font-extrabold">설정</h1>
      <p className="mt-0 mb-6 text-muted-foreground">이 컴퓨터에서만 사용하는 화면 설정과 시스템 상태입니다.</p>

      <Card className="mb-4">
        <CardHeader title="테마" description="모든 테마는 같은 화면 구조를 사용하며 색과 모서리, 글꼴만 달라집니다." />
        <ThemePicker />
      </Card>

      <Card>
        <CardHeader title="시스템" description="데이터베이스와 저장소 점검 결과입니다." />
        <p className="mt-0 mb-3">{health.message}</p>
        <Link href="/status" className="tap-target inline-flex items-center underline">상태 화면에서 자세히 보기</Link>
      </Card>
    </>
  );
}
