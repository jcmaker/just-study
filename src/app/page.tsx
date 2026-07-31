import { randomUUID } from "node:crypto";

import Link from "next/link.js";

import { listCourses } from "../server/courses.ts";
import { getRuntime, requireDatabase } from "../server/runtime.ts";
import { CourseForm } from "./course-form.tsx";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const courses = listCourses(requireDatabase(getRuntime()));

  return (
    <>
      <h1>배우고 싶은 것을 적어 보세요.</h1>
      <p className="lead">
        과정 이름과 30일 뒤 목표를 남기면, 이 컴퓨터에 안전하게 저장해 이어갈 수
        있습니다.
      </p>
      <section aria-labelledby="new-course">
        <h2 id="new-course">새 과정</h2>
        <CourseForm requestId={randomUUID()} />
      </section>
      <section aria-labelledby="saved-courses">
        <h2 id="saved-courses">저장된 과정</h2>
        {courses.length === 0 ? (
          <p>아직 저장된 과정이 없습니다. 위에서 첫 과정을 만들어 보세요.</p>
        ) : (
          <ul className="course-list">
            {courses.map((course) => (
              <li key={course.id}>
                <Link href={`/courses/${course.id}`}>{course.title}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
