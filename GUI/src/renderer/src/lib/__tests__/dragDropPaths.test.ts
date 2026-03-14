import { describe, expect, it } from "vitest";
import { extractElectronDragPaths } from "../dragDropPaths";

describe("extractElectronDragPaths", () => {
  it("reads paths from drag items", () => {
    const paths = extractElectronDragPaths(
      {
        items: [
          {
            kind: "file",
            getAsFile: () => ({ path: "E:/books/a.epub" } as unknown as File),
          },
        ],
      },
      undefined,
    );

    expect(paths).toEqual(["E:/books/a.epub"]);
  });

  it("falls back to files when drag items do not expose path", () => {
    const resolver = (file?: File | null) =>
      file?.name === "b.txt" ? "E:/books/b.txt" : "";
    const paths = extractElectronDragPaths(
      {
        items: [
          {
            kind: "file",
            getAsFile: () => ({ path: "" } as unknown as File),
          },
        ],
        files: [{ name: "b.txt" } as File],
      },
      resolver,
    );

    expect(paths).toEqual(["E:/books/b.txt"]);
  });

  it("deduplicates paths collected from items and files", () => {
    const resolver = (file?: File | null) => {
      if (file?.name === "d.ass") return "E:/books/d.ass";
      return "";
    };
    const paths = extractElectronDragPaths(
      {
        items: [
          {
            kind: "file",
            getAsFile: () => ({ path: "E:/books/c.srt" } as unknown as File),
          },
        ],
        files: [{ name: "c.srt" } as File, { name: "d.ass" } as File],
      },
      resolver,
    );

    expect(paths).toEqual(["E:/books/c.srt", "E:/books/d.ass"]);
  });

  it("ignores non-file items and empty paths", () => {
    const paths = extractElectronDragPaths(
      {
        items: [
          {
            kind: "string",
            getAsFile: () => ({ path: "E:/books/ignored.txt" } as unknown as File),
          },
          {
            kind: "file",
            getAsFile: () => null,
          },
        ],
        files: [{ name: "blank.txt" } as File],
      },
      () => "   ",
    );

    expect(paths).toEqual([]);
  });
});
