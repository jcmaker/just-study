export const NAV_ITEMS = [
  { href: "/", label: "오늘" },
  { href: "/courses", label: "과정" },
  { href: "/settings", label: "설정" },
] as const;

export function isActiveNav(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
