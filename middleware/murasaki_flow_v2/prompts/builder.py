# Prompt builder for Pipeline V2.

from __future__ import annotations

from typing import Any, Dict, List
import re


_TEMPLATE_TOKEN_PATTERN = re.compile(r"\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}")


def _render_template(template: str, mapping: Dict[str, str]) -> str:
    def _replace(match: re.Match[str]) -> str:
        key = match.group(1)
        return mapping.get(key, match.group(0))

    return _TEMPLATE_TOKEN_PATTERN.sub(_replace, template)


def build_messages(
    profile: Dict[str, Any],
    source_text: str,
    context_before: str,
    context_after: str,
    glossary_text: str,
    line_index: int | None = None,
) -> List[Dict[str, str]]:
    system_template = str(profile.get("system_template") or "").strip("\n")
    user_template = str(profile.get("user_template") or "").strip("\n")

    mapping = {
        "source": str(source_text or ""),
        "context_before": str(context_before or ""),
        "context_after": str(context_after or ""),
        "glossary": str(glossary_text or ""),
        "line_index": "" if line_index is None else str(line_index),
        "line_number": "" if line_index is None else str(line_index + 1),
    }

    messages: List[Dict[str, str]] = []

    if system_template:
        content = _render_template(system_template, mapping).strip("\n")
        if content:
            messages.append({"role": "system", "content": content})

    if user_template:
        content = _render_template(user_template, mapping).strip("\n")
        messages.append({"role": "user", "content": content})

    if not messages:
        messages.append({"role": "user", "content": mapping["source"]})

    return messages
