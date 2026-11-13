import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { apiGet } from "@/lib/api-client";

type RatingSummaryProps = { targetType: "member" | "load"; targetId?: string | number | null; className?: string };

export function RatingSummary({ targetType, targetId, className = "" }: RatingSummaryProps) {
  const [summary, setSummary] = useState<{ average: number; count: number } | null>(null);
  useEffect(() => {
    let active = true;
    async function fetchSummary() {
      if (targetId == null || String(targetId).length === 0) {
        setSummary(null);
        return;
      }
      try {
        const { ok, data } = await apiGet<{ average?: number; count?: number }>(
          `/api/ratings/summary?targetType=${targetType}&targetId=${encodeURIComponent(String(targetId))}`,
        );
        if (!active) return;
        if (!ok || !data?.count) {
          setSummary(null);
          return;
        }
        setSummary({ average: Number(data.average || 0), count: Number(data.count || 0) });
      } catch {
        if (active) setSummary(null);
      }
    }
    void fetchSummary();
    return () => {
      active = false;
    };
  }, [targetType, targetId]);

  if (!summary)
    return (
      <span
        className={`inline-flex items-center gap-1 text-xs text-muted-foreground ${className}`}
        aria-label="هنوز امتیازی ثبت نشده است"
      >
        <Star className="size-3.5" />
        بدون امتیاز
      </span>
    );

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs ${className}`}
      aria-label={`امتیاز ${summary.average.toFixed(1)} از ۵، بر پایه ${summary.count} رأی`}
    >
      <Star className="size-3.5 fill-amber-400 text-amber-500" />
      <strong>{summary.average.toLocaleString("fa-IR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}</strong>
      <span className="text-muted-foreground">({summary.count.toLocaleString("fa-IR")})</span>
    </span>
  );
}
