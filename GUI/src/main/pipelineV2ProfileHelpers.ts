export const canUseServerProfilesPath = (
  serverPath: unknown,
  exists: (path: string) => boolean,
) =>
  typeof serverPath === "string" && serverPath.trim().length > 0 && exists(serverPath);

export const hasServerProfilesList = (data: unknown) => Array.isArray(data);
