import pytest

from rule_processor import RuleProcessor
from murasaki_translator.core.text_protector import TextProtector


@pytest.mark.unit
def test_rule_processor_basic_replace_regex_format():
    rules = [
        {"type": "replace", "pattern": "foo", "replacement": "bar", "active": True},
        {"type": "regex", "pattern": r"\s+", "replacement": " ", "active": True},
        {"type": "format", "pattern": "ellipsis", "active": True},
    ]
    processor = RuleProcessor(rules)
    text = "foo   baz...."
    out = processor.process(text)
    assert out == "bar baz\u2026\u2026"


@pytest.mark.unit
def test_rule_processor_strict_line_count_skips_changes():
    rules = [
        {"type": "format", "pattern": "clean_empty_lines", "active": True},
    ]
    processor = RuleProcessor(rules)
    text = "a\n\n\nb\n"
    out = processor.process(text, strict_line_count=True)
    assert out == text


@pytest.mark.unit
def test_rule_processor_python_script_blocked():
    script = "def transform(text):\n    open('x')\n    return text\n"
    rules = [
        {"type": "python", "script": script, "active": True},
    ]
    processor = RuleProcessor(rules)
    text = "input"
    out = processor.process(text)
    assert out == text
    err = processor.get_python_script_error(script)
    assert "blocked" in err.lower()


@pytest.mark.unit
def test_rule_processor_python_script_timeout():
    script = "def transform(text):\n    while True:\n        pass\n"
    rules = [
        {"type": "python", "script": script, "active": True},
    ]
    processor = RuleProcessor(rules)
    text = "input"
    out = processor.process(text)
    assert out == text
    err = processor.get_python_script_error(script)
    assert "timeout" in err.lower()


@pytest.mark.unit
def test_rule_processor_python_transform_function():
    script = "def transform(text, src_text=None, protector=None):\n    return f\"{text}:{src_text}\"\n"
    rules = [
        {"type": "python", "script": script, "active": True},
    ]
    processor = RuleProcessor(rules)
    text = "input"
    out = processor.process(text, src_text="source")
    assert out == "input:source"


@pytest.mark.unit
def test_rule_processor_python_transform_with_protector_restore():
    script = (
        "def transform(text, src_text=None, protector=None):\n"
        "    if protector is None:\n"
        "        return text\n"
        "    return protector.restore(text)\n"
    )
    rules = [
        {"type": "python", "script": script, "active": True},
    ]
    processor = RuleProcessor(rules)
    protector = TextProtector()
    protector.replacements = {"@P1@": "Alice"}
    out = processor.process("@P1@", protector=protector)
    assert out == "Alice"


@pytest.mark.unit
def test_rule_processor_smart_quotes_preserves_html_attribute_quotes():
    rules = [
        {"type": "format", "pattern": "smart_quotes", "active": True},
    ]
    processor = RuleProcessor(rules)
    text = '<font color="#ff0000">"哈哈哈"</font>'
    out = processor.process(text)
    assert '<font color="#ff0000">' in out
    assert "<font color=「#ff0000」>" not in out
    assert "「哈哈哈」" in out


@pytest.mark.unit
def test_rule_processor_smart_quotes_preserves_inline_code_quotes():
    rules = [
        {"type": "format", "pattern": "smart_quotes", "active": True},
    ]
    processor = RuleProcessor(rules)
    text = '配置示例：`{"k":"v"}`；对话："你好"'
    out = processor.process(text)
    assert '`{"k":"v"}`' in out
    assert "配置示例：" in out
    assert "对话：「你好」" in out


@pytest.mark.unit
def test_rule_processor_smart_quotes_preserves_fenced_code_block_quotes():
    rules = [
        {"type": "format", "pattern": "smart_quotes", "active": True},
    ]
    processor = RuleProcessor(rules)
    text = '```json\n{"k":"v"}\n```\n"外部内容"'
    out = processor.process(text)
    assert '```json\n{"k":"v"}\n```' in out
    assert "「外部内容」" in out
