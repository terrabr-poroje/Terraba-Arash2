import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Mail, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiPost } from "@/lib/api-client";
import { pageHead } from "@/lib/marketplace";

export const Route = createFileRoute("/admin-reset-password")({
  head: () => pageHead("تنظیم رمز مدیر", "تنظیم یا تغییر رمز عبور مدیر ترابار با ایمیل بازیابی یا پیامک."),
  component: AdminResetPasswordPage,
});

function AdminResetPasswordPage() {
  const navigate = useNavigate();
  const [method, setMethod] = useState<"email" | "sms">("email");
  const [identifier, setIdentifier] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function sendOtp(e?: FormEvent) {
    if (e) e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const { ok, data } = await apiPost<{ success?: boolean; message?: string }>("/api/admin/request-password-otp", {
      method,
      identifier: identifier.trim() || undefined,
    });
    setBusy(false);
    if (!ok || !data?.success) {
      setError(
        data?.message ||
          (method === "email" ? "ارسال کد تأیید به ایمیل مدیر ناموفق بود." : "ارسال پیامک کد تأیید ناموفق بود."),
      );
    } else {
      setOtpSent(true);
      setNotice(
        data.message ||
          (method === "email"
            ? "کد تأیید ۶ رقمی به ایمیل بازیابی مدیر کل ارسال شد."
            : "کد تأیید ۶ رقمی به شماره ثبت‌شده مدیر کل ارسال شد."),
      );
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const cleanOtp = otpCode
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .trim();
    if (cleanOtp.length !== 6) {
      setError("کد تأیید ۶ رقمی ارسال‌شده را وارد کنید.");
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
      otpCode: cleanOtp,
      newPassword: password,
      method,
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
          <h1 className="text-2xl font-extrabold">بازیابی و تنظیم رمز مدیر کل</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            تغییر رمز مدیر کل با ارسال کد تأیید ۶ رقمی به ایمیل بازیابی یا شماره تماس ثبت‌شده مدیر در تنظیمات کلودفلر انجام می‌شود.
          </p>

          {!otpSent ? (
            <form onSubmit={sendOtp} className="mt-6 grid gap-4">
              <div className="flex rounded-lg border border-border bg-muted/40 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setMethod("email");
                    setIdentifier("");
                    setError("");
                    setNotice("");
                  }}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-xs font-bold transition-all ${
                    method === "email"
                      ? "bg-card text-primary shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Mail className="size-4" />
                  ایمیل بازیابی مدیر
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMethod("sms");
                    setIdentifier("");
                    setError("");
                    setNotice("");
                  }}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-xs font-bold transition-all ${
                    method === "sms"
                      ? "bg-card text-primary shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Phone className="size-4" />
                  شماره تماس مدیر
                </button>
              </div>

              <label className="field-label">
                {method === "email" ? "ایمیل بازیابی مدیر (اختیاری جهت تطبیق)" : "شماره تماس مدیر (اختیاری جهت تطبیق)"}
                <input
                  type={method === "email" ? "email" : "tel"}
                  dir="ltr"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="field-input text-left"
                  placeholder={method === "email" ? "admin@example.com" : "09123456789"}
                />
                <span className="text-xs font-normal text-muted-foreground">
                  {method === "email"
                    ? "در صورت خالی گذاشتن، کد مستقیم به ADMIN_RECOVERY_EMAIL ارسال می‌شود."
                    : "در صورت خالی گذاشتن، کد مستقیم به ADMIN_PHONE_FOR_OTP پیامک می‌شود."}
                </span>
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
                {busy
                  ? "در حال ارسال کد…"
                  : method === "email"
                    ? "ارسال کد تأیید ۶ رقمی به ایمیل مدیر"
                    : "ارسال کد تأیید ۶ رقمی به شماره مدیر"}
              </Button>
            </form>
          ) : (
            <form onSubmit={submit} className="mt-6 grid gap-4">
              {notice && (
                <p role="status" className="text-sm font-medium text-primary">
                  {notice}
                </p>
              )}
              <label className="field-label">
                کد تأیید ۶ رقمی ({method === "email" ? "ارسال‌شده به ایمیل" : "پیامک‌شده"})
                <input
                  required
                  dir="ltr"
                  inputMode="numeric"
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
                  className="field-input text-left"
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
                  className="field-input text-left"
                />
              </label>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy}>
                  {busy ? "در حال ذخیره…" : "ذخیره رمز جدید"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setOtpSent(false);
                    setOtpCode("");
                    setError("");
                    setNotice("");
                  }}
                >
                  تغییر روش / ارسال مجدد
                </Button>
              </div>
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
