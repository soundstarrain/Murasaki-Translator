const CODE_FENCE_MARKERS = ["```", "'''", '"""'];
const CODE_FENCE_PATTERNS = [
  /```(?:jsonl|json|text)?\s*([\s\S]*?)```/i,
  /'''(?:jsonl|json|text)?\s*([\s\S]*?)'''/i,
  /"""(?:jsonl|json|text)?\s*([\s\S]*?)"""/i,
];
const THINK_PATTERN_CLOSED = /<think>.*?<\/think>/gis;
const THINK_PATTERN_OPEN = /<think>(.*?)(?:<\/think>|$)/gis;

export const stripThinkTags = (text: string) => {
  if (!text) return text;
  let cleaned = text.replace(THINK_PATTERN_CLOSED, "");
  if (cleaned === text) {
    cleaned = cleaned.replace(THINK_PATTERN_OPEN, "");
  }
  return cleaned.replace(/<think>|<\/think>/gi, "").trim();
};

const stripCodeFence = (text: string) => {
  const cleaned = text.trim();
  for (const pattern of CODE_FENCE_PATTERNS) {
    const match = pattern.exec(cleaned);
    if (match) return match[1].trim();
  }
  return cleaned;
};

const extractFirstJsonBlock = (text: string) => {
  if (!text) return "";
  let start: number | null = null;
  const stack: string[] = [];
  let inStr = false;
  let escape = false;
  for (let idx = 0; idx < text.length; idx += 1) {
    const ch = text[idx];
    if (inStr) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === "\"") {
        inStr = false;
      }
      continue;
    }
    if (ch === "\"") {
      inStr = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      if (!stack.length) start = idx;
      stack.push(ch);
    } else if (ch === "}" || ch === "]") {
      if (!stack.length) continue;
      const opening = stack[stack.length - 1];
      if ((opening === "{" && ch === "}") || (opening === "[" && ch === "]")) {
        stack.pop();
        if (!stack.length && start !== null) {
          return text.slice(start, idx + 1);
        }
      } else {
        stack.pop();
      }
    }
  }
  return "";
};

const stripStringPrefixes = (raw: string) =>
  raw.replace(/\b([uUbBrR]{1,3})(?=['"])/g, "");

const toJsonCompatible = (raw: string) => {
  const normalizedInput = stripStringPrefixes(raw);
  const out: string[] = [];
  let inSingle = false;
  let inDouble = false;
  let escape = false;
  let word = "";
  const stack: Array<{
    type: string;
    outIndex?: number;
    hasComma?: boolean;
    hasContent?: boolean;
  }> = [];
  const markParenContent = (ch: string) => {
    const top = stack[stack.length - 1];
    if (!top || top.type !== "(") return;
    if (ch.trim() === "" || ch === "," || ch === ")") return;
    top.hasContent = true;
  };
  const flushWord = () => {
    if (!word) return;
    if (word === "None") out.push("null");
    else if (word === "True") out.push("true");
    else if (word === "False") out.push("false");
    else out.push(word);
    word = "";
  };
  for (let i = 0; i < normalizedInput.length; i += 1) {
    const ch = normalizedInput[i];
    if (!inSingle && !inDouble) {
      markParenContent(ch);
    }
    if (inSingle) {
      if (escape) {
        out.push(ch);
        escape = false;
      } else if (ch === "\\") {
        out.push(ch);
        escape = true;
      } else if (ch === "'") {
        inSingle = false;
        out.push('"');
      } else {
        out.push(ch === '"' ? '\\"' : ch);
      }
      continue;
    }
    if (inDouble) {
      if (escape) {
        out.push(ch);
        escape = false;
      } else if (ch === "\\") {
        out.push(ch);
        escape = true;
      } else if (ch === '"') {
        inDouble = false;
        out.push(ch);
      } else {
        out.push(ch);
      }
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      word += ch;
      continue;
    }
    flushWord();
    if (ch === "'") {
      inSingle = true;
      out.push('"');
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      out.push(ch);
      continue;
    }
    if (ch === "(") {
      stack.push({
        type: "(",
        outIndex: out.length,
        hasComma: false,
        hasContent: false,
      });
      out.push("(");
      continue;
    }
    if (ch === ")") {
      const entry = stack.pop();
      if (entry?.type === "(" && entry.outIndex !== undefined) {
        if (entry.hasComma || !entry.hasContent) {
          out[entry.outIndex] = "[";
          out.push("]");
        } else {
          out[entry.outIndex] = "";
        }
      } else {
        out.push(ch);
      }
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push({ type: ch });
      out.push(ch);
      continue;
    }
    if (ch === "}" || ch === "]") {
      if (stack.length) stack.pop();
      out.push(ch);
      continue;
    }
    if (ch === ",") {
      const top = stack[stack.length - 1];
      if (top?.type === "(") {
        top.hasComma = true;
      }
      out.push(ch);
      continue;
    }
    out.push(ch);
  }
  flushWord();
  return out.join("").replace(/,(\s*[}\]])/g, "$1");
};

const parseJsonLike = (candidate: string) => {
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    // ignore
  }
  try {
    const normalized = toJsonCompatible(candidate);
    return JSON.parse(normalized);
  } catch {
    // ignore
  }
  return null;
};

export const parseJsonPreviewValue = (raw: string) => {
  const cleaned = stripCodeFence(stripThinkTags(raw));
  const candidates = [cleaned];
  const extracted = extractFirstJsonBlock(cleaned);
  if (extracted && extracted !== cleaned) candidates.push(extracted);
  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = parseJsonLike(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
};

const getByPath = (data: any, path: string) => {
  let current = data;
  const parts = path.split(".");
  for (const part of parts) {
    if (!part) continue;
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index)) {
        throw new Error("list_index_invalid");
      }
      current = current[index];
    } else if (current && typeof current === "object") {
      if (!(part in current)) {
        throw new Error("key_not_found");
      }
      current = current[part];
    } else {
      throw new Error("invalid_path");
    }
  }
  return current;
};

const normalizeRegexPattern = (pattern: string) =>
  pattern.replace(/\(\?P</g, "(?<");

const buildRegexWithFlags = (pattern: string, options?: any) => {
  let flags = "";
  const rawFlags = options?.flags;
  const flagList = Array.isArray(rawFlags)
    ? rawFlags
    : typeof rawFlags === "string"
      ? rawFlags.split(",").map((item) => item.trim())
      : [];
  if (
    flagList.some((item) => String(item).toLowerCase() === "dotall") ||
    options?.dotall
  ) {
    flags += "s";
  }
  if (
    flagList.some((item) => String(item).toLowerCase() === "multiline") ||
    options?.multiline
  ) {
    flags += "m";
  }
  if (
    flagList.some((item) => String(item).toLowerCase() === "ignorecase") ||
    options?.ignorecase
  ) {
    flags += "i";
  }
  flags = flags.replace(/g/g, "");
  return new RegExp(normalizeRegexPattern(pattern), flags);
};

export const parseJsonlPreviewLines = (rawInput: string, path?: string) => {
  const cleanedText = stripCodeFence(stripThinkTags(rawInput));
  const lines: string[] = [];
  cleanedText.split("\n").forEach((rawLine) => {
    const line = rawLine.trim();
    if (line === "") {
      lines.push("");
      return;
    }
    if (CODE_FENCE_MARKERS.some((marker) => line.startsWith(marker))) {
      return;
    }
    let normalized = line;
    if (normalized.toLowerCase().startsWith("jsonline")) {
      normalized = normalized.slice("jsonline".length).trim();
    }
    const data = parseJsonPreviewValue(normalized);
    if (data === null) {
      throw new Error("jsonl_invalid");
    }
    const value = path ? getByPath(data, path) : data;
    lines.push(String(value));
  });
  return lines;
};

export const parseTaggedLinePreviewLines = (
  rawInput: string,
  options?: {
    pattern?: string;
    sortById?: boolean;
    sortByLineNumber?: boolean;
    flags?: string[] | string;
    multiline?: boolean;
    dotall?: boolean;
    ignorecase?: boolean;
  },
) => {
  const cleanedInput = stripThinkTags(rawInput);
  const pattern = options?.pattern || "^@@(?P<id>\\d+)@@(?P<text>.*)$";
  const regex = buildRegexWithFlags(pattern, options);
  const entries: Array<{ id?: string; text: string }> = [];
  cleanedInput.split("\n").forEach((line) => {
    const match = regex.exec(line.trim());
    if (!match) return;
    const groups = (match as any).groups as Record<string, string> | undefined;
    const lineId = groups?.id ?? match[1];
    const text = groups?.text ?? match[2] ?? "";
    entries.push({ id: lineId, text });
  });
  if (!entries.length) {
    throw new Error("no_tagged_lines");
  }
  const shouldSort = Boolean(options?.sortById || options?.sortByLineNumber);
  if (shouldSort) {
    const hasAllIds = entries.every((item) => String(item.id || "").trim());
    if (hasAllIds) {
      entries.sort((a, b) => {
        const rawA = String(a.id || "");
        const rawB = String(b.id || "");
        const intA = Number.parseInt(rawA, 10);
        const intB = Number.parseInt(rawB, 10);
        const hasIntA = Number.isFinite(intA);
        const hasIntB = Number.isFinite(intB);
        const keyA = hasIntA ? `0-${String(intA).padStart(8, "0")}` : `1-${rawA}`;
        const keyB = hasIntB ? `0-${String(intB).padStart(8, "0")}` : `1-${rawB}`;
        return keyA.localeCompare(keyB);
      });
    }
  }
  return entries.map((item) => item.text);
};
