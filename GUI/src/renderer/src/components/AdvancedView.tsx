import { useState, useEffect } from "react";
import {
  Save,
  Sparkles,
  Info,
  RefreshCw,
  Zap,
  HelpCircle,
  AlertTriangle,
} from "lucide-react";
import {
  Card,
  CardContent,
  Button,
  Switch,
  Slider,
  Input,
  Label,
} from "./ui/core";
import { translations, Language } from "../lib/i18n";
import { AlertModal } from "./ui/AlertModal";
import { useAlertModal } from "../hooks/useAlertModal";

interface AdvancedViewProps {
  lang: Language;
}

export function AdvancedView({ lang }: AdvancedViewProps) {
  const t = translations[lang];
  const [saved, setSaved] = useState(false);
  const { alertProps } = useAlertModal();

  // Model Config State
  const [gpuLayers, setGpuLayers] = useState("-1");
  const [ctxSize, setCtxSize] = useState("4096");
  const [concurrency, setConcurrency] = useState(1); // Parallel Slots (1-4)
  // Granular High-Fidelity
  const [flashAttn, setFlashAttn] = useState(true);
  const [kvCacheType, setKvCacheType] = useState("f16");
  const [autoKvSwitch, setAutoKvSwitch] = useState(true);
  const [useLargeBatch, setUseLargeBatch] = useState(true);
  const [physicalBatchSize, setPhysicalBatchSize] = useState(1024);
  const [autoBatchSwitch, setAutoBatchSwitch] = useState(true);
  const [seed, setSeed] = useState(""); // String for input, parse to int

  // Flag to prevent auto-switch from overriding saved values during initial load
  const [isLoaded, setIsLoaded] = useState(false);

  // Device Config
  const [deviceMode, setDeviceMode] = useState<"auto" | "cpu">("auto");
  const [gpuDeviceId, setGpuDeviceId] = useState("");

  // Hardware Specs
  const [specs, setSpecs] = useState<any>(null);
  const [loadingSpecs, setLoadingSpecs] = useState(false);

  // Active Model Info
  const [modelInfo, setModelInfo] = useState<any>(null);

  // Text Processing State

  // Quality Control Settings (高级质量控制)
  const [temperature, setTemperature] = useState(0.7);
  const [enableLineCheck, setEnableLineCheck] = useState(true);
  const [lineToleranceAbs, setLineToleranceAbs] = useState(10);
  const [lineTolerancePct, setLineTolerancePct] = useState(20);
  const [enableRepPenaltyRetry, setEnableRepPenaltyRetry] = useState(true);
  const [repPenaltyBase, setRepPenaltyBase] = useState(1.0);
  const [repPenaltyMax, setRepPenaltyMax] = useState(1.5);
  const [maxRetries, setMaxRetries] = useState(3);
  const [strictMode, setStrictMode] = useState("off");

  // Glossary Coverage Check (术语表覆盖率检测)
  const [enableCoverageCheck, setEnableCoverageCheck] = useState(true);
  const [outputHitThreshold, setOutputHitThreshold] = useState(60); // 输出精确命中阈值
  const [cotCoverageThreshold, setCotCoverageThreshold] = useState(80); // CoT覆盖阈值
  const [coverageRetries, setCoverageRetries] = useState(2);

  // Dynamic Retry Strategy (动态重试策略)
  const [retryTempBoost, setRetryTempBoost] = useState(0.05);
  const [repPenaltyStep, setRepPenaltyStep] = useState(0.1);
  const [retryPromptFeedback, setRetryPromptFeedback] = useState(true);

  // Text Protection (文本保护)
  const [enableTextProtect, setEnableTextProtect] = useState(false);
  const [protectPatterns, setProtectPatterns] = useState("");

  // Chunking Strategy
  const [enableBalance, setEnableBalance] = useState(true);
  const [balanceThreshold, setBalanceThreshold] = useState(0.6);
  const [balanceCount, setBalanceCount] = useState(3);

  useEffect(() => {
    // Load Model Config
    setGpuLayers(localStorage.getItem("config_gpu") || "-1");
    setCtxSize(localStorage.getItem("config_ctx") || "4096");
    setConcurrency(parseInt(localStorage.getItem("config_concurrency") || "1"));

    setFlashAttn(localStorage.getItem("config_flash_attn") !== "false");
    setKvCacheType(localStorage.getItem("config_kv_cache_type") || "f16");
    setAutoKvSwitch(localStorage.getItem("config_auto_kv_switch") !== "false");
    setUseLargeBatch(
      localStorage.getItem("config_use_large_batch") !== "false",
    );
    setPhysicalBatchSize(
      parseInt(localStorage.getItem("config_physical_batch_size") || "1024"),
    );
    setAutoBatchSwitch(
      localStorage.getItem("config_auto_batch_switch") !== "false",
    );
    setSeed(localStorage.getItem("config_seed") || "");

    // Load Device Config
    setDeviceMode(
      (localStorage.getItem("config_device_mode") as "auto" | "cpu") || "auto",
    );
    setGpuDeviceId(localStorage.getItem("config_gpu_device_id") || "");

    // Load Active Model
    const savedModel = localStorage.getItem("config_model");
    if (savedModel) {
      loadModelInfo(savedModel);
    }

    // Load Quality Control Config
    const savedTemp = localStorage.getItem("config_temperature");
    if (savedTemp) setTemperature(parseFloat(savedTemp));
    setEnableLineCheck(localStorage.getItem("config_line_check") !== "false");
    const savedLineAbs = localStorage.getItem("config_line_tolerance_abs");
    if (savedLineAbs) setLineToleranceAbs(parseInt(savedLineAbs));
    const savedLinePct = localStorage.getItem("config_line_tolerance_pct");
    if (savedLinePct) setLineTolerancePct(parseInt(savedLinePct));
    setEnableRepPenaltyRetry(
      localStorage.getItem("config_rep_penalty_retry") !== "false",
    );
    const savedRepBase = localStorage.getItem("config_rep_penalty_base");
    if (savedRepBase) setRepPenaltyBase(parseFloat(savedRepBase));
    const savedRepMax = localStorage.getItem("config_rep_penalty_max");
    if (savedRepMax) setRepPenaltyMax(parseFloat(savedRepMax));
    const savedMaxRetries = localStorage.getItem("config_max_retries");
    if (savedMaxRetries) setMaxRetries(parseInt(savedMaxRetries));
    setStrictMode(localStorage.getItem("config_strict_mode") || "off");

    // Load Glossary Coverage Check Config
    setEnableCoverageCheck(
      localStorage.getItem("config_coverage_check") !== "false",
    );
    const savedOutputHitThreshold = localStorage.getItem(
      "config_output_hit_threshold",
    );
    if (savedOutputHitThreshold)
      setOutputHitThreshold(parseInt(savedOutputHitThreshold));
    const savedCotCoverageThreshold = localStorage.getItem(
      "config_cot_coverage_threshold",
    );
    if (savedCotCoverageThreshold)
      setCotCoverageThreshold(parseInt(savedCotCoverageThreshold));
    const savedCoverageRetries = localStorage.getItem(
      "config_coverage_retries",
    );
    // 修复：如果保存的值大于5，重置为默认值2
    if (savedCoverageRetries) {
      const val = parseInt(savedCoverageRetries);
      setCoverageRetries(val > 5 ? 2 : val);
    }

    // Load Dynamic Retry Strategy Config
    const savedRetryTempBoost = localStorage.getItem("config_retry_temp_boost");
    if (savedRetryTempBoost) setRetryTempBoost(parseFloat(savedRetryTempBoost));
    const savedRepPenaltyStep = localStorage.getItem("config_rep_penalty_step");
    if (savedRepPenaltyStep) setRepPenaltyStep(parseFloat(savedRepPenaltyStep));
    setRetryPromptFeedback(
      localStorage.getItem("config_retry_prompt_feedback") !== "false",
    );

    // Load Text Protect Config
    setEnableTextProtect(
      localStorage.getItem("config_text_protect") === "true",
    );
    setProtectPatterns(localStorage.getItem("config_protect_patterns") || "");

    // Load Chunking Strategy
    setEnableBalance(localStorage.getItem("config_balance_enable") !== "false");
    const savedThreshold = localStorage.getItem("config_balance_threshold");
    if (savedThreshold) setBalanceThreshold(parseFloat(savedThreshold));
    const savedCount = localStorage.getItem("config_balance_count");
    if (savedCount) setBalanceCount(parseInt(savedCount));

    loadHardwareSpecs();

    // Mark as loaded to enable auto-switch effects
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    if (!isLoaded) return; // Don't run before initial load completes
    if (autoBatchSwitch) {
      const ctxValue = parseInt(ctxSize);
      if (concurrency === 1) {
        // Fixed 2048 for single slot to ensure zero truncation error for the entire sequence (Input+CoT+Output)
        setPhysicalBatchSize(Math.min(2048, ctxValue));
      } else {
        // Parallel stable limit
        setPhysicalBatchSize(Math.min(1024, ctxValue));
      }
    }
  }, [concurrency, autoBatchSwitch, ctxSize, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return; // Don't run before initial load completes
    if (autoKvSwitch) {
      // Auto KV Strategy: default to f16 for all concurrency levels
      setKvCacheType("f16");
    }
  }, [concurrency, autoKvSwitch, isLoaded]);

  const loadHardwareSpecs = async () => {
    setLoadingSpecs(true);
    try {
      // @ts-ignore
      const s = await window.api.getHardwareSpecs();
      console.log("Specs:", s);
      if (s) {
        setSpecs(s);
        // if (!localStorage.getItem("config_ctx")) {
        //     setCtxSize(s.recommended_ctx.toString())
        // }
      }
    } catch (e) {
      console.error(e);
    }
    setLoadingSpecs(false);
  };

  const loadModelInfo = async (modelName: string) => {
    try {
      // @ts-ignore
      const info = await window.api.getModelInfo(modelName);
      if (info) {
        console.log("Model Info:", info);
        setModelInfo(info);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSave = (_e?: React.MouseEvent) => {
    // Save Model Config
    localStorage.setItem("config_gpu", gpuLayers);
    localStorage.setItem("config_ctx", ctxSize);
    localStorage.setItem("config_concurrency", concurrency.toString());

    localStorage.setItem("config_flash_attn", String(flashAttn));
    localStorage.setItem("config_kv_cache_type", kvCacheType);
    localStorage.setItem("config_auto_kv_switch", String(autoKvSwitch));
    localStorage.setItem("config_use_large_batch", String(useLargeBatch));
    localStorage.setItem(
      "config_physical_batch_size",
      String(physicalBatchSize),
    );
    localStorage.setItem("config_auto_batch_switch", String(autoBatchSwitch));
    localStorage.setItem("config_seed", seed);

    // Save Device Config
    localStorage.setItem("config_device_mode", deviceMode);
    localStorage.setItem("config_gpu_device_id", gpuDeviceId);

    // Save Quality Control Config
    localStorage.setItem("config_temperature", String(temperature));
    localStorage.setItem("config_line_check", String(enableLineCheck));
    localStorage.setItem("config_line_tolerance_abs", String(lineToleranceAbs));
    localStorage.setItem("config_line_tolerance_pct", String(lineTolerancePct));
    localStorage.setItem(
      "config_rep_penalty_retry",
      String(enableRepPenaltyRetry),
    );
    localStorage.setItem("config_rep_penalty_base", String(repPenaltyBase));
    localStorage.setItem("config_rep_penalty_max", String(repPenaltyMax));
    localStorage.setItem("config_max_retries", String(maxRetries));
    localStorage.setItem("config_strict_mode", strictMode);

    // Save Text Protect Config
    localStorage.setItem("config_text_protect", enableTextProtect.toString());
    localStorage.setItem("config_protect_patterns", protectPatterns);

    // Save Chunking Strategy
    localStorage.setItem("config_balance_enable", String(enableBalance));
    localStorage.setItem("config_balance_threshold", String(balanceThreshold));
    localStorage.setItem("config_balance_count", String(balanceCount));

    // Save Dynamic Retry Strategy Config
    localStorage.setItem("config_retry_temp_boost", String(retryTempBoost));
    localStorage.setItem("config_rep_penalty_step", String(repPenaltyStep));
    localStorage.setItem(
      "config_retry_prompt_feedback",
      String(retryPromptFeedback),
    );

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex-1 h-screen flex flex-col bg-background overflow-hidden">
      {/* Header - Fixed Top */}
      <div className="px-8 pt-8 pb-6 shrink-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
          <Sparkles className="w-6 h-6 text-primary" />
          {t.nav.advanced}
          {loadingSpecs && (
            <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
          )}
        </h2>
      </div>

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto px-8 pb-4 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent hover:scrollbar-thumb-muted-foreground/30">
        <div className="grid gap-6">
          {/* --- Model Engine Settings Section --- */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2 border-b pb-2">
              模型与推理 (Model & Inference)
            </h3>

            {/* ===== GPU & 显存设置 - 一体化大卡片 ===== */}
            <Card>
              <CardContent className="pt-6 space-y-6">
                {/* --- GPU 配置 --- */}
                <div className="space-y-3">
                  <div className="text-sm font-semibold border-b pb-2">
                    GPU 配置 (GPU Configuration)
                  </div>
                  <div
                    className={`grid gap-4 ${deviceMode === "auto" ? "grid-cols-3" : "grid-cols-1"}`}
                  >
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">
                        {t.config.device.mode}
                      </label>
                      <select
                        className="w-full border border-border p-2 rounded bg-secondary text-foreground text-sm"
                        value={deviceMode}
                        onChange={(e) =>
                          setDeviceMode(e.target.value as "auto" | "cpu")
                        }
                      >
                        <option value="auto">
                          {t.config.device.modes.auto}
                        </option>
                        <option value="cpu">{t.config.device.modes.cpu}</option>
                      </select>
                      {deviceMode === "cpu" && (
                        <p className="text-xs text-amber-600">
                          ⚠️ CPU 推理非常慢
                        </p>
                      )}
                    </div>

                    {deviceMode === "auto" && (
                      <>
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted-foreground">
                            {t.config.device.gpuId}
                          </label>
                          <input
                            type="text"
                            placeholder="0,1"
                            className="w-full border p-2 rounded text-sm bg-secondary"
                            value={gpuDeviceId}
                            onChange={(e) => setGpuDeviceId(e.target.value)}
                          />
                          <p className="text-xs text-muted-foreground">
                            {t.config.device.gpuIdDesc}
                          </p>
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted-foreground">
                            {t.config.gpuLayers}
                          </label>
                          <select
                            className="w-full border border-border p-2 rounded bg-secondary text-foreground text-sm"
                            value={gpuLayers}
                            onChange={(e) => setGpuLayers(e.target.value)}
                          >
                            <option value="-1">
                              {t.advancedView.gpuLayersAll || "全部 (All)"}
                            </option>
                            <option value="0">0 (CPU Only)</option>
                            <option value="16">16</option>
                            <option value="24">24</option>
                            <option value="32">32</option>
                            <option value="48">48</option>
                            <option value="64">64</option>
                          </select>
                          <p className="text-xs text-muted-foreground">
                            {t.advancedView.gpuLayersDesc || "建议保持默认"}
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* --- 上下文长度 --- */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold border-b pb-2">
                    {t.config.ctxSize}
                    <span className="text-xs text-muted-foreground font-normal">
                      (Tokens)
                    </span>

                    {/* Definition Tooltip */}
                    <div className="group relative flex items-center ml-1 z-50">
                      <Info className="w-3.5 h-3.5 text-muted-foreground/70 hover:text-primary cursor-help transition-colors" />
                      {/* Changed: bottom-full -> top-full, w-[440px] -> w-[480px] to fix clipping & spacing */}
                      <div
                        className="absolute left-0 top-full mt-3 -translate-x-10 w-[480px] p-0
                                                            bg-popover text-popover-foreground text-xs rounded-xl shadow-2xl border border-border/50
                                                            opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none
                                                            backdrop-blur-md bg-background/95 overflow-hidden ring-1 ring-border/50"
                      >
                        {/* Header Banner */}
                        <div className="bg-secondary/40 px-4 py-3 border-b border-border/50 flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-primary" />
                          <h4 className="font-bold text-sm text-foreground">
                            CoT 效率与上下文调优
                          </h4>
                        </div>

                        <div className="p-4 space-y-5">
                          {/* Section 1: Core Logic (Grid Layout) */}
                          <div className="grid gap-3">
                            <div className="flex gap-3 items-start">
                              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0 mt-0.5 border border-blue-500/20">
                                <Zap className="w-4 h-4 text-blue-500" />
                              </div>
                              <div>
                                <h5 className="font-semibold text-foreground mb-1">
                                  效率原理 (Efficiency)
                                </h5>
                                <p className="text-muted-foreground leading-relaxed">
                                  CoT 占比与{" "}
                                  <span className="text-foreground font-medium">
                                    Batch Size
                                  </span>{" "}
                                  成反比。Batch 越大，纯文本生成效率越高。
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Section 2: Definitions (Key-Value Style) */}
                          <div className="space-y-2">
                            <div className="p-2.5 rounded-lg bg-secondary/20 border border-border/50 hover:bg-secondary/40 transition-colors">
                              <span className="block text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-0.5">
                                Context (总预算)
                              </span>
                              <div className="text-foreground/90">
                                包含了 术语表 + Prompt + CoT思维链 + 译文
                                的总和。
                              </div>
                            </div>
                            <div className="p-2.5 rounded-lg bg-secondary/20 border border-border/50 hover:bg-secondary/40 transition-colors">
                              <span className="block text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-0.5">
                                Batch Size (切片)
                              </span>
                              <div className="text-foreground/90">
                                模型单次吞吐的文本长度，直接决定长句连贯性。
                              </div>
                            </div>
                          </div>

                          {/* Section 3: Recommendation (Hero Card) */}
                          <div className="relative overflow-hidden rounded-xl border border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-transparent">
                            <div className="absolute top-0 right-0 p-2 opacity-10">
                              <Sparkles className="w-16 h-16" />
                            </div>
                            <div className="p-3.5 relative z-10">
                              <div className="flex justify-between items-center mb-2">
                                <span className="font-semibold text-amber-600 dark:text-amber-500 flex items-center gap-1.5">
                                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div>
                                  推荐配置 (Recommended)
                                </span>
                                <span className="text-[10px] bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded border border-amber-500/20">
                                  High Efficiency
                                </span>
                              </div>

                              <div className="flex items-end gap-3 mb-2">
                                <div className="flex-1">
                                  <div className="text-[10px] text-muted-foreground mb-1">
                                    最优 Batch Size (Optimal)
                                  </div>
                                  <div className="text-2xl font-mono font-bold text-foreground leading-none">
                                    1024{" "}
                                    <span className="text-muted-foreground text-sm mx-1">
                                      -
                                    </span>{" "}
                                    1536
                                  </div>
                                </div>
                                <div className="text-[10px] text-right text-muted-foreground">
                                  ≈ 3.5k - 5k Context
                                </div>
                              </div>

                              <p className="text-[10px] text-muted-foreground/80 leading-snug">
                                此区间是兼顾{" "}
                                <strong className="text-foreground font-medium">
                                  逻辑推理(CoT)
                                </strong>{" "}
                                与{" "}
                                <strong className="text-foreground font-medium">
                                  长文连贯性
                                </strong>{" "}
                                的最佳平衡点。
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-4 mb-2">
                    <div className="flex flex-col">
                      <span
                        className={`text-3xl font-bold font-mono tracking-tight transition-colors duration-500 ${
                          (() => {
                            const ctxInt = parseInt(ctxSize);
                            let cotRatio = 3.5;
                            if (ctxInt >= 8192) cotRatio = 3.2;
                            else if (ctxInt > 1024) {
                              const slope = (3.2 - 3.5) / (8192 - 1024);
                              cotRatio = 3.5 + slope * (ctxInt - 1024);
                            }
                            const theoretical = Math.round(
                              ((ctxInt * 0.9 - 500) / cotRatio) * 1.3,
                            );
                            if (theoretical > 4096) return "text-red-500";
                            if (theoretical >= 3072) return "text-amber-500";
                            return "text-black dark:text-foreground";
                          })()
                        }`}
                      >
                        {ctxSize}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mt-1">
                        Per-Slot Context
                      </span>
                    </div>

                    {(() => {
                      const ctxInt = parseInt(ctxSize);

                      // Dynamic CoT Ratio: 3.5 (at 1024) -> 3.2 (at 8192)
                      // Linear interpolation: y = mx + c
                      // m = (3.2 - 3.5) / (8192 - 1024) = -0.3 / 7168 ≈ -0.00004185267
                      // Clamped between 3.2 and 3.5 for safety
                      let cotRatio = 3.5;
                      if (ctxInt >= 8192) {
                        cotRatio = 3.2;
                      } else if (ctxInt <= 1024) {
                        cotRatio = 3.5;
                      } else {
                        const slope = (3.2 - 3.5) / (8192 - 1024);
                        cotRatio = 3.5 + slope * (ctxInt - 1024);
                      }

                      // Theoretical Chunk Size Calculation
                      const theoretical = Math.round(
                        ((ctxInt * 0.9 - 500) / cotRatio) * 1.3,
                      );

                      // Limits:
                      // - Risk Zone: 3072-4096
                      // - Hard Limit: 4096
                      const isHardLimited = theoretical > 4096;
                      const isNearLimit =
                        theoretical > 3072 && theoretical <= 4096;
                      const effective = Math.min(4096, theoretical);

                      // Dynamic text generation based on effective chunk size
                      let labelText = `最佳 (Optimal)`;
                      let subText = `单块 ≈ ${effective} 字`;
                      let badgeStyle =
                        "text-emerald-600 bg-emerald-500/10 border-emerald-500/20";
                      let icon = <Sparkles className="w-3 h-3" />;

                      if (isHardLimited) {
                        labelText = `单块超限 (Capped)`;
                        subText = `理论单块 > 4096 字 | 实际将截断至 4096 字`;
                        badgeStyle =
                          "text-red-600 bg-red-500/10 border-red-500/20";
                        icon = <Zap className="w-3 h-3" />;
                      } else if (isNearLimit) {
                        labelText = `接近上限 (Near Limit)`;
                        subText = `单块 3072-4096 字 | 已进入硬上限前风险区，请降低上下文`;
                        badgeStyle =
                          "text-amber-600 bg-amber-500/10 border-amber-500/20";
                        icon = <Info className="w-3 h-3" />;
                      } else if (effective > 2048) {
                        labelText = `偏大 (Large)`;
                        subText = `单块 ≈ ${effective} 字 | 可翻译更长片段，但翻译效果会大幅下降`;
                        badgeStyle =
                          "text-orange-600 bg-orange-500/10 border-orange-500/20";
                        icon = <Info className="w-3 h-3" />;
                      } else if (effective >= 1024 && effective <= 1536) {
                        labelText = `推荐区间 (Recommended)`;
                        subText = `单块 ≈ ${effective} 字 | 质量与效率最佳平衡`;
                        badgeStyle =
                          "text-emerald-600 bg-emerald-500/10 border-emerald-500/20";
                        icon = <Sparkles className="w-3 h-3" />;
                      } else if (effective > 1536 && effective <= 2048) {
                        labelText = `可用区间 (Usable)`;
                        subText = `单块 ≈ ${effective} 字 | 可用，建议优先控制在 1024-1536`;
                        badgeStyle =
                          "text-teal-600 bg-teal-500/10 border-teal-500/20";
                        icon = <Info className="w-3 h-3" />;
                      } else if (effective >= 512 && effective < 1024) {
                        labelText = `偏小 (Small)`;
                        subText = `单块 ≈ ${effective} 字 | 可用，但上下文利用率偏低`;
                        badgeStyle =
                          "text-blue-600 bg-blue-500/10 border-blue-500/20";
                        icon = <Info className="w-3 h-3" />;
                      } else {
                        labelText = `过小 (Too Small)`;
                        subText = `单块 < 512 字 | 分块过碎，建议适度增大上下文`;
                        badgeStyle =
                          "text-amber-600 bg-amber-500/10 border-amber-500/20";
                        icon = <Zap className="w-3 h-3" />;
                      }

                      return (
                        <div className="flex flex-col items-end gap-1.5">
                          <div
                            className={`flex items-center gap-1.5 px-3 py-1 rounded-full border ${badgeStyle} shadow-[0_0_10px_rgba(16,185,129,0.1)] dark:shadow-[0_0_15px_rgba(16,185,129,0.05)] transition-all duration-300`}
                          >
                            {icon}
                            <span className="text-xs font-bold tracking-wide uppercase">
                              {labelText}
                            </span>
                          </div>
                          <span className="text-[11px] text-muted-foreground/80 font-medium text-right italic whitespace-nowrap">
                            {subText}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                  <div className="relative pt-6 pb-4 px-1">
                    <Slider
                      min={1024}
                      max={16384}
                      step={128}
                      value={parseInt(ctxSize)}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setCtxSize(e.target.value)
                      }
                      className="w-full h-2 rounded-lg relative z-10"
                      style={{
                        background: (() => {
                          const sMin = 1024;
                          const sMax = 16384;
                          const getPct = (v: number) =>
                            Math.max(
                              0,
                              Math.min(100, ((v - sMin) / (sMax - sMin)) * 100),
                            );

                          // Quality Factors (Per-Slot, aligned with chunk conversion)
                          // chunk >= 1024 -> ctx ~= 3526 (blue -> green)
                          // chunk >= 2048 -> ctx ~= 6295 (green -> light amber)
                          // chunk >= 3072 -> ctx ~= 8957 (light amber -> amber)
                          // chunk >  4096 -> ctx ~= 11757 (amber -> red)
                          const qGreenStart = getPct(3526);
                          const qAmberStart = getPct(6295);
                          const qDeepAmberStart = getPct(8957);
                          const qRedStart = getPct(11757);

                          return `linear-gradient(to right, 
                                                        #3b82f6 0%, #3b82f6 ${qGreenStart}%, 
                                                        #10b981 ${qGreenStart}%, #10b981 ${qAmberStart}%, 
                                                        #fbbf24 ${qAmberStart}%, #fbbf24 ${qDeepAmberStart}%,
                                                        #f59e0b ${qDeepAmberStart}%, #f59e0b ${qRedStart}%, 
                                                        #ef4444 ${qRedStart}%, #ef4444 100%)`;
                        })(),
                      }}
                    />

                    {/* Milestone Markers - Precise Alignment */}
                    <div className="absolute inset-x-0 bottom-0 flex justify-between pointer-events-none h-6">
                      {[1024, 2048, 4096, 6144, 8192, 12288, 16384].map((v) => {
                        const sMin = 1024;
                        const sMax = 16384;
                        const pct = ((v - sMin) / (sMax - sMin)) * 100;
                        return (
                          <div
                            key={v}
                            className="absolute flex flex-col items-center group/tick"
                            style={{
                              left: `${pct}%`,
                              transform: "translateX(-50%)",
                            }}
                          >
                            <div className="w-0.5 h-1.5 bg-border/40 group-hover/tick:bg-primary/50 transition-colors" />
                            <span className="text-[10px] font-mono text-muted-foreground/40 mt-1 scale-75 group-hover/tick:text-primary/70 transition-colors">
                              {v >= 1024 ? `${(v / 1024).toFixed(0)}k` : v}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground font-mono px-1">
                    <span>1024</span>
                    <span>16384</span>
                  </div>
                  {(() => {
                    const ctxInt = parseInt(ctxSize);
                    // Hard limit check (duplicated logic for simplicity in this scope)
                    let cotRatio = 3.5;
                    if (ctxInt >= 8192) cotRatio = 3.2;
                    else if (ctxInt > 1024) {
                      const slope = (3.2 - 3.5) / (8192 - 1024);
                      cotRatio = 3.5 + slope * (ctxInt - 1024);
                    }
                    const theoretical = Math.round(
                      ((ctxInt * 0.9 - 500) / cotRatio) * 1.3,
                    );
                    const isHardLimited = theoretical > 4096;
                    const isNearLimit =
                      theoretical > 3072 && theoretical <= 4096;
                    const effective = Math.min(4096, theoretical);

                    return (
                      (isHardLimited || isNearLimit) && (
                        <p
                          className={`mt-3 text-[10px] p-3 rounded-lg border leading-relaxed flex gap-2 ${
                            isHardLimited
                              ? "text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/20"
                              : "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20"
                          }`}
                        >
                          <Info className="w-3 h-3 shrink-0 mt-0.5" />
                          <span>
                            <strong>
                              {isHardLimited
                                ? "Context 硬上限告警："
                                : "Context 风险区提示："}
                            </strong>{" "}
                            {isHardLimited
                              ? `理论单块约 ${theoretical} 字，已超过 4096 硬上限，实际将按 4096 字处理。`
                              : `理论单块约 ${effective} 字，位于 3072-4096 风险区，建议回调上下文以提升稳定性。`}
                          </span>
                        </p>
                      )
                    );
                  })()}

                  {/* --- Parallel Concurrency (并发数) --- */}
                  <div className="space-y-3 border-t pt-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">
                          {t.advancedView?.concurrency ||
                            "并发任务数 (Parallel)"}
                        </span>
                        <div className="group relative flex items-center ml-1 z-[60]">
                          <HelpCircle className="w-3.5 h-3.5 text-muted-foreground/70 hover:text-primary cursor-help transition-colors" />
                          <div
                            className="absolute left-0 bottom-full mb-2 -translate-x-10 w-[420px] p-0
                                                                    bg-popover text-popover-foreground text-xs rounded-xl shadow-2xl border border-border/50
                                                                    opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none
                                                                    backdrop-blur-md bg-background/95 overflow-hidden ring-1 ring-border/50"
                          >
                            <div className="bg-secondary/40 px-4 py-2 border-b border-border/50 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Zap className="w-3.5 h-3.5 text-primary" />
                                <span className="font-bold">
                                  显卡并发推荐表
                                </span>
                              </div>
                              <span className="text-[10px] text-muted-foreground bg-background/50 px-1.5 py-0.5 rounded border">
                                Ref: 8B Q4KM @ 4k Ctx
                              </span>
                            </div>
                            <div className="p-0">
                              <table className="w-full text-left border-collapse">
                                <thead>
                                  <tr className="bg-muted/30 text-[10px] text-muted-foreground uppercase tracking-wider">
                                    <th className="p-2 pl-4 font-medium">
                                      显存
                                    </th>
                                    <th className="p-2 font-medium">
                                      参考型号
                                    </th>
                                    <th className="p-2 text-center font-medium text-emerald-600">
                                      推荐
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="text-[11px] divide-y divide-border/30">
                                  <tr className="hover:bg-muted/20">
                                    <td className="p-2 pl-4 font-mono font-bold opacity-70">
                                      6 GB
                                    </td>
                                    <td className="p-2 text-muted-foreground">
                                      RTX 3050 / 4050 / 2060 <br />
                                      <span className="text-[9px] opacity-70">
                                        GTX 1660S / 1060 6G
                                      </span>
                                    </td>
                                    <td className="p-2 text-center font-bold">
                                      1
                                    </td>
                                  </tr>
                                  <tr className="hover:bg-muted/20">
                                    <td className="p-2 pl-4 font-mono font-bold opacity-70">
                                      8 GB
                                    </td>
                                    <td className="p-2 text-muted-foreground">
                                      RTX 4060 Ti / 3060 / 3070 <br />
                                      <span className="text-[9px] opacity-70">
                                        RTX 2080 / 3050 8G
                                      </span>
                                    </td>
                                    <td className="p-2 text-center font-bold">
                                      1
                                    </td>
                                  </tr>
                                  <tr className="hover:bg-muted/20">
                                    <td className="p-2 pl-4 font-mono font-bold opacity-70">
                                      10 GB
                                    </td>
                                    <td className="p-2 text-muted-foreground">
                                      RTX 3080 10G <br />
                                      <span className="text-[9px] opacity-70">
                                        RTX 2080 Ti (11G)
                                      </span>
                                    </td>
                                    <td className="p-2 text-center font-bold">
                                      2
                                    </td>
                                  </tr>
                                  <tr className="hover:bg-muted/20">
                                    <td className="p-2 pl-4 font-mono font-bold opacity-70">
                                      12 GB
                                    </td>
                                    <td className="p-2 text-muted-foreground">
                                      RTX 4070 (Ti/Super) <br />
                                      <span className="text-[9px] opacity-70">
                                        3080 Ti / 3060 12G
                                      </span>
                                    </td>
                                    <td className="p-2 text-center font-bold">
                                      4
                                    </td>
                                  </tr>
                                  <tr className="hover:bg-muted/20">
                                    <td className="p-2 pl-4 font-mono font-bold opacity-70">
                                      16 GB
                                    </td>
                                    <td className="p-2 text-muted-foreground">
                                      RTX 4080 (Super) / 5080 <br />
                                      <span className="text-[9px] opacity-70">
                                        4070 Ti Super
                                      </span>
                                    </td>
                                    <td className="p-2 text-center font-bold">
                                      6
                                    </td>
                                  </tr>
                                  <tr className="hover:bg-muted/20">
                                    <td className="p-2 pl-4 font-mono font-bold opacity-70">
                                      24 GB+
                                    </td>
                                    <td className="p-2 text-muted-foreground">
                                      RTX 4090 / 3090 (Ti) <br />
                                      <span className="text-[9px] opacity-70">
                                        RTX 5090 (32G) / A100
                                      </span>
                                    </td>
                                    <td className="p-2 text-center font-bold">
                                      8
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                            <div className="bg-muted/30 px-4 py-2 border-t border-border/50 text-[10px] text-muted-foreground italic leading-snug">
                              并发数过高可能导致推理速度下降，实际推理速度由显卡
                              FLOPS 和显存带宽以及并发数量共同决定。
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground mr-2">
                          Max 16 Slots
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <Slider
                          min={1}
                          max={16}
                          step={1}
                          value={concurrency}
                          onChange={(
                            e: React.ChangeEvent<HTMLInputElement>,
                          ) => {
                            const val = parseInt(e.target.value);
                            setConcurrency(val);
                            // Auto KV Switch logic
                            if (autoKvSwitch) {
                              if (val >= 1) {
                                setKvCacheType("f16");
                              }
                            }
                          }}
                          className={`w-full h-2 rounded-lg concurrency-slider`}
                        />
                        <div className="relative h-6 mt-1 overflow-visible">
                          {[1, 4, 8, 12, 16].map((v) => {
                            const pct = ((v - 1) / (16 - 1)) * 100;
                            return (
                              <div
                                key={v}
                                className="absolute flex flex-col items-center group/tick"
                                style={{
                                  left: `${pct}%`,
                                  transform: "translateX(-50%)",
                                }}
                              >
                                <div className="w-0.5 h-1 bg-border/40 group-hover/tick:bg-primary/50 transition-colors" />
                                <span className="text-[10px] font-mono text-muted-foreground/50 mt-1 scale-90 group-hover/tick:text-primary/70 transition-colors whitespace-nowrap">
                                  {v === 16 ? "x16 (Max)" : `x${v}`}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <span
                        className={`text-lg font-bold font-mono w-8 text-center ${concurrency > 4 ? "text-amber-500" : "text-primary"}`}
                      >
                        {concurrency}
                      </span>
                    </div>

                    <div className="flex flex-col gap-4 mt-6">
                      {/* --- Consolidated Dashboard Grid --- */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {/* Card 1: Token Throughput Stats */}
                        <div
                          className={`relative overflow-hidden rounded-xl border p-3 flex flex-col justify-between h-full transition-all duration-300 ${
                            parseInt(ctxSize) * concurrency > 16384 * 16 * 0.75
                              ? "bg-red-500/5 border-red-500/20"
                              : parseInt(ctxSize) * concurrency > 16384 * 16 * 0.45
                                ? "bg-amber-500/5 border-amber-500/20"
                                : "bg-secondary/30 border-border/40 hover:border-primary/30"
                          }`}
                        >
                          <div className="flex flex-col">
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                              并发总吞吐估算 (Total Throughput)
                            </span>
                            <div className="flex items-baseline gap-1.5 mt-1">
                              <span
                                className={`text-xl font-mono font-bold tracking-tight ${
                                  parseInt(ctxSize) * concurrency > 16384 * 16 * 0.75
                                    ? "text-red-600"
                                    : parseInt(ctxSize) * concurrency >
                                        16384 * 16 * 0.45
                                      ? "text-amber-600"
                                      : "text-primary"
                                }`}
                              >
                                {(parseInt(ctxSize) * concurrency).toLocaleString()}
                              </span>
                              <span className="text-[10px] text-muted-foreground/60">
                                token-slots
                              </span>
                            </div>
                          </div>
                          <div className="w-full h-1 mt-3 bg-foreground/5 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                parseInt(ctxSize) * concurrency > 16384 * 16 * 0.75
                                  ? "bg-red-500 w-full animate-pulse"
                                  : parseInt(ctxSize) * concurrency >
                                      16384 * 16 * 0.45
                                    ? "bg-amber-500"
                                    : "bg-emerald-500"
                              }`}
                              style={{
                                width: `${Math.min(100, ((parseInt(ctxSize) * concurrency) / (16384 * 16)) * 100)}%`,
                              }}
                            />
                          </div>
                          <div className="mt-2 flex items-center justify-between text-[9px] text-muted-foreground/70">
                            <span>
                              Per Slot: {parseInt(ctxSize).toLocaleString()}
                            </span>
                            <span>
                              {parseInt(ctxSize) * concurrency > 16384 * 16 * 0.75
                                ? "High Throughput"
                                : parseInt(ctxSize) * concurrency >
                                    16384 * 16 * 0.45
                                  ? "Medium Throughput"
                                  : "Balanced"}
                            </span>
                          </div>
                        </div>

                        {/* Card 2: VRAM Estimates */}
                        {specs &&
                          (() => {
                            if (specs.error) {
                              return (
                                <div className="relative overflow-hidden rounded-xl border border-red-500/20 bg-red-500/5 p-3 flex flex-col justify-center items-center h-full text-center">
                                  <span className="text-[10px] text-red-500/70 uppercase font-bold mb-1">
                                    Hardware Detection Error
                                  </span>
                                  <span className="text-[9px] text-red-400/80 leading-tight">
                                    {specs.error}
                                  </span>
                                </div>
                              );
                            }
                            const slotCtx = parseInt(ctxSize);
                            const modelBase = modelInfo
                              ? modelInfo.sizeGB
                              : 5.9;
                            const perSlotVram = slotCtx * 0.00015;
                            const totalCtxVram = perSlotVram * concurrency;
                            const sysOverhead = 1.0;
                            const totalNeeded =
                              modelBase + totalCtxVram + sysOverhead;
                            const vramTotal =
                              specs.vram_gb || specs.ram_gb || 16;
                            const isSafe = totalNeeded <= vramTotal;
                            const usagePct = Math.min(
                              100,
                              (totalNeeded / vramTotal) * 100,
                            );

                            return (
                              <div
                                className={`relative overflow-hidden rounded-xl border p-3 flex flex-col justify-between h-full transition-all duration-300 ${
                                  !isSafe
                                    ? "bg-red-500/5 border-red-500/20"
                                    : usagePct > 90
                                      ? "bg-amber-500/5 border-amber-500/20"
                                      : "bg-secondary/30 border-border/40 hover:border-blue-500/30"
                                }`}
                              >
                                <div className="flex flex-col">
                                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                                    显存占用估算 (VRAM Est.)
                                  </span>
                                  <div className="flex items-baseline gap-1.5 mt-1">
                                    <span
                                      className={`text-xl font-mono font-bold tracking-tight ${!isSafe ? "text-red-600" : "text-foreground"}`}
                                    >
                                      {totalNeeded.toFixed(1)}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground/60">
                                      / {vramTotal.toFixed(1)} GB
                                    </span>
                                  </div>
                                </div>
                                <div className="w-full h-1 mt-3 bg-foreground/5 rounded-full overflow-hidden flex">
                                  <div
                                    className="h-full bg-purple-500/50"
                                    style={{
                                      width: `${(sysOverhead / vramTotal) * 100}%`,
                                    }}
                                    title="System"
                                  />
                                  <div
                                    className="h-full bg-blue-500/60"
                                    style={{
                                      width: `${(modelBase / vramTotal) * 100}%`,
                                    }}
                                    title="Model"
                                  />
                                  <div
                                    className={`h-full ${!isSafe ? "bg-red-500" : "bg-amber-500/60"}`}
                                    style={{
                                      width: `${(totalCtxVram / vramTotal) * 100}%`,
                                    }}
                                    title="KV Cache"
                                  />
                                </div>
                                <div className="mt-2 flex items-center justify-between text-[9px] text-muted-foreground/70">
                                  <span>
                                    Status: {isSafe ? "Safe" : "OOM Risk"}
                                  </span>
                                  <span>{usagePct.toFixed(0)}% Utilized</span>
                                </div>
                              </div>
                            );
                          })()}
                      </div>

                      {/* --- Consolidated System Advisory --- */}
                      {concurrency > 1 && (
                        <div
                          className={`rounded-xl border p-3 flex gap-3 items-start backdrop-blur-sm ${
                            concurrency > 8
                              ? "bg-orange-500/10 border-orange-500/20 text-orange-700 dark:text-orange-400"
                              : "bg-secondary/40 border-border/50 text-foreground/80"
                          }`}
                        >
                          <Info className="w-4 h-4 shrink-0 mt-0.5 opacity-80" />
                          <div className="space-y-1.5 flex-1">
                            <span className="text-[11px] font-bold uppercase tracking-wider opacity-90">
                              系统细节与建议 (System Advisory)
                            </span>
                            <ul className="text-[10px] space-y-1 leading-relaxed opacity-80 list-disc pl-3">
                              {concurrency > 1 && concurrency <= 4 && (
                                <li className="text-primary font-medium italic">
                                  并发模式已开启 (x{concurrency}
                                  )。相比单线程模式，吞吐量将大幅提升，但翻译质量会稍微下降。对翻译质量要求高的文本建议保持单线程模式
                                </li>
                              )}
                              {concurrency > 4 && (
                                <li className="text-orange-600 dark:text-orange-400 font-bold italic">
                                  高并发模式 (x{concurrency}
                                  )：可能影响系统稳定性，翻译质量将面临下降风险。除非显存足够大，否则不建议使用
                                </li>
                              )}
                            </ul>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ===== Chunking Strategy Card ===== */}
            <Card>
              <CardContent className="pt-6 space-y-6">
                <h3 className="text-sm font-semibold border-b pb-2 flex items-center gap-2">
                  分块与负载均衡 (Chunking & Balancing)
                </h3>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium">
                        启用尾部均衡 (Tail Balancing)
                      </div>
                      <p className="text-xs text-muted-foreground">
                        避免最后一个分块过短，自动重新分配末尾负载
                      </p>
                    </div>
                    <Switch
                      checked={enableBalance}
                      onCheckedChange={setEnableBalance}
                    />
                  </div>

                  {enableBalance && (
                    <div className="pl-4 border-l-2 border-primary/20 space-y-4">
                      {/* Count Slider */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-muted-foreground">
                            均衡块数 (Range)
                          </span>
                          <span className="text-xs font-mono bg-secondary px-2 rounded">
                            Last {balanceCount} Blocks
                          </span>
                        </div>
                        <Slider
                          min={2}
                          max={5}
                          step={1}
                          value={balanceCount}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            setBalanceCount(parseInt(e.target.value))
                          }
                          className="w-full"
                        />
                      </div>

                      {/* Threshold Slider */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-muted-foreground">
                            触发阈值 (Trigger Threshold)
                          </span>
                          <span className="text-xs font-mono bg-secondary px-2 rounded">
                            {Math.round(balanceThreshold * 100)}%
                          </span>
                        </div>
                        <Slider
                          min={0.1}
                          max={0.9}
                          step={0.1}
                          value={balanceThreshold}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            setBalanceThreshold(parseFloat(e.target.value))
                          }
                          className="w-full"
                        />
                        <p className="text-[10px] text-muted-foreground">
                          当最后一个块长度小于目标长度的{" "}
                          {Math.round(balanceThreshold * 100)}% 时触发重平衡
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* --- Inference Quality Control  --- */}
          <div className="space-y-4 pt-4">
            <h3 className="text-lg font-semibold flex items-center gap-2 border-b pb-2">
              推理质量控制 (Inference Quality Control )
              <span className="text-[10px] bg-blue-500/10 text-blue-600 px-2 py-0.5 rounded font-normal">
                {t.advancedView.recommendDefault}
              </span>
            </h3>

            <Card>
              <CardContent className="pt-6 space-y-6">
                {/* Granular High-Fidelity Settings */}
                <div className="space-y-4">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    Detailed Inference Options
                  </p>

                  {/* 1. Flash Attention */}
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-sm">Flash Attention (-fa)</Label>
                      <p className="text-[10px] text-muted-foreground">
                        提升并发数值稳定性，降低长文本显存占用 (需 RTX 20+ GPU)
                      </p>
                    </div>
                    <Switch
                      checked={flashAttn}
                      onCheckedChange={setFlashAttn}
                    />
                  </div>

                  {/* 2. Seed Locking */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-0.5 flex-1">
                      <Label className="text-sm">锁定随机种子 (Seed)</Label>
                      <p className="text-[10px] text-muted-foreground">
                        固定采样种子以复现结果 (留空为随机)
                      </p>
                    </div>
                    <Input
                      className="w-24 h-8 text-xs font-mono"
                      placeholder="Random"
                      value={seed}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setSeed(e.target.value.replace(/[^0-9]/g, ""))
                      }
                    />
                  </div>

                  <div className="h-px bg-border/50 my-2" />

                  {/* 3. KV Cache Selection with Auto Switch */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label className="text-sm">KV Cache 精度选择</Label>
                        <p className="text-[10px] text-muted-foreground">
                          F16 为原生质量；Q8_0 用于节约显存
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">
                          自动 (Auto)
                        </span>
                        <Switch
                          checked={autoKvSwitch}
                          onCheckedChange={setAutoKvSwitch}
                          className="scale-75 origin-right"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {[
                        {
                          id: "f16",
                          label: "F16",
                          sub: "原生质量",
                          hint: "默认推荐",
                        },
                        {
                          id: "q8_0",
                          label: "Q8_0",
                          sub: "节约显存",
                          hint: "显存受限可选",
                        },
                        {
                          id: "q5_1",
                          label: "Q5_1",
                          sub: "高效型",
                          hint: "显存紧促可选",
                        },
                        {
                          id: "q4_0",
                          label: "Q4_0",
                          sub: "极限型",
                          hint: "极限显存方案",
                        },
                      ].map((opt) => (
                        <button
                          key={opt.id}
                          onClick={() => setKvCacheType(opt.id)}
                          disabled={autoKvSwitch}
                          className={`flex flex-col items-start p-2 rounded-lg border transition-all text-left
                                                        ${
                                                          kvCacheType === opt.id
                                                            ? "bg-primary/10 border-primary ring-1 ring-primary/20"
                                                            : "bg-secondary/40 border-border hover:border-primary/50"
                                                        }
                                                        ${autoKvSwitch ? "opacity-70 grayscale-[0.5] cursor-not-allowed" : "cursor-pointer"}
                                                    `}
                        >
                          <div className="flex items-center justify-between w-full">
                            <span className="text-xs font-bold">
                              {opt.label}
                            </span>
                            {kvCacheType === opt.id && (
                              <Sparkles className="w-3 h-3 text-primary" />
                            )}
                          </div>
                          <span className="text-[9px] text-muted-foreground mt-0.5">
                            {opt.sub} · {opt.hint}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 4. Physical Batch Control */}
                  <div className="space-y-4 pt-2">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label className="text-sm">物理同步 (Batch Sync)</Label>
                        <p className="text-[10px] text-muted-foreground">
                          强制 b=ub，确保预处理完整性与单线程一致性
                        </p>
                      </div>
                      <Switch
                        checked={useLargeBatch}
                        onCheckedChange={setUseLargeBatch}
                      />
                    </div>

                    {useLargeBatch && (
                      <div className="animate-in fade-in slide-in-from-right-1 duration-300">
                        <div className="p-3 bg-secondary/50 rounded-xl border border-border/60 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold uppercase text-foreground/80">
                                批处理大小 (BATCH SIZE)
                              </span>
                              {autoBatchSwitch && (
                                <span className="text-[8px] px-1.5 bg-primary/20 text-primary rounded-sm font-bold uppercase tracking-tighter">
                                  Auto
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-muted-foreground mr-1 italic">
                                智能推荐
                              </span>
                              <Switch
                                checked={autoBatchSwitch}
                                onCheckedChange={setAutoBatchSwitch}
                                className="scale-75 origin-right"
                              />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center gap-4">
                              <Slider
                                disabled={autoBatchSwitch}
                                min={128}
                                max={4096}
                                step={128}
                                value={physicalBatchSize}
                                onChange={(
                                  e: React.ChangeEvent<HTMLInputElement>,
                                ) =>
                                  setPhysicalBatchSize(parseInt(e.target.value))
                                }
                                className={`flex-1 ${autoBatchSwitch ? "opacity-50" : ""}`}
                              />
                              <span className="text-xs font-mono font-bold w-10 text-right">
                                {physicalBatchSize}
                              </span>
                            </div>
                            <p className="text-[9px] text-muted-foreground leading-relaxed italic border-l-2 border-primary/20 pl-2">
                              <strong>重要提示：</strong>当并发=1时，建议设为
                              2048；并发 {">"} 1时建议维持 1024。
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* --- Quality Control Section (高级质量控制) --- */}
          <div className="space-y-4 pt-4">
            <h3 className="text-lg font-semibold flex items-center gap-2 border-b pb-2">
              {t.advancedView.qualityControl}
              <span className="text-[10px] bg-blue-500/10 text-blue-600 px-2 py-0.5 rounded font-normal">
                {t.advancedView.recommendDefault}
              </span>
            </h3>

            <Card>
              <CardContent className="space-y-6 pt-6">
                {/* Temperature */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {t.advancedView.temperature}
                      </span>
                      <Info className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                    <span className="text-sm font-mono bg-secondary px-2 py-0.5 rounded">
                      {temperature.toFixed(2)}
                    </span>
                  </div>
                  <Slider
                    value={temperature}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setTemperature(parseFloat(e.target.value))
                    }
                    min={0.1}
                    max={1.5}
                    step={0.05}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t.advancedView.temperatureDesc}
                  </p>
                </div>

                {/* Global Max Retries - 全局最大重试次数 */}
                <div className="space-y-4 border-t pt-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {t.advancedView.maxRetries}
                      </span>
                      <span className="text-[10px] bg-blue-500/10 text-blue-600 px-1.5 py-0.5 rounded">
                        {t.advancedView.globalLabel || "全局"}
                      </span>
                    </div>
                    <input
                      type="number"
                      className="w-20 border p-1.5 rounded text-sm bg-secondary text-center"
                      value={maxRetries}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setMaxRetries(parseInt(e.target.value) || 3)
                      }
                      onBlur={(e) => {
                        const v = Math.max(
                          1,
                          Math.min(10, parseInt(e.target.value) || 3),
                        );
                        setMaxRetries(v);
                        localStorage.setItem(
                          "config_max_retries",
                          v.toString(),
                        );
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground -mt-1">
                    {t.advancedView.maxRetriesDesc}
                  </p>

                  {/* Unified Retry Strategy (Temp Step) */}
                  <div className="space-y-3 pt-3 border-t border-dashed">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {t.advancedView.retryTempBoost}
                        </span>
                        <span className="text-[10px] font-mono opacity-50 bg-secondary px-1.5 py-0.5 rounded">
                          ±Step
                        </span>
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        className="w-20 border p-1.5 rounded text-sm bg-secondary text-center"
                        value={retryTempBoost}
                        onChange={(e) =>
                          setRetryTempBoost(parseFloat(e.target.value) || 0.05)
                        }
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      此参数同时用于行数升温和术语降温
                    </p>
                  </div>
                </div>

                {/* Validation Rules Sub-header */}
                <div className="flex items-center gap-2 border-t pt-4">
                  <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    {t.advancedView.validationRules || "验证规则"}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {t.advancedView.validationRulesDesc || "(触发重试的条件)"}
                  </span>
                </div>

                {/* Line Count Check */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {t.advancedView.lineCheck}
                      </span>
                    </div>
                    <Switch
                      checked={enableLineCheck}
                      onCheckedChange={setEnableLineCheck}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t.advancedView.lineCheckDesc}
                  </p>
                  {enableLineCheck && (
                    <div className="border-l-2 border-primary/30 pl-4 ml-2 mt-2 space-y-4">
                      {/* 1. Strict Mode Policy (Priority) */}
                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground flex items-center justify-between font-medium">
                          <span>严格对齐模式 (Strict Mode)</span>
                        </label>
                        <select
                          className="w-full border border-border p-1.5 rounded bg-secondary text-foreground text-xs"
                          value={strictMode}
                          onChange={(e) => setStrictMode(e.target.value)}
                        >
                          <option value="off">
                            关闭 (使用阈值 / Use Tolerance)
                          </option>
                          <option value="subs">
                            自动 (仅字幕文件强制 / Subs Only)
                          </option>
                          <option value="all">
                            强制开启 (所有文件 / Always On)
                          </option>
                        </select>
                        <p className="text-[10px] text-muted-foreground italic leading-relaxed">
                          {strictMode === "off" ? (
                            "手动设置允许的行数误差范围。"
                          ) : strictMode === "subs" ? (
                            "字幕文件强制行数一致，其他文件使用下方阈值。"
                          ) : (
                            <span className="text-amber-500 font-medium flex items-start gap-1">
                              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                              非字幕或代码等特殊场景不建议开启。模型合并、拆分段落属于正常优化，强制对齐可能增加重试风险。开启该选项后，如果行数有任何不一致，都会触发重试。
                            </span>
                          )}
                        </p>
                      </div>

                      {/* 2. Tolerance Inputs (Conditional) */}
                      {strictMode !== "all" && (
                        <div
                          className={`grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-1 duration-300 ${strictMode === "subs" ? "opacity-80" : ""}`}
                        >
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">
                              {strictMode === "subs"
                                ? t.advancedView.absTolerance + " (非字幕)"
                                : t.advancedView.absTolerance}
                            </label>
                            <input
                              type="number"
                              className="w-full border p-1.5 rounded text-sm bg-secondary text-center"
                              value={lineToleranceAbs}
                              onChange={(
                                e: React.ChangeEvent<HTMLInputElement>,
                              ) =>
                                setLineToleranceAbs(
                                  parseInt(e.target.value) || 20,
                                )
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">
                              {strictMode === "subs"
                                ? t.advancedView.pctTolerance + " (非字幕)"
                                : t.advancedView.pctTolerance}
                            </label>
                            <input
                              type="number"
                              className="w-full border p-1.5 rounded text-sm bg-secondary text-center"
                              value={lineTolerancePct}
                              onChange={(
                                e: React.ChangeEvent<HTMLInputElement>,
                              ) =>
                                setLineTolerancePct(
                                  parseInt(e.target.value) || 20,
                                )
                              }
                            />
                          </div>
                        </div>
                      )}

                      {/* 3. Strict Mode Info Banner Removed for cleanliness */}
                    </div>
                  )}
                </div>

                {/* Repetition Penalty */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {t.advancedView.repPenalty}
                      </span>
                    </div>
                    <Switch
                      checked={enableRepPenaltyRetry}
                      onCheckedChange={setEnableRepPenaltyRetry}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t.advancedView.repPenaltyDesc}
                  </p>
                  {enableRepPenaltyRetry && (
                    <div className="border-l-2 border-primary/30 pl-4 ml-2 mt-2">
                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">
                            {t.advancedView.repBase}
                          </label>
                          <input
                            type="number"
                            step="0.05"
                            className="w-full border p-1.5 rounded text-sm bg-secondary text-center"
                            value={repPenaltyBase}
                            onChange={(e) =>
                              setRepPenaltyBase(
                                parseFloat(e.target.value) || 1.0,
                              )
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">
                            {t.advancedView.repMax}
                          </label>
                          <input
                            type="number"
                            step="0.05"
                            className="w-full border p-1.5 rounded text-sm bg-secondary text-center"
                            value={repPenaltyMax}
                            onChange={(e) =>
                              setRepPenaltyMax(
                                parseFloat(e.target.value) || 1.5,
                              )
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">
                            {t.advancedView.repBoost}
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            className="w-full border p-1.5 rounded text-sm bg-secondary text-center"
                            value={repPenaltyStep}
                            onChange={(e) =>
                              setRepPenaltyStep(
                                parseFloat(e.target.value) || 0.1,
                              )
                            }
                          />
                        </div>
                      </div>
                      <p className="text-[10px] text-muted-foreground italic mt-2">
                        {t.advancedView.repBoostDesc}
                      </p>
                    </div>
                  )}
                </div>

                {/* Glossary Coverage Check */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {t.advancedView.glossaryCoverage}
                      </span>
                    </div>
                    <Switch
                      checked={enableCoverageCheck}
                      onCheckedChange={(v) => {
                        setEnableCoverageCheck(v);
                        localStorage.setItem(
                          "config_coverage_check",
                          v.toString(),
                        );
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    检测译文中术语表翻译的命中率。输出精确命中达到阈值，或 CoT
                    中日文术语覆盖达到阈值即通过。
                  </p>

                  {enableCoverageCheck && (
                    <div className="border-l-2 border-primary/30 pl-4 ml-2 mt-2 space-y-4">
                      {/* Coverage Thresholds */}
                      <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">
                            输出命中阈值 (%)
                          </label>
                          <input
                            type="number"
                            className="w-full border p-1.5 rounded text-sm bg-secondary text-center"
                            value={outputHitThreshold}
                            onChange={(
                              e: React.ChangeEvent<HTMLInputElement>,
                            ) =>
                              setOutputHitThreshold(
                                parseInt(e.target.value) || 0,
                              )
                            }
                            onBlur={(e) => {
                              const v = Math.max(
                                0,
                                Math.min(100, parseInt(e.target.value) || 60),
                              );
                              setOutputHitThreshold(v);
                              localStorage.setItem(
                                "config_output_hit_threshold",
                                v.toString(),
                              );
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">
                            CoT覆盖阈值 (%)
                          </label>
                          <input
                            type="number"
                            className="w-full border p-1.5 rounded text-sm bg-secondary text-center"
                            value={cotCoverageThreshold}
                            onChange={(
                              e: React.ChangeEvent<HTMLInputElement>,
                            ) =>
                              setCotCoverageThreshold(
                                parseInt(e.target.value) || 0,
                              )
                            }
                            onBlur={(e) => {
                              const v = Math.max(
                                0,
                                Math.min(100, parseInt(e.target.value) || 80),
                              );
                              setCotCoverageThreshold(v);
                              localStorage.setItem(
                                "config_cot_coverage_threshold",
                                v.toString(),
                              );
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">
                            {t.advancedView.coverageRetries}
                          </label>
                          <input
                            type="number"
                            className="w-full border p-1.5 rounded text-sm bg-secondary text-center"
                            value={coverageRetries}
                            onChange={(
                              e: React.ChangeEvent<HTMLInputElement>,
                            ) =>
                              setCoverageRetries(parseInt(e.target.value) || 2)
                            }
                            onBlur={(e) => {
                              const v = Math.max(
                                1,
                                Math.min(5, parseInt(e.target.value) || 2),
                              );
                              setCoverageRetries(v);
                              localStorage.setItem(
                                "config_coverage_retries",
                                v.toString(),
                              );
                            }}
                          />
                        </div>
                      </div>

                      {/* Prompt Feedback Toggle */}
                      <div className="space-y-3 pt-4 border-t border-dashed mt-4">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">
                            Prompt 反馈注入
                          </span>
                          <Switch
                            checked={retryPromptFeedback}
                            onCheckedChange={(v) => {
                              setRetryPromptFeedback(v);
                              localStorage.setItem(
                                "config_retry_prompt_feedback",
                                v.toString(),
                              );
                            }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          重试时在提示词中明确告知模型遗漏了哪些术语
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Floating Footer - Fixed Bottom */}
      <div className="p-8 pt-4 pb-8 border-t bg-background shrink-0 z-10 flex justify-end">
        <Button onClick={handleSave} className="gap-2 shadow-sm px-6">
          <Save className="w-4 h-4" />
          {saved ? t.saved : t.save}
        </Button>
      </div>
      <AlertModal {...alertProps} />
    </div>
  );
}
