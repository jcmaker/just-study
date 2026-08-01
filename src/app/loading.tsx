import { Card, Skeleton } from "./ui/primitives.tsx";

export default function TodayLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <p className="sr-only">오늘 화면을 불러오는 중입니다.</p>
      <Skeleton className="mb-6 h-9 w-64" />
      <Card className="mb-6">
        <Skeleton className="mb-3 h-6 w-48" />
        <Skeleton className="mb-3 h-4 w-full" />
        <Skeleton className="h-11 w-40" />
      </Card>
      <Skeleton className="mb-3 h-6 w-40" />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-24 w-full" />)}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {[0, 1].map((index) => <Skeleton key={index} className="h-40 w-full" />)}
      </div>
    </div>
  );
}
