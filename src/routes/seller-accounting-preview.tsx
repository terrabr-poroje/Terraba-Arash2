/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRightLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  Landmark,
  LoaderCircle,
  Send,
  Wallet,
} from "lucide-react";
import { apiGet, apiPost } from "@/lib/api-client";
import { useAuth } from "@/lib/auth";
import { normalizeNumericInput, pageHead } from "@/lib/marketplace";

export const Route = createFileRoute("/seller-accounting-preview")({
  head: () => pageHead("امور مالی و گردش حساب | ترابار", "مشاهده گردش مالی، ۵٪ کمیسیون، ثبت شبا و درخواست تسویه در ترابار."),
  component: SellerAccountingPage,
});

const money = (v: number) =>
  new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(Math.round(v)) + " تومان";
const fmtDate = (v: string) =>
  new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" }).format(new Date(v));
const cleanIban = (v: string) => v.replace(/[\s-]/g, "").toUpperCase();

function SellerAccountingPage() {
  const { user, loading } = useAuth();
  const [memberId, setMemberId] = useState("");
  const [bank, setBank] = useState<any>(null);
  const [bankName, setBankName] = useState("");
  const [holder, setHolder] = useState("");
  const [iban, setIban] = useState("");
  const [orders, setOrders] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [salesTotal, setSalesTotal] = useState(0);
  const [commissionTotal, setCommissionTotal] = useState(0);
  const [netSalesTotal, setNetSalesTotal] = useState(0);
  const [settledPayoutsTotal, setSettledPayoutsTotal] = useState(0);
  const [pendingPayoutsTotal, setPendingPayoutsTotal] = useState(0);
  const [availableBalance, setAvailableBalance] = useState(0);
  const [payoutAmount, setPayoutAmount] = useState("");
  const [payoutDesc, setPayoutDesc] = useState("");
  const [requestingPayout, setRequestingPayout] = useState(false);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  async function loadSummary() {
    if (!user) {
      setBusy(false);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { ok, data } = await apiGet<any>("/api/finance/summary");
      if (!ok || !data?.success) {
        setError(data?.message || "دریافت اطلاعات مالی انجام نشد.");
        setBusy(false);
        return;
      }
      setMemberId(String(data.member?.id || ""));
      if (data.bankAccount) {
        setBank(data.bankAccount);
        setBankName(data.bankAccount.bank_name || "");
        setHolder(data.bankAccount.account_holder_name || "");
        setIban(data.bankAccount.iban || "");
      }
      setOrders(Array.isArray(data.orders) ? data.orders : []);
      setTransactions(Array.isArray(data.transactions) ? data.transactions : []);
      setSalesTotal(Number(data.salesTotal || 0));
      setCommissionTotal(Number(data.commissionTotal || 0));
      setNetSalesTotal(Number(data.netSalesTotal || 0));
      setSettledPayoutsTotal(Number(data.settledPayoutsTotal || 0));
      setPendingPayoutsTotal(Number(data.pendingPayoutsTotal || 0));
      setAvailableBalance(Number(data.availableBalance || 0));
    } catch {
      setError("خطا در برقراری ارتباط با سرور مالی.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!loading) void loadSummary();
  }, [user?.id, loading]);

  const entries = useMemo(() => {
    return [
      ...orders.map((o) => ({
        id: String(o.id),
        date: String(o.created_at),
        title:
          "فاکتور شماره " +
          new Intl.NumberFormat("fa-IR").format(o.invoice_number) +
          (o.seller_member_id === memberId ? " · فروش" : " · خرید"),
        detail: "وضعیت: " + (o.delivery_status || o.status || "ثبت‌شده"),
        amount:
          (o.buyer_member_id === memberId && o.seller_member_id !== memberId ? -1 : 1) *
          Number(o.total_price ?? 0),
        status: "پرداخت: " + (o.payment_status === "paid" ? "پرداخت‌شده" : o.payment_status === "unpaid" ? "پرداخت‌نشده" : o.payment_status || "نامشخص"),
      })),
      ...transactions.map((t) => {
        const type = String(t.transaction_type || "");
        const payoutSt = String(t.payout_status || "");
        const isPayout = type === "payout" || type === "payout_request";
        const isCommission = type === "commission";
        return {
          id: String(t.id),
          date: String(t.transaction_date || t.created_at || new Date().toISOString()),
          title:
            type === "sale_credit" || type === "receipt"
              ? "اعتبار فروش خالص (۹۵٪ پس از کسر کمیسیون)"
              : isCommission
                ? "کارمزد ترابار (۵٪)"
                : isPayout
                  ? "درخواست / واریز تسویه بانکی"
                  : "تراکنش مالی",
          detail:
            String(t.description ?? "") +
            (t.reference_code ? " · شناسه پیگیری: " + t.reference_code : ""),
          amount: isCommission || isPayout ? -Math.abs(Number(t.amount ?? 0)) : Number(t.amount ?? 0),
          status: isPayout
            ? (["settled", "paid", "success"].includes(payoutSt)
                ? "واریز انجام‌شده"
                : payoutSt === "failed"
                  ? "ناموفق"
                  : payoutSt === "cancelled"
                    ? "لغوشده"
                    : "در انتظار پرداخت") + (t.processed_at ? " · " + fmtDate(t.processed_at) : "")
            : "ثبت‌شده در دفتر",
        };
      }),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [orders, transactions, memberId]);

  const filtered = entries.filter(
    (e) => (!from || e.date.slice(0, 10) >= from) && (!to || e.date.slice(0, 10) <= to),
  );

  async function saveBank(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    const normalized = cleanIban(iban);
    if (!/^IR\d{24}$/.test(normalized)) {
      setError("شماره شبا باید با IR شروع شود و پس از آن ۲۴ رقم داشته باشد.");
      return;
    }
    if (!bankName.trim() || !holder.trim()) {
      setError("نام بانک و صاحب حساب الزامی است.");
      return;
    }
    setSaving(true);
    try {
      const { ok, data } = await apiPost<any>("/api/finance/bank-account", {
        bankName: bankName.trim(),
        accountHolderName: holder.trim(),
        iban: normalized,
      });
      if (!ok || !data?.success) {
        setError(data?.message || "ذخیره اطلاعات بانکی انجام نشد.");
        return;
      }
      setBank(data.bankAccount);
      setNotice(data.message || "اطلاعات بانکی ذخیره شد و در انتظار تأیید مدیر است.");
    } catch {
      setError("خطا در ثبت اطلاعات بانکی.");
    } finally {
      setSaving(false);
    }
  }

  async function submitPayoutRequest(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    const amountNum = Number(normalizeNumericInput(payoutAmount));
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError("مبلغ درخواستی برای تسویه باید بزرگ‌تر از صفر باشد.");
      return;
    }
    setRequestingPayout(true);
    try {
      const { ok, data } = await apiPost<any>("/api/finance/request-payout", {
        amount: amountNum,
        description: payoutDesc.trim() || undefined,
      });
      if (!ok || !data?.success) {
        setError(data?.message || "ثبت درخواست تسویه انجام نشد.");
        return;
      }
      setNotice(data.message || "درخواست تسویه حساب ثبت شد و در صف پرداخت مدیر قرار گرفت.");
      setPayoutAmount("");
      setPayoutDesc("");
      await loadSummary();
    } catch {
      setError("خطا در ارسال درخواست تسویه.");
    } finally {
      setRequestingPayout(false);
    }
  }

  if (loading || busy) {
    return (
      <main dir="rtl" className="mx-auto max-w-3xl p-8 text-center">
        <LoaderCircle className="mx-auto mb-3 size-7 animate-spin" />
        در حال دریافت اطلاعات مالی…
      </main>
    );
  }

  if (!user) {
    return (
      <main dir="rtl" className="mx-auto max-w-3xl p-6">
        <Link to="/auth" className="inline-flex items-center gap-2 text-primary">
          <ArrowLeft className="size-4" /> ورود به ترابار
        </Link>
        <p className="mt-4 rounded-xl border bg-card p-5">برای مشاهده صورت‌حساب ابتدا وارد شوید.</p>
      </main>
    );
  }

  return (
    <main dir="rtl" className="min-h-[70vh] bg-market-surface px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-3xl">
        <Link to="/account" className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-primary">
          <ArrowLeft className="size-4" /> بازگشت به حساب کاربری
        </Link>
        <header className="mb-6 rounded-3xl bg-emerald-950 px-5 py-7 text-white shadow-lg sm:px-8">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold">
            <Wallet className="size-4" /> TERRABAR | ترابار
          </span>
          <h1 className="mt-3 text-2xl font-black">امور مالی و گردش حساب اعضا</h1>
          <p className="mt-2 text-sm leading-7 text-emerald-50/90">
            صورت‌حساب خرید و فروش، کسر ۵٪ کارمزد سامانه، ثبت شماره شبا و درخواست تسویه حساب.
          </p>
        </header>

        {error && (
          <p role="alert" className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
            {notice}
          </p>
        )}

        <section className="mb-6 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-extrabold">
            <Landmark className="size-5" /> ۱. اطلاعات حساب بانکی (شماره شبا)
          </h2>
          <form onSubmit={saveBank} className="space-y-4">
            <label className="block space-y-2 text-sm font-semibold">
              نام بانک
              <input
                className="w-full rounded-lg border border-input bg-background px-3 py-3 font-normal"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="مثلاً بانک ملت"
                maxLength={100}
                required
              />
            </label>
            <label className="block space-y-2 text-sm font-semibold">
              نام و نام خانوادگی صاحب حساب
              <input
                className="w-full rounded-lg border border-input bg-background px-3 py-3 font-normal"
                value={holder}
                onChange={(e) => setHolder(e.target.value)}
                placeholder="مطابق نام صاحب حساب"
                maxLength={160}
                required
              />
            </label>
            <label className="block space-y-2 text-sm font-semibold">
              شماره شبا
              <input
                className="w-full rounded-lg border border-input bg-background px-3 py-3 font-normal"
                dir="ltr"
                value={iban}
                onChange={(e) => setIban(e.target.value.toUpperCase())}
                placeholder="IR000000000000000000000000"
                autoComplete="off"
                maxLength={29}
                required
              />
              <span className="block text-xs font-normal leading-5 text-muted-foreground">
                شماره شبا با IR و ۲۴ رقم وارد شود.
              </span>
            </label>
            {bank && (
              <p className="flex items-center gap-2 rounded-lg bg-muted p-3 text-sm">
                {bank.verification_status === "verified" ? (
                  <CheckCircle2 className="size-4 text-emerald-600" />
                ) : (
                  <Clock3 className="size-4" />
                )}
                وضعیت:{" "}
                {bank.verification_status === "verified"
                  ? "تأییدشده"
                  : bank.verification_status === "rejected"
                    ? "ردشده"
                    : "در انتظار بررسی مدیر"}
              </p>
            )}
            <button
              disabled={saving}
              className="w-full rounded-xl bg-primary px-4 py-3 font-bold text-primary-foreground disabled:opacity-50"
            >
              {saving ? "در حال ذخیره…" : "ذخیره اطلاعات بانکی"}
            </button>
          </form>
        </section>

        <section className="mb-6 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-extrabold">
            <ArrowRightLeft className="size-5" /> ۲. گردش حساب و درخواست تسویه
          </h2>
          <div className="mb-4 rounded-2xl bg-emerald-950 p-5 text-white">
            <p className="text-sm text-emerald-100">جمع فروش پرداخت‌شده</p>
            <p className="mt-2 text-3xl font-black">{money(salesTotal)}</p>
            <p className="mt-2 text-xs leading-5 text-emerald-100">مجموع ناخالص سفارش‌های پرداخت‌شده و تأییدشده.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
              <p className="text-sm">کارمزد ترابار (۵٪)</p>
              <p className="mt-2 text-xl font-extrabold">{money(commissionTotal)}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
              <p className="text-sm">سهم خالص فروشنده (۹۵٪)</p>
              <p className="mt-2 text-xl font-extrabold">{money(netSalesTotal)}</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
              <p className="text-sm">مانده قابل تسویه (بستانکاری شما)</p>
              <p className="mt-2 text-xl font-extrabold">{money(availableBalance)}</p>
              {pendingPayoutsTotal > 0 && (
                <p className="mt-1 text-xs">درخواست‌های تسویه در انتظار: {money(pendingPayoutsTotal)}</p>
              )}
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
              <p className="text-sm">تسویه‌های واریزشده به حساب</p>
              <p className="mt-2 text-xl font-extrabold">{money(settledPayoutsTotal)}</p>
            </div>
          </div>

          <form onSubmit={submitPayoutRequest} className="mt-5 rounded-xl border border-border bg-muted/30 p-4 space-y-3">
            <h3 className="font-bold text-sm">ثبت درخواست تسویه حساب</h3>
            {!bank || bank.verification_status !== "verified" ? (
              <p className="text-xs leading-6 text-muted-foreground">
                برای ثبت درخواست تسویه حساب، ابتدا باید شماره شبای شما توسط مدیر کل تأیید شود.
              </p>
            ) : availableBalance <= 0 ? (
              <p className="text-xs leading-6 text-muted-foreground">
                در حال حاضر مانده قابل تسویه شما صفر است. با پرداخت سفارش‌ها، موجودی بلافاصله محاسبه می‌شود.
              </p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-semibold">
                    مبلغ درخواستی (تومان)
                    <input
                      type="text"
                      inputMode="numeric"
                      dir="ltr"
                      className="field-input mt-1 text-left"
                      value={payoutAmount}
                      onChange={(e) => setPayoutAmount(normalizeNumericInput(e.target.value))}
                      placeholder={String(availableBalance)}
                      required
                    />
                  </label>
                  <label className="text-xs font-semibold">
                    توضیح (اختیاری)
                    <input
                      type="text"
                      className="field-input mt-1"
                      value={payoutDesc}
                      onChange={(e) => setPayoutDesc(e.target.value)}
                      placeholder="مثلاً تسویه فروش هفته جاری"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPayoutAmount(String(availableBalance))}
                    className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold"
                  >
                    انتخاب کل مانده ({money(availableBalance)})
                  </button>
                  <button
                    type="submit"
                    disabled={requestingPayout}
                    className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50"
                  >
                    <Send className="size-3.5" />
                    {requestingPayout ? "در حال ثبت درخواست…" : "ارسال درخواست تسویه"}
                  </button>
                </div>
              </>
            )}
          </form>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-extrabold">
            <FileText className="size-5" /> ۳. صورت‌حساب و سوابق مالی
          </h2>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-2 text-sm">
              از تاریخ
              <input
                className="w-full rounded-lg border border-input bg-background px-3 py-2"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="space-y-2 text-sm">
              تا تاریخ
              <input
                className="w-full rounded-lg border border-input bg-background px-3 py-2"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>
          <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarDays className="size-4" /> {filtered.length.toLocaleString("fa-IR")} مورد
          </p>
          {filtered.length === 0 ? (
            <p className="rounded-xl bg-muted/50 p-5 text-center text-sm leading-6 text-muted-foreground">
              هنوز سفارشی یا تراکنشی برای این حساب ثبت نشده است.
            </p>
          ) : (
            <div className="space-y-3">
              {filtered.map((e) => (
                <article key={e.id + e.title} className="rounded-xl border border-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-bold">{e.title}</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {fmtDate(e.date)} · {e.detail}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{e.status}</p>
                    </div>
                    <p
                      className={`shrink-0 font-extrabold tabular-nums ${
                        e.amount < 0 ? "text-destructive" : "text-emerald-700"
                      }`}
                    >
                      {e.amount < 0 ? "−" : "+"}
                      {money(Math.abs(e.amount))}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
