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


def _get_chunk_type(store: Optional[ProfileStore], ref: str) -> str:
    if not store or not ref:
        return ""
    try:
        profile = store.load_profile("chunk", ref)
    except Exception:
        return ""
    return str(profile.get("chunk_type") or profile.get("type") or "")


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
            members = data.get("members")
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
            has_members = isinstance(members, list) and bool(members)
            if not has_endpoints and not has_members:
                result.errors.append("missing_pool_endpoints")
            if has_endpoints and missing_model:
                result.errors.append("missing_pool_model")
            if has_members and store:
                for member in members:
                    member_id = str(member or "")
                    if member_id and not _exists(store, "api", member_id):
                        _error_missing_ref("api", member_id, result)
        else:
            _warn_unknown_type(api_type, result)
        if data.get("rpm") is not None and data.get("rpm") != "":
            try:
                rpm_value = int(data.get("rpm"))
            except (TypeError, ValueError):
                rpm_value = 0
            if rpm_value < 1:
                result.errors.append("invalid_rpm")

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

    if kind == "chunk":
        chunk_type = str(data.get("chunk_type") or data.get("type") or "")
        if not chunk_type:
            result.errors.append("missing_field:chunk_type")
        if chunk_type and chunk_type not in {"legacy", "line"}:
            _warn_unknown_type(chunk_type, result)

    if kind == "pipeline":
        for field in ("provider", "prompt", "parser", "chunk_policy"):
            _ensure_field(data, field, result)
        if data.get("apply_line_policy") and not data.get("line_policy"):
            result.errors.append("missing_field:line_policy")
        settings = data.get("settings") or {}
        if "concurrency" in settings:
            raw_concurrency = settings.get("concurrency")
            if raw_concurrency is None or raw_concurrency == "":
                concurrency = 0
            else:
                try:
                    concurrency = int(raw_concurrency)
                except (TypeError, ValueError):
                    concurrency = None
            if concurrency is None or concurrency < 0:
                result.errors.append("invalid_concurrency")

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
            chunk_type = _get_chunk_type(store, chunk_ref)
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
