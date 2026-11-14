import { Component, type ErrorInfo, type ReactNode } from "react";
import { isDynamicImportError, triggerSingleChunkRecoveryReload } from "@/lib/safe-storage";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  isChunkError: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    isChunkError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      isChunkError: isDynamicImportError(error),
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.warn("[AppErrorBoundary] Caught render exception:", error, errorInfo);
    if (isDynamicImportError(error)) {
      triggerSingleChunkRecoveryReload();
    }
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div
          dir="rtl"
          className="flex min-h-screen items-center justify-center bg-background px-4 py-8 text-center"
        >
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-lg">
            <h1 className="text-lg font-bold text-foreground">
              ترابار | بازار میوه و تره‌بار ایران
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {this.state.isChunkError
                ? "به‌روزرسانی نسخه یا اختلال موقت در دریافت فایل‌های صفحه رخ داد. لطفاً صفحه را مجدداً بارگذاری کنید."
                : "در نمایش این بخش مشکلی پیش آمد. لطفاً صفحه را مجدداً بارگذاری کنید."}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  try {
                    window.location.reload();
                  } catch {
                    window.location.href = "/";
                  }
                }}
                className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                بارگذاری مجدد صفحه
              </button>
              <a
                href="/"
                className="inline-flex items-center justify-center rounded-lg border border-input bg-background px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              >
                صفحه اصلی
              </a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
