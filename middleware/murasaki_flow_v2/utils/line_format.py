"""Line-mode input/output format compatibility helpers for Pipeline V2."""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple
import ast
import json
import re


_CODE_FENCE_MARKERS = ("```", "'''", '"""')
_TAGGED_LINE_PATTERN = re.compile(r"^@@(?P<id>\d+)@@(?P<text>.*)$")


def _strip_code_fence(text: str) -> str:
    cleaned = text.strip()
    for marker in _CODE_FENCE_MARKERS:
        if cleaned.startswith(marker) and cleaned.endswith(marker):
            return cleaned[len(marker) : -len(marker)].strip()
    return cleaned


def _extract_first_json_block(text: str) -> str:
    if not text:
        return ""
    start = None
    stack: List[str] = []
    in_str = False
    escape = False
    for idx, ch in enumerate(text):
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == "\"":
                in_str = False
            continue
        if ch == "\"":
            in_str = True
            continue
        if ch in "{[":
            if not stack:
                start = idx
            stack.append(ch)
        elif ch in "}]":
            if not stack:
                continue
            opening = stack[-1]
            if (opening == "{" and ch == "}") or (opening == "[" and ch == "]"):
                stack.pop()
                if not stack and start is not None:
                    return text[start : idx + 1]
            else:
                stack.pop()
    return ""


def _try_parse_json(text: str) -> Optional[object]:
    cleaned = _strip_code_fence(text)
    candidates = [cleaned]
    extracted = _extract_first_json_block(cleaned)
    if extracted and extracted not in candidates:
        candidates.append(extracted)
    for candidate in candidates:
        if not candidate:
            continue
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            try:
                return ast.literal_eval(candidate)
            except Exception:
                continue
    return None


def _extract_entry_from_dict(data: Dict[str, object]) -> Tuple[Optional[str], Optional[str]]:
    _text_keys = ("text", "translation", "value", "output")
    if len(data) == 1:
        key, value = next(iter(data.items()))
        if key.lower() not in _text_keys:
            return str(key), "" if value is None else str(value)

    id_keys = ("id", "line", "line_id", "line_number", "index")
    text_keys = ("text", "translation", "value", "output")
    line_id = None
    for key in id_keys:
        if key in data:
            line_id = data.get(key)
            break
    if line_id is not None:
        for key in text_keys:
            if key in data:
                value = data.get(key)
                return str(line_id), "" if value is None else str(value)
    return None, None


def parse_jsonl_entries(text: str) -> Tuple[Dict[str, str], List[str]]:
    entries: Dict[str, str] = {}
    ordered: List[str] = []

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith(_CODE_FENCE_MARKERS):
            continue
        if line.lower().startswith("jsonline"):
            line = line[len("jsonline") :].strip()
        if not line:
            continue
        data = _try_parse_json(line)
        if data is None:
            continue
        if isinstance(data, dict):
            line_id, value = _extract_entry_from_dict(data)
            if line_id is not None:
                entries[str(line_id)] = "" if value is None else str(value)
                continue
            for key in ("translation", "text"):
                if key in data:
                    ordered.append("" if data[key] is None else str(data[key]))
                    break
        elif isinstance(data, list):
            ordered.extend("" if item is None else str(item) for item in data)

    if entries or ordered:
        return entries, ordered

    payload = _try_parse_json(text)
    if isinstance(payload, dict):
        line_id, value = _extract_entry_from_dict(payload)
        if line_id is not None:
            return {str(line_id): "" if value is None else str(value)}, []
        for key in ("translation", "text"):
            if key in payload:
                return {}, ["" if payload[key] is None else str(payload[key])]
    if isinstance(payload, list):
        return {}, ["" if item is None else str(item) for item in payload]

    return {}, []


def parse_tagged_entries(text: str, pattern: Optional[str] = None) -> Dict[str, str]:
    compiled = _TAGGED_LINE_PATTERN if not pattern else re.compile(pattern)
    entries: Dict[str, str] = {}
    for raw in text.splitlines():
        match = compiled.match(raw.strip())
        if not match:
            continue
        group_dict = match.groupdict() if match.groupdict() else {}
        line_id = group_dict.get("id")
        if line_id is None:
            continue
        entries[str(line_id)] = match.group("text")
    return entries


def extract_line_for_policy(
    text: str,
    line_index: int,
    *,
    tagged_pattern: Optional[str] = None,
) -> Optional[str]:
    entries, ordered = parse_jsonl_entries(text)
    if entries:
        key = str(line_index + 1)
        if key in entries:
            return entries[key]
        alt_key = str(line_index)
        if alt_key in entries:
            return entries[alt_key]
    if ordered and line_index < len(ordered):
        return ordered[line_index]

    tagged = parse_tagged_entries(text, pattern=tagged_pattern)
    if tagged:
        key = str(line_index + 1)
        if key in tagged:
            return tagged[key]
        alt_key = str(line_index)
        if alt_key in tagged:
            return tagged[alt_key]
    return None
