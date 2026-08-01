import { Skeleton } from "../../ui/primitives.tsx";

export default function CourseLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <p className="sr-only">과정을 불러오는 중입니다.</p>
      <Skeleton className="mb-2 h-4 w-32" />
      <Skeleton className="mb-5 h-9 w-72" />
      <Skeleton className="mb-5 h-11 w-full max-w-xl" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
