export const THEMES = ["focus", "calm", "focus-dark"] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "focus";
export const THEME_STORAGE_KEY = "just-study:theme";
export const DARK_THEME: Theme = "focus-dark";

export const THEME_LABELS: Record<Theme, { name: string; description: string }> = {
  focus: { name: "Focus", description: "높은 대비의 흑백과 빨강·노랑 강조. 기본값입니다." },
  calm: { name: "Calm", description: "따뜻한 중성색과 부드러운 경계. 오래 읽을 때 좋습니다." },
  "focus-dark": { name: "Focus Dark", description: "Focus와 같은 구조의 어두운 배경입니다." },
};

export function normalizeTheme(value: unknown): Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value)
    ? (value as Theme)
    : DEFAULT_THEME;
}

export function themeAttributes(theme: Theme): { theme: Theme; dark: boolean; colorScheme: "light" | "dark" } {
  const dark = theme === DARK_THEME;
  return { theme, dark, colorScheme: dark ? "dark" : "light" };
}

export function applyTheme(value: unknown, root: HTMLElement): void {
  const { theme, dark, colorScheme } = themeAttributes(normalizeTheme(value));
  root.setAttribute("data-theme", theme);
  root.classList[dark ? "add" : "remove"]("dark");
  root.style.colorScheme = colorScheme;
}

export const THEME_BOOTSTRAP_SCRIPT = `(function(){var r=document.documentElement;try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var a=${JSON.stringify(THEMES)};if(a.indexOf(t)<0)t=${JSON.stringify(DEFAULT_THEME)};r.setAttribute("data-theme",t);r.classList[t===${JSON.stringify(DARK_THEME)}?"add":"remove"]("dark");r.style.colorScheme=t===${JSON.stringify(DARK_THEME)}?"dark":"light";}catch(e){r.setAttribute("data-theme",${JSON.stringify(DEFAULT_THEME)});r.classList.remove("dark");r.style.colorScheme="light";}})();`;
