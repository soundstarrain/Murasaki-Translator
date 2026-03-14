import { describe, expect, it } from "vitest";
import { resolveProfilesDirWithLegacyFallback } from "../profileDirMigration";

type EntryType = "file" | "dir";

type Entry = {
  type: EntryType;
};

const normalizePath = (value: string) => value.replace(/\\/g, "/");

const dirname = (value: string) => {
  const normalized = normalizePath(value);
  const idx = normalized.lastIndexOf("/");
  return idx <= 0 ? "/" : normalized.slice(0, idx);
};

const createFsMock = (initialEntries: Record<string, EntryType> = {}) => {
  const entries = new Map<string, Entry>();
  const mkdirCalls: string[] = [];
  const renameCalls: Array<{ from: string; to: string }> = [];
  const copyCalls: Array<{ from: string; to: string }> = [];
  const rmCalls: string[] = [];

  const ensureDir = (path: string) => {
    const normalized = normalizePath(path);
    if (!entries.has(normalized)) {
      entries.set(normalized, { type: "dir" });
    }
  };

  for (const [path, type] of Object.entries(initialEntries)) {
    const normalized = normalizePath(path);
    entries.set(normalized, { type });
    let current = dirname(normalized);
    while (current && current !== normalized && !entries.has(current)) {
      entries.set(current, { type: "dir" });
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  const moveTree = (from: string, to: string) => {
    const normalizedFrom = normalizePath(from);
    const normalizedTo = normalizePath(to);
    const snapshots = Array.from(entries.entries()).filter(
      ([entryPath]) =>
        entryPath === normalizedFrom || entryPath.startsWith(`${normalizedFrom}/`),
    );
    for (const [entryPath] of snapshots) {
      entries.delete(entryPath);
    }
    for (const [entryPath, entry] of snapshots) {
      const nextPath = normalizedTo + entryPath.slice(normalizedFrom.length);
      entries.set(nextPath, entry);
    }
  };

  return {
    fsLike: {
      existsSync: (path: string) => entries.has(normalizePath(path)),
      mkdirSync: (path: string) => {
        const normalized = normalizePath(path);
        mkdirCalls.push(normalized);
        ensureDir(normalized);
      },
      renameSync: (from: string, to: string) => {
        renameCalls.push({ from: normalizePath(from), to: normalizePath(to) });
        moveTree(from, to);
      },
      readdirSync: (path: string) => {
        const normalized = normalizePath(path);
        const names = new Set<string>();
        for (const entryPath of entries.keys()) {
          if (!entryPath.startsWith(`${normalized}/`)) continue;
          const rest = entryPath.slice(normalized.length + 1);
          if (!rest) continue;
          names.add(rest.split("/")[0]);
        }
        return Array.from(names);
      },
      statSync: (path: string) => {
        const normalized = normalizePath(path);
        const entry = entries.get(normalized);
        if (!entry) throw new Error(`Missing path: ${normalized}`);
        return {
          isDirectory: () => entry.type === "dir",
          isFile: () => entry.type === "file",
        };
      },
      copyFileSync: (from: string, to: string) => {
        const normalizedFrom = normalizePath(from);
        const normalizedTo = normalizePath(to);
        copyCalls.push({ from: normalizedFrom, to: normalizedTo });
        ensureDir(dirname(normalizedTo));
        entries.set(normalizedTo, { type: "file" });
      },
      rmSync: (path: string) => {
        const normalized = normalizePath(path);
        rmCalls.push(normalized);
        for (const entryPath of Array.from(entries.keys())) {
          if (entryPath === normalized || entryPath.startsWith(`${normalized}/`)) {
            entries.delete(entryPath);
          }
        }
      },
    },
    entries,
    mkdirCalls,
    renameCalls,
    copyCalls,
    rmCalls,
  };
};

describe("profileDirMigration", () => {
  it("migrates user-data dir via rename when middleware target is missing", () => {
    const profilesDir = "/app/middleware/pipeline_v2_profiles";
    const legacyDir = "/app/userdata/pipeline_v2_profiles";
    const mock = createFsMock({
      [legacyDir]: "dir",
      [`${legacyDir}/pipeline`]: "dir",
      [`${legacyDir}/pipeline/ds.yaml`]: "file",
    });

    const result = resolveProfilesDirWithLegacyFallback({
      profilesDir,
      legacyDir,
      fsLike: mock.fsLike,
    });

    expect(result).toEqual({
      activeDir: profilesDir,
      usedLegacyFallback: false,
    });
    expect(mock.renameCalls).toEqual([{ from: legacyDir, to: profilesDir }]);
    expect(mock.entries.has(`${profilesDir}/pipeline/ds.yaml`)).toBe(true);
    expect(mock.entries.has(`${legacyDir}/pipeline/ds.yaml`)).toBe(false);
  });

  it("merges user-data contents into middleware dir when target already exists", () => {
    const profilesDir = "/app/middleware/pipeline_v2_profiles";
    const legacyDir = "/app/userdata/pipeline_v2_profiles";
    const mock = createFsMock({
      [profilesDir]: "dir",
      [`${profilesDir}/prompt`]: "dir",
      [`${profilesDir}/prompt/default.yaml`]: "file",
      [legacyDir]: "dir",
      [`${legacyDir}/pipeline`]: "dir",
      [`${legacyDir}/pipeline/ds.yaml`]: "file",
      [`${legacyDir}/api`]: "dir",
      [`${legacyDir}/api/new_api.yaml`]: "file",
    });

    const result = resolveProfilesDirWithLegacyFallback({
      profilesDir,
      legacyDir,
      fsLike: mock.fsLike,
    });

    expect(result).toEqual({
      activeDir: profilesDir,
      usedLegacyFallback: false,
    });
    expect(mock.copyCalls).toEqual([
      {
        from: `${legacyDir}/pipeline/ds.yaml`,
        to: `${profilesDir}/pipeline/ds.yaml`,
      },
      {
        from: `${legacyDir}/api/new_api.yaml`,
        to: `${profilesDir}/api/new_api.yaml`,
      },
    ]);
    expect(mock.rmCalls).toEqual([legacyDir]);
    expect(mock.entries.has(`${profilesDir}/pipeline/ds.yaml`)).toBe(true);
    expect(mock.entries.has(`${profilesDir}/api/new_api.yaml`)).toBe(true);
    expect(mock.entries.has(`${legacyDir}/pipeline/ds.yaml`)).toBe(false);
  });

  it("falls back to user-data dir when migration fails", () => {
    const profilesDir = "/app/middleware/pipeline_v2_profiles";
    const legacyDir = "/app/userdata/pipeline_v2_profiles";
    const mock = createFsMock({ [legacyDir]: "dir" });
    mock.fsLike.renameSync = () => {
      throw new Error("rename failed");
    };

    const result = resolveProfilesDirWithLegacyFallback({
      profilesDir,
      legacyDir,
      fsLike: mock.fsLike,
    });

    expect(result).toEqual({
      activeDir: legacyDir,
      usedLegacyFallback: true,
    });
  });

  it("ensures active directory exists", () => {
    const profilesDir = "/app/middleware/pipeline_v2_profiles";
    const legacyDir = "/app/userdata/pipeline_v2_profiles";
    const mock = createFsMock({});

    const result = resolveProfilesDirWithLegacyFallback({
      profilesDir,
      legacyDir,
      fsLike: mock.fsLike,
    });

    expect(result.activeDir).toBe(profilesDir);
    expect(mock.mkdirCalls).toContain(profilesDir);
  });
});
