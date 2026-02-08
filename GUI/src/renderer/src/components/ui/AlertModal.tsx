import React, { useState } from "react";
import { Card, Button } from "./core";
import { AlertTriangle, Info, CheckCircle2, X, RefreshCw } from "lucide-react";

interface AlertModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string | React.ReactNode;
  variant?: "default" | "destructive" | "info" | "success" | "warning";
  onConfirm?: () => void | Promise<void>;
  confirmText?: string;
  cancelText?: string;
  showCancel?: boolean;
  showIcon?: boolean;
  closeOnConfirm?: boolean;
  confirmLoading?: boolean;
}

export function AlertModal({
  open,
  onOpenChange,
  title,
  description,
  variant = "default",
  onConfirm,
  confirmText = "确定",
  cancelText = "取消",
  showCancel = false,
  showIcon = true,
  closeOnConfirm = true,
  confirmLoading = false,
}: AlertModalProps) {
  if (!open) return null;

  const getIcon = () => {
    switch (variant) {
      case "warning":
        return <AlertTriangle className="w-6 h-6 text-yellow-500" />;
      case "success":
        return <CheckCircle2 className="w-6 h-6 text-green-500" />;
      case "info":
        return <Info className="w-6 h-6 text-blue-500" />;
      default:
        return <AlertTriangle className="w-6 h-6 text-yellow-500" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <Card className="w-full max-w-lg shadow-lg border-border bg-background animate-in zoom-in-95 duration-200">
        {showIcon ? (
          <div className="p-6 relative">
            <div className="flex items-start gap-4">
              <div className="shrink-0 mt-1">{getIcon()}</div>
              <div className="flex-1 space-y-2 min-w-0">
                <h3 className="font-semibold text-lg leading-none tracking-tight">
                  {title}
                </h3>
                <div className="text-sm text-muted-foreground mt-2 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                  {typeof description === "string" ? (
                    <p className="whitespace-pre-wrap break-words text-xs font-mono">
                      {description}
                    </p>
                  ) : (
                    description
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={() => onOpenChange(false)}
              className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
            >
              <X className="w-4 h-4" />
              <span className="sr-only">Close</span>
            </button>
          </div>
        ) : (
          <div className="p-6 relative">
            <h3 className="font-semibold text-lg leading-none tracking-tight pr-8">
              {title}
            </h3>
            <div className="text-sm text-muted-foreground mt-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
              {typeof description === "string" ? (
                <p className="whitespace-pre-wrap break-words text-xs font-mono">
                  {description}
                </p>
              ) : (
                description
              )}
            </div>
            <button
              onClick={() => onOpenChange(false)}
              className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
            >
              <X className="w-4 h-4" />
              <span className="sr-only">Close</span>
            </button>
          </div>
        )}
        <div className="p-6 pt-0 flex justify-end gap-2">
          {showCancel && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {cancelText}
            </Button>
          )}
          <Button
            variant={variant === "destructive" ? "destructive" : "default"}
            onClick={async () => {
              if (onConfirm) await onConfirm();
              if (closeOnConfirm) onOpenChange(false);
            }}
            disabled={confirmLoading}
          >
            {confirmLoading ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                检测中...
              </>
            ) : (
              confirmText
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
}
