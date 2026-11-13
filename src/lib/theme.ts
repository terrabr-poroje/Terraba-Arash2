/**
 * Universal Theme Manager for Terrabar (Light / Dark mode)
 * Persists user preference in localStorage and handles system dark mode detection.
 */

import { useState, useEffect } from "react";

export type Theme = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "terrabar-theme";

/**
 * Reads the saved theme preference from localStorage, defaulting to 'system'
 */
export function getSavedTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const val = localStorage.getItem(THEME_STORAGE_KEY);
    if (val === "light" || val === "dark" || val === "system") {
      return val;
    }
  } catch {
    // Ignore storage quota/permission errors
  }
  return "system";
}

/**
 * Determines whether the user's OS prefers dark mode
 */
export function getSystemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Resolves the active effective theme to either 'light' or 'dark'
 */
export function getEffectiveTheme(theme: Theme = getSavedTheme()): "light" | "dark" {
  if (theme === "system") {
    return getSystemPrefersDark() ? "dark" : "light";
  }
  return theme;
}

/**
 * Applies the given theme to the document element, updates meta theme-color,
 * and broadcasts the change to other components and tabs.
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;

  const effective = getEffectiveTheme(theme);
  const root = document.documentElement;

  if (effective === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }

  // Update mobile browser header color
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.setAttribute("content", effective === "dark" ? "#15221b" : "#1e704b");
  }

  // Persist preference
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore storage issues
  }

  // Dispatch custom event for reactive components
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("terrabar-theme-change", {
        detail: { theme, effectiveTheme: effective },
      })
    );
  }
}

/**
 * React hook to read and toggle the current theme
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("system");
  const [effectiveTheme, setEffectiveTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    // Sync initial state from DOM / localStorage
    const saved = getSavedTheme();
    setThemeState(saved);
    setEffectiveTheme(getEffectiveTheme(saved));

    const handleThemeChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ theme: Theme; effectiveTheme: "light" | "dark" }>;
      if (customEvent.detail) {
        setThemeState(customEvent.detail.theme);
        setEffectiveTheme(customEvent.detail.effectiveTheme);
      } else {
        const cur = getSavedTheme();
        setThemeState(cur);
        setEffectiveTheme(getEffectiveTheme(cur));
      }
    };

    const handleSystemMediaChange = () => {
      const current = getSavedTheme();
      if (current === "system") {
        applyTheme("system");
      }
    };

    window.addEventListener("terrabar-theme-change", handleThemeChange);
    window.addEventListener("storage", handleThemeChange);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", handleSystemMediaChange);

    return () => {
      window.removeEventListener("terrabar-theme-change", handleThemeChange);
      window.removeEventListener("storage", handleThemeChange);
      mediaQuery.removeEventListener("change", handleSystemMediaChange);
    };
  }, []);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    setEffectiveTheme(getEffectiveTheme(newTheme));
    applyTheme(newTheme);
  };

  const toggleTheme = () => {
    const isCurrentlyDark =
      typeof document !== "undefined"
        ? document.documentElement.classList.contains("dark")
        : effectiveTheme === "dark";
    const next = isCurrentlyDark ? "light" : "dark";
    setTheme(next);
  };

  return {
    theme,
    effectiveTheme,
    isDark: effectiveTheme === "dark",
    setTheme,
    toggleTheme,
  };
}
