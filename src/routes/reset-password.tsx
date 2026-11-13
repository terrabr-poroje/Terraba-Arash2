import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, KeyRound, Lock, Mail, Phone, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pageHead } from "@/lib/marketplace";
import { requestPasswordReset, submitResetPasswordWithOtp } from "@/lib/email-client";

export const Route = createFileRoute("/reset-password")({
  head: () =>
    pageHead("بازیابی رمز عبور", "بازیابی امن کلمه عبور با کد یک‌بارمصرف از طریق پیامک یا ایمیل در ترابار."),
  component: ResetPasswordPage,
});

type ResetMethod = "email" | "sms";

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [method, setMethod] = useState<ResetMethod>("email");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [step, setStep] = useState<"request" | "verify">("request");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [targetDisplay, setTargetDisplay] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const emailParam = params.get("email")?.trim();
    const phoneParam = params.get("phone")?.trim();
    if (emailParam) {
      setMethod("email");
      setIdentifier(emailParam);
    } else if (phoneParam) {
      setMethod("sms");
      setIdentifier(phoneParam);
    }
  }, []);

  async function handleSendOtp(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");

    const cleanId = identifier.trim();
    if (!cleanId) {
      setError(method === "email" ? "نشانی ایمیل خود را وارد کنید." : "شماره موبایل خود را وارد کنید.");
      return;
    }

    if (method === "email" && (!cleanId.includes("@") || cleanId.length < 5)) {
      setError("نشانی ایمیل معتبر نیست؛ مثال: name@domain.com");
      return;
    }

    setBusy(true);
    try {
      const res = await requestPasswordReset(cleanId, method);
      if (res.success) {
        setTargetDisplay(res.target || cleanId);
        setStep("verify");
        setNotice(res.message || "کد تأیید ۶ رقمی با موفقیت ارسال شد.");
      } else {
        setError(res.message || "خطا در ارسال کد تأیید. لطفاً اطلاعات واردشده را بررسی کنید.");
      }
    } catch {
      setError("خطا در برقراری ارتباط با سرور. لطفاً اتصال اینترنت را بررسی کنید.");
    } finally {
      setBusy(false);
    }
  }

  async function handleResetPassword(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");

    if (!code || code.trim().length < 5) {
      setError("کد تأیید ۶ رقمی را وارد کنید.");
      return;
    }

    if (!newPassword || newPassword.length < 6) {
      setError("کلمه عبور جدید باید حداقل ۶ نویسه (کاراکتر) باشد.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("کلمه عبور جدید و تکرار آن یکسان نیستند.");
      return;
    }

    setBusy(true);
    try {
      const res = await submitResetPasswordWithOtp({
        identifier: identifier.trim(),
        code: code.trim(),
        newPassword: newPassword.trim(),
      });

      if (res.success) {
        setNotice("کلمه عبور جدید با موفقیت ثبت شد! در حال انتقال به صفحه ورود…");
        window.setTimeout(() => {
          navigate({ to: "/auth" });
        }, 1500);
      } else {
        setError(res.message || "کد تأیید واردشده نادرست یا منقضی است.");
      }
    } catch {
      setError("خطا در برقراری ارتباط با سرور جهت تغییر رمز.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-market-surface py-12 sm:py-16">
      <div className="site-container max-w-lg">
        <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="grid size-12 place-items-center rounded-xl bg-accent text-primary">
              <KeyRound className="size-6" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-foreground">بازیابی رمز عبور</h1>
              <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
                رمز عبور حساب خود را با دریافت کد یک‌بارمصرف بازنشانی کنید.
              </p>
            </div>
          </div>

          {step === "request" ? (
            <div className="mt-6">
              {/* Method Switcher: Email vs SMS */}
              <div className="flex rounded-lg border border-border bg-muted/40 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setMethod("email");
                    setError("");
                    setNotice("");
                  }}
                  className={`flex-1 flex items-center justify-center gap-2 rounded-md py-2 text-xs font-bold transition-all ${
                    method === "email"
                      ? "bg-card text-primary shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Mail className="size-4" />
                  بازیابی از طریق ایمیل
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMethod("sms");
                    setError("");
                    setNotice("");
                  }}
                  className={`flex-1 flex items-center justify-center gap-2 rounded-md py-2 text-xs font-bold transition-all ${
                    method === "sms"
                      ? "bg-card text-primary shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Phone className="size-4" />
                  بازیابی از طریق پیامک
                </button>
              </div>

              <form onSubmit={handleSendOtp} className="mt-6 grid gap-4">
                {method === "email" ? (
                  <label className="field-label">
                    نشانی ایمیل حساب کاربری
                    <input
                      required
                      type="email"
                      dir="ltr"
                      autoComplete="email"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      className="field-input text-left"
                      placeholder="name@example.com"
                    />
                    <span className="text-xs font-normal text-muted-foreground">
                      کد تأیید ۶ رقمی به نشانی ایمیل شما ارسال خواهد شد.
                    </span>
                  </label>
                ) : (
                  <label className="field-label">
                    شماره موبایل ثبت‌شده در ترابار
                    <input
                      required
                      type="tel"
                      dir="ltr"
                      inputMode="tel"
                      autoComplete="tel"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      className="field-input text-left"
                      placeholder="09123456789"
                    />
                    <span className="text-xs font-normal text-muted-foreground">
                      کد تأیید ۶ رقمی به شماره همراه شما پیامک خواهد شد.
                    </span>
                  </label>
                )}

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

                <Button type="submit" disabled={busy || !identifier.trim()} className="mt-2">
                  {busy ? "در حال ارسال کد…" : "ارسال کد تأیید بازیابی"}
                  {method === "email" ? <Mail className="mr-2 size-4" /> : <Phone className="mr-2 size-4" />}
                </Button>
              </form>
            </div>
          ) : (
            /* STEP 2: ENTER OTP & NEW PASSWORD */
            <form onSubmit={handleResetPassword} className="mt-6 grid gap-4">
              <div className="rounded-xl bg-accent/40 border border-primary/20 p-4 text-sm">
                <div className="flex items-center gap-2 font-bold text-primary">
                  <CheckCircle2 className="size-4" />
                  <span>کد تأیید ارسال شد</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  کد ۶ رقمی به {targetDisplay || identifier} ارسال گردید. لطفاً کد را در کادر زیر وارد کنید.
                </p>
              </div>

              <label className="field-label">
                کد تأیید ۶ رقمی
                <input
                  required
                  dir="ltr"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="field-input text-center text-lg tracking-[0.4em]"
                  placeholder="000000"
                />
              </label>

              <label className="field-label">
                کلمه عبور جدید
                <input
                  required
                  type="password"
                  dir="ltr"
                  minLength={6}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="field-input text-left"
                  placeholder="حداقل ۶ نویسه"
                />
              </label>

              <label className="field-label">
                تکرار کلمه عبور جدید
                <input
                  required
                  type="password"
                  dir="ltr"
                  minLength={6}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="field-input text-left"
                  placeholder="تکرار کلمه عبور"
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

              <Button
                type="submit"
                disabled={busy || code.trim().length !== 6 || newPassword.length < 6 || newPassword !== confirmPassword}
                className="mt-2"
              >
                {busy ? "در حال ثبت رمز جدید…" : "تأیید و ذخیره رمز جدید"}
                <ShieldCheck className="mr-2 size-4" />
              </Button>

              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setStep("request");
                  setCode("");
                  setNewPassword("");
                  setConfirmPassword("");
                  setError("");
                  setNotice("");
                }}
              >
                ارسال مجدد یا تغییر روش
              </Button>
            </form>
          )}

          <div className="mt-8 pt-4 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <Link to="/auth" className="flex items-center gap-1 hover:text-primary transition-colors">
              <ArrowRight className="size-3.5" />
              بازگشت به ورود / ثبت‌نام
            </Link>
            <Link to="/admin-reset-password" className="text-muted-foreground hover:text-foreground">
              ورود اضطراری مدیر
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
