const ANCHOR_TOKEN_REGEX = /@(?:id|end)=\d+@/gi;
const HTML_TAG_REGEX = /<[^>]+>/g;
const ASS_OVERRIDE_TAG_REGEX = /\{\\[^}]*\}/g;
const SRT_TIMECODE_REGEX =
  /^\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*$/;
const SRT_INDEX_REGEX = /^\s*\d+\s*$/;
const FILENAME_ONLY_REGEX =
  /^\s*[\w-]+\.(?:jpg|jpeg|png|gif|webp|bmp|tiff|svg|mp3|wav|ogg|mp4|mkv|avi|mov|pdf|zip|rar|7z)\s*$/i;
const JAPANESE_CHAR_REGEX = /[\u3040-\u30FF\u31F0-\u31FF\u4E00-\u9FFF]/g;
const MEANINGFUL_CHAR_REGEX =
  /[A-Za-z0-9\u3040-\u30FF\u31F0-\u31FF\u4E00-\u9FFF]/g;

export function normalizeForSimilarity(text: string): string {
  return text
    .replace(ANCHOR_TOKEN_REGEX, " ")
    .replace(ASS_OVERRIDE_TAG_REGEX, " ")
    .replace(HTML_TAG_REGEX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function countJapaneseChars(text: string): number {
  const matches = text.match(JAPANESE_CHAR_REGEX);
  return matches ? matches.length : 0;
}

export function countMeaningfulChars(text: string): number {
  const matches = text.match(MEANINGFUL_CHAR_REGEX);
  return matches ? matches.length : 0;
}

function isTrivialLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (SRT_TIMECODE_REGEX.test(trimmed)) return true;
  if (SRT_INDEX_REGEX.test(trimmed)) return true;
  const normalized = normalizeForSimilarity(trimmed);
  if (!normalized) return true;
  if (FILENAME_ONLY_REGEX.test(normalized)) return true;
  return false;
}

function extractAssDialogueText(line: string): string {
  const trimmed = line.trim();
  if (!/^(Dialogue|Comment):/i.test(trimmed)) return trimmed;
  const parts = trimmed.split(",");
  if (parts.length <= 1) return "";
  return parts.slice(9).join(",").trim();
}

export function getEffectiveLineCount(text: string): number {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      if (/^(Style|Format):/i.test(trimmed)) return "";
      if (SRT_TIMECODE_REGEX.test(trimmed)) return "";
      if (SRT_INDEX_REGEX.test(trimmed)) return "";
      const assText = extractAssDialogueText(trimmed);
      const normalized = normalizeForSimilarity(assText);
      if (!normalized) return "";
      if (FILENAME_ONLY_REGEX.test(normalized)) return "";
      return normalized;
    })
    .filter(Boolean).length;
}

export function calculateSimilarity(src: string, dst: string): number {
  const srcNorm = normalizeForSimilarity(src);
  const dstNorm = normalizeForSimilarity(dst);
  const srcChars = new Set(srcNorm.match(MEANINGFUL_CHAR_REGEX) || []);
  const dstChars = new Set(dstNorm.match(MEANINGFUL_CHAR_REGEX) || []);
  let overlap = 0;
  srcChars.forEach((c) => {
    if (dstChars.has(c)) overlap++;
  });
  return overlap / Math.max(srcChars.size, 1);
}

export function findHighSimilarityLines(src: string, dst: string): number[] {
  const srcLines = src.split(/\r?\n/);
  const dstLines = dst.split(/\r?\n/);
  const minLen = Math.min(srcLines.length, dstLines.length);
  const similarLines: number[] = [];

  for (let i = 0; i < minLen; i++) {
    const sRaw = srcLines[i] || "";
    const dRaw = dstLines[i] || "";
    if (isTrivialLine(sRaw) || isTrivialLine(dRaw)) continue;
    const s = normalizeForSimilarity(sRaw);
    const d = normalizeForSimilarity(dRaw);

    const sMeaningful = countMeaningfulChars(s);
    const dMeaningful = countMeaningfulChars(d);
    const sJa = countJapaneseChars(s);
    const dJa = countJapaneseChars(d);
    if (sMeaningful < 8 || dMeaningful < 8) continue;
    if (sJa < 6 || dJa < 6) continue;

    const sim = calculateSimilarity(s, d);
    if (sim > 0.9) {
      similarLines.push(i + 1);
    }
  }
  return similarLines;
}

export function detectKanaResidue(dst: string): number {
  const KANA_REGEX = /[\u3040-\u309F\u30A0-\u30FF]/g;
  const matches = dst.match(KANA_REGEX);
  return matches ? matches.length : 0;
}
