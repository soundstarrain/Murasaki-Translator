import { useMemo, useState } from "react";
import yaml from "js-yaml";
import { Card, CardContent, Button, Input, Label } from "./ui/core";
import { translations, Language } from "../lib/i18n";
import { emitToast } from "../lib/toast";
import {
  CheckCircle2,
  Database,
  Server,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { cn } from "../lib/utils";

type SourceMode = "local" | "api";

const DEFAULT_API_FORM = {
  id: "",
  name: "",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4.1-mini",
  timeout: "600",
};

const formatErrorCode = (code: string, texts: any) => {
  if (code === "invalid_yaml") return texts.validationInvalidYaml;
  if (code === "invalid_id") return texts.validationInvalidId;
  if (code === "missing_id") return texts.missingId;
  if (code.startsWith("missing_field:")) {
    const field = code.split(":")[1] || "";
    return texts.validationMissingField.replace("{field}", field);
  }
  if (code === "missing_base_url") return texts.validationMissingBaseUrl;
  if (code === "missing_model") return texts.validationMissingModel;
  if (code === "missing_members") return texts.validationMissingMembers;
  if (code === "missing_pattern") return texts.validationMissingPattern;
  if (code === "missing_json_path") return texts.validationMissingJsonPath;
  if (code === "invalid_timeout") return texts.validationInvalidTimeout;
  if (code.startsWith("profile_exists")) {
    const id = code.split(":")[1] || "";
    if (id) return texts.validationProfileExists.replace("{id}", id);
    return texts.validationProfileExists
      .replace("{id}", "")
      .replace(/[:：]\s*$/, "")
      .trim();
  }
  if (code.startsWith("unsupported_type:")) {
    const type = code.split(":")[1] || "";
    return texts.validationInvalidType.replace("{type}", type);
  }
  if (code.startsWith("missing_reference:")) {
    const parts = code.split(":");
    const kind = parts[1] || "";
    const id = parts[2] || "";
    return texts.validationUnknownReference
      .replace("{kind}", kind)
      .replace("{id}", id);
  }
  return code;
};

const formatServerError = (error: any, fallback: string, texts: any) => {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  if (Array.isArray(error?.errors)) {
    return error.errors
      .map((code: string) => formatErrorCode(code, texts))
      .join("\n");
  }
  if (Array.isArray(error?.detail)) {
    return error.detail
      .map((code: string) => formatErrorCode(code, texts))
      .join("\n");
  }
  if (typeof error?.detail === "string")
    return formatErrorCode(error.detail, texts);
  try {
    return JSON.stringify(error);
  } catch {
    return fallback;
  }
};

interface ModelHubViewProps {
  lang: Language;
  onNavigate?: (view: string) => void;
}

export function ModelHubView({ lang, onNavigate }: ModelHubViewProps) {
  const t = translations[lang];
  const texts = t.modelHubView;
  const apiTexts = t.apiManager;

  const [source, setSource] = useState<SourceMode>("local");
  const [apiForm, setApiForm] = useState(DEFAULT_API_FORM);
  const [saving, setSaving] = useState(false);

  const requiredMissing = useMemo(() => {
    return (
      !apiForm.id.trim() || !apiForm.baseUrl.trim() || !apiForm.model.trim()
    );
  }, [apiForm]);

  const handleApiSave = async (openAfterSave?: boolean) => {
    if (requiredMissing) {
      emitToast({ title: texts.saveFail, description: texts.missingRequired });
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        id: apiForm.id.trim(),
        name: apiForm.name.trim() || apiForm.id.trim(),
        type: "openai_compat",
        base_url: apiForm.baseUrl.trim(),
        api_key: apiForm.apiKey.trim(),
        model: apiForm.model.trim(),
        headers: {},
        params: {},
      };
      const timeoutValue = Number(apiForm.timeout);
      if (Number.isFinite(timeoutValue) && timeoutValue > 0) {
        payload.timeout = timeoutValue;
      }
      const yamlText = yaml.dump(payload, { lineWidth: 120, noRefs: true });
      const result = await window.api?.pipelineV2ProfilesSave?.(
        "api",
        payload.id,
        yamlText,
      );
      if (result?.ok) {
        emitToast({ title: texts.saveOk, description: payload.id });
        if (Array.isArray(result.warnings) && result.warnings.length) {
          emitToast({
            title: apiTexts.validationWarn,
            description: result.warnings
              .map((code: string) => formatErrorCode(code, apiTexts))
              .join("\n"),
          });
        }
        if (openAfterSave) onNavigate?.("api_manager");
      } else {
        emitToast({
          title: texts.saveFail,
          description: formatServerError(
            result?.error,
            texts.saveFail,
            apiTexts,
          ),
        });
      }
    } catch (error: any) {
      emitToast({
        title: texts.saveFail,
        description: error?.message || texts.saveFail,
      });
    } finally {
      setSaving(false);
    }
  };

  const StepTag = ({ active, label }: { active?: boolean; label: string }) => (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold",
        active
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border/60 bg-secondary/20 text-muted-foreground",
      )}
    >
      <CheckCircle2
        className={cn("w-3.5 h-3.5", active ? "opacity-100" : "opacity-50")}
      />
      <span>{label}</span>
    </div>
  );

  return (
    <div className="flex-1 h-screen flex flex-col bg-background overflow-hidden">
      <div className="px-8 pt-8 pb-6 shrink-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <h2 className="text-2xl font-bold text-foreground">{texts.title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{texts.subtitle}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-2">
              <StepTag active label={texts.steps.select} />
              <StepTag
                active
                label={source === "api" ? texts.steps.api : texts.steps.local}
              />
              <StepTag label={texts.steps.compose} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 space-y-4">
            <div>
              <div className="text-sm font-semibold">{texts.chooseTitle}</div>
              <p className="text-xs text-muted-foreground">
                {texts.chooseDesc}
              </p>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card
                className={cn(
                  "cursor-pointer border transition-colors",
                  source === "local"
                    ? "border-primary/40 bg-primary/5"
                    : "border-border/60 hover:border-primary/30",
                )}
                onClick={() => setSource("local")}
              >
                <CardContent className="pt-5 space-y-4">
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "h-10 w-10 rounded-lg flex items-center justify-center",
                        source === "local"
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-muted-foreground",
                      )}
                    >
                      <Database className="w-5 h-5" />
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm font-semibold">
                        {texts.localCard.title}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {texts.localCard.desc}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{texts.localCard.hint}</span>
                    <Button
                      size="sm"
                      variant={source === "local" ? "default" : "outline"}
                    >
                      {source === "local"
                        ? texts.selectedAction
                        : texts.selectAction}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card
                className={cn(
                  "cursor-pointer border transition-colors",
                  source === "api"
                    ? "border-primary/40 bg-primary/5"
                    : "border-border/60 hover:border-primary/30",
                )}
                onClick={() => setSource("api")}
              >
                <CardContent className="pt-5 space-y-4">
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "h-10 w-10 rounded-lg flex items-center justify-center",
                        source === "api"
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-muted-foreground",
                      )}
                    >
                      <Server className="w-5 h-5" />
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm font-semibold">
                        {texts.apiCard.title}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {texts.apiCard.desc}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{texts.apiCard.hint}</span>
                    <Button
                      size="sm"
                      variant={source === "api" ? "default" : "outline"}
                    >
                      {source === "api"
                        ? texts.selectedAction
                        : texts.selectAction}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>

        {source === "local" && (
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="flex flex-col gap-2">
                <div className="text-sm font-semibold">
                  {texts.localActionsTitle}
                </div>
                <p className="text-xs text-muted-foreground">
                  {texts.localActionsDesc}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => onNavigate?.("model_local")}>
                  {texts.localActionsPrimary}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => onNavigate?.("service")}
                >
                  {texts.localActionsSecondary}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {source === "api" && (
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-sm font-semibold">
                    {texts.quickTitle}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {texts.quickDesc}
                  </p>
                </div>
                <div className="inline-flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 border border-primary/20 rounded-full px-2 py-1">
                  <Sparkles className="w-3 h-3" />
                  {texts.quickBadge}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>
                    {texts.form.idLabel}
                    <span className="text-red-500 ml-1">*</span>
                  </Label>
                  <Input
                    value={apiForm.id}
                    onChange={(e) =>
                      setApiForm((prev) => ({ ...prev, id: e.target.value }))
                    }
                    placeholder={texts.placeholders.id}
                  />
                  <div className="text-[11px] text-muted-foreground">
                    {texts.help.id}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{texts.form.nameLabel}</Label>
                  <Input
                    value={apiForm.name}
                    onChange={(e) =>
                      setApiForm((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder={texts.placeholders.name}
                  />
                </div>
                <div className="space-y-2">
                  <Label>
                    {texts.form.baseUrlLabel}
                    <span className="text-red-500 ml-1">*</span>
                  </Label>
                  <Input
                    value={apiForm.baseUrl}
                    onChange={(e) =>
                      setApiForm((prev) => ({
                        ...prev,
                        baseUrl: e.target.value,
                      }))
                    }
                    placeholder={texts.placeholders.baseUrl}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{texts.form.apiKeyLabel}</Label>
                  <Input
                    type="password"
                    value={apiForm.apiKey}
                    onChange={(e) =>
                      setApiForm((prev) => ({
                        ...prev,
                        apiKey: e.target.value,
                      }))
                    }
                    placeholder={texts.placeholders.apiKey}
                  />
                  <div className="text-[11px] text-muted-foreground">
                    {texts.help.apiKey}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>
                    {texts.form.modelLabel}
                    <span className="text-red-500 ml-1">*</span>
                  </Label>
                  <Input
                    value={apiForm.model}
                    onChange={(e) =>
                      setApiForm((prev) => ({ ...prev, model: e.target.value }))
                    }
                    placeholder={texts.placeholders.model}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{texts.form.timeoutLabel}</Label>
                  <Input
                    value={apiForm.timeout}
                    onChange={(e) =>
                      setApiForm((prev) => ({
                        ...prev,
                        timeout: e.target.value,
                      }))
                    }
                    placeholder={texts.placeholders.timeout}
                  />
                  <div className="text-[11px] text-muted-foreground">
                    {texts.help.timeout}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button onClick={() => handleApiSave(false)} disabled={saving}>
                  {texts.save}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleApiSave(true)}
                  disabled={saving}
                >
                  {texts.saveAndOpen}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setApiForm(DEFAULT_API_FORM)}
                  disabled={saving}
                >
                  {texts.reset}
                </Button>
              </div>
              {requiredMissing && (
                <div className="text-xs text-muted-foreground">
                  {texts.missingRequired}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">
                  {texts.advancedTitle}
                </div>
                <p className="text-xs text-muted-foreground">
                  {texts.advancedDesc}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => onNavigate?.("api_manager")}
              >
                {texts.advancedAction}
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
