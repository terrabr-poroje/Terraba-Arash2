import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pageHead } from "@/lib/marketplace";

export const Route = createFileRoute("/admin-login")({
  head: () => pageHead("ورود مدیران ترابار", "ورود امن مدیر کل و مدیران شهر ترابار."),
  component: AdminLoginPage,
});

function AdminLoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");

    const cleanUsername = username.trim();
    const cleanPassword = password.trim();

    if (!cleanUsername || !cleanPassword) {
      setError("نام کاربری (یا ایمیل/شماره مدیر) و رمز عبور را وارد کنید.");
      setBusy(false);
      return;
    }

    // Authenticate with backend admin login
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: cleanUsername, password: cleanPassword }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.success) {
        setError(data?.message || "نام کاربری یا رمز عبور مدیر نادرست است.");
        setBusy(false);
        return;
      }

      if (data?.sessionToken) {
        const sessionData = {
          token: data.sessionToken,
          user: data.user,
          member: data.member,
          roles: data.roles || ["admin", "main_admin", "buyer", "seller", "supplier"],
        };
        localStorage.setItem("terrabar_d1_session", JSON.stringify(sessionData));
        document.cookie = `tb_session=${data.sessionToken}; Path=/; Max-Age=2592000; SameSite=Lax`;
        window.dispatchEvent(new CustomEvent("terrabar-auth-change", { detail: sessionData }));
        setNotice("ورود مدیر با موفقیت تأیید شد؛ در حال انتقال به پنل مدیریت…");
        setBusy(false);
        window.setTimeout(() => navigate({ to: "/admin" }), 300);
        return;
      }
    } catch {
      setError("خطا در برقراری ارتباط با سرور. لطفاً اتصال اینترنت را بررسی کنید.");
      setBusy(false);
      return;
    }

    setBusy(false);
  }

  return (
    <section className="bg-market-surface py-10">
      <div className="site-container max-w-md">
        <div className="rounded-xl border border-border bg-card p-6 sm:p-8">
          <div className="mb-5 flex items-center gap-3">
            <div className="grid size-12 place-items-center rounded-xl bg-accent text-primary">
              <ShieldCheck className="size-6" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold">ورود مدیران ترابار</h1>
              <p className="text-xs text-muted-foreground mt-0.5">احراز هویت و دسترسی به پنل مدیریت</p>
            </div>
          </div>
          <form onSubmit={submit} className="grid gap-4">
            <label className="field-label">
              نام کاربری، ایمیل یا شماره تماس مدیر
              <input
                required
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="field-input"
                dir="auto"
                placeholder="Rahavard یا ایمیل / شماره تماس"
              />
            </label>
            <label className="field-label">
              رمز عبور مدیر
              <input
                required
                type="password"
                autoComplete="current-password"
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="field-input text-left"
                dir="ltr"
                placeholder="رمز عبور مدیر"
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
              {busy ? "در حال بررسی…" : "ورود به پنل مدیریت"}
              <KeyRound className="mr-2 size-4" />
            </Button>
          </form>
          <div className="mt-4 text-center">
            <Link to="/admin-reset-password" className="text-xs font-medium text-primary underline">
              فراموشی یا تنظیم رمز مدیر (با ایمیل یا پیامک)
            </Link>
          </div>
          <div className="mt-4 flex justify-between border-t border-border pt-4 text-sm">
            <Link to="/auth" className="text-primary underline">
              ورود کاربران
            </Link>
            <Link to="/" className="text-primary underline">
              صفحه اصلی
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
