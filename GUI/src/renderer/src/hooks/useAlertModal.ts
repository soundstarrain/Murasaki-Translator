import { useState, useCallback } from "react";

export interface AlertConfig {
  open: boolean;
  title: string;
  description: string | React.ReactNode;
  variant?: "default" | "destructive" | "info" | "success" | "warning";
  onConfirm?: () => void;
  confirmText?: string;
  cancelText?: string;
  showCancel?: boolean;
}

export function useAlertModal() {
  const [alertConfig, setAlertConfig] = useState<AlertConfig>({
    open: false,
    title: "",
    description: "",
  });

  const showAlert = useCallback(
    (config: {
      title: string;
      description: string | React.ReactNode;
      variant?: "default" | "success" | "info" | "destructive" | "warning";
      confirmText?: string;
    }) => {
      setAlertConfig({
        ...config,
        open: true,
        showCancel: false,
      });
    },
    [],
  );

  const showConfirm = useCallback(
    (config: {
      title: string;
      description: string | React.ReactNode;
      onConfirm: () => void;
      variant?: "destructive" | "default" | "warning";
      confirmText?: string;
      cancelText?: string;
    }) => {
      setAlertConfig({
        ...config,
        open: true,
        showCancel: true,
      });
    },
    [],
  );

  const closeAlert = useCallback(() => {
    setAlertConfig((prev) => ({ ...prev, open: false }));
  }, []);

  return {
    alertProps: {
      ...alertConfig,
      onOpenChange: closeAlert,
    },
    showAlert,
    showConfirm,
  };
}
