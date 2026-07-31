import Link from "next/link.js";

export default function NotFound() {
  return (
    <>
      <h1>과정을 찾을 수 없습니다.</h1>
      <section>
        <p>과정이 삭제되었거나 주소가 잘못되었을 수 있습니다.</p>
        <Link href="/">과정 목록으로 돌아가기</Link>
      </section>
    </>
  );
}
