import { describe, it, expect } from "vitest";
import {
  parseJsonlPreviewLines,
  parseJsonPreviewValue,
  parseTaggedLinePreviewLines,
} from "../parserPreview";

describe("parserPreview helpers", () => {
  it("parses jsonline JSONL with path", () => {
    const raw = 'jsonline{"translation":"A"}';
    const lines = parseJsonlPreviewLines(raw, "translation");
    expect(lines).toEqual(["A"]);
  });

  it("parses JSONL inside code fences", () => {
    const raw = "```jsonl\njsonline{\"translation\":\"B\"}\n```";
    const lines = parseJsonlPreviewLines(raw, "translation");
    expect(lines).toEqual(["B"]);
  });

  it("extracts JSON block from mixed text", () => {
    const data = parseJsonPreviewValue("Answer: {\"ok\": true}");
    expect(data).toEqual({ ok: true });
  });

  it("throws on invalid JSONL", () => {
    expect(() => parseJsonlPreviewLines("not_json")).toThrow();
  });

  it("parses tagged lines with python-style groups", () => {
    const raw = "@@2@@B\n@@1@@A";
    const lines = parseTaggedLinePreviewLines(raw, {
      pattern: "^@@(?P<id>\\d+)@@(?P<text>.*)$",
    });
    expect(lines).toEqual(["B", "A"]);
  });

  it("sorts tagged lines by id when enabled", () => {
    const raw = "@@2@@B\n@@1@@A";
    const lines = parseTaggedLinePreviewLines(raw, {
      pattern: "^@@(?P<id>\\d+)@@(?P<text>.*)$",
      sortById: true,
    });
    expect(lines).toEqual(["A", "B"]);
  });
});
