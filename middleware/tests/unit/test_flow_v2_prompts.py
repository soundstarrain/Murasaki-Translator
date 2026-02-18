import pytest

from murasaki_flow_v2.prompts.builder import build_messages


@pytest.mark.unit
def test_flow_v2_prompt_line_number():
    profile = {
        "system_template": "Translate",
        "user_template": "@@{{line_number}}@@{{source}}",
    }
    messages = build_messages(
        profile,
        source_text="hello",
        context_before="",
        context_after="",
        glossary_text="",
        line_index=4,
    )
    assert messages[-1]["content"] == "@@5@@hello"


@pytest.mark.unit
def test_flow_v2_prompt_persona_rules_order():
    profile = {
        "persona": "Persona A",
        "style_rules": "Style B",
        "output_rules": "Output C",
        "system_template": "System D",
        "user_template": "{{source}}",
    }
    messages = build_messages(
        profile,
        source_text="hello",
        context_before="",
        context_after="",
        glossary_text="",
        line_index=None,
    )
    assert messages[0]["role"] == "system"
    assert messages[0]["content"] == "Persona A\n\nStyle B\n\nOutput C\n\nSystem D"


@pytest.mark.unit
def test_flow_v2_prompt_fallback_user_only():
    profile = {}
    messages = build_messages(
        profile,
        source_text="hello",
        context_before="",
        context_after="",
        glossary_text="",
        line_index=None,
    )
    assert messages == [{"role": "user", "content": "hello"}]
