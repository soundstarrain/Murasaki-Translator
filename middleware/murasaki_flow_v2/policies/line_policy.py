# Line policy implementations for Pipeline V2.

from __future__ import annotations

from typing import Any, Dict, List, Iterable
import re

from murasaki_flow_v2.utils.line_aligner import align_lines


class LinePolicyError(RuntimeError):
    pass


class LinePolicy:
    def __init__(self, profile: Dict[str, Any]):
        self.profile = profile

    def apply(self, source_lines: List[str], output_lines: List[str]) -> List[str]:
        return output_lines


_KANA_RE = re.compile(r"[\u3040-\u309F\u30A0-\u30FF]")
_CJK_KANA_RE = re.compile(
    r"[\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]"
)


def _has_kana(text: str) -> bool:
    return bool(_KANA_RE.search(text))


def _count_cjk_kana(text: str) -> int:
    return len(_CJK_KANA_RE.findall(text))


def _char_bigrams(text: str) -> set[str]:
    compact = re.sub(r"\s+", "", text.lower())
    if not compact:
        return set()
    if len(compact) == 1:
        return {compact}
    return {compact[i : i + 2] for i in range(len(compact) - 1)}


def _jaccard_score(a: str, b: str) -> float:
    a_set = _char_bigrams(a)
    b_set = _char_bigrams(b)
    if not a_set or not b_set:
        return 0.0
    return len(a_set & b_set) / len(a_set | b_set)


def _collect_checks(raw: Any) -> Dict[str, bool]:
    if isinstance(raw, dict):
        return {str(k): bool(v) for k, v in raw.items()}
    if isinstance(raw, list):
        return {str(k): True for k in raw}
    if isinstance(raw, str):
        return {raw: True}
    return {}


def _normalize_line(text: str, *, trim: bool) -> str:
    return text.strip() if trim else text


def _apply_line_checks(
    source_lines: List[str],
    output_lines: List[str],
    options: Dict[str, Any],
) -> None:
    checks = _collect_checks(options.get("checks"))
    if not checks:
        return

    trim = bool(options.get("trim", True))
    similarity_threshold = float(
        options.get("similarity_threshold") or options.get("similarity") or 0.8
    )
    source_lang = str(options.get("source_lang") or "").lower()
    for idx, (src, dst) in enumerate(zip(source_lines, output_lines)):
        src_norm = _normalize_line(src, trim=trim)
        dst_norm = _normalize_line(dst, trim=trim)

        if checks.get("empty_line") and src_norm and not dst_norm:
            raise LinePolicyError(f"LineCheck:empty_line:{idx}")

        if checks.get("kana_trace") and source_lang in {"ja", "jp"}:
            if _has_kana(dst_norm):
                raise LinePolicyError(f"LineCheck:kana_trace:{idx}")

        if checks.get("similarity"):
            if src_norm and dst_norm:
                if _count_cjk_kana(src_norm) < 10:
                    continue
                if src_norm in dst_norm or dst_norm in src_norm:
                    raise LinePolicyError(f"LineCheck:similarity:{idx}")
                if _jaccard_score(src_norm, dst_norm) >= similarity_threshold:
                    raise LinePolicyError(f"LineCheck:similarity:{idx}")


def _run_quality_checks(
    source_lines: List[str],
    output_lines: List[str],
    options: Dict[str, Any],
) -> None:
    _apply_line_checks(source_lines, output_lines, options)


def _pad_or_truncate(lines: List[str], target_len: int) -> List[str]:
    if len(lines) < target_len:
        return lines + [""] * (target_len - len(lines))
    return lines[:target_len]


def _truncate_only(lines: List[str], target_len: int) -> List[str]:
    if len(lines) <= target_len:
        return lines
    return lines[:target_len]


class StrictLinePolicy(LinePolicy):
    def apply(self, source_lines: List[str], output_lines: List[str]) -> List[str]:
        if len(source_lines) == len(output_lines):
            result = output_lines
        else:
            options = self.profile.get("options") or {}
            on_mismatch = str(options.get("on_mismatch") or "error")
            if on_mismatch == "retry":
                raise LinePolicyError(
                    f"StrictLinePolicy mismatch: src={len(source_lines)} dst={len(output_lines)}"
                )
            if on_mismatch == "pad":
                result = _pad_or_truncate(output_lines, len(source_lines))
            elif on_mismatch == "truncate":
                result = _truncate_only(output_lines, len(source_lines))
            elif on_mismatch == "align":
                result = align_lines(source_lines, output_lines)
            else:
                raise LinePolicyError(
                    f"StrictLinePolicy mismatch: src={len(source_lines)} dst={len(output_lines)}"
                )
        _run_quality_checks(source_lines, result, self.profile.get("options") or {})
        return result


class TolerantLinePolicy(LinePolicy):
    def apply(self, source_lines: List[str], output_lines: List[str]) -> List[str]:
        if len(source_lines) == len(output_lines):
            result = output_lines
        else:
            result = align_lines(source_lines, output_lines)
        _run_quality_checks(source_lines, result, self.profile.get("options") or {})
        return result
