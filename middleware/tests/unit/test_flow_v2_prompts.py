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
def test_flow_v2_prompt_uses_current_system_template_only():
    profile = {
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
    assert messages[0]["content"] == "System D"


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


@pytest.mark.unit
def test_flow_v2_prompt_template_does_not_second_pass_expand():
    profile = {
        "user_template": "{{source}}",
    }
    messages = build_messages(
        profile,
        source_text="line {{glossary}}",
        context_before="",
        context_after="",
        glossary_text="SECRET_GLOSSARY",
        line_index=None,
    )
    assert messages == [{"role": "user", "content": "line {{glossary}}"}]
