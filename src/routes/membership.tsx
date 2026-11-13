import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Clock3, Send, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiGet, apiPost } from "@/lib/api-client";
import { useAuth, type AppRole } from "@/lib/auth";
import { pageHead, provinces, provinceCities } from "@/lib/marketplace";
import { CityPicker } from "@/components/city-picker";

export const Route = createFileRoute("/membership")({
  head: () =>
    pageHead(
      "درخواست عضویت",
      "درخواست عضویت به‌عنوان خریدار، خریدار ویژه، تأمین‌کننده یا بارفروش در ترابار؛ پس از تأیید مدیر فعال می‌شود.",
    ),
  component: MembershipPage,
});

const roleLabels: Record<string, string> = {
  admin: "مدیر",
  city_manager: "مدیر شهری",
  supplier: "تأمین‌کننده (باغدار، کشاورز، سورتینگ)",
  seller: "بارفروش / حجره‌دار میدان",
  bar_seller: "بارفروش / حجره‌دار میدان",
  special_buyer: "خریدار ویژه (دسترسی به خرید حرفه‌ای و شهرهای همجوار)",
  buyer: "خریدار",
};
const statusLabels: Record<string, string> = {
  pending: "در انتظار بررسی مدیر",
  approved: "تأیید شده",
  rejected: "رد شده",
};

type RequestRow = {
  id: string;
  role_code: string;
  approval_status: string;
  created_at: string;
  request_note?: string | null;
};

const roleToCode: Partial<Record<AppRole, string>> = {
  supplier: "supplier",
  seller: "bar_seller",
  special_buyer: "special_buyer",
  buyer: "buyer",
};
const roleFromCode = (code: string): string => (code === "bar_seller" ? "seller" : code);

function MembershipPage() {
  const { user, member, loading } = useAuth();
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [role, setRole] = useState<AppRole>("supplier");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [province, setProvince] = useState("البرز");
  const [city, setCity] = useState("کرج");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [resubmitNotes, setResubmitNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (user) {
      setFullName((prev) => prev || member?.full_name || user.full_name || "");
      setPhone((prev) => prev || member?.phone || user.phone || "");
      if (member?.province || user.province) setProvince(member?.province || user.province || "البرز");
      if (member?.city || user.city) setCity(member?.city || user.city || "کرج");
    }
  }, [user, member]);

  function refresh() {
    if (!user) return;
    apiGet<{ success?: boolean; requests?: RequestRow[] }>("/api/membership/my-requests")
      .then(({ data }) => {
        if (Array.isArray(data?.requests)) {
          setRequests(data.requests);
        }
      })
      .catch(() => {
        // Keep current state if transient error
      });
  }

  useEffect(refresh, [user?.id]);

  async function resubmitRole(request: RequestRow) {
    if (!user || request.approval_status !== "rejected") return;
    const note = (resubmitNotes[request.id] ?? "").trim();
    if (!note) {
      setError("برای درخواست مجدد، لطفاً یک توضیح کوتاه بنویسید.");
      return;
    }
    if (note.length > 500) {
      setError("متن توضیح حداکثر ۵۰۰ نویسه باشد.");
      return;
    }
    setBusy(true);
    setError("");

    try {
      const { ok, data } = await apiPost<{ success?: boolean; message?: string }>(
        "/api/membership/submit-request",
        {
          role: request.role_code,
          description: note,
        },
      );
      if (!ok || !data?.success) {
        setError(data?.message || "ارسال مجدد انجام نشد. لطفاً دوباره تلاش کنید.");
      } else {
        setResubmitNotes((current) => ({ ...current, [request.id]: "" }));
        refresh();
      }
    } catch {
      setError("خطا در برقراری ارتباط با سرور.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    if (!province.trim() || !city.trim()) {
      setError("استان و شهر محل فعالیت را انتخاب کنید.");
      return;
    }
    setBusy(true);
    setError("");

    const requestedRoleCode = roleToCode[role] ?? role;

    try {
      const { ok, data } = await apiPost<{ success?: boolean; message?: string }>(
        "/api/membership/submit-request",
        {
          role: requestedRoleCode,
          fullName: fullName.trim(),
          phone: phone.trim(),
          province,
          city,
          description: description.trim(),
        },
      );

      if (ok && data?.success) {
        setSaved(true);
        refresh();
      } else {
        setError(data?.message || "ثبت درخواست عضویت انجام نشد؛ دوباره تلاش کنید.");
      }
    } catch {
      setError("خطا در ثبت درخواست در پایگاه داده؛ دوباره تلاش نمایید.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <section className="py-16 text-center text-sm text-muted-foreground">در حال بارگذاری…</section>;
  }

  if (!user) {
    return (
      <section className="bg-market-surface py-16">
        <div className="site-container max-w-md text-center">
          <h1 className="text-2xl font-extrabold">ابتدا وارد حساب شوید</h1>
          <p className="mt-3 text-sm text-muted-foreground">برای ثبت درخواست عضویت، ورود یا ثبت‌نام لازم است.</p>
          <Button asChild className="mt-6">
            <Link to="/auth">ورود / ثبت‌نام</Link>
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-market-surface py-12">
      <div className="site-container grid gap-8 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-6 sm:p-8">
          <h1 className="text-2xl font-extrabold">درخواست عضویت</h1>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">
            نقش خود را انتخاب کنید؛ درخواست شما برای مدیر ارسال می‌شود و پس از تأیید، امکان‌های آن نقش (مانند اعلام بار یا خرید ویژه) برایتان فعال می‌شود.
          </p>
          {saved ? (
            <div className="mt-6 text-center">
              <CheckCircle2 className="mx-auto mb-3 size-10 text-primary" />
              <p className="font-bold">درخواست شما ثبت شد</p>
              <p className="mt-2 text-sm text-muted-foreground">نتیجه بررسی مدیر در همین صفحه نمایش داده می‌شود.</p>
              <Button type="button" variant="outline" className="mt-4" onClick={() => setSaved(false)}>
                ثبت درخواست نقش دیگر
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-6 grid gap-4">
              <label className="field-label">
                نقش درخواستی
                <select className="field-input" value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
                  <option value="supplier">{roleLabels.supplier}</option>
                  <option value="seller">{roleLabels.seller}</option>
                  <option value="special_buyer">{roleLabels.special_buyer}</option>
                  <option value="buyer">{roleLabels.buyer}</option>
                </select>
              </label>
              <label className="field-label">
                نام و نام خانوادگی
                <input required value={fullName} onChange={(e) => setFullName(e.target.value)} className="field-input" />
              </label>
              <label className="field-label">
                شماره تماس
                <input
                  required
                  dir="ltr"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="field-input text-left"
                  placeholder="09…"
                />
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="field-label">
                  <label htmlFor="membership-province">استان محل فعالیت</label>
                  <CityPicker
                    value={province}
                    onChange={(value) => {
                      setProvince(value);
                      setCity("");
                    }}
                    id="membership-province"
                    options={provinces}
                    placeholder="جست‌وجوی استان…"
                  />
                </div>
                <div className="field-label">
                  <label htmlFor="membership-city">شهر محل فعالیت</label>
                  <CityPicker
                    value={city}
                    onChange={setCity}
                    id="membership-city"
                    options={provinceCities[province] ?? []}
                    disabled={!province}
                    placeholder={province ? "جست‌وجو و انتخاب شهر همین استان…" : "ابتدا استان را انتخاب کنید…"}
                  />
                </div>
              </div>
              <label className="field-label">
                توضیحات (اختیاری)
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="field-input min-h-20 resize-y"
                  placeholder="نوع فعالیت، محصولات، سابقه…"
                />
              </label>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={busy}>
                <Send />
                {busy ? "در حال ارسال…" : "ارسال درخواست به مدیر"}
              </Button>
            </form>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card p-6 sm:p-8">
          <h2 className="text-lg font-bold">درخواست‌های من</h2>
          {requests.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">هنوز درخواستی ثبت نکرده‌اید.</p>
          ) : (
            <ul className="mt-4 grid gap-3">
              {requests.map((request) => (
                <li key={request.id} className="rounded-lg border border-border p-4 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <strong>{roleLabels[roleFromCode(request.role_code)] ?? request.role_code}</strong>
                    <span
                      className={`flex items-center gap-1 text-xs ${
                        request.approval_status === "approved"
                          ? "text-primary"
                          : request.approval_status === "rejected"
                            ? "text-destructive"
                            : "text-muted-foreground"
                      }`}
                    >
                      {request.approval_status === "approved" ? (
                        <CheckCircle2 className="size-4" />
                      ) : request.approval_status === "rejected" ? (
                        <XCircle className="size-4" />
                      ) : (
                        <Clock3 className="size-4" />
                      )}
                      {statusLabels[request.approval_status] || request.approval_status}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    تاریخ درخواست: {new Date(request.created_at).toLocaleDateString("fa-IR")}
                  </p>
                  {request.request_note && (
                    <p className="mt-2 rounded bg-muted p-2 text-sm">توضیح ثبت‌شده: {request.request_note}</p>
                  )}
                  {request.approval_status === "rejected" && (
                    <div className="mt-3 grid gap-2">
                      <label className="field-label">
                        توضیح کوتاه برای درخواست مجدد
                        <textarea
                          value={resubmitNotes[request.id] ?? ""}
                          onChange={(e) =>
                            setResubmitNotes((current) => ({ ...current, [request.id]: e.target.value }))
                          }
                          maxLength={500}
                          className="field-input min-h-20 resize-y"
                          placeholder="مثلاً: اطلاعات فعالیت خود را تکمیل کرده‌ام؛ لطفاً درخواست را دوباره بررسی کنید."
                        />
                      </label>
                      <Button type="button" disabled={busy} onClick={() => resubmitRole(request)}>
                        <Send className="size-4" />
                        {busy ? "در حال ارسال…" : "ارسال درخواست مجدد"}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
