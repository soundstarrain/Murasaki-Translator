import pytest

from murasaki_translator.core.prompt import PromptBuilder


@pytest.mark.unit
def test_prompt_builder_glossary_injection():
    builder = PromptBuilder({"foo": "bar", "baz": "qux"})
    messages = builder.build_messages("foo only", preset="novel")
    system = messages[0]["content"]
    assert "术语表" in system
    assert "foo" in system
    assert "baz" not in system


@pytest.mark.unit
def test_prompt_builder_unknown_preset_fallback():
    builder = PromptBuilder()
    messages = builder.build_messages("hello", preset="unknown")
    system = messages[0]["content"]
    assert "轻小说" in system


@pytest.mark.unit
def test_prompt_builder_glossary_limit():
    glossary = {f"t{i}": f"v{i}" for i in range(30)}
    builder = PromptBuilder(glossary)
    block = " ".join(glossary.keys())
    messages = builder.build_messages(block, preset="novel")
    system = messages[0]["content"]
    # Only top 20 terms should be injected
    assert system.count("\": \"") <= 20
