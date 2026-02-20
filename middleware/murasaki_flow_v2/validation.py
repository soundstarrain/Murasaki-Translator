# Validation helpers for Pipeline V2 profiles.

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from murasaki_flow_v2.registry.profile_store import ProfileStore


@dataclass
class ValidationResult:
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


def _ensure_field(data: Dict[str, Any], field: str, result: ValidationResult) -> None:
    if not data.get(field):
        result.errors.append(f"missing_field:{field}")


def _warn_unknown_type(value: str, result: ValidationResult) -> None:
    if value:
        result.warnings.append(f"unsupported_type:{value}")


def _warn_missing_ref(kind: str, ref: str, result: ValidationResult) -> None:
    result.warnings.append(f"missing_reference:{kind}:{ref}")


def _error_missing_ref(kind: str, ref: str, result: ValidationResult) -> None:
    result.errors.append(f"missing_reference:{kind}:{ref}")


def _exists(store: Optional[ProfileStore], kind: str, ref: str) -> bool:
    if not store or not ref:
        return False
    return bool(store.resolve_profile_path(kind, ref))


def _normalize_chunk_type(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if raw == "legacy":
        return "block"
    if raw in {"block", "line"}:
        return raw
    return raw


def _get_chunk_type(store: Optional[ProfileStore], ref: str) -> str:
    if not store or not ref:
        return ""
    try:
        profile = store.load_profile("chunk", ref)
    except Exception:
        return ""
    return _normalize_chunk_type(profile.get("chunk_type") or profile.get("type") or "")


def _collect_prompt_text(prompt: Dict[str, Any]) -> str:
    parts = [
        prompt.get("persona"),
        prompt.get("style_rules"),
        prompt.get("output_rules"),
        prompt.get("system_template"),
        prompt.get("user_template"),
    ]
    return "\n".join([str(p) for p in parts if isinstance(p, str)]).lower()


def _prompt_has_source(prompt: Dict[str, Any]) -> bool:
    user_template = str(prompt.get("user_template") or "")
    if not user_template.strip():
        return True
    return "{{source}}" in user_template


def _validate_prompt_parser(
    prompt: Dict[str, Any], parser: Dict[str, Any], result: ValidationResult
) -> None:
    parser_type = str(parser.get("type") or "")
    text = _collect_prompt_text(prompt)
    if parser_type == "tagged_line":
        if "@@" not in text and "[[" not in text:
            result.errors.append("parser_requires_tagged_prompt")
    if parser_type in {"json_object", "json_array"}:
        if "json" not in text:
            result.errors.append("parser_requires_json_prompt")
    if parser_type == "jsonl":
        if "jsonl" not in text and "json lines" not in text and "jsonline" not in text:
            result.errors.append("parser_requires_jsonl_prompt")


def validate_profile(
    kind: str,
    data: Dict[str, Any],
    store: Optional[ProfileStore] = None,
) -> ValidationResult:
    result = ValidationResult()
    if not isinstance(data, dict):
        result.errors.append("invalid_yaml")
        return result

    if not data.get("id"):
        result.errors.append("missing_id")
    else:
        raw_id = str(data.get("id") or "").strip()
        if not ProfileStore.is_safe_profile_id(raw_id):
            result.errors.append("invalid_id")

    if kind == "api":
        api_type = str(data.get("type") or data.get("provider") or "openai_compat")
        if api_type == "openai_compat":
            if not data.get("base_url"):
                result.errors.append("missing_base_url")
            if not data.get("model"):
                result.errors.append("missing_model")
        elif api_type == "pool":
            endpoints = data.get("endpoints")
            has_endpoints = False
            missing_model = False
            if isinstance(endpoints, list):
                for item in endpoints:
                    if not isinstance(item, dict):
                        continue
                    if item.get("base_url") or item.get("baseUrl"):
                        has_endpoints = True
                        if not item.get("model"):
                            missing_model = True
            has_members = data.get("members") not in (None, "", [])
            if not has_endpoints:
                result.errors.append("missing_pool_endpoints")
            if has_endpoints and missing_model:
                result.errors.append("missing_pool_model")
            if has_members:
                result.errors.append("pool_members_unsupported")
        else:
            _warn_unknown_type(api_type, result)
        if data.get("rpm") is not None and data.get("rpm") != "":
            try:
                rpm_value = int(data.get("rpm"))
            except (TypeError, ValueError):
                rpm_value = 0
            if rpm_value < 1:
                result.errors.append("invalid_rpm")
        if data.get("timeout") is not None and data.get("timeout") != "":
            try:
                timeout_value = float(data.get("timeout"))
            except (TypeError, ValueError):
                timeout_value = None
            if timeout_value is None or timeout_value <= 0:
                result.errors.append("invalid_timeout")

    if kind == "parser":
        parser_type = str(data.get("type") or "")
        if not parser_type:
            result.errors.append("missing_field:type")
        if parser_type == "regex":
            pattern = (data.get("options") or {}).get("pattern")
            if not pattern:
                result.errors.append("missing_pattern")
        if parser_type == "json_object":
            options = data.get("options") or {}
            if not options.get("path") and not options.get("key"):
                result.errors.append("missing_json_path")
        if parser_type == "jsonl":
            options = data.get("options") or {}
            if options and not options.get("path") and not options.get("key"):
                result.warnings.append("missing_json_path")
        if parser_type == "any":
            options = data.get("options") or {}
            parsers = options.get("parsers") or options.get("candidates")
            if not isinstance(parsers, list) or not parsers:
                result.errors.append("missing_any_parsers")
        if parser_type == "python":
            options = data.get("options") or {}
            if not options.get("script") and not options.get("path"):
                result.errors.append("missing_script")

    if kind == "prompt":
        if not _prompt_has_source(data):
            result.errors.append("prompt_missing_source")

    if kind == "policy":
        policy_type = str(data.get("type") or "")
        if not policy_type:
            result.errors.append("missing_field:type")
        if policy_type and policy_type not in {"strict", "tolerant"}:
            _warn_unknown_type(policy_type, result)
        options = data.get("options") or {}
        raw_similarity = options.get("similarity_threshold")
        if raw_similarity is None or raw_similarity == "":
            raw_similarity = options.get("similarity")
        if raw_similarity is not None and raw_similarity != "":
            try:
                similarity_value = float(raw_similarity)
            except (TypeError, ValueError):
                similarity_value = None
            if (
                similarity_value is None
                or similarity_value <= 0
                or similarity_value > 1
            ):
                result.errors.append("invalid_similarity_threshold")

    if kind == "chunk":
        raw_chunk_type = data.get("chunk_type") or data.get("type") or ""
        chunk_type = _normalize_chunk_type(raw_chunk_type)
        if not chunk_type:
            result.errors.append("missing_field:chunk_type")
        if chunk_type and chunk_type not in {"block", "line"}:
            _warn_unknown_type(chunk_type, result)
        options = data.get("options") or {}
        target_raw = options.get("target_chars")
        target_value = None
        if target_raw is not None and target_raw != "":
            try:
                target_value = int(target_raw)
            except (TypeError, ValueError):
                target_value = None
            if target_value is None or target_value <= 0:
                result.errors.append("invalid_target_chars")
        max_raw = options.get("max_chars")
        if max_raw is not None and max_raw != "":
            try:
                max_value = int(max_raw)
            except (TypeError, ValueError):
                max_value = None
            if max_value is None or max_value <= 0:
                result.errors.append("invalid_max_chars")
            elif target_value is not None and max_value < target_value:
                result.errors.append("invalid_max_chars")
        balance_raw = options.get("balance_threshold")
        if balance_raw is not None and balance_raw != "":
            try:
                balance_value = float(balance_raw)
            except (TypeError, ValueError):
                balance_value = None
            if balance_value is None or balance_value <= 0 or balance_value > 1:
                result.errors.append("invalid_balance_threshold")
        count_raw = options.get("balance_count")
        if count_raw is not None and count_raw != "":
            try:
                count_value = int(count_raw)
            except (TypeError, ValueError):
                count_value = None
            if count_value is None or count_value < 1:
                result.errors.append("invalid_balance_count")

    if kind == "pipeline":
        for field in ("provider", "prompt", "parser", "chunk_policy"):
            _ensure_field(data, field, result)
        if data.get("apply_line_policy") and not data.get("line_policy"):
            result.errors.append("missing_field:line_policy")
        if store:
            ref_map = {
                "provider": "api",
                "prompt": "prompt",
                "parser": "parser",
                "line_policy": "policy",
                "chunk_policy": "chunk",
            }
            for field, ref_kind in ref_map.items():
                ref_id = str(data.get(field) or "")
                if ref_id and not _exists(store, ref_kind, ref_id):
                    _error_missing_ref(ref_kind, ref_id, result)

            chunk_ref = str(data.get("chunk_policy") or "")
            chunk_type = _normalize_chunk_type(_get_chunk_type(store, chunk_ref))
            if data.get("apply_line_policy") and chunk_type and chunk_type != "line":
                result.errors.append("line_policy_requires_line_chunk")
            if chunk_type == "line" and not data.get("line_policy"):
                result.errors.append("line_chunk_missing_line_policy")
            prompt_ref = str(data.get("prompt") or "")
            parser_ref = str(data.get("parser") or "")
            if prompt_ref and parser_ref:
                try:
                    prompt_profile = store.load_profile("prompt", prompt_ref)
                    parser_profile = store.load_profile("parser", parser_ref)
                    if not _prompt_has_source(prompt_profile):
                        result.errors.append("prompt_missing_source")
                    _validate_prompt_parser(prompt_profile, parser_profile, result)
                except Exception:
                    pass

    return result
