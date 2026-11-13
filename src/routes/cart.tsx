/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Minus, Plus, ShoppingCart, Trash2, PackageCheck, Truck, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiDelete, apiGet, apiPost } from "@/lib/api-client";
import { useAuth } from "@/lib/auth";
import { faNumber, normalizeNumericInput, pageHead, type Load } from "@/lib/marketplace";

export const Route = createFileRoute("/cart")({
  head: () => pageHead("سبد خرید", "بررسی سبد خرید، اصلاح تعداد و ثبت سفارش در ترابار.", "/cart"),
  component: CartPage,
});

type CartItem = { load: Load; quantity: number; saleType: string; expiresAt?: number };
const CART_KEY = "terrabar-cart-items";
const CART_TTL_MS = 6 * 60 * 60 * 1000;

function readValidCart(): CartItem[] {
  try {
    const raw = window.localStorage.getItem(CART_KEY) ?? window.sessionStorage.getItem(CART_KEY) ?? "[]";
    const now = Date.now();
    const parsed = JSON.parse(raw) as CartItem[];
    const items = Array.isArray(parsed)
      ? parsed
          .map((item) => ({ ...item, expiresAt: Number(item.expiresAt) || now + CART_TTL_MS }))
          .filter((item) => item.expiresAt! > now)
      : [];
    window.localStorage.setItem(CART_KEY, JSON.stringify(items));
    window.sessionStorage.removeItem(CART_KEY);
    return items;
  } catch {
    return [];
  }
}

function priceFor(item: CartItem) {
  const option = item.load.saleOptions?.find((opt) => opt.saleType === item.saleType);
  const weight = item.quantity * item.load.weight;
  const match = option?.priceBreaks?.find(
    (br) => weight >= br.minQuantity && (br.maxQuantity == null || weight <= br.maxQuantity),
  );
  return Number(match?.price ?? option?.price ?? item.load.price);
}

function CartPage() {
  const { user, member } = useAuth();
  const [items, setItems] = useState<CartItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitted, setSubmitted] = useState<{ count: number; total: number; invoices: number[] } | null>(null);
  const [deliveryType, setDeliveryType] = useState<"pickup" | "terrabar">("pickup");
  const [deliveryAddress, setDeliveryAddress] = useState("");

  useEffect(() => {
    const read = () => {
      const valid = readValidCart();
      setItems((current) => (JSON.stringify(current) === JSON.stringify(valid) ? current : valid));
      setLoaded(true);
    };
    read();
    const expiryTimer = window.setInterval(() => {
      const valid = readValidCart();
      setItems((current) => (JSON.stringify(current) === JSON.stringify(valid) ? current : valid));
      window.dispatchEvent(new Event("terrabar-cart-updated"));
    }, 30_000);
    window.addEventListener("terrabar-cart-updated", read);
    window.addEventListener("storage", read);
    return () => {
      window.clearInterval(expiryTimer);
      window.removeEventListener("terrabar-cart-updated", read);
      window.removeEventListener("storage", read);
    };
  }, []);

  // Reconcile server-persisted 6h cart when user signs in and local cart is empty
  useEffect(() => {
    if (!user) return;
    let active = true;
    apiGet<{ success?: boolean; items?: any[] }>("/api/cart")
      .then(async ({ ok, data }) => {
        if (!active || !ok || !Array.isArray(data?.items) || data.items.length === 0) return;
        const localValid = readValidCart();
        if (localValid.length > 0) return;
        const loadDetails = await Promise.all(
          data.items.map((row) =>
            apiGet<{ success?: boolean; load?: any }>(`/api/loads/detail?id=${encodeURIComponent(row.load_id)}`)
              .then((res) => ({ row, detail: res.data?.load }))
              .catch(() => null),
          ),
        );
        if (!active) return;
        const hydrated: CartItem[] = [];
        for (const entry of loadDetails) {
          if (!entry?.detail) continue;
          const d = entry.detail;
          const weight = Number(d.package_weight) > 0 ? Number(d.package_weight) : 1;
          hydrated.push({
            load: {
              id: d.id,
              memberId: d.member_id || "",
              saleType: d.sale_type || "regular",
              saleOptions: Array.isArray(d.tiers) && d.tiers.length
                ? d.tiers.map((t: any) => ({
                    saleType: String(t.sale_type),
                    label: String(t.sale_type),
                    price: Number(t.unit_price),
                    minimum: Math.max(1, Number(t.minimum_packages || 1)),
                  }))
                : [{ saleType: d.sale_type || "regular", label: "قیمت پایه", price: Number(d.price) || 0, minimum: Math.max(1, Number(d.min_order_quantity || 1)) }],
              packageType: d.package_type || "کارتن",
              createdAt: d.created_at || "",
              product: d.product_type || d.name || "محصول",
              variety: d.engine || "",
              category: "میوه",
              quality: "استاندارد",
              city: d.city || "",
              province: d.origin || "",
              weight,
              stock: Number(d.count || 0),
              minimum: Math.max(1, Number(d.min_order_quantity || 1)),
              price: Number(d.price) || 0,
              ready: d.ready_date || "",
              validity: "طبق وضعیت بار",
              seller: d.member_name || "فروشنده ترابار",
              sellerType: d.seller_type || "فروشنده",
              image: "",
              isSample: false,
            },
            quantity: Number(entry.row.quantity) || 1,
            saleType: String(entry.row.sale_type || "regular"),
            expiresAt: entry.row.expires_at ? new Date(entry.row.expires_at).getTime() : Date.now() + CART_TTL_MS,
          });
        }
        if (hydrated.length) setItems(hydrated);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(CART_KEY, JSON.stringify(items));
      window.sessionStorage.removeItem(CART_KEY);
      window.dispatchEvent(new Event("terrabar-cart-updated"));
    } catch {
      // ignore storage errors
    }

    if (user) {
      if (items.length === 0) {
        void apiDelete("/api/cart").catch(() => {});
      } else {
        void apiPost("/api/cart", {
          items: items.map((item) => ({
            loadId: String(item.load.id),
            saleType: item.saleType,
            quantity: item.quantity,
            expiresAt: item.expiresAt,
          })),
        }).catch(() => {});
      }
    }
  }, [items, loaded, user?.id]);

  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity * item.load.weight * priceFor(item), 0),
    [items],
  );

  function changeQuantity(index: number, raw: string) {
    const value = Number(normalizeNumericInput(raw));
    if (!Number.isInteger(value) || value < 1) return;
    setItems((current) =>
      current.map((item, i) => {
        if (i !== index) return item;
        const minimum = item.load.saleOptions?.find((o) => o.saleType === item.saleType)?.minimum ?? item.load.minimum;
        return { ...item, quantity: Math.min(item.load.stock, Math.max(minimum, value)) };
      }),
    );
    setError("");
    setNotice("");
  }

  async function submitOrder() {
    setError("");
    setNotice("");
    const validItems = readValidCart();
    if (!validItems.length) {
      setItems([]);
      setError("سبد خرید خالی است یا مهلت شش‌ساعته کالاها تمام شده است.");
      return;
    }
    if (deliveryType === "terrabar" && !deliveryAddress.trim()) {
      setError("برای ارسال، نشانی دقیق محل تحویل را وارد کنید.");
      return;
    }
    if (!user) {
      setError("برای ثبت سفارش ابتدا وارد حساب خود شوید.");
      return;
    }
    if (validItems.some((item) => !item.load.memberId)) {
      setError("برای یکی از کالاها شناسه فروشنده ثبت نشده است؛ سفارش ارسال نشد.");
      return;
    }

    setBusy(true);
    try {
      const orderTotal = validItems.reduce(
        (sum, item) => sum + item.quantity * item.load.weight * priceFor(item),
        0,
      );
      const createdInvoices: number[] = [];
      const batchNonce = Date.now().toString(36);

      for (const [idx, item] of validItems.entries()) {
        const unitPrice = priceFor(item);
        const lineTotal = item.quantity * item.load.weight * unitPrice;
        const { ok, data } = await apiPost<any>("/api/orders/sync", {
          idempotency_key: `cart_${user.id}_${item.load.id}_${item.saleType}_${batchNonce}_${idx}`,
          load_id: item.load.id,
          seller_member_id: item.load.memberId,
          customer_name: member?.full_name || user.full_name || "خریدار ترابار",
          customer_phone: member?.phone || user.phone || "",
          customer_email: member?.email || user.email || "",
          customer_city: member?.city || user.city || "",
          quantity: item.quantity,
          unit: "package",
          price: unitPrice,
          total_price: lineTotal,
          sale_type: item.saleType,
          delivery_type: deliveryType,
          delivery_address: deliveryType === "pickup" ? null : deliveryAddress.trim(),
          status: "pending",
          payment_status: "unpaid",
          notes:
            deliveryType === "terrabar"
              ? "ثبت از سبد خرید با هماهنگی ارسال و باربری"
              : "ثبت از سبد خرید ترابار با تحویل حضوری؛ در انتظار تأیید فروشنده",
        });
        if (!ok || !data?.success) {
          setError(data?.message || "ثبت یکی از اقلام سفارش با خطا مواجه شد.");
          setBusy(false);
          return;
        }
        if (data?.order?.invoice_number) {
          createdInvoices.push(Number(data.order.invoice_number));
        }
      }

      setSubmitted({ count: validItems.length, total: orderTotal, invoices: createdInvoices });
      setItems([]);
      setNotice("سفارش‌ها با شماره فاکتور یکتا ثبت شدند و برای فروشندگان ارسال گردیدند.");
    } catch {
      setError("خطا در ارتباط با سرور هنگام ثبت سفارش.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="site-container max-w-4xl py-6 sm:py-10">
      <Link to="/requests" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
        <ArrowRight className="size-4" />
        بازگشت به ادامه خرید
      </Link>
      <div className="mt-5 flex items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-black">سبد خرید</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            هر کالا تا ۶ ساعت پس از افزودن در سبد می‌ماند؛ اگر تا پایان مهلت سفارش ثبت نشود، خودکار از سبد حذف می‌شود.
          </p>
        </div>
        <ShoppingCart className="size-7 text-primary" />
      </div>

      {submitted && (
        <div role="status" className="mt-5 rounded-xl border border-primary/30 bg-accent/40 p-4">
          <CheckCircle2 className="ml-2 inline size-5 text-primary" />
          <strong>سفارش ثبت شد</strong>
          <p className="mt-2 text-sm">
            {faNumber(submitted.count)} قلم کالا · {faNumber(submitted.total)} تومان
            {submitted.invoices.length > 0 && (
              <> · شماره فاکتور: {submitted.invoices.map((n) => `#${faNumber(n)}`).join("، ")}</>
            )}
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            سفارش در انتظار تأیید فروشنده است. از بخش پیگیری سفارش‌ها می‌توانید وضعیت و مراحل ارسال را دنبال کنید.
          </p>
          <Button asChild size="sm" variant="outline" className="mt-3">
            <Link to="/orders">مشاهده و پیگیری سفارش‌ها</Link>
          </Button>
        </div>
      )}

      {!loaded ? (
        <p className="py-10 text-center text-muted-foreground">در حال بارگذاری سبد خرید…</p>
      ) : items.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-border p-8 text-center">
          <ShoppingCart className="mx-auto size-10 text-muted-foreground" />
          <h2 className="mt-3 text-lg font-bold">سبد خرید خالی است</h2>
          <p className="mt-2 text-sm text-muted-foreground">برای افزودن کالا به بازار برگردید.</p>
          <Link to="/requests" className="mt-5 inline-flex">
            <Button>ادامه خرید</Button>
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-5 space-y-3">
            {items.map((item, index) => {
              const unitPrice = priceFor(item);
              const lineTotal = item.quantity * item.load.weight * unitPrice;
              return (
                <article key={String(item.load.id) + "-" + item.saleType} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-extrabold">
                        {item.load.product} {item.load.variety}
                      </h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.load.quality} · {item.load.city} ·{" "}
                        {item.load.saleOptions?.find((o) => o.saleType === item.saleType)?.label ?? item.saleType}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label="حذف کالا از سبد"
                      onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <div>
                      <span className="block text-xs text-muted-foreground">قیمت هر کیلو</span>
                      <strong>{faNumber(unitPrice)} تومان</strong>
                    </div>
                    <div>
                      <span className="block text-xs text-muted-foreground">وزن بسته</span>
                      <strong>{faNumber(item.load.weight)} کیلو</strong>
                    </div>
                    <div>
                      <span className="block text-xs text-muted-foreground">وزن کل</span>
                      <strong>{faNumber(item.quantity * item.load.weight)} کیلو</strong>
                    </div>
                    <div>
                      <span className="block text-xs text-muted-foreground">مبلغ کل</span>
                      <strong className="text-primary">{faNumber(lineTotal)} تومان</strong>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
                    <span className="text-sm font-semibold">تعداد بسته</span>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="size-8"
                        aria-label="کاهش تعداد"
                        disabled={
                          item.quantity <=
                          (item.load.saleOptions?.find((o) => o.saleType === item.saleType)?.minimum ??
                            item.load.minimum)
                        }
                        onClick={() => changeQuantity(index, String(item.quantity - 1))}
                      >
                        <Minus className="size-3.5" />
                      </Button>
                      <input
                        aria-label="تعداد بسته"
                        inputMode="numeric"
                        className="field-input h-8 w-16 px-1 text-center"
                        value={String(item.quantity)}
                        onChange={(e) => changeQuantity(index, e.target.value)}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="size-8"
                        aria-label="افزایش تعداد"
                        disabled={item.quantity >= item.load.stock}
                        onClick={() => changeQuantity(index, String(item.quantity + 1))}
                      >
                        <Plus className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <section aria-labelledby="delivery-title" className="mt-5 rounded-xl border border-border bg-card p-4">
            <h2 id="delivery-title" className="font-bold">
              روش تحویل
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                aria-pressed={deliveryType === "pickup"}
                onClick={() => {
                  setDeliveryType("pickup");
                  setError("");
                }}
                className={`rounded-lg border p-3 text-right transition-colors ${
                  deliveryType === "pickup" ? "border-primary bg-accent" : "border-border"
                }`}
              >
                <span className="flex items-center gap-2 font-semibold">
                  <MapPin className="size-4 text-primary" />
                  تحویل حضوری
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  بدون هزینه ارسال؛ دریافت مستقیم از محل بارگیری یا حجره
                </span>
              </button>
              <button
                type="button"
                aria-pressed={deliveryType === "terrabar"}
                onClick={() => {
                  setDeliveryType("terrabar");
                  setError("");
                }}
                className={`rounded-lg border p-3 text-right transition-colors ${
                  deliveryType === "terrabar" ? "border-primary bg-accent" : "border-border"
                }`}
              >
                <span className="flex items-center gap-2 font-semibold">
                  <Truck className="size-4 text-primary" />
                  هماهنگی ارسال / حمل‌ونقل
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  ارسال به نشانی مقصد با هماهنگی ناوگان پس از تأیید فروشنده
                </span>
              </button>
            </div>
            {deliveryType === "terrabar" && (
              <div className="mt-3 space-y-2">
                <label className="block text-sm font-medium" htmlFor="delivery-address">
                  نشانی دقیق تحویل <span className="text-destructive">*</span>
                </label>
                <textarea
                  id="delivery-address"
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                  rows={2}
                  maxLength={1000}
                  placeholder="استان، شهر، نشانی کامل و شماره هماهنگی تحویل‌گیرنده"
                  className="field-input w-full resize-y"
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  کرایه حمل بر اساس توافق ناوگان و مسافت هنگام هماهنگی ارسال محاسبه می‌شود.
                </p>
              </div>
            )}
          </section>

          <div className="mt-3 rounded-xl border border-primary/30 bg-card p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">جمع کالاها</span>
              <strong className="text-xl font-black text-primary">{faNumber(total)} تومان</strong>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {deliveryType === "pickup" ? "هزینه تحویل حضوری: ۰ تومان" : "هزینه حمل‌ونقل بر عهده خریدار و طبق توافق باربری"}
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setItems([]);
                  setError("");
                  setNotice("سبد خرید خالی شد.");
                }}
              >
                خالی کردن سبد
              </Button>
              <Button type="button" disabled={busy || !items.length} onClick={() => void submitOrder()}>
                {busy ? "در حال ثبت سفارش…" : "ثبت نهایی سفارش"}
                <PackageCheck className="mr-2 size-4" />
              </Button>
            </div>
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {error}{" "}
          {error.includes("وارد حساب") && (
            <Link to="/auth" className="font-bold underline">
              ورود / ثبت‌نام
            </Link>
          )}
        </p>
      )}
      {notice && !submitted && (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          {notice}
        </p>
      )}
    </div>
  );
}
