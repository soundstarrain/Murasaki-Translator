export interface HfDownloadRepoSummary {
  id: string;
  name: string;
  downloads: number;
}

const BLOCKED_REPO_KEYWORDS = ["APE"];

const toSafeDownloads = (downloads: number) =>
  Number.isFinite(downloads) ? downloads : 0;

export const shouldHideHfDownloadRepo = (
  repo: Pick<HfDownloadRepoSummary, "name">,
): boolean => {
  const upperName = repo.name.toUpperCase();
  return BLOCKED_REPO_KEYWORDS.some((keyword) => upperName.includes(keyword));
};

export const sortHfDownloadRepos = <T extends HfDownloadRepoSummary>(
  repos: readonly T[],
): T[] =>
  repos
    .filter((repo) => !shouldHideHfDownloadRepo(repo))
    .sort((left, right) => {
      const downloadDelta =
        toSafeDownloads(right.downloads) - toSafeDownloads(left.downloads);
      if (downloadDelta !== 0) return downloadDelta;
      return left.name.localeCompare(right.name, undefined, {
        sensitivity: "base",
        numeric: true,
      });
    });
