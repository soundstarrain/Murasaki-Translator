"""Built-in parser implementations."""

from __future__ import annotations

from typing import Any, Callable, List, Tuple
import ast
import importlib.util
import json
import os
import re

from .base import BaseParser, ParseOutput, ParserError


def _split_lines_keep_empty(text: str) -> List[str]:
    if text == "":
        return [""]
    return text.split("\n")


_CODE_FENCE_PATTERNS = [
    re.compile(r"```(?:jsonl|json|text)?\s*([\s\S]*?)```", re.IGNORECASE),
    re.compile(r"'''(?:jsonl|json|text)?\s*([\s\S]*?)'''", re.IGNORECASE),
    re.compile(r'"""(?:jsonl|json|text)?\s*([\s\S]*?)"""', re.IGNORECASE),
]

_THINK_PATTERN_CLOSED = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)
_THINK_PATTERN_OPEN = re.compile(r"<think>(.*?)(?:</think>|$)", re.IGNORECASE | re.DOTALL)


def _strip_think_tags(text: str) -> str:
    if not text:
        return text
    cleaned = _THINK_PATTERN_CLOSED.sub("", text)
    if cleaned == text:
        cleaned = _THINK_PATTERN_OPEN.sub("", text)
    cleaned = cleaned.replace("<think>", "").replace("</think>", "")
    return cleaned.strip()


def _strip_code_fence(text: str) -> str:
    cleaned = text.strip()
    for pattern in _CODE_FENCE_PATTERNS:
        match = pattern.search(cleaned)
        if match:
            return match.group(1).strip()
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


def _load_json_like(text: str) -> Any:
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
    raise ParserError("JsonParser: invalid JSON")


class PlainParser(BaseParser):
    def parse(self, text: str) -> ParseOutput:
        text = _strip_think_tags(text)
        cleaned = text.strip("\n")
        return ParseOutput(text=cleaned, lines=_split_lines_keep_empty(cleaned))


class LineStrictParser(BaseParser):
    def parse(self, text: str) -> ParseOutput:
        text = _strip_think_tags(text)
        options = self.profile.get("options") or {}
        multi_line = str(options.get("multi_line") or "join")
        lines = _split_lines_keep_empty(text.strip("\n"))
        if len(lines) <= 1:
            return ParseOutput(text=lines[0] if lines else "", lines=lines if lines else [""])
        if multi_line == "first":
            return ParseOutput(text=lines[0], lines=[lines[0]])
        if multi_line == "error":
            raise ParserError("LineStrictParser: multiple lines detected")
        joined = " ".join([l for l in lines if l.strip()]) if multi_line == "join" else "\n".join(lines)
        return ParseOutput(text=joined, lines=[joined])


class JsonArrayParser(BaseParser):
    def parse(self, text: str) -> ParseOutput:
        text = _strip_think_tags(text)
        try:
            data = _load_json_like(text)
        except ParserError as exc:
            raise ParserError("JsonArrayParser: invalid JSON") from exc
        if not isinstance(data, list):
            raise ParserError("JsonArrayParser: expected JSON array")
        lines = [str(item) for item in data]
        return ParseOutput(text="\n".join(lines), lines=lines)


class JsonlParser(BaseParser):
    def parse(self, text: str) -> ParseOutput:
        text = _strip_think_tags(text)
        options = self.profile.get("options") or {}
        path = options.get("path") or options.get("key")
        lines: List[str] = []
        cleaned_text = _strip_code_fence(text)
        for raw in cleaned_text.splitlines():
            cleaned = raw.strip()
            if cleaned == "":
                lines.append("")
                continue
            if cleaned.startswith("```") or cleaned.startswith("'''") or cleaned.startswith('"""'):
                continue
            if cleaned.lower().startswith("jsonline"):
                cleaned = cleaned[len("jsonline") :].strip()
            try:
                data = json.loads(cleaned)
            except json.JSONDecodeError:
                extracted = _extract_first_json_block(cleaned)
                if extracted:
                    try:
                        data = json.loads(extracted)
                    except json.JSONDecodeError:
                        try:
                            data = ast.literal_eval(extracted)
                        except Exception as exc:
                            raise ParserError("JsonlParser: invalid JSONL") from exc
                else:
                    try:
                        data = ast.literal_eval(cleaned)
                    except Exception as exc:
                        raise ParserError("JsonlParser: invalid JSONL") from exc
            value = data
            if path:
                value = _get_by_path(data, str(path))
            lines.append(str(value))
        if not lines:
            raise ParserError("JsonlParser: empty output")
        return ParseOutput(text="\n".join(lines), lines=lines)


class TaggedLineParser(BaseParser):
    def parse(self, text: str) -> ParseOutput:
        text = _strip_think_tags(text)
        options = self.profile.get("options") or {}
        pattern = options.get("pattern") or r"^@@(?P<id>\d+)@@(?P<text>.*)$"
        sort_by_id = bool(options.get("sort_by_id") or options.get("sort_by_line_number"))
        compiled = re.compile(pattern)
        entries: List[tuple[str | None, str]] = []
        for raw in text.splitlines():
            match = compiled.match(raw.strip())
            if match:
                group_dict = match.groupdict()
                line_id = group_dict.get("id") if isinstance(group_dict, dict) else None
                entries.append((line_id, match.group("text")))
        if not entries:
            raise ParserError("TaggedLineParser: no tagged lines found")
        if sort_by_id:
            sortable = [item for item in entries if item[0] is not None]
            if len(sortable) == len(entries):
                def _sort_key(item: tuple[str | None, str]) -> tuple[int, str]:
                    raw_id = item[0] or ""
                    try:
                        return (0, f"{int(raw_id):08d}")
                    except ValueError:
                        return (1, raw_id)
                entries.sort(key=_sort_key)
        lines = [text for _, text in entries]
        return ParseOutput(text="\n".join(lines), lines=lines)


class RegexParser(BaseParser):
    def parse(self, text: str) -> ParseOutput:
        text = _strip_think_tags(text)
        options = self.profile.get("options") or {}
        pattern = str(options.get("pattern") or "").strip()
        if not pattern:
            raise ParserError("RegexParser: options.pattern is required")

        flags = 0
        raw_flags = options.get("flags")
        if isinstance(raw_flags, str):
            raw_flags = [f.strip() for f in raw_flags.split(",") if f.strip()]
        if isinstance(raw_flags, list):
            if any(str(f).lower() == "multiline" for f in raw_flags):
                flags |= re.MULTILINE
            if any(str(f).lower() == "dotall" for f in raw_flags):
                flags |= re.DOTALL
            if any(str(f).lower() == "ignorecase" for f in raw_flags):
                flags |= re.IGNORECASE
        if options.get("multiline"):
            flags |= re.MULTILINE
        if options.get("dotall"):
            flags |= re.DOTALL
        if options.get("ignorecase"):
            flags |= re.IGNORECASE

        compiled = re.compile(pattern, flags)
        match = compiled.search(text)
        if not match:
            raise ParserError("RegexParser: pattern not matched")
        group = options.get("group", 0)
        try:
            extracted = match.group(group)
        except (IndexError, KeyError) as exc:
            raise ParserError("RegexParser: invalid group") from exc
        cleaned = str(extracted).strip("\n")
        return ParseOutput(text=cleaned, lines=_split_lines_keep_empty(cleaned))


class AnyParser(BaseParser):
    def parse(self, text: str) -> ParseOutput:
        text = _strip_think_tags(text)
        options = self.profile.get("options") or {}
        candidates = options.get("parsers") or options.get("candidates") or []
        if not isinstance(candidates, list) or not candidates:
            raise ParserError("AnyParser: options.parsers is required")

        last_error: Exception | None = None
        for raw in candidates:
            if not isinstance(raw, dict):
                last_error = ParserError("AnyParser: invalid parser entry")
                continue
            try:
                parser = _build_parser_from_profile(raw)
                return parser.parse(text)
            except ParserError as exc:
                last_error = exc
                continue
        raise ParserError(f"AnyParser: all parsers failed: {last_error}")


class PythonScriptParser(BaseParser):
    def __init__(self, profile: dict):
        super().__init__(profile)
        self._cache: Tuple[str, float, Callable[[str], Any]] | None = None

    def _load_callable(self) -> Callable[[str], Any]:
        options = self.profile.get("options") or {}
        raw_path = options.get("script") or options.get("path")
        if not raw_path:
            raise ParserError("PythonScriptParser: options.script is required")
        path = os.path.expandvars(os.path.expanduser(str(raw_path)))
        if not os.path.isabs(path):
            path = os.path.abspath(path)
        if not os.path.exists(path):
            raise ParserError("PythonScriptParser: script not found")
        mtime = os.path.getmtime(path)
        if self._cache and self._cache[0] == path and self._cache[1] == mtime:
            return self._cache[2]

        module_name = f"parser_script_{abs(hash(path))}"
        spec = importlib.util.spec_from_file_location(module_name, path)
        if spec is None or spec.loader is None:
            raise ParserError("PythonScriptParser: failed to load script")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        func_name = str(options.get("function") or "parse")
        func = getattr(module, func_name, None)
        if not callable(func):
            raise ParserError("PythonScriptParser: function not found")
        self._cache = (path, mtime, func)
        return func

    def parse(self, text: str) -> ParseOutput:
        text = _strip_think_tags(text)
        func = self._load_callable()
        result = func(text)
        if isinstance(result, ParseOutput):
            return result
        if isinstance(result, dict):
            text_val = result.get("text") if "text" in result else ""
            lines_val = result.get("lines")
            if isinstance(lines_val, list):
                lines = [str(item) for item in lines_val]
                return ParseOutput(text="\n".join(lines), lines=lines)
            return ParseOutput(text=str(text_val), lines=_split_lines_keep_empty(str(text_val)))
        if isinstance(result, list):
            lines = [str(item) for item in result]
            return ParseOutput(text="\n".join(lines), lines=lines)
        return ParseOutput(text=str(result), lines=_split_lines_keep_empty(str(result)))


def _get_by_path(data: Any, path: str) -> Any:
    current = data
    for part in path.split("."):
        if part == "":
            continue
        if isinstance(current, list):
            try:
                index = int(part)
            except ValueError as exc:
                raise ParserError("JsonObjectParser: list index must be int") from exc
            try:
                current = current[index]
            except IndexError as exc:
                raise ParserError("JsonObjectParser: list index out of range") from exc
        elif isinstance(current, dict):
            if part not in current:
                raise ParserError("JsonObjectParser: key not found")
            current = current[part]
        else:
            raise ParserError("JsonObjectParser: invalid path segment")
    return current


class JsonObjectParser(BaseParser):
    def parse(self, text: str) -> ParseOutput:
        text = _strip_think_tags(text)
        try:
            data = _load_json_like(text)
        except ParserError as exc:
            raise ParserError("JsonObjectParser: invalid JSON") from exc
        if not isinstance(data, dict):
            raise ParserError("JsonObjectParser: expected JSON object")
        options = self.profile.get("options") or {}
        path = options.get("path") or options.get("key")
        if not path:
            raise ParserError("JsonObjectParser: options.path or options.key is required")
        value = _get_by_path(data, str(path))
        cleaned = str(value).strip("\n")
        return ParseOutput(text=cleaned, lines=_split_lines_keep_empty(cleaned))


def _build_parser_from_profile(profile: dict) -> BaseParser:
    parser_type = str(profile.get("type") or "plain")
    parser_map = {
        "plain": PlainParser,
        "line_strict": LineStrictParser,
        "json_array": JsonArrayParser,
        "json_object": JsonObjectParser,
        "jsonl": JsonlParser,
        "tagged_line": TaggedLineParser,
        "regex": RegexParser,
        "any": AnyParser,
        "python": PythonScriptParser,
    }
    parser_cls = parser_map.get(parser_type)
    if not parser_cls:
        raise ParserError(f"AnyParser: unsupported parser type {parser_type}")
    return parser_cls(profile)
