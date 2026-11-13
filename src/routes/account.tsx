/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  ClipboardList,
  Edit3,
  KeyRound,
  Lock,
  Mail,
  Package,
  Phone,
  Save,
  Send,
  ShieldCheck,
  Store,
  UserRound,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CityPicker } from "@/components/city-picker";
import { RatingForm } from "@/components/rating-form";
import { apiGet, apiPost, saveStoredSession, getSessionToken } from "@/lib/api-client";
import { useAuth, signOut } from "@/lib/auth";
import { pageHead, provinces, provinceCities, faNumber } from "@/lib/marketplace";

export const Route = createFileRoute("/account")({
  head: () => pageHead("حساب کاربری من", "مدیریت پروفایل، عضویت‌ها، بارها، امور مالی و سفارش‌های حساب ترابار."),
  component: AccountPage,
});

type Member = {
  id: string;
  full_name: string | null;
  phone: string | null;
  email?: string | null;
  city: string | null;
  province?: string | null;
  products?: string | null;
  verification_status: string | null;
};
type MemberRole = { id: string; role_code: string; approval_status: string; created_at: string };
type LoadRow = {
  id: string;
  name: string | null;
  product_type: string | null;
  engine: string | null;
  city: string | null;
  quantity: number | null;
  count: number | null;
  price: number | null;
  status: string;
  created_at: string;
};
type OrderRow = {
  id: string;
  invoice_number: number;
  load_id: string | null;
  seller_member_id: string | null;
  buyer_member_id: string | null;
  quantity: number | null;
  unit: string | null;
  total_price: number | null;
  status: string;
  payment_status: string | null;
  delivery_status: string | null;
  created_at: string;
};

const roleLabels: Record<string, string> = {
  supplier: "تأمین‌کننده",
  seller: "بارفروش / حجره‌دار",
  bar_seller: "بارفروش / حجره‌دار",
  buyer: "خریدار",
  special_buyer: "خریدار ویژه",
  professional_buyer: "خریدار ویژه",
  admin: "مدیر کل",
  city_manager: "مدیر شهری",
};
const approvalLabels: Record<string, string> = {
  pending: "در انتظار بررسی",
  approved: "تأییدشده",
  rejected: "ردشده",
};
const loadLabels: Record<string, string> = {
  active: "فعال",
  pending: "در انتظار بررسی",
  inactive: "غیرفعال",
  rejected: "ردشده",
  archived: "بایگانی‌شده",
  sold_out: "تمام‌شده",
  expired: "منقضی‌شده",
  published: "منتشرشده",
};
const orderLabels: Record<string, string> = {
  pending: "در انتظار پاسخ",
  accepted: "تأییدشده",
  confirmed: "تأییدشده",
  rejected: "ردشده",
  shipped: "ارسال‌شده",
  delivered: "تحویل‌شده",
  cancelled: "لغوشده",
};
const paymentLabels: Record<string, string> = {
  unpaid: "پرداخت‌نشده",
  pending: "در انتظار تأیید",
  paid: "پرداخت‌شده",
  failed: "ناموفق",
  refunded: "بازپرداخت‌شده",
};

function AccountPage() {
  const { user, session, loading } = useAuth();
  const navigate = useNavigate();
  const [member, setMember] = useState<Member | null>(null);
  const [memberRoles, setMemberRoles] = useState<MemberRole[]>([]);
  const [loads, setLoads] = useState<LoadRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [financeSummary, setFinanceSummary] = useState<any>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  // Editable profile state
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileFullName, setProfileFullName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileProvince, setProfileProvince] = useState("البرز");
  const [profileCity, setProfileCity] = useState("کرج");
  const [profileActivity, setProfileActivity] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  // Password reset state
  const [resetMethod, setResetMethod] = useState<"phone" | "email">("phone");
  const [resetIdentifier, setResetIdentifier] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetSuccess, setResetSuccess] = useState("");
  const [timerSeconds, setTimerSeconds] = useState(0);

  useEffect(() => {
    if (user?.phone) {
      setResetMethod("phone");
      setResetIdentifier(user.phone);
    } else if (user?.email) {
      setResetMethod("email");
      setResetIdentifier(user.email);
    }
  }, [user?.phone, user?.email]);

  useEffect(() => {
    if (timerSeconds <= 0) return;
    const interval = setInterval(() => {
      setTimerSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [timerSeconds]);

  useEffect(() => {
    let active = true;
    async function loadAccount() {
      if (!user) {
        setBusy(false);
        return;
      }
      setBusy(true);
      setError("");
      try {
        const [{ ok, data }, loadsRes] = await Promise.all([
          apiGet<any>("/api/account/overview"),
          apiGet<any>(`/api/loads/list?mode=all&memberId=${encodeURIComponent(session?.member?.id || user.id)}`),
        ]);
        if (!active) return;

        if (!ok || !data?.success) {
          setError("دریافت کامل اطلاعات حساب با خطا مواجه شد.");
          setMember({
            id: session?.member?.id || user.id,
            full_name: user.full_name || null,
            phone: user.phone || null,
            email: user.email || null,
            city: user.city || null,
            province: user.province || null,
            verification_status: "approved",
          });
        } else {
          const m = data.member || {
            id: user.id,
            full_name: user.full_name || null,
            phone: user.phone || null,
            email: user.email || null,
            city: user.city || null,
            province: user.province || null,
            verification_status: "approved",
          };
          setMember(m);
          setProfileFullName(m.full_name || "");
          setProfileEmail(m.email || user.email || "");
          setProfileProvince(m.province || "البرز");
          setProfileCity(m.city || "کرج");
          setProfileActivity(m.products || user.activity || "");
          setMemberRoles(Array.isArray(data.roleRequests) ? data.roleRequests : []);
          setOrders(Array.isArray(data.orders) ? data.orders : []);
          setFinanceSummary(data.financeSummary || null);
        }

        if (loadsRes.ok && Array.isArray(loadsRes.data?.loads)) {
          setLoads(loadsRes.data.loads);
        }
      } catch {
        if (active) setError("خطا در بارگذاری اطلاعات حساب.");
      } finally {
        if (active) setBusy(false);
      }
    }
    void loadAccount();
    return () => {
      active = false;
    };
  }, [user?.id]);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!profileFullName.trim() || profileFullName.trim().length < 2) {
      toast.error("نام و نام خانوادگی معتبر وارد کنید.");
      return;
    }
    if (!profileCity.trim()) {
      toast.error("شهر محل فعالیت را انتخاب کنید.");
      return;
    }
    setSavingProfile(true);
    try {
      const { ok, data } = await apiPost<any>("/api/account/profile", {
        fullName: profileFullName.trim(),
        email: profileEmail.trim(),
        province: profileProvince,
        city: profileCity,
        activity: profileActivity.trim(),
      });
      if (!ok || !data?.success) {
        toast.error(data?.message || "ذخیره تغییرات پروفایل انجام نشد.");
        return;
      }
      if (data.member) setMember(data.member);
      const token = getSessionToken();
      if (token && data.user) {
        saveStoredSession({
          token,
          user: data.user,
          member: data.member,
          roles: data.roles || session?.roles,
        });
      }
      setEditingProfile(false);
      toast.success("اطلاعات حساب کاربری با موفقیت به‌روزرسانی شد.");
    } catch {
      toast.error("خطا در ذخیره پروفایل.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleSendResetOtp() {
    setResetError("");
    setResetSuccess("");
    const idToUse = resetMethod === "phone" ? user?.phone || resetIdentifier : user?.email || resetIdentifier;
    if (!idToUse || !idToUse.trim()) {
      setResetError(resetMethod === "phone" ? "شماره تماس معتبری یافت نشد." : "نشانی ایمیل معتبری یافت نشد.");
      return;
    }

    setResetBusy(true);
    try {
      const { ok, data } = await apiPost<any>("/api/auth/send-password-reset-otp", {
        identifier: idToUse.trim(),
        preferredMethod: resetMethod === "phone" ? "sms" : "email",
      });
      if (ok && data?.success) {
        setOtpSent(true);
        setTimerSeconds(120);
        setResetSuccess(data.message || "کد تأیید ۶ رقمی با موفقیت ارسال شد.");
      } else {
        setResetError(data?.message || "خطا در ارسال کد تأیید تغییر کلمه عبور.");
      }
    } catch {
      setResetError("خطا در برقراری ارتباط با سامانه ارسال کد.");
    } finally {
      setResetBusy(false);
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setResetError("");
    setResetSuccess("");

    if (!otpCode || otpCode.trim().length < 5) {
      setResetError("کد تأیید ۶ رقمی پیامک یا ایمیل شده را وارد کنید.");
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      setResetError("رمز عبور جدید باید حداقل ۶ کاراکتر باشد.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setResetError("رمز عبور جدید و تکرار آن یکسان نیستند.");
      return;
    }

    setResetBusy(true);
    try {
      const idToUse = resetMethod === "phone" ? user?.phone || resetIdentifier : user?.email || resetIdentifier;
      const { ok, data } = await apiPost<any>("/api/auth/reset-password-with-otp", {
        identifier: idToUse.trim(),
        code: otpCode.trim(),
        newPassword: newPassword.trim(),
      });
      if (ok && data?.success) {
        setResetSuccess(data.message || "رمز عبور با موفقیت در پایگاه داده تغییر یافت.");
        setOtpCode("");
        setNewPassword("");
        setConfirmPassword("");
        setOtpSent(false);
      } else {
        setResetError(data?.message || "کد تأیید وارد شده نامعتبر یا منقضی شده است.");
      }
    } catch {
      setResetError("خطا در ثبت رمز عبور جدید در پایگاه داده.");
    } finally {
      setResetBusy(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    await navigate({ to: "/auth" });
  }

  if (loading || busy) {
    return <section className="site-container py-16 text-center text-sm text-muted-foreground">در حال بارگذاری حساب کاربری…</section>;
  }
  if (!user) {
    return (
      <section className="site-container max-w-xl py-16 text-center">
        <UserRound className="mx-auto size-10 text-primary" />
        <h1 className="mt-4 text-2xl font-extrabold">ورود به حساب کاربری</h1>
        <p className="mt-2 text-sm text-muted-foreground">برای مشاهده پروفایل، عضویت‌ها، بارها و سفارش‌ها ابتدا وارد شوید.</p>
        <Button asChild className="mt-6">
          <Link to="/auth">ورود / ثبت‌نام</Link>
        </Button>
      </section>
    );
  }

  return (
    <section className="bg-market-surface py-8 sm:py-12">
      <div className="site-container grid gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-primary">TERRABAR</p>
            <h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">حساب کاربری من</h1>
            <p className="mt-2 text-sm text-muted-foreground">پروفایل، عضویت‌ها، بارهای من و سوابق مالی در بخش‌های جداگانه.</p>
          </div>
          <Button variant="outline" onClick={handleSignOut}>
            خروج از حساب
          </Button>
        </div>
        {error && (
          <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            {error}
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-border bg-card p-5 md:col-span-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <UserRound className="size-5 text-primary" />
                <h2 className="font-bold">اطلاعات پروفایل</h2>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditingProfile((v) => !v)}>
                <Edit3 className="ml-1 size-4" />
                {editingProfile ? "انصراف" : "ویرایش"}
              </Button>
            </div>
            {editingProfile ? (
              <form onSubmit={handleSaveProfile} className="mt-4 grid gap-3 text-sm">
                <label className="field-label">
                  نام و نام خانوادگی
                  <input
                    required
                    className="field-input"
                    value={profileFullName}
                    onChange={(e) => setProfileFullName(e.target.value)}
                  />
                </label>
                <label className="field-label">
                  ایمیل
                  <input
                    type="email"
                    dir="ltr"
                    className="field-input text-left"
                    value={profileEmail}
                    onChange={(e) => setProfileEmail(e.target.value)}
                    placeholder="name@example.com"
                  />
                </label>
                <div className="field-label">
                  <label htmlFor="profile-province">استان</label>
                  <CityPicker
                    id="profile-province"
                    value={profileProvince}
                    options={provinces}
                    onChange={(v) => {
                      setProfileProvince(v);
                      setProfileCity("");
                    }}
                  />
                </div>
                <div className="field-label">
                  <label htmlFor="profile-city">شهر</label>
                  <CityPicker
                    id="profile-city"
                    value={profileCity}
                    options={provinceCities[profileProvince] ?? []}
                    disabled={!profileProvince}
                    onChange={setProfileCity}
                  />
                </div>
                <label className="field-label">
                  نوع فعالیت / محصولات
                  <input
                    className="field-input"
                    value={profileActivity}
                    onChange={(e) => setProfileActivity(e.target.value)}
                  />
                </label>
                <Button type="submit" disabled={savingProfile} className="gap-2">
                  <Save className="size-4" />
                  {savingProfile ? "در حال ذخیره…" : "ذخیره اطلاعات"}
                </Button>
              </form>
            ) : member ? (
              <dl className="mt-4 grid gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">نام و نام خانوادگی</dt>
                  <dd className="mt-1 font-semibold">{member.full_name || "ثبت نشده"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">شماره تماس</dt>
                  <dd dir="ltr" className="mt-1 text-right font-semibold">
                    {member.phone || "ثبت نشده"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">ایمیل</dt>
                  <dd dir="ltr" className="mt-1 text-right font-semibold">
                    {member.email || user.email || "ثبت نشده"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">استان و شهر عضویت</dt>
                  <dd className="mt-1 font-semibold">
                    {[member.province, member.city].filter(Boolean).join(" · ") || "ثبت نشده"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">شناسه حساب</dt>
                  <dd className="mt-1 break-all text-xs text-muted-foreground">{user.id}</dd>
                </div>
              </dl>
            ) : null}
          </div>

          <div className="rounded-xl border border-border bg-card p-5 md:col-span-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-primary" />
              <h2 className="font-bold">عضویت‌ها و دسترسی‌ها</h2>
            </div>
            {memberRoles.length ? (
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {memberRoles.map((r) => (
                  <li key={r.id} className="rounded-lg border border-border p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{roleLabels[r.role_code] || r.role_code}</span>
                      <span className="rounded-full bg-secondary px-2.5 py-1 text-xs">
                        {approvalLabels[r.approval_status] || r.approval_status}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {r.approval_status === "approved"
                        ? "امکانات این نقش طبق سطح دسترسی و شهر مجاز فعال است."
                        : r.approval_status === "pending"
                          ? "پس از بررسی مدیر، وضعیت و امکانات به‌روزرسانی می‌شود."
                          : "برای پیگیری یا ارسال مجدد درخواست به بخش عضویت بروید."}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">هنوز نقش یا درخواست عضویتی برای این حساب ثبت نشده است.</p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link to="/membership">پیگیری / درخواست عضویت</Link>
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-card p-5">
            <Package className="size-5 text-primary" />
            <p className="mt-3 text-sm text-muted-foreground">بارهای ثبت‌شده</p>
            <p className="mt-1 text-2xl font-extrabold">{faNumber(loads.length)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {faNumber(loads.filter((l) => l.status === "active" || l.status === "published").length)} بار فعال / منتشرشده
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <ClipboardList className="size-5 text-primary" />
            <p className="mt-3 text-sm text-muted-foreground">سفارش‌های مرتبط</p>
            <p className="mt-1 text-2xl font-extrabold">{faNumber(orders.length)}</p>
            <p className="mt-1 text-xs text-muted-foreground">خریدهای شما و سفارش‌های بارهای شما</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <ShieldCheck className="size-5 text-primary" />
            <p className="mt-3 text-sm text-muted-foreground">نقش‌های تأییدشده</p>
            <p className="mt-1 text-2xl font-extrabold">
              {faNumber(memberRoles.filter((r) => r.approval_status === "approved").length)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">نقش‌های فعال ثبت‌شده در سامانه</p>
          </div>
        </div>

        {/* Finance Summary & Quick Link */}
        <div id="finance" className="scroll-mt-6 rounded-xl border border-border bg-card p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Wallet className="size-5 text-primary" />
              <h2 className="text-lg font-bold">خلاصه امور مالی و تسویه حساب</h2>
            </div>
            <Button asChild size="sm">
              <Link to="/seller-accounting-preview">
                مدیریت شبا، صورت‌حساب و درخواست تسویه
                <ArrowLeft className="mr-1 size-4" />
              </Link>
            </Button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-muted/40 p-3.5">
              <span className="text-xs text-muted-foreground">کل فروش پرداخت‌شده</span>
              <p className="mt-1 font-extrabold">{faNumber(financeSummary?.salesTotal ?? 0)} تومان</p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3.5">
              <span className="text-xs text-muted-foreground">کارمزد پلتفرم (۵٪)</span>
              <p className="mt-1 font-extrabold">{faNumber(financeSummary?.commissionTotal ?? 0)} تومان</p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3.5">
              <span className="text-xs text-muted-foreground">سهم خالص فروشنده (۹۵٪)</span>
              <p className="mt-1 font-extrabold">{faNumber(financeSummary?.netSalesTotal ?? 0)} تومان</p>
            </div>
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3.5">
              <span className="text-xs text-muted-foreground">موجودی قابل تسویه</span>
              <p className="mt-1 font-extrabold text-primary">{faNumber(financeSummary?.availableBalance ?? 0)} تومان</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Store className="size-5 text-primary" />
              <h2 className="text-lg font-bold">بارهای من</h2>
            </div>
            <Button asChild size="sm">
              <Link to="/announce">
                ثبت / مدیریت بار <ArrowLeft className="mr-1 size-4" />
              </Link>
            </Button>
          </div>
          {!loads.length ? (
            <p className="mt-4 text-sm text-muted-foreground">هنوز باری برای این حساب ثبت نشده است.</p>
          ) : (
            <div className="mt-4 grid gap-3">
              {loads.map((l) => (
                <div key={l.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4">
                  <div>
                    <p className="font-semibold">
                      {l.name || [l.product_type, l.engine].filter(Boolean).join(" ") || "بار بدون عنوان"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {l.city || "شهر ثبت نشده"} · {l.count ?? "—"} بسته ·{" "}
                      {Number(l.price ?? 0).toLocaleString("fa-IR")} تومان/کیلو
                    </p>
                  </div>
                  <span className="rounded-full bg-secondary px-3 py-1 text-xs">{loadLabels[l.status] || l.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">سوابق سفارش و فاکتورها</h2>
            <Button asChild variant="outline" size="sm">
              <Link to="/orders">
                پیگیری همه سفارش‌ها و درخواست‌ها <ArrowLeft className="mr-1 size-4" />
              </Link>
            </Button>
          </div>
          {!orders.length ? (
            <p className="mt-4 text-sm text-muted-foreground">هنوز سفارشی برای این حساب ثبت نشده است.</p>
          ) : (
            <div className="mt-4 grid gap-3">
              {orders.map((o) => (
                <div key={o.id} className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">فاکتور شماره {new Intl.NumberFormat("fa-IR").format(o.invoice_number)}</span>
                    <span className="rounded-full bg-secondary px-3 py-1 text-xs">{orderLabels[o.status] || o.status}</span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {o.quantity ?? "—"} {o.unit || "واحد"} · مبلغ {Number(o.total_price ?? 0).toLocaleString("fa-IR")} تومان
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    پرداخت: {paymentLabels[o.payment_status || "unpaid"] || o.payment_status || "نامشخص"} · تحویل:{" "}
                    {orderLabels[o.delivery_status || ""] || o.delivery_status || "در انتظار ثبت وضعیت"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{new Date(o.created_at).toLocaleDateString("fa-IR")}</p>
                  {member &&
                    o.buyer_member_id === member.id &&
                    (["delivered", "received", "completed"].includes(o.status) || o.delivery_status === "delivered") && (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {o.load_id && (
                          <RatingForm
                            key={`${o.id}-load`}
                            orderId={o.id}
                            reviewerMemberId={member.id}
                            targetType="load"
                            targetId={o.load_id}
                            title="امتیاز به بار خریداری‌شده"
                          />
                        )}
                        {o.seller_member_id && o.seller_member_id !== member.id && (
                          <RatingForm
                            key={`${o.id}-seller`}
                            orderId={o.id}
                            reviewerMemberId={member.id}
                            targetType="member"
                            targetId={o.seller_member_id}
                            title="امتیاز به فروشنده"
                          />
                        )}
                      </div>
                    )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
            <div className="flex items-center gap-2.5">
              <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
                <KeyRound className="size-5" />
              </span>
              <div>
                <h2 className="text-lg font-bold">تغییر کلمه عبور (رمز عبور)</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">در این بخش تغییر رمز با پیامک یا ایمیل انجام می‌شود.</p>
              </div>
            </div>
            <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-foreground">
              احراز هویت امن با کد یکبارمصرف
            </span>
          </div>

          <div className="mt-5 space-y-4">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setResetMethod("phone");
                  setOtpSent(false);
                  setResetError("");
                  setResetSuccess("");
                }}
                className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition sm:text-sm ${
                  resetMethod === "phone"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                <Phone className="size-4" />
                تغییر رمز با پیامک به شماره تماس
              </button>
              <button
                type="button"
                onClick={() => {
                  setResetMethod("email");
                  setOtpSent(false);
                  setResetError("");
                  setResetSuccess("");
                }}
                className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition sm:text-sm ${
                  resetMethod === "email"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                <Mail className="size-4" />
                تغییر رمز با ارسال کد به ایمیل
              </button>
            </div>

            {resetError && (
              <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-xs text-destructive">
                {resetError}
              </div>
            )}

            {resetSuccess && (
              <div
                role="status"
                className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-800 dark:text-emerald-300"
              >
                {resetSuccess}
              </div>
            )}

            {!otpSent ? (
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <div className="grid max-w-md gap-3">
                  <label className="text-xs font-semibold text-foreground">
                    {resetMethod === "phone" ? "شماره همراه ثبت‌شده جهت دریافت پیامک:" : "نشانی ایمیل ثبت‌شده جهت دریافت کد:"}
                  </label>
                  <input
                    type={resetMethod === "phone" ? "tel" : "email"}
                    dir="ltr"
                    value={resetMethod === "phone" ? user.phone || resetIdentifier : user.email || resetIdentifier}
                    onChange={(e) => setResetIdentifier(e.target.value)}
                    className="field-input font-mono text-left text-sm"
                    placeholder={resetMethod === "phone" ? "0912xxxxxxx" : "name@example.com"}
                  />
                  <p className="text-[11px] leading-5 text-muted-foreground">
                    پس از کلیک، کد ۶ رقمی امن به {resetMethod === "phone" ? "شماره موبایل شما پیامک" : "نشانی ایمیل شما ارسال"} خواهد شد.
                  </p>
                  <div>
                    <Button type="button" disabled={resetBusy} onClick={handleSendResetOtp} className="gap-2">
                      <Send className="size-4" />
                      {resetBusy ? "در حال ارسال کد…" : "ارسال کد تأیید یکبارمصرف"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <form onSubmit={handleResetPassword} className="rounded-xl border border-primary/20 bg-primary/5 p-4 sm:p-5">
                <div className="grid max-w-md gap-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>کد تأیید ۶ رقمی به {resetMethod === "phone" ? "موبایل" : "ایمیل"} شما ارسال شد:</span>
                    {timerSeconds > 0 ? (
                      <span className="font-mono font-bold text-primary">
                        ارسال مجدد: {Math.floor(timerSeconds / 60)}:{(timerSeconds % 60).toString().padStart(2, "0")}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleSendResetOtp}
                        disabled={resetBusy}
                        className="font-bold text-primary hover:underline"
                      >
                        ارسال مجدد کد
                      </button>
                    )}
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground">کد ۶ رقمی تأیید:</label>
                    <input
                      required
                      type="text"
                      dir="ltr"
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value)}
                      placeholder="123456"
                      className="field-input mt-1 font-mono text-center text-lg tracking-widest"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground">کلمه عبور جدید (حداقل ۶ نویسه):</label>
                    <input
                      required
                      type="password"
                      dir="ltr"
                      minLength={6}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="••••••••"
                      className="field-input mt-1 text-left text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground">تکرار کلمه عبور جدید:</label>
                    <input
                      required
                      type="password"
                      dir="ltr"
                      minLength={6}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      className="field-input mt-1 text-left text-sm"
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button type="submit" disabled={resetBusy} className="gap-2">
                      <Lock className="size-4" />
                      {resetBusy ? "در حال ذخیره در پایگاه داده…" : "تأیید و ذخیره رمز جدید"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setOtpSent(false);
                        setOtpCode("");
                      }}
                    >
                      تغییر شماره / ایمیل
                    </Button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
