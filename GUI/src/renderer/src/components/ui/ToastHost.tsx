import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

type ToastVariant = "info" | "success" | "warning" | "error";

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
  duration: number;
}

const variantStyles: Record<ToastVariant, { className: string; icon: any }> = {
  success: {
    className: "bg-emerald-500/10 border-emerald-500/30 text-emerald-700",
    icon: CheckCircle2,
  },
  warning: {
    className: "bg-amber-500/10 border-amber-500/30 text-amber-700",
    icon: AlertTriangle,
  },
  error: {
    className: "bg-red-500/10 border-red-500/30 text-red-700",
    icon: AlertTriangle,
  },
  info: {
    className: "bg-blue-500/10 border-blue-500/30 text-blue-700",
    icon: Info,
  },
};

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        message?: string;
        variant?: ToastVariant;
        duration?: number;
      };
      if (!detail?.message) return;
      const toast: ToastItem = {
        id: Date.now() + Math.random(),
        message: detail.message,
        variant: detail.variant || "info",
        duration: detail.duration ?? 4200,
      };
      setToasts((prev) => [...prev, toast]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, toast.duration);
    };

    window.addEventListener("app-toast", handler as EventListener);
    return () =>
      window.removeEventListener("app-toast", handler as EventListener);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[var(--z-toast)] flex flex-col gap-2">
      {toasts.map((toast) => {
        const config = variantStyles[toast.variant];
        const Icon = config.icon;
        return (
          <div
            key={toast.id}
            className={`min-w-[220px] max-w-[360px] rounded-lg border px-3 py-2 text-xs shadow-lg backdrop-blur-sm flex items-start gap-2 ${config.className}`}
          >
            <Icon className="w-3.5 h-3.5 mt-0.5" />
            <span className="flex-1 leading-relaxed">{toast.message}</span>
            <button
              type="button"
              onClick={() =>
                setToasts((prev) => prev.filter((t) => t.id !== toast.id))
              }
              className="text-current/70 hover:text-current"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
