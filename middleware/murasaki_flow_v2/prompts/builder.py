# Prompt builder for Pipeline V2.

from __future__ import annotations

from typing import Any, Dict, List


def _render_template(template: str, mapping: Dict[str, str]) -> str:
    result = template
    for key, value in mapping.items():
        result = result.replace(f"{{{{{key}}}}}", value)
    return result


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
    persona = str(profile.get("persona") or "").strip("\n")
    style_rules = str(profile.get("style_rules") or "").strip("\n")
    output_rules = str(profile.get("output_rules") or "").strip("\n")

    mapping = {
        "source": str(source_text or ""),
        "context_before": str(context_before or ""),
        "context_after": str(context_after or ""),
        "glossary": str(glossary_text or ""),
        "line_index": "" if line_index is None else str(line_index),
        "line_number": "" if line_index is None else str(line_index + 1),
    }

    messages: List[Dict[str, str]] = []

    system_parts: List[str] = []
    if persona:
        system_parts.append(_render_template(persona, mapping).strip("\n"))
    if style_rules:
        system_parts.append(_render_template(style_rules, mapping).strip("\n"))
    if output_rules:
        system_parts.append(_render_template(output_rules, mapping).strip("\n"))
    if system_template:
        system_parts.append(_render_template(system_template, mapping).strip("\n"))

    if system_parts:
        content = "\n\n".join([part for part in system_parts if part])
        if content:
            messages.append({"role": "system", "content": content})

    if user_template:
        content = _render_template(user_template, mapping).strip("\n")
        messages.append({"role": "user", "content": content})

    if not messages:
        messages.append({"role": "user", "content": mapping["source"]})

    return messages
