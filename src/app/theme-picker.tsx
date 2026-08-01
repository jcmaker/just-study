"use client";

import { startTransition, useEffect, useState } from "react";

import {
  applyTheme,
  DEFAULT_THEME,
  normalizeTheme,
  THEMES,
  THEME_LABELS,
  THEME_STORAGE_KEY,
  type Theme,
} from "./theme.ts";

export function ThemePicker() {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    let storedTheme = DEFAULT_THEME;
    try {
      storedTheme = normalizeTheme(localStorage.getItem(THEME_STORAGE_KEY));
    } catch {}
    startTransition(() => { setTheme(storedTheme); });
  }, []);

  function choose(next: Theme): void {
    setTheme(next);
    applyTheme(next, document.documentElement);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
      setStatus(`${THEME_LABELS[next].name} 테마를 적용하고 이 브라우저에 저장했습니다.`);
    } catch {
      setStatus(`${THEME_LABELS[next].name} 테마를 적용했지만 저장하지 못했습니다. 새로고침하면 Focus로 돌아갑니다.`);
    }
  }

  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="mb-3 text-sm text-muted-foreground">
        선택한 테마는 이 브라우저에만 저장되며 학습 데이터에는 영향을 주지 않습니다.
      </legend>
      <div className="grid gap-3 sm:grid-cols-3">
        {THEMES.map((value) => (
          <label
            key={value}
            className={`surface tap-target flex cursor-pointer flex-col gap-2 p-4 ${theme === value ? "outline-selected" : ""}`}
          >
            <span className="flex items-center gap-2">
              <input
                type="radio"
                name="theme"
                value={value}
                checked={theme === value}
                onChange={() => { choose(value); }}
                className="h-5 w-5"
              />
              <span className="font-bold">{THEME_LABELS[value].name}</span>
              {theme === value ? <span className="text-xs font-semibold">(선택됨)</span> : null}
            </span>
            <span className="text-sm text-muted-foreground">{THEME_LABELS[value].description}</span>
          </label>
        ))}
      </div>
      <p aria-live="polite" className="mt-3 mb-0 text-sm">{status}</p>
    </fieldset>
  );
}
