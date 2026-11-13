/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Check, MapPin, Package, Store, Truck, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { faNumber, normalizeNumericInput, type Load } from "@/lib/marketplace";
import { RatingSummary } from "@/components/rating-summary";
import { apiGet, apiPost } from "@/lib/api-client";
import { useAuth } from "@/lib/auth";

export function LoadCard({
  load,
  onAddToCart,
  purchaseMode = "retail",
  cartSelected = false,
}: {
  load: Load;
  onAddToCart?: (load: Load, quantity: number, saleType: string) => void;
  purchaseMode?: string;
  cartSelected?: boolean;
}) {
  const { user, member } = useAuth();
  const [dialog, setDialog] = useState<"order" | "seller" | null>(null);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [justAdded, setJustAdded] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadPhotos() {
      if (load.isSample) return;
      const preloaded = (load as any).images;
      if (Array.isArray(preloaded) && preloaded.length > 0) {
        setPhotoUrls(
          preloaded
            .map((img: any) =>
              String(img?.storage_path || img || "").startsWith("/api/") ||
              String(img?.storage_path || img || "").startsWith("http")
                ? String(img?.storage_path || img)
                : `/api/storage/file/${img?.storage_path || img}`,
            )
            .filter(Boolean),
        );
        return;
      }
      try {
        const { ok, data } = await apiGet<{ load?: { images?: any[] } }>(
          `/api/loads/detail?id=${encodeURIComponent(String(load.id))}`,
        );
        if (!active || !ok || !data?.load?.images?.length) return;
        setPhotoUrls(
          data.load.images
            .map((item: any) =>
              String(item.storage_path || "").startsWith("/api/") ||
              String(item.storage_path || "").startsWith("http")
                ? item.storage_path
                : `/api/storage/file/${item.storage_path}`,
            )
            .filter(Boolean),
        );
      } catch {
        // Keep fallback
      }
    }
    void loadPhotos();
    return () => {
      active = false;
    };
  }, [load.id, load.isSample]);

  const saleOptions = load.saleOptions?.length
    ? load.saleOptions
    : [{ saleType: load.saleType || "regular", label: "قیمت پایه", price: load.price, minimum: load.minimum }];
  const retailOption = saleOptions.find((option) =>
    ["retail", "regular"].includes(String(option.saleType).toLowerCase()),
  );
  const wholesaleOption = saleOptions.find((option) => String(option.saleType).toLowerCase() === "wholesale");
  const preferredOption =
    saleOptions.find((option) => option.saleType === purchaseMode) ||
    (purchaseMode === "wholesale" ? wholesaleOption : retailOption) ||
    saleOptions[0];
  const [selectedSaleType, setSelectedSaleType] = useState(preferredOption?.saleType || load.saleType || "regular");
  const [count, setCount] = useState(String(preferredOption?.minimum ?? load.minimum));

  useEffect(() => {
    const next =
      saleOptions.find((option) => option.saleType === purchaseMode) ||
      (purchaseMode === "wholesale" ? wholesaleOption : retailOption) ||
      saleOptions[0];
    setSelectedSaleType(next?.saleType || load.saleType || "regular");
    setCount(String(next?.minimum ?? load.minimum));
  }, [purchaseMode, load.id]);

  const quantityForPrice = Number(count);
  const selectedSale = saleOptions.find((option) => option.saleType === selectedSaleType) || preferredOption || saleOptions[0];
  const crossTier = ["retail", "wholesale"].includes(purchaseMode) && !!retailOption && !!wholesaleOption;
  const effectiveSale = crossTier
    ? quantityForPrice >= (wholesaleOption?.minimum ?? load.minimum)
      ? wholesaleOption!
      : retailOption!
    : selectedSale;
  const priceBreak = effectiveSale?.priceBreaks?.find(
    (item) =>
      quantityForPrice * load.weight >= item.minQuantity &&
      (item.maxQuantity == null || quantityForPrice * load.weight <= item.maxQuantity),
  );
  const effectivePrice = priceBreak?.price ?? effectiveSale?.price ?? load.price;
  const effectiveMinimum = crossTier
    ? quantityForPrice >= (wholesaleOption?.minimum ?? load.minimum)
      ? wholesaleOption?.minimum ?? load.minimum
      : retailOption?.minimum ?? load.minimum
    : selectedSale?.minimum ?? load.minimum;

  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [deliveryType, setDeliveryType] = useState<"terrabar" | "pickup" | "buyer_carrier">("terrabar");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const quantity = Number(count);
  const valid =
    Number.isInteger(quantity) &&
    quantity >= (crossTier ? retailOption?.minimum ?? 1 : effectiveMinimum) &&
    quantity <= load.stock;
  const totals = {
    weight: valid ? quantity * load.weight : 0,
    total: valid ? quantity * load.weight * effectivePrice : 0,
  };

  function openOrder() {
    const firstOption =
      preferredOption || load.saleOptions?.[0] || { saleType: load.saleType || "regular", minimum: load.minimum };
    setSelectedSaleType(firstOption.saleType);
    setCount(String(firstOption.minimum));
    setSubmitted(false);
    setOrderError("");
    setDeliveryType("terrabar");
    setDeliveryAddress("");
    setOrderNotes("");
    setDialog("order");
  }

  async function submitOrder() {
    setOrderError("");
    if (!valid) return;
    if (load.isSample) {
      setSubmitted(true);
      return;
    }
    if (!load.memberId) {
      setOrderError("شناسه فروشنده در اطلاعات بار موجود نیست؛ ثبت سفارش متوقف شد.");
      return;
    }
    if (deliveryType !== "pickup" && !deliveryAddress.trim()) {
      setOrderError("برای حمل به نشانی تحویل نیاز داریم. برای تحویل حضوری، گزینه مربوطه را انتخاب کنید.");
      return;
    }
    if (!user) {
      setOrderError("برای ثبت درخواست سفارش ابتدا وارد حساب شوید.");
      return;
    }

    setBusy(true);
    const idempotencyKey = `direct_${load.id}_${member?.id || user.id}_${quantity}_${Math.floor(Date.now() / 15000)}`;
    const { ok, data } = await apiPost<{ success?: boolean; message?: string }>("/api/orders/sync", {
      load_id: load.id,
      idempotency_key: idempotencyKey,
      customer_name: member?.full_name || user.full_name || "خریدار ترابار",
      customer_phone: member?.phone || user.phone || "",
      customer_email: member?.email || user.email || "",
      customer_city: member?.city || user.city || "",
      quantity,
      unit: "بسته",
      price: effectivePrice,
      total_price: totals.total,
      sale_type: selectedSaleType,
      delivery_address: deliveryType === "pickup" ? null : deliveryAddress.trim(),
      delivery_type: deliveryType,
      status: "pending",
      notes: orderNotes.trim() || null,
      buyer_member_id: member?.id || user.id,
      seller_member_id: load.memberId,
    });

    if (!ok || !data?.success) {
      setOrderError(data?.message || "ثبت درخواست سفارش انجام نشد. لطفاً دوباره تلاش کنید.");
    } else {
      setSubmitted(true);
    }
    setBusy(false);
  }

  const qualityStyle = {
    ویژه: "bg-accent text-primary",
    استاندارد: "bg-info-soft text-info",
    اقتصادی: "bg-warning-soft text-warning",
    توافقی: "bg-muted text-muted-foreground",
  }[load.quality];

  return (
    <article
      aria-label={cartSelected ? `${load.product} انتخاب شده و در سبد خرید است` : `${load.product}`}
      className={`load-card overflow-hidden rounded-lg border bg-card text-sm transition-colors ${cartSelected ? "border-primary ring-2 ring-primary/25" : "border-border"}`}
    >
      {cartSelected && (
        <div className="flex items-center gap-1.5 bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground">
          <Check className="size-3.5" />
          انتخاب شده · در فاکتور سبد خرید
        </div>
      )}
      <div className="relative aspect-[5/3] overflow-hidden bg-muted">
        <img
          src={photoUrls[0] || load.image}
          alt={`${load.product} ${load.variety}`}
          loading="lazy"
          width={1024}
          height={576}
          className={`h-full w-full object-cover transition-transform duration-300 motion-safe:hover:scale-[1.03] ${load.id === 1 ? "object-[85%_65%]" : ""}`}
        />
        <span className="absolute bottom-1.5 left-1.5 rounded bg-card/95 px-1.5 py-0.5 text-[9px] text-muted-foreground">
          {load.isSample ? "بار نمونه" : "بار ثبت‌شده"}
        </span>
      </div>
      <div className="space-y-1 p-1.5 sm:p-2">
        <div className="flex min-w-0 items-center justify-between gap-1">
          <h3 className="min-w-0 truncate text-xs font-extrabold sm:text-sm">
            {load.product}
            <span className="font-normal text-muted-foreground"> · {load.variety}</span>
          </h3>
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold ${qualityStyle}`}>
            {load.quality}
          </span>
        </div>
        <div className="flex items-center justify-between gap-1 rounded bg-accent/40 px-2 py-1">
          <span className="text-[10px] text-muted-foreground">هر کیلو</span>
          <strong className="text-sm font-extrabold text-primary">
            {faNumber(effectivePrice)} <span className="text-[9px] font-normal">تومان</span>
          </strong>
        </div>
        <div className="flex items-center justify-between gap-1 text-[10px] leading-4">
          <span className="truncate text-muted-foreground">
            {load.packageType || "بسته"} · {faNumber(load.weight)} کیلو
          </span>
          <span className="shrink-0 text-muted-foreground">حداقل {faNumber(effectiveMinimum)} بسته</span>
        </div>
        <p className="flex items-center gap-1 text-[9px] text-muted-foreground">
          <MapPin className="size-2.5 shrink-0 text-primary" />
          <span className="truncate">
            {load.city}، {load.province}
          </span>
          <span className="shrink-0">موجودی {faNumber(load.stock)}</span>
        </p>
        {onAddToCart && !load.isSample && (
          <div className="rounded border border-border/80 px-1.5 py-1">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[9px] text-muted-foreground">تعداد بسته</span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label="کاهش تعداد بسته"
                  className="size-6 shrink-0"
                  disabled={quantity <= (crossTier ? retailOption?.minimum ?? 1 : effectiveMinimum)}
                  onClick={() =>
                    setCount(String(Math.max(crossTier ? retailOption?.minimum ?? 1 : effectiveMinimum, quantity - 1)))
                  }
                >
                  <Minus className="size-3" />
                </Button>
                <input
                  aria-label={`تعداد ${load.product} برای سبد`}
                  inputMode="numeric"
                  className="field-input h-6 w-10 px-0.5 text-center text-[10px]"
                  value={count}
                  onChange={(e) => setCount(normalizeNumericInput(e.target.value))}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label="افزایش تعداد بسته"
                  className="size-6 shrink-0"
                  disabled={quantity >= load.stock}
                  onClick={() => setCount(String(Math.min(load.stock, Math.max(1, quantity || 0) + 1)))}
                >
                  <Plus className="size-3" />
                </Button>
              </div>
            </div>
            <div className="mt-1 flex items-center justify-between gap-1 border-t border-border/70 pt-1 text-[10px]">
              <span className="text-muted-foreground">
                وزن کل:{" "}
                <strong className="text-foreground">
                  {faNumber(quantity > 0 && quantity <= load.stock ? quantity * load.weight : 0)} کیلو
                </strong>
              </span>
              <span className="text-muted-foreground">مبلغ کل</span>
              <strong className="text-xs text-primary">
                {faNumber(
                  Number.isInteger(quantity) && quantity >= effectiveMinimum && quantity <= load.stock
                    ? totals.total
                    : 0,
                )}{" "}
                تومان
              </strong>
            </div>
            {saleOptions.length > 1 && (
              <details className="mt-1 text-[9px]">
                <summary className="cursor-pointer text-muted-foreground">نوع فروش</summary>
                <select
                  aria-label="نوع فروش"
                  className="field-input mt-1 h-7 text-[10px]"
                  value={selectedSaleType}
                  onChange={(e) => {
                    const key = e.target.value;
                    const option = saleOptions.find((item) => item.saleType === key);
                    setSelectedSaleType(key);
                    setCount(String(option?.minimum ?? load.minimum));
                  }}
                >
                  {saleOptions.map((option) => (
                    <option key={option.saleType} value={option.saleType}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </details>
            )}
            {crossTier && (
              <p className="mt-0.5 text-[9px] text-primary">
                {effectiveSale?.saleType === "wholesale" ? "قیمت عمده" : "قیمت خرده"}
              </p>
            )}
            <Button
              type="button"
              disabled={!Number.isInteger(quantity) || quantity < effectiveMinimum || quantity > load.stock}
              variant={cartSelected ? "secondary" : "default"}
              className="mt-1 h-7 w-full gap-1 px-2 text-[10px]"
              onClick={() => {
                onAddToCart(load, quantity, effectiveSale?.saleType || selectedSaleType);
                setJustAdded(true);
              }}
            >
              {justAdded ? "به سبد خرید اضافه شد" : cartSelected ? "افزودن بیشتر به سبد" : "افزودن به سبد خرید"}{" "}
              {justAdded || cartSelected ? <Check className="size-3" /> : <Package className="size-3" />}
            </Button>
            {justAdded && (
              <p role="status" className="mt-1 text-center text-[10px] font-semibold text-primary">
                ✓ {faNumber(quantity)} بسته به سبد اضافه شد؛ مبلغ: {faNumber(totals.total)} تومان
              </p>
            )}
          </div>
        )}
        <div className="flex gap-1">
          <Button className="h-8 min-w-0 flex-1 gap-1 px-1.5 text-[10px]" onClick={openOrder}>
            جزئیات و سفارش
            <ArrowLeft className="size-3" />
          </Button>
          <Button
            variant="ghost"
            className="h-8 min-w-0 flex-1 gap-1 px-1.5 text-[10px] text-muted-foreground"
            onClick={() => setDialog("seller")}
          >
            <Store className="size-3" />
            ویترین فروشنده
          </Button>
        </div>
      </div>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent dir="rtl" className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg text-right">
          <DialogTitle className="mt-3 text-right">
            {dialog === "seller" ? load.seller : `${load.product} · ${load.variety}`}
          </DialogTitle>
          <DialogDescription className="text-right">
            {dialog === "seller"
              ? `${load.sellerType} — اطلاعات تماس مستقیم نمایش داده نمی‌شود`
              : load.isSample
                ? "این کارت نمونه است؛ فقط محاسبه نمایشی انجام می‌شود."
                : "درخواست به فروشنده ارسال می‌شود؛ پرداخت پس از تأیید شرایط انجام خواهد شد."}
          </DialogDescription>
          {dialog === "seller" && (
            <div className="flex flex-wrap gap-4 rounded-md bg-secondary/60 p-3 text-sm">
              <span>
                امتیاز عضو: <RatingSummary targetType="member" targetId={load.isSample ? null : load.memberId ?? null} />
              </span>
              <span>
                امتیاز این بار: <RatingSummary targetType="load" targetId={load.isSample ? null : load.id} />
              </span>
            </div>
          )}
          {dialog === "seller" && !load.isSample && load.memberId && (
            <div className="rounded-lg border border-primary/20 bg-accent/30 p-3">
              <p className="text-xs leading-6 text-muted-foreground">
                لینک اختصاصی این فروشنده را می‌توانید برای دیگران ارسال کنید؛ مشاهدهٔ بارهای ویترین پس از ورود یا ثبت‌نام امکان‌پذیر است.
              </p>
              <a
                href={`/store/${encodeURIComponent(load.memberId)}`}
                className="mt-2 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              >
                باز کردن ویترین اختصاصی <Store className="size-4" />
              </a>
              <p dir="ltr" className="mt-2 break-all text-left text-[11px] text-muted-foreground font-mono">
                /store/{encodeURIComponent(load.memberId)}
              </p>
            </div>
          )}
          {dialog === "seller" ? (
            <>
              <img className="aspect-[2/1] w-full rounded object-cover" src={photoUrls[0] || load.image} alt={load.product} />
              {photoUrls.length > 1 && (
                <div className="grid grid-cols-4 gap-2">
                  {photoUrls.slice(1).map((url, index) => (
                    <img
                      key={url}
                      src={url}
                      alt={`${load.product} عکس ${index + 2}`}
                      className="aspect-square w-full rounded object-cover"
                      loading="lazy"
                    />
                  ))}
                </div>
              )}
              <p className="flex items-center gap-2 text-sm">
                <MapPin className="size-4 text-primary" />
                {load.city}، {load.province}
              </p>
              <div className="border-t border-border pt-4">
                <h4 className="font-bold">بار موجود در ویترین</h4>
                <p className="mt-2 text-sm text-muted-foreground">
                  {load.product} {load.variety} · {load.quality} · {faNumber(load.stock)} بسته
                </p>
                <Button className="mt-4 w-full" onClick={openOrder}>
                  مشاهده بار
                  <ArrowLeft />
                </Button>
              </div>
            </>
          ) : submitted ? (
            <div className="py-5 text-center">
              <Check className="mx-auto size-12 rounded-full bg-secondary p-2 text-primary" />
              <h3 className="mt-4 font-bold">
                {load.isSample ? "پیش‌نمایش سفارش آماده است" : "درخواست سفارش ثبت شد"}
              </h3>
              <p className="mt-3 text-sm">
                {faNumber(quantity)} بسته · {faNumber(totals.weight)} کیلوگرم
              </p>
              <p className="mt-2 text-lg font-bold text-primary">{faNumber(totals.total)} تومان</p>
              <p className="mt-4 text-xs leading-6 text-muted-foreground">
                {load.isSample
                  ? "سفارش واقعی ثبت نشده و موجودی تغییری نکرده است."
                  : "درخواست در انتظار تأیید فروشنده است. پرداخت هنوز انجام نشده و موجودی پس از تأیید فروشنده کسر می‌شود."}
              </p>
              <Button className="mt-5" onClick={() => setDialog(null)}>
                بازگشت
              </Button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 border-y border-border py-3 text-xs">
                <span>
                  کیفیت: <strong>{load.quality}</strong>
                </span>
                <span>
                  مبدأ: <strong>{load.city}</strong>
                </span>
                <span>
                  بسته:{" "}
                  <strong>
                    {load.packageType || "بسته"} · {faNumber(load.weight)} کیلو
                  </strong>
                </span>
                <span>
                  موجودی: <strong>{faNumber(load.stock)} بسته</strong>
                </span>
                <span className="flex items-center gap-1 text-primary">
                  <Truck className="size-3.5" />
                  {load.ready}
                </span>
                <span>{load.isSample ? `اعتبار نمونه: ${load.validity}` : load.validity}</span>
              </div>
              {saleOptions.length > 1 && (
                <label className="grid gap-2 text-sm font-semibold">
                  بخش فروش
                  <select
                    className="field-input"
                    value={selectedSaleType}
                    onChange={(e) => {
                      const key = e.target.value;
                      const option = saleOptions.find((item) => item.saleType === key);
                      setSelectedSaleType(key);
                      setCount(String(option?.minimum ?? load.minimum));
                    }}
                  >
                    {saleOptions.map((option) => (
                      <option key={option.saleType} value={option.saleType}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="grid grid-cols-2 gap-2 rounded border border-border p-2.5 text-xs">
                <span>قیمت هر کیلو</span>
                <strong>{faNumber(effectivePrice)} تومان</strong>
                <span>حداقل سفارش</span>
                <strong>{faNumber(effectiveMinimum)} بسته</strong>
                {crossTier && (
                  <>
                    <span>قیمت محاسبه‌شده</span>
                    <strong>{effectiveSale?.saleType === "wholesale" ? "عمده" : "خرده"}</strong>
                  </>
                )}
              </div>
              <label htmlFor={`quantity-${load.id}`} className="text-sm font-semibold">
                تعداد بسته
              </label>
              <div className="grid grid-cols-[36px_minmax(0,1fr)_36px] gap-2">
                <Button
                  size="icon"
                  variant="outline"
                  aria-label="کاهش تعداد بسته"
                  disabled={quantity <= (crossTier ? retailOption?.minimum ?? 1 : effectiveMinimum)}
                  onClick={() =>
                    setCount(String(Math.max(crossTier ? retailOption?.minimum ?? 1 : effectiveMinimum, quantity - 1)))
                  }
                >
                  <Minus />
                </Button>
                <input
                  id={`quantity-${load.id}`}
                  type="text"
                  inputMode="numeric"
                  value={count}
                  onChange={(e) => setCount(normalizeNumericInput(e.target.value))}
                  className="field-input h-9 text-center"
                />
                <Button
                  size="icon"
                  variant="outline"
                  aria-label="افزایش تعداد بسته"
                  disabled={quantity >= load.stock}
                  onClick={() => setCount(String(Math.min(load.stock, Math.max(1, quantity || 0) + 1)))}
                >
                  <Plus />
                </Button>
              </div>
              <p className={`text-xs ${valid ? "text-muted-foreground" : "text-destructive"}`}>
                حداقل {faNumber(effectiveMinimum)} و حداکثر {faNumber(load.stock)} بسته؛ فقط تعداد صحیح.
              </p>
              <div className="grid gap-3 bg-secondary p-4 text-sm">
                <div className="flex justify-between">
                  <span>وزن کل</span>
                  <strong>{faNumber(totals.weight)} کیلوگرم</strong>
                </div>
                <div className="flex justify-between">
                  <span>قیمت هر کیلوگرم</span>
                  <strong>{faNumber(effectivePrice)} تومان</strong>
                </div>
                <div className="flex justify-between border-t border-border pt-3">
                  <span>مبلغ کل کالا</span>
                  <strong className="text-lg text-primary">{faNumber(totals.total)} تومان</strong>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">هزینه حمل در مبلغ فوق محاسبه نشده است.</p>
              {!load.isSample && (
                <div className="grid gap-3 rounded-lg border border-border p-4">
                  <label className="field-label">
                    روش دریافت بار
                    <select
                      className="field-input"
                      value={deliveryType}
                      onChange={(e) => setDeliveryType(e.target.value as "terrabar" | "pickup" | "buyer_carrier")}
                    >
                      <option value="terrabar">حمل‌کننده پیشنهادی ترابار</option>
                      <option value="pickup">تحویل حضوری از فروشنده</option>
                      <option value="buyer_carrier">حمل‌کننده خریدار</option>
                    </select>
                  </label>
                  {deliveryType !== "pickup" && (
                    <label className="field-label">
                      نشانی تحویل
                      <input
                        required
                        value={deliveryAddress}
                        onChange={(e) => setDeliveryAddress(e.target.value)}
                        className="field-input"
                        placeholder="نشانی دقیق یا محل تحویل"
                      />
                    </label>
                  )}
                  <label className="field-label">
                    توضیحات سفارش (اختیاری)
                    <textarea
                      value={orderNotes}
                      onChange={(e) => setOrderNotes(e.target.value)}
                      className="field-input min-h-16 resize-y"
                      placeholder="توضیحات لازم برای فروشنده"
                    />
                  </label>
                </div>
              )}
              {orderError && (
                <p role="alert" className="text-sm text-destructive">
                  {orderError}{" "}
                  {orderError.includes("وارد حساب") && (
                    <Link to="/auth" className="font-bold text-primary underline">
                      ورود / ثبت‌نام
                    </Link>
                  )}
                </p>
              )}
              <Button disabled={!valid || busy} onClick={() => void submitOrder()}>
                {busy ? "در حال ارسال…" : load.isSample ? "پیش‌نمایش سفارش" : "ارسال درخواست سفارش"}
                <Package />
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </article>
  );
}