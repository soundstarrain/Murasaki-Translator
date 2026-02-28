"""Anchor normalization, localization, repair, and validation helpers."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Sequence, Set, Tuple
import re
import unicodedata


_ID_TOKEN_RE = re.compile(r"@id=(\d+)@", re.IGNORECASE)
_END_TOKEN_RE = re.compile(r"@end=(\d+)@", re.IGNORECASE)
_ANCHOR_TOKEN_RE = re.compile(r"@(id|end)=(\d+)@", re.IGNORECASE)
_STRICT_PAIR_RE = re.compile(
    r"@id=(\d+)@((?:(?!@id=\d+@)[\s\S])*?)@end=\1@",
    re.IGNORECASE,
)
_REASONABLE_ANCHOR_ID_MAX = 1_000_000_000


def _normalize_digits(raw: str) -> str:
    return str(raw or "").translate(
        str.maketrans(
            "\uff10\uff11\uff12\uff13\uff14\uff15\uff16\uff17\uff18\uff19",
            "0123456789",
        )
    )


def _is_reasonable_anchor_id(anchor_id: str) -> bool:
    if not anchor_id or not str(anchor_id).isdigit():
        return False
    try:
        value = int(anchor_id)
    except Exception:
        return False
    return 0 <= value <= _REASONABLE_ANCHOR_ID_MAX


def _normalize_anchor_token_candidate(raw_token: str) -> str | None:
    token = unicodedata.normalize("NFKC", str(raw_token or ""))
    compact = re.sub(r"\s+", "", token).lower()
    if not compact:
        return None

    strict = re.fullmatch(r"(id|end)=([0-9]+)", compact)
    if strict:
        kind, anchor_id = strict.groups()
        if _is_reasonable_anchor_id(anchor_id):
            return f"@{kind}={anchor_id}@"
        return None

    if "id" not in compact and "end" not in compact:
        return None

    numbers = re.findall(r"[0-9]+", compact)
    if len(numbers) != 1:
        return None

    anchor_id = numbers[0]
    if not _is_reasonable_anchor_id(anchor_id):
        return None

    id_pos = compact.find("id")
    end_pos = compact.find("end")
    if id_pos >= 0 and (end_pos < 0 or id_pos < end_pos):
        kind = "id"
    elif end_pos >= 0:
        kind = "end"
    else:
        return None
    return f"@{kind}={anchor_id}@"


@dataclass
class LocalAnchorContext:
    enabled: bool = False
    mode: str = ""
    source_text_local: str = ""
    prompt_text_local: str = ""
    global_to_local: Dict[str, str] = field(default_factory=dict)
    local_to_global: Dict[str, str] = field(default_factory=dict)
    expected_local_ids: List[str] = field(default_factory=list)


def normalize_anchor_stream(text: str) -> str:
    """Normalize potentially mangled @id/@end anchors (full-width, spaces, newlines)."""
    if not text:
        return text

    def _fix_id(m: re.Match) -> str:
        return f"@id={_normalize_digits(m.group(1))}@"

    def _fix_end(m: re.Match) -> str:
        return f"@end={_normalize_digits(m.group(1))}@"

    text = re.sub(
        r"[@＠]\s*[iｉIＩ]\s*[dｄDＤ]\s*[=＝]\s*([0-9０-９]+)\s*[@＠]",
        _fix_id,
        text,
    )
    text = re.sub(
        r"[@＠]\s*[eｅEＥ]\s*[nｎNＮ]\s*[dｄDＤ]\s*[=＝]\s*([0-9０-９]+)\s*[@＠]",
        _fix_end,
        text,
    )
    # Recover tokens missing trailing '@', e.g. "@end=16" at line end.
    text = re.sub(
        r"[@＠]\s*[iｉIＩ]\s*[dｄDＤ]\s*[=＝]\s*([0-9０-９]+)(?=(?:\s|$|[^0-9０-９@＠]))",
        _fix_id,
        text,
    )
    text = re.sub(
        r"[@＠]\s*[eｅEＥ]\s*[nｎNＮ]\s*[dｄDＤ]\s*[=＝]\s*([0-9０-９]+)(?=(?:\s|$|[^0-9０-９@＠]))",
        _fix_end,
        text,
    )

    # Last-pass fallback for malformed wrapped anchors, e.g. @<end=1>@ / @{id:1}@.
    def _fix_wrapped_candidate(m: re.Match) -> str:
        normalized = _normalize_anchor_token_candidate(m.group(1))
        return normalized if normalized else m.group(0)

    text = re.sub(r"[@＠]([^@＠\r\n]{1,64})[@＠]", _fix_wrapped_candidate, text)
    return text


def collect_anchor_ids(text: str) -> List[str]:
    """Collect @id anchor ids in first-seen order."""
    seen: Set[str] = set()
    ordered: List[str] = []
    for anchor_id in _ID_TOKEN_RE.findall(normalize_anchor_stream(text)):
        if anchor_id in seen:
            continue
        seen.add(anchor_id)
        ordered.append(anchor_id)
    return ordered


def remap_anchor_ids(text: str, anchor_id_map: Dict[str, str]) -> str:
    """Remap @id/@end ids with a supplied map (unknown ids remain unchanged)."""
    if not text:
        return text
    if not anchor_id_map:
        return normalize_anchor_stream(text)

    normalized = normalize_anchor_stream(text)

    def _replace(m: re.Match) -> str:
        kind = m.group(1).lower()
        anchor_id = m.group(2)
        mapped = anchor_id_map.get(anchor_id)
        if mapped is None:
            return f"@{kind}={anchor_id}@"
        return f"@{kind}={mapped}@"

    return _ANCHOR_TOKEN_RE.sub(_replace, normalized)


def prepare_local_anchor_context(
    source_text: str,
    prompt_text: str,
    *,
    mode: str,
) -> LocalAnchorContext:
    """
    Build per-block local-id mapping and localized source/prompt texts.
    mode should be 'epub' or 'alignment'.
    """
    src_norm = normalize_anchor_stream(source_text)
    prompt_norm = normalize_anchor_stream(prompt_text)
    ordered_ids = collect_anchor_ids(src_norm)
    if not ordered_ids:
        return LocalAnchorContext(
            enabled=False,
            mode=mode,
            source_text_local=src_norm,
            prompt_text_local=prompt_norm,
        )

    global_to_local = {
        global_id: str(idx + 1) for idx, global_id in enumerate(ordered_ids)
    }
    local_to_global = {
        local_id: global_id for global_id, local_id in global_to_local.items()
    }

    return LocalAnchorContext(
        enabled=True,
        mode=mode,
        source_text_local=remap_anchor_ids(src_norm, global_to_local),
        prompt_text_local=remap_anchor_ids(prompt_norm, global_to_local),
        global_to_local=global_to_local,
        local_to_global=local_to_global,
        expected_local_ids=[str(idx + 1) for idx in range(len(ordered_ids))],
    )


def restore_output_anchors(text: str, local_to_global: Dict[str, str]) -> str:
    """Restore localized anchors back to global ids."""
    return remap_anchor_ids(text, local_to_global)


def repair_and_validate_anchor_output(
    source_text: str,
    output_text: str,
    *,
    mode: str,
) -> Tuple[str, bool, Dict[str, object]]:
    """
    Repair anchor stream best-effort, then validate.
    Returns: (repaired_output, success, meta).
    """
    src_norm = normalize_anchor_stream(source_text)
    out_norm = normalize_anchor_stream(output_text)

    expected_ids = collect_anchor_ids(src_norm)
    expected_set = set(expected_ids)
    if not expected_ids:
        return out_norm, True, {
            "format": mode,
            "repaired": False,
            "repair_steps": [],
            "missing_count": 0,
            "foreign_count": 0,
            "expected_count": 0,
        }

    repaired_steps: List[str] = []
    if mode == "alignment":
        out_norm, converted = _convert_alignment_double_id_to_end(
            out_norm, expected_set
        )
        if converted:
            repaired_steps.append("alignment_id_to_end")

    out_norm, removed = _strip_foreign_anchor_tokens(out_norm, expected_set)
    if removed > 0:
        repaired_steps.append("strip_foreign_anchor")

    out_norm, salvaged = _salvage_single_number_anchor_tokens(out_norm, expected_set)
    if salvaged > 0:
        repaired_steps.append("salvage_single_number_anchor")

    missing_ids, foreign_ids = _diff_anchor_state(out_norm, expected_ids, expected_set)
    missing_strict_pair_ids = _missing_strict_pair_ids(out_norm, expected_ids)
    if missing_ids or missing_strict_pair_ids:
        rebuilt = _rebuild_anchor_pairs_from_loose_stream(
            out_norm, expected_ids, expected_set
        )
        if rebuilt is not None:
            out_norm = rebuilt
            repaired_steps.append("rebuild_anchor_pairs")
            missing_ids, foreign_ids = _diff_anchor_state(
                out_norm, expected_ids, expected_set
            )
            missing_strict_pair_ids = _missing_strict_pair_ids(
                out_norm,
                expected_ids,
            )

    success = not missing_ids and not foreign_ids and not missing_strict_pair_ids
    meta = {
        "format": mode,
        "repaired": bool(repaired_steps),
        "repair_steps": repaired_steps,
        "missing_count": len(missing_ids),
        "foreign_count": len(foreign_ids),
        "strict_pair_missing_count": len(missing_strict_pair_ids),
        "expected_count": len(expected_ids),
    }
    if missing_ids:
        meta["missing_ids"] = missing_ids
    if foreign_ids:
        meta["foreign_ids"] = foreign_ids
    if missing_strict_pair_ids:
        meta["strict_pair_missing_ids"] = missing_strict_pair_ids
    return out_norm, success, meta


def _convert_alignment_double_id_to_end(
    text: str,
    expected_ids: Set[str],
) -> Tuple[str, bool]:
    has_end = set(_END_TOKEN_RE.findall(text))
    counters: Dict[str, int] = {}
    changed = False

    def _replace(m: re.Match) -> str:
        nonlocal changed
        anchor_id = m.group(1)
        if anchor_id not in expected_ids:
            return m.group(0)
        if anchor_id in has_end:
            return m.group(0)
        counters[anchor_id] = counters.get(anchor_id, 0) + 1
        if counters[anchor_id] % 2 == 0:
            changed = True
            return f"@end={anchor_id}@"
        return m.group(0)

    out = _ID_TOKEN_RE.sub(_replace, text)
    return out, changed


def _strip_foreign_anchor_tokens(
    text: str,
    expected_ids: Set[str],
) -> Tuple[str, int]:
    removed_count = 0

    def _replace(m: re.Match) -> str:
        nonlocal removed_count
        kind = m.group(1).lower()
        anchor_id = m.group(2)
        if anchor_id in expected_ids:
            return f"@{kind}={anchor_id}@"
        removed_count += 1
        return ""

    return _ANCHOR_TOKEN_RE.sub(_replace, text), removed_count


def _salvage_single_number_anchor_tokens(
    text: str,
    expected_ids: Set[str],
) -> Tuple[str, int]:
    if not text or not expected_ids:
        return text, 0

    out_id_set = set(_ID_TOKEN_RE.findall(text))
    out_end_set = set(_END_TOKEN_RE.findall(text))
    recovered_count = 0

    def _replace(m: re.Match) -> str:
        nonlocal recovered_count
        full_token = m.group(0)
        full_norm = unicodedata.normalize("NFKC", full_token)
        if _ANCHOR_TOKEN_RE.fullmatch(full_norm):
            return full_norm

        compact = re.sub(r"\s+", "", unicodedata.normalize("NFKC", m.group(1))).lower()
        if "id" in compact or "end" in compact:
            # Tokens with explicit kind should have been handled by normalize_anchor_stream.
            return full_token

        numbers = re.findall(r"[0-9]+", compact)
        if len(numbers) != 1:
            return full_token

        anchor_id = numbers[0]
        if anchor_id not in expected_ids or not _is_reasonable_anchor_id(anchor_id):
            return full_token

        missing_id = anchor_id not in out_id_set
        missing_end = anchor_id not in out_end_set
        if missing_id == missing_end:
            return full_token

        kind = "id" if missing_id else "end"
        if kind == "id":
            out_id_set.add(anchor_id)
        else:
            out_end_set.add(anchor_id)
        recovered_count += 1
        return f"@{kind}={anchor_id}@"

    fixed = re.sub(r"[@＠]([^@＠\r\n]{1,64})[@＠]", _replace, text)
    return fixed, recovered_count


def _diff_anchor_state(
    text: str,
    expected_ids: Sequence[str],
    expected_set: Set[str],
) -> Tuple[List[str], List[str]]:
    out_id_set = set(_ID_TOKEN_RE.findall(text))
    out_end_set = set(_END_TOKEN_RE.findall(text))

    missing_ids = [
        anchor_id
        for anchor_id in expected_ids
        if anchor_id not in out_id_set or anchor_id not in out_end_set
    ]
    foreign_ids = sorted(
        (out_id_set | out_end_set) - expected_set,
        key=lambda value: int(value),
    )
    return missing_ids, foreign_ids


def _rebuild_anchor_pairs_from_loose_stream(
    text: str,
    expected_ids: Sequence[str],
    expected_set: Set[str],
) -> str | None:
    if not expected_ids:
        return text

    id_to_text: Dict[str, str] = {}
    for anchor_id, content in _STRICT_PAIR_RE.findall(text):
        if anchor_id not in expected_set or anchor_id in id_to_text:
            continue
        cleaned = _ANCHOR_TOKEN_RE.sub("", (content or "")).strip()
        id_to_text[anchor_id] = cleaned

    if len(id_to_text) < len(expected_ids):
        loose_re = re.compile(
            r"@id=(\d+)@([\s\S]*?)(@end=\1@|(?=@id=\d+@)|\Z)",
            re.IGNORECASE,
        )
        for m in loose_re.finditer(text):
            anchor_id = m.group(1)
            if anchor_id not in expected_set or anchor_id in id_to_text:
                continue
            cleaned = _ANCHOR_TOKEN_RE.sub("", (m.group(2) or "")).strip()
            id_to_text[anchor_id] = cleaned

    if len(id_to_text) < len(expected_ids):
        # Fallback: recover missing ids from text immediately preceding each @end=ID@.
        prev_end = 0
        for m in _ANCHOR_TOKEN_RE.finditer(text):
            kind = m.group(1).lower()
            anchor_id = m.group(2)
            segment = text[prev_end:m.start()]
            prev_end = m.end()
            if kind != "end" or anchor_id not in expected_set or anchor_id in id_to_text:
                continue
            cleaned = _ANCHOR_TOKEN_RE.sub("", (segment or "")).strip()
            id_to_text[anchor_id] = cleaned

    if any(anchor_id not in id_to_text for anchor_id in expected_ids):
        return None

    rebuilt_parts = [
        f"@id={anchor_id}@\n{id_to_text.get(anchor_id, '')}\n@end={anchor_id}@"
        for anchor_id in expected_ids
    ]
    return "\n".join(rebuilt_parts)


def _missing_strict_pair_ids(
    text: str,
    expected_ids: Sequence[str],
) -> List[str]:
    strict_ids = set(anchor_id for anchor_id, _ in _STRICT_PAIR_RE.findall(text))
    return [anchor_id for anchor_id in expected_ids if anchor_id not in strict_ids]
