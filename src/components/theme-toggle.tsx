import { useEffect, useState } from "react";
import { Moon, Sun, Laptop } from "lucide-react";
import { useTheme } from "@/lib/theme";

interface ThemeToggleProps {
  variant?: "header-button" | "menu-item" | "inline";
  className?: string;
  onClick?: () => void;
}

export function ThemeToggle({
  variant = "header-button",
  className = "",
  onClick,
}: ThemeToggleProps) {
  const { effectiveTheme, theme, setTheme, toggleTheme, isDark } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleClick = () => {
    toggleTheme();
    if (onClick) onClick();
  };

  if (variant === "menu-item") {
    return (
      <button
        type="button"
        onClick={handleClick}
        className={`flex min-h-12 w-full items-center justify-between rounded-xl border border-border px-4 py-3 text-right text-sm font-bold text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
        aria-label="تغییر به حالت روز یا شب"
      >
        <span className="flex items-center gap-3">
          <Moon className="size-5 text-emerald-700 dark:text-emerald-400 dark:hidden" aria-hidden="true" />
          <Sun className="hidden size-5 text-amber-400 dark:block" aria-hidden="true" />
          <span className="dark:hidden">حالت روشن فعال است</span>
          <span className="hidden dark:inline">حالت تیره فعال است</span>
        </span>
        <span className="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-semibold text-muted-foreground">
          <span className="dark:hidden">تغییر به شب 🌙</span>
          <span className="hidden dark:inline">تغییر به روز ☀️</span>
        </span>
      </button>
    );
  }

  if (variant === "inline") {
    return (
      <div className={`inline-flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1 text-xs ${className}`}>
        <button
          type="button"
          onClick={() => setTheme("light")}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-bold transition-all ${
            mounted && theme === "light"
              ? "bg-card text-primary shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
          title="حالت روز (روشن)"
        >
          <Sun className="size-3.5 text-amber-500" />
          <span>روشن</span>
        </button>
        <button
          type="button"
          onClick={() => setTheme("dark")}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-bold transition-all ${
            mounted && theme === "dark"
              ? "bg-card text-primary shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
          title="حالت شب (تیره)"
        >
          <Moon className="size-3.5 text-emerald-400" />
          <span>تیره</span>
        </button>
        <button
          type="button"
          onClick={() => setTheme("system")}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-bold transition-all ${
            mounted && theme === "system"
              ? "bg-card text-primary shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
          title="پیروی از تم سیستم عامل"
        >
          <Laptop className="size-3.5" />
          <span>سیستم</span>
        </button>
      </div>
    );
  }

  // Default: header-button
  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-foreground transition-all hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
      aria-label="تغییر به حالت روز یا شب"
      title="تغییر به حالت روز یا شب"
    >
      <Moon className="size-5 text-emerald-700 dark:text-emerald-400 transition-transform duration-200 hover:-rotate-12 dark:hidden" />
      <Sun className="hidden size-5 text-amber-400 transition-transform duration-200 hover:rotate-45 dark:block" />
    </button>
  );
}
