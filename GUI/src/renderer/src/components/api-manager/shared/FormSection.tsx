import type { ReactNode } from "react";
import { cn } from "../../../lib/utils";

type FormSectionProps = {
  title?: ReactNode;
  desc?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  contentClassName?: string;
};

export function FormSection({
  title,
  desc,
  actions,
  children,
  className,
  contentClassName,
}: FormSectionProps) {
  return (
    <section
      className={cn(
        "rounded-xl border bg-muted/20 p-4 space-y-4 transition-colors hover:border-primary/30",
        className,
      )}
    >
      {(title || desc || actions) && (
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            {title && <div className="text-sm font-medium">{title}</div>}
            {desc && (
              <div className="text-xs text-muted-foreground">{desc}</div>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children != null && (
        <div className={cn("space-y-4", contentClassName)}>{children}</div>
      )}
    </section>
  );
}
