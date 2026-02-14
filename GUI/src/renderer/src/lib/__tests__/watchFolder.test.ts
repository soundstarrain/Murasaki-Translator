import { describe, expect, it } from "vitest";

import {
  filterWatchFilesByTypes,
  isLikelyTranslatedOutput,
  normalizeWatchFileTypes,
  normalizeWatchFolderConfig,
} from "../watchFolder";

describe("watchFolder helpers", () => {
  it("normalizes file type inputs", () => {
    expect(normalizeWatchFileTypes([" .TXT ", ".Srt", "", "  "])).toEqual([
      "txt",
      "srt",
    ]);
  });

  it("normalizes watch folder config defaults", () => {
    expect(
      normalizeWatchFolderConfig({
        id: "watch-1",
        path: "  C:/Media  ",
        fileTypes: [".TXT"],
      }),
    ).toEqual({
      id: "watch-1",
      path: "C:/Media",
      includeSubdirs: false,
      enabled: true,
      fileTypes: ["txt"],
      createdAt: undefined,
    });
  });

  it("filters paths by configured types and supported extensions", () => {
    const paths = ["a.srt", "b.txt", "c.doc", "d.SRT"];
    const supported = [".srt", ".txt"];

    expect(filterWatchFilesByTypes(paths, ["SRT"], supported)).toEqual([
      "a.srt",
      "d.SRT",
    ]);
    expect(filterWatchFilesByTypes(paths, [], supported)).toEqual([
      "a.srt",
      "b.txt",
      "d.SRT",
    ]);
  });

  it("detects likely translated outputs by suffix and model name", () => {
    const supported = [".srt", ".txt"];
    expect(
      isLikelyTranslatedOutput("movie_translated.srt", ["ModelA"], supported),
    ).toBe(true);
    expect(
      isLikelyTranslatedOutput("movie_modela.srt", ["ModelA.gguf"], supported),
    ).toBe(true);
    expect(
      isLikelyTranslatedOutput("movie_modela.doc", ["ModelA"], supported),
    ).toBe(false);
  });
});
