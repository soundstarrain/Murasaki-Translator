/**
 * useConfig - 配置持久化 Hook
 * 使用 localStorage 存储用户设置
 */

import { useState, useCallback } from "react";

// 配置类型定义
export interface AppConfig {
  // 上次使用的模型
  lastModel: string;
  // 上次使用的术语表
  lastGlossary: string;
  // 高级设置
  advanced: {
    gpuLayers: string;
    ctxSize: string;
    temperature: string;
    repeatPenalty: string;
    chunkSize: string;
    deviceMode: "auto" | "cpu";
    gpuId: string;
    daemonMode: boolean;
    preset: string;
    mode: string;
    // 质量检测
    lineCheck: boolean;
    lineToleranceAbs: string;
    lineTolerancePct: string;
    // 后处理
    fixPunctuation: boolean;
    fixKana: boolean;
    rubyClean: boolean;
    traditional: boolean;
  };
  // 输出设置
  output: {
    customPath: string;
    autoTxt: boolean;
    autoEpub: boolean;
    saveCot: boolean;
    saveSummary: boolean;
  };
  // 主题
  theme: "dark" | "light" | "system";
}

// 默认配置
const defaultConfig: AppConfig = {
  lastModel: "",
  lastGlossary: "",
  advanced: {
    gpuLayers: "-1",
    ctxSize: "8192",
    temperature: "0.7",
    repeatPenalty: "1.0",
    chunkSize: "1000",
    deviceMode: "auto",
    gpuId: "",
    daemonMode: false,
    preset: "novel",
    mode: "doc",
    lineCheck: false,
    lineToleranceAbs: "20",
    lineTolerancePct: "0.2",
    fixPunctuation: false,
    fixKana: false,
    rubyClean: false,
    traditional: false,
  },
  output: {
    customPath: "",
    autoTxt: false,
    autoEpub: false,
    saveCot: false,
    saveSummary: false,
  },
  theme: "dark",
};

const STORAGE_KEY = "murasaki-config";

/**
 * 深度合并配置对象
 */
function deepMerge<T>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key in source) {
    if (source[key] !== undefined) {
      if (
        typeof source[key] === "object" &&
        source[key] !== null &&
        !Array.isArray(source[key])
      ) {
        result[key] = deepMerge(target[key], source[key] as any);
      } else {
        result[key] = source[key] as any;
      }
    }
  }
  return result;
}

/**
 * 从 localStorage 加载配置
 */
function loadConfig(): AppConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // 与默认配置合并，确保新增字段有默认值
      return deepMerge(defaultConfig, parsed);
    }
  } catch (error) {
    console.warn("[useConfig] Failed to load config:", error);
  }
  return defaultConfig;
}

/**
 * 保存配置到 localStorage
 */
function saveConfig(config: AppConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (error) {
    console.error("[useConfig] Failed to save config:", error);
  }
}

/**
 * 配置持久化 Hook
 */
export function useConfig() {
  const [config, setConfigState] = useState<AppConfig>(() => loadConfig());

  // 更新配置（自动保存）
  const setConfig = useCallback(
    (updater: Partial<AppConfig> | ((prev: AppConfig) => AppConfig)) => {
      setConfigState((prev) => {
        const newConfig =
          typeof updater === "function"
            ? updater(prev)
            : deepMerge(prev, updater);
        saveConfig(newConfig);
        return newConfig;
      });
    },
    [],
  );

  // 更新高级设置
  const setAdvanced = useCallback(
    (updates: Partial<AppConfig["advanced"]>) => {
      setConfig((prev) => ({
        ...prev,
        advanced: { ...prev.advanced, ...updates },
      }));
    },
    [setConfig],
  );

  // 更新输出设置
  const setOutput = useCallback(
    (updates: Partial<AppConfig["output"]>) => {
      setConfig((prev) => ({
        ...prev,
        output: { ...prev.output, ...updates },
      }));
    },
    [setConfig],
  );

  // 重置配置
  const resetConfig = useCallback(() => {
    setConfigState(defaultConfig);
    saveConfig(defaultConfig);
  }, []);

  // 导出配置
  const exportConfig = useCallback(() => {
    const dataStr = JSON.stringify(config, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "murasaki-config.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [config]);

  // 导入配置
  const importConfig = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target?.result as string);
        const merged = deepMerge(defaultConfig, imported);
        setConfigState(merged);
        saveConfig(merged);
      } catch (error) {
        console.error("[useConfig] Failed to import config:", error);
      }
    };
    reader.readAsText(file);
  }, []);

  return {
    config,
    setConfig,
    setAdvanced,
    setOutput,
    resetConfig,
    exportConfig,
    importConfig,
  };
}

export default useConfig;
