import { dirname, join } from "path";

type FsStatLike = {
  isDirectory: () => boolean;
  isFile: () => boolean;
};

type FsLike = {
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string, options?: { recursive?: boolean }) => void;
  renameSync: (oldPath: string, newPath: string) => void;
  readdirSync: (path: string) => string[];
  statSync: (path: string) => FsStatLike;
  copyFileSync: (source: string, destination: string) => void;
  rmSync: (
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ) => void;
};

export interface ResolveProfilesDirInput {
  profilesDir: string;
  legacyDir: string;
  fsLike: FsLike;
}

export interface ResolveProfilesDirResult {
  activeDir: string;
  usedLegacyFallback: boolean;
}

const copyLegacyDirIntoProfilesDir = (
  sourceDir: string,
  targetDir: string,
  fsLike: FsLike,
) => {
  fsLike.mkdirSync(targetDir, { recursive: true });
  for (const entry of fsLike.readdirSync(sourceDir)) {
    const sourcePath = join(sourceDir, entry);
    const targetPath = join(targetDir, entry);
    const sourceStat = fsLike.statSync(sourcePath);

    if (sourceStat.isDirectory()) {
      copyLegacyDirIntoProfilesDir(sourcePath, targetPath, fsLike);
      continue;
    }

    if (!sourceStat.isFile()) continue;
    fsLike.mkdirSync(dirname(targetPath), { recursive: true });
    fsLike.copyFileSync(sourcePath, targetPath);
  }
};

export const resolveProfilesDirWithLegacyFallback = (
  input: ResolveProfilesDirInput,
): ResolveProfilesDirResult => {
  const { profilesDir, legacyDir, fsLike } = input;
  let activeDir = profilesDir;
  let usedLegacyFallback = false;

  if (legacyDir !== profilesDir && fsLike.existsSync(legacyDir)) {
    if (!fsLike.existsSync(profilesDir)) {
      try {
        fsLike.mkdirSync(dirname(profilesDir), { recursive: true });
        fsLike.renameSync(legacyDir, profilesDir);
      } catch {
        activeDir = legacyDir;
        usedLegacyFallback = true;
      }
    } else {
      try {
        copyLegacyDirIntoProfilesDir(legacyDir, profilesDir, fsLike);
        fsLike.rmSync(legacyDir, { recursive: true, force: true });
      } catch {
        activeDir = legacyDir;
        usedLegacyFallback = true;
      }
    }
  }

  if (!fsLike.existsSync(activeDir)) {
    fsLike.mkdirSync(activeDir, { recursive: true });
  }

  return {
    activeDir,
    usedLegacyFallback,
  };
};
