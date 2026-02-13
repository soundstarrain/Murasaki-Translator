/**
 * useConfig - 统一配置管理 Hook
 * 集中管理 localStorage 中的应用配置
 */

import { useState, useCallback } from "react";

// 配置键定义
export const CONFIG_KEYS = {
  // Model & Server
  model: "config_model",
  glossaryPath: "config_glossary_path",
  gpu: "config_gpu",
  ctx: "config_ctx",
  remoteUrl: "config_remote_url",
  preset: "config_preset",
  deviceMode: "config_device_mode",
  gpuDeviceId: "config_gpu_device_id",

  // Output
  outputDir: "config_output_dir",
  cacheDir: "config_cache_dir",
  traditional: "config_traditional",
  autoTxt: "config_auto_txt",
  autoEpub: "config_auto_epub",

  // Processing
  temperature: "config_temperature",
  lineCheck: "config_line_check",
  lineToleranceAbs: "config_line_tolerance_abs",
  lineTolerancePct: "config_line_tolerance_pct",

  // Retries
  maxRetries: "config_max_retries",
  repPenaltyBase: "config_rep_penalty_base",
  repPenaltyMax: "config_rep_penalty_max",

  // Rules
  rulesPre: "config_rules_pre",
  rulesPost: "config_rules_post",

  // Saving Options
  saveCot: "config_save_cot",
  saveSummary: "config_save_summary",

  // UI Preferences
  theme: "theme",
  language: "language",
} as const;

export type ConfigKey = keyof typeof CONFIG_KEYS;

// 默认值
const DEFAULTS: Partial<Record<ConfigKey, string>> = {
  gpu: "true",
  ctx: "8192",
  preset: "novel",
  deviceMode: "auto",
  gpuDeviceId: "0",
  temperature: "0.3",
  lineCheck: "true",
  lineToleranceAbs: "2",
  lineTolerancePct: "30",
  maxRetries: "3",
  repPenaltyBase: "1.0",
  repPenaltyMax: "1.3",
  traditional: "false",
  saveCot: "false",
  saveSummary: "false",
  theme: "light",
  language: "zh",
};

export interface UseConfigReturn {
  // Getters
  get: (key: ConfigKey) => string;
  getBoolean: (key: ConfigKey) => boolean;
  getNumber: (key: ConfigKey) => number;

  // Setters
  set: (key: ConfigKey, value: string) => void;
  setBoolean: (key: ConfigKey, value: boolean) => void;
  setNumber: (key: ConfigKey, value: number) => void;

  // Batch operations
  getAll: () => Record<ConfigKey, string>;
  resetAll: () => void;
}

export function useConfig(): UseConfigReturn {
  // Force re-render trigger
  const [, setTrigger] = useState(0);

  const get = useCallback((key: ConfigKey): string => {
    return localStorage.getItem(CONFIG_KEYS[key]) || DEFAULTS[key] || "";
  }, []);

  const getBoolean = useCallback((key: ConfigKey): boolean => {
    const value = localStorage.getItem(CONFIG_KEYS[key]);
    if (value === null) return DEFAULTS[key] === "true";
    return value === "true";
  }, []);

  const getNumber = useCallback((key: ConfigKey): number => {
    const value = localStorage.getItem(CONFIG_KEYS[key]);
    const parsed = parseFloat(value || DEFAULTS[key] || "0");
    return isNaN(parsed) ? 0 : parsed;
  }, []);

  const set = useCallback((key: ConfigKey, value: string) => {
    localStorage.setItem(CONFIG_KEYS[key], value);
    setTrigger((n) => n + 1);
  }, []);

  const setBoolean = useCallback((key: ConfigKey, value: boolean) => {
    localStorage.setItem(CONFIG_KEYS[key], String(value));
    setTrigger((n) => n + 1);
  }, []);

  const setNumber = useCallback((key: ConfigKey, value: number) => {
    localStorage.setItem(CONFIG_KEYS[key], String(value));
    setTrigger((n) => n + 1);
  }, []);

  const getAll = useCallback((): Record<ConfigKey, string> => {
    const result = {} as Record<ConfigKey, string>;
    for (const key of Object.keys(CONFIG_KEYS) as ConfigKey[]) {
      result[key] = get(key);
    }
    return result;
  }, [get]);

  const resetAll = useCallback(() => {
    for (const key of Object.keys(CONFIG_KEYS) as ConfigKey[]) {
      localStorage.removeItem(CONFIG_KEYS[key]);
    }
    setTrigger((n) => n + 1);
  }, []);

  return {
    get,
    getBoolean,
    getNumber,
    set,
    setBoolean,
    setNumber,
    getAll,
    resetAll,
  };
}

/**
 * 使用示例:
 *
 * const config = useConfig()
 *
 * // 读取
 * const modelPath = config.get('model')
 * const useGpu = config.getBoolean('gpu')
 * const temperature = config.getNumber('temperature')
 *
 * // 写入
 * config.set('model', '/path/to/model.gguf')
 * config.setBoolean('gpu', true)
 * config.setNumber('temperature', 0.5)
 */
