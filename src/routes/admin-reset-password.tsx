import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { apiPost } from "@/lib/api-client";
import { pageHead } from "@/lib/marketplace";

export const Route = createFileRoute("/admin-reset-password")({
  head: () => pageHead("تنظیم رمز مدیر", "تنظیم یا تغییر رمز عبور مدیر ترابار با تأیید پیامکی."),
  component: AdminResetPasswordPage,
});

function AdminResetPasswordPage() {
  const navigate = useNavigate();
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function sendOtp() {
    setBusy(true);
    setError("");
    setNotice("");
    const { ok, data } = await apiPost<{ success?: boolean; message?: string }>("/api/admin/request-password-otp", {});
    setBusy(false);
    if (!ok || !data?.success) {
      setError(data?.message || "ارسال پیامک کد تأیید ناموفق بود.");
    } else {
      setOtpSent(true);
      setNotice(data.message || "کد تأیید ۶ رقمی به شماره ثبت‌شده مدیر کل ارسال شد.");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    if (otpCode.trim().length !== 6) {
      setError("کد تأیید ۶ رقمی پیامک‌شده را وارد کنید.");
      setBusy(false);
      return;
    }
    if (password.length < 8) {
      setError("رمز عبور باید دست‌کم ۸ نویسه داشته باشد.");
      setBusy(false);
      return;
    }
    if (password !== confirm) {
      setError("تکرار رمز عبور با رمز اصلی یکسان نیست.");
      setBusy(false);
      return;
    }
    const { ok, data } = await apiPost<{ success?: boolean; message?: string }>("/api/admin/change-password", {
      otpCode: otpCode.trim(),
      newPassword: password,
    });
    if (!ok || !data?.success) {
      setError(data?.message || "تغییر رمز عبور انجام نشد.");
      setBusy(false);
      return;
    }
    setNotice(data.message || "رمز عبور مدیر تغییر کرد. اکنون با رمز جدید وارد شوید.");
    setBusy(false);
    window.setTimeout(() => navigate({ to: "/admin-login" }), 900);
  }

  return (
    <section className="bg-market-surface py-12">
      <div className="site-container max-w-md">
        <div className="rounded-xl border border-border bg-card p-6 sm:p-8">
          <h1 className="text-2xl font-extrabold">تنظیم رمز مدیر کل</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            تغییر رمز مدیر کل فقط با ارسال کد تأیید ۶ رقمی به شماره موبایل ثبت‌شده مدیر در سیستم انجام می‌شود.
          </p>
          {!otpSent ? (
            <div className="mt-6 grid gap-4">
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              {notice && (
                <p role="status" className="text-sm text-primary">
                  {notice}
                </p>
              )}
              <Button type="button" onClick={() => void sendOtp()} disabled={busy}>
                {busy ? "در حال ارسال پیامک…" : "ارسال کد تأیید ۶ رقمی به شماره مدیر"}
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-6 grid gap-4">
              <label className="field-label">
                کد تأیید پیامکی
                <input
                  required
                  dir="ltr"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  className="field-input text-center font-mono tracking-widest"
                  placeholder="123456"
                />
              </label>
              <label className="field-label">
                رمز عبور جدید
                <input
                  required
                  type="password"
                  minLength={8}
                  autoComplete="new-password"
                  dir="ltr"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="field-input"
                />
              </label>
              <label className="field-label">
                تکرار رمز عبور
                <input
                  required
                  type="password"
                  minLength={8}
                  autoComplete="new-password"
                  dir="ltr"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="field-input"
                />
              </label>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              {notice && (
                <p role="status" className="text-sm text-primary">
                  {notice}
                </p>
              )}
              <Button type="submit" disabled={busy}>
                {busy ? "در حال ذخیره…" : "ذخیره رمز جدید"}
              </Button>
            </form>
          )}
          <Link to="/admin-login" className="mt-5 inline-block text-sm text-primary underline">
            بازگشت به ورود مدیر
          </Link>
        </div>
      </div>
    </section>
  );
}
