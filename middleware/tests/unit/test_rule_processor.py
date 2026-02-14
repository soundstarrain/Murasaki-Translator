import pytest

from rule_processor import RuleProcessor


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
