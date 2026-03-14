import { describe, expect, it } from "vitest";
import {
  shouldHideHfDownloadRepo,
  sortHfDownloadRepos,
} from "../hfDownloadRepos";

describe("sortHfDownloadRepos", () => {
  it("hides repositories whose model name contains APE", () => {
    const repos = [
      { id: "a", name: "Murasaki-4B", downloads: 3200 },
      { id: "b", name: "Murasaki-APE-4B", downloads: 9999 },
    ];

    expect(sortHfDownloadRepos(repos).map((repo) => repo.name)).toEqual([
      "Murasaki-4B",
    ]);
    expect(shouldHideHfDownloadRepo(repos[1])).toBe(true);
  });

  it("sorts repositories by downloads descending by default", () => {
    const repos = [
      { id: "b", name: "Murasaki-8B", downloads: 1200 },
      { id: "a", name: "Murasaki-4B", downloads: 3200 },
      { id: "c", name: "Murasaki-14B", downloads: 800 },
    ];

    expect(sortHfDownloadRepos(repos).map((repo) => repo.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("falls back to stable name ordering when downloads tie", () => {
    const repos = [
      { id: "b", name: "Murasaki-14B", downloads: 1000 },
      { id: "a", name: "Murasaki-4B", downloads: 1000 },
      { id: "c", name: "Murasaki-8B", downloads: 1000 },
    ];

    expect(sortHfDownloadRepos(repos).map((repo) => repo.name)).toEqual([
      "Murasaki-4B",
      "Murasaki-8B",
      "Murasaki-14B",
    ]);
  });
});
