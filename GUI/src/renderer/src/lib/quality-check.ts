export function calculateSimilarity(src: string, dst: string): number {
  const srcChars = new Set(src.replace(/\s/g, ""));
  const dstChars = new Set(dst.replace(/\s/g, ""));
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
    const s = srcLines[i].trim();
    const d = dstLines[i].trim();

    if (s.length < 5 || d.length < 5) continue;

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
