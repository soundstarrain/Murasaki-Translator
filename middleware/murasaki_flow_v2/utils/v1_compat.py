from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple
import json
import os
import threading

from rule_processor import RuleProcessor
from murasaki_translator.core.text_protector import TextProtector
from murasaki_translator.core.quality_checker import QualityChecker


def load_rules(path: Optional[str]) -> List[Dict[str, Any]]:
    if not path or not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def load_glossary(path: Optional[str]) -> Dict[str, str]:
    if not path or not os.path.exists(path) or not path.lower().endswith(".json"):
        return {}
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return {str(k): str(v) for k, v in data.items() if k and v}
        if isinstance(data, list):
            glossary: Dict[str, str] = {}
            for entry in data:
                if not isinstance(entry, dict):
                    continue
                src = entry.get("src") or entry.get("jp") or entry.get("original")
                dst = entry.get("dst") or entry.get("zh") or entry.get("translation")
                if src and dst:
                    glossary[str(src)] = str(dst)
            return glossary
    except Exception:
        return {}
    return {}


def _parse_protect_pattern_lines(lines: List[str]) -> Tuple[List[str], List[str]]:
    additions: List[str] = []
    removals: List[str] = []
    for raw in lines:
        line = (raw or "").strip()
        if not line:
            continue
        if line.startswith("#") or line.startswith("//"):
            continue
        if line.startswith("!"):
            pat = line[1:].strip()
            if pat:
                removals.append(pat)
            continue
        if line.startswith("+"):
            line = line[1:].strip()
        if line:
            additions.append(line)
    return additions, removals


def _parse_protect_pattern_payload(raw: Any) -> List[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(p) for p in raw if str(p).strip()]
    if isinstance(raw, str):
        stripped = raw.strip()
        if not stripped:
            return []
        try:
            parsed = json.loads(stripped)
            if isinstance(parsed, list):
                return [str(p) for p in parsed if str(p).strip()]
        except Exception:
            pass
        return [line for line in stripped.splitlines() if line.strip()]
    return [str(raw).strip()] if str(raw).strip() else []


def _collect_protect_rule_lines(rules: List[Dict[str, Any]]) -> Tuple[bool, List[str]]:
    enabled = False
    lines: List[str] = []
    for rule in rules or []:
        if not rule or not rule.get("active", True):
            continue
        if rule.get("type") == "protect" or rule.get("pattern") == "text_protect":
            enabled = True
            options = (
                rule.get("options") if isinstance(rule.get("options"), dict) else {}
            )
            raw = options.get("patterns")
            lines.extend(_parse_protect_pattern_payload(raw))
    return enabled, lines


def _collect_legacy_protect_lines(post_rules: List[Dict[str, Any]]) -> List[str]:
    lines: List[str] = []
    for rule in post_rules or []:
        if not rule or not rule.get("active", True):
            continue
        if rule.get("pattern") == "restore_protection":
            options = (
                rule.get("options") if isinstance(rule.get("options"), dict) else {}
            )
            raw = options.get("customPattern")
            lines.extend(_parse_protect_pattern_payload(raw))
    return lines


def _merge_protect_patterns(
    base: Optional[List[str]], additions: List[str], removals: List[str]
) -> List[str]:
    merged = list(base) if base else []
    for pat in additions:
        if pat not in merged:
            merged.append(pat)
    if removals:
        merged = [pat for pat in merged if pat not in removals]
    return merged


def build_protect_patterns(
    pre_rules: List[Dict[str, Any]],
    post_rules: List[Dict[str, Any]],
    enable: bool = True,
) -> List[str]:
    if not enable:
        return []
    protect_enabled, protect_lines = _collect_protect_rule_lines(pre_rules)
    legacy_lines = _collect_legacy_protect_lines(post_rules)
    if not protect_enabled and not legacy_lines:
        return []
    additions, removals = _parse_protect_pattern_lines(protect_lines + legacy_lines)
    base_patterns = TextProtector.DEFAULT_PATTERNS
    return _merge_protect_patterns(base_patterns, additions, removals)


@dataclass
class V1CompatOptions:
    rules_pre: List[Dict[str, Any]]
    rules_post: List[Dict[str, Any]]
    glossary: Dict[str, str]
    source_lang: str = "ja"
    strict_line_count: bool = False
    enable_quality: bool = True
    enable_text_protect: bool = True


class V1CompatProcessor:
    def __init__(self, options: V1CompatOptions):
        self.options = options
        self._pre_lock = threading.Lock()
        self._post_lock = threading.Lock()
        self._pre_rules = list(options.rules_pre or [])
        self._post_rules = list(options.rules_post or [])
        if options.enable_text_protect:
            has_restore = any(
                (rule or {}).get("pattern") == "restore_protection"
                for rule in self._post_rules
            )
            if not has_restore:
                self._post_rules.append(
                    {"type": "format", "pattern": "restore_protection", "active": True}
                )
        self._pre = RuleProcessor(self._pre_rules)
        self._post = RuleProcessor(self._post_rules)
        self._quality = (
            QualityChecker(glossary=options.glossary)
            if options.enable_quality
            else None
        )
        self._protect_patterns = build_protect_patterns(
            self._pre_rules,
            self._post_rules,
            enable=options.enable_text_protect,
        )

    @property
    def has_pre_rules(self) -> bool:
        return bool(self._pre_rules)

    @property
    def has_post_rules(self) -> bool:
        return bool(self._post_rules)

    def create_protector(self) -> Optional[TextProtector]:
        if not self._protect_patterns:
            return None
        return TextProtector(patterns=self._protect_patterns)

    def apply_pre(self, text: str) -> str:
        if not self.has_pre_rules:
            return text
        with self._pre_lock:
            return self._pre.process(
                text, strict_line_count=self.options.strict_line_count
            )

    def apply_post(
        self,
        text: str,
        *,
        src_text: Optional[str] = None,
        protector: Optional[TextProtector] = None,
    ) -> str:
        if not self.has_post_rules and protector is None:
            return text
        with self._post_lock:
            return self._post.process(
                text,
                src_text=src_text,
                protector=protector,
                strict_line_count=self.options.strict_line_count,
            )

    def check_quality(
        self,
        source_lines: List[str],
        output_lines: List[str],
        *,
        filter_empty: bool = True,
    ) -> List[Dict[str, Any]]:
        if not self._quality:
            return []
        if filter_empty:
            source_lines = [line for line in source_lines if line.strip()]
            output_lines = [line for line in output_lines if line.strip()]
        source_lang = (self.options.source_lang or "ja").lower()
        if source_lang == "jp":
            source_lang = "ja"
        try:
            return self._quality.check_output(
                source_lines, output_lines, source_lang=source_lang
            )
        except Exception:
            return []
