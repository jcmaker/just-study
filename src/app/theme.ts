export const THEMES = ["focus", "calm", "focus-dark", "bubblegum", "terminal"] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "focus";
export const THEME_STORAGE_KEY = "just-study:theme";
// Themes that render light text on a dark page. They take the `dark` class so
// shadcn's dark variant matches, and report a dark color-scheme to the browser.
export const DARK_THEMES: readonly Theme[] = ["focus-dark", "terminal"];

export const THEME_LABELS: Record<Theme, { name: string; description: string }> = {
  focus: { name: "Focus", description: "높은 대비의 흑백과 빨강·노랑 강조. 기본값입니다." },
  calm: { name: "Calm", description: "따뜻한 중성색과 부드러운 경계. 오래 읽을 때 좋습니다." },
  "focus-dark": { name: "Focus Dark", description: "Focus와 같은 구조의 어두운 배경입니다." },
  bubblegum: { name: "Bubblegum", description: "크림 종이에 분홍·하늘·노랑 스티커. Focus와 같은 구조입니다." },
  terminal: { name: "Terminal", description: "검은 화면에 인광 초록. 전체가 고정폭 글꼴입니다." },
};

export function normalizeTheme(value: unknown): Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value)
    ? (value as Theme)
    : DEFAULT_THEME;
}

export function themeAttributes(theme: Theme): { theme: Theme; dark: boolean; colorScheme: "light" | "dark" } {
  const dark = DARK_THEMES.includes(theme);
  return { theme, dark, colorScheme: dark ? "dark" : "light" };
}

export function applyTheme(value: unknown, root: HTMLElement): void {
  const { theme, dark, colorScheme } = themeAttributes(normalizeTheme(value));
  root.setAttribute("data-theme", theme);
  root.classList[dark ? "add" : "remove"]("dark");
  root.style.colorScheme = colorScheme;
}

export const THEME_BOOTSTRAP_SCRIPT = `(function(){var r=document.documentElement;try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var a=${JSON.stringify(THEMES)};if(a.indexOf(t)<0)t=${JSON.stringify(DEFAULT_THEME)};var d=${JSON.stringify(DARK_THEMES)}.indexOf(t)>=0;r.setAttribute("data-theme",t);r.classList[d?"add":"remove"]("dark");r.style.colorScheme=d?"dark":"light";}catch(e){r.setAttribute("data-theme",${JSON.stringify(DEFAULT_THEME)});r.classList.remove("dark");r.style.colorScheme="light";}})();`;
