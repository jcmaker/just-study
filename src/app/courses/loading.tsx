import { Skeleton } from "../ui/primitives.tsx";

export default function CoursesLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <p className="sr-only">과정 목록을 불러오는 중입니다.</p>
      <Skeleton className="mb-4 h-9 w-40" />
      <Skeleton className="mb-5 h-11 w-72" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((index) => <Skeleton key={index} className="h-44 w-full" />)}
      </div>
    </div>
  );
}
