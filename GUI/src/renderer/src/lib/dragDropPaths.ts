type ElectronFileLike = Partial<File> & {
  path?: string;
};

type DragItemLike = {
  kind?: string;
  getAsFile?: () => File | null;
};

type DragTransferLike = {
  items?: ArrayLike<DragItemLike> | null;
  files?: ArrayLike<File> | null;
};

export type ElectronDragPathResolver = (
  file?: File | null,
) => string | undefined;

const readElectronFilePath = (
  file: ElectronFileLike | null | undefined,
  resolvePath?: ElectronDragPathResolver,
) => {
  const resolvedPath = resolvePath?.(file as File | null | undefined) || "";
  if (resolvedPath.trim()) return resolvedPath.trim();
  const rawPath = typeof file?.path === "string" ? file.path.trim() : "";
  return rawPath;
};

const resolveRendererFilePath = (file?: File | null) => {
  if (!file) return "";
  try {
    return window.electron?.webUtils?.getPathForFile?.(file) || "";
  } catch {
    return "";
  }
};

export const extractElectronDragPaths = (
  dataTransfer?: DragTransferLike | null,
  resolvePath?: ElectronDragPathResolver,
): string[] => {
  if (!dataTransfer) return [];

  const results: string[] = [];
  const seen = new Set<string>();
  const effectiveResolver = resolvePath || resolveRendererFilePath;
  const pushPath = (file: ElectronFileLike | null | undefined) => {
    const path = readElectronFilePath(file, effectiveResolver);
    if (!path || seen.has(path)) return;
    seen.add(path);
    results.push(path);
  };

  const items = Array.from(dataTransfer.items || []);
  for (const item of items) {
    if (item?.kind !== "file") continue;
    pushPath(item.getAsFile?.());
  }

  const files = Array.from(dataTransfer.files || []);
  for (const file of files) {
    pushPath(file);
  }

  return results;
};
