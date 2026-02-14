export const CONFIG_SNAPSHOT_VERSION = 1;

export interface ConfigSnapshot {
  version: number;
  exportedAt: string;
  appVersion?: string;
  data: Record<string, string>;
}

const isAllowedKey = (key: string) =>
  key === "app_lang" || key.startsWith("config_");

export const buildConfigSnapshot = (appVersion: string): ConfigSnapshot => {
  const data: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !isAllowedKey(key)) continue;
    const value = localStorage.getItem(key);
    if (value !== null) data[key] = value;
  }
  return {
    version: CONFIG_SNAPSHOT_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion,
    data,
  };
};

export const parseConfigSnapshot = (raw: string) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  if (!parsed || typeof parsed !== "object") {
    return { error: "Invalid snapshot" };
  }

  const snapshot = parsed as Partial<ConfigSnapshot> & {
    data?: Record<string, string>;
  };

  if (typeof snapshot.version !== "number") {
    return { error: "Missing version" };
  }
  if (snapshot.version !== CONFIG_SNAPSHOT_VERSION) {
    return { error: `Unsupported version: ${snapshot.version}` };
  }
  if (!snapshot.data || typeof snapshot.data !== "object") {
    return { error: "Missing data" };
  }

  const cleaned: Record<string, string> = {};
  Object.entries(snapshot.data).forEach(([key, value]) => {
    if (!isAllowedKey(key)) return;
    if (typeof value === "string") cleaned[key] = value;
  });

  if (Object.keys(cleaned).length === 0) {
    return { error: "Empty snapshot" };
  }

  return {
    snapshot: {
      version: snapshot.version,
      exportedAt: snapshot.exportedAt || new Date().toISOString(),
      appVersion: snapshot.appVersion,
      data: cleaned,
    },
  };
};
