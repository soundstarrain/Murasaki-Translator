import pytest

from murasaki_translator.core.parser import ResponseParser


@pytest.mark.unit
def test_response_parser_think_block():
    parser = ResponseParser()
    raw = "<think>idea</think>\nline1\nline2"
    lines, cot = parser.parse(raw, expected_count=0)
    assert "think" in cot
    assert lines == ["line1", "line2"]


@pytest.mark.unit
def test_response_parser_json_format():
    parser = ResponseParser()
    raw = '{"think":"t","translation":"ok"}'
    lines, cot = parser.parse(raw, expected_count=0)
    assert "think" in cot
    assert lines == ["ok"]


@pytest.mark.unit
def test_response_parser_json_output_field():
    parser = ResponseParser()
    raw = '{"output":"hello"}'
    lines, cot = parser.parse(raw, expected_count=0)
    assert cot == ""
    assert lines == ["hello"]


@pytest.mark.unit
def test_response_parser_json_text_field_with_newlines():
    parser = ResponseParser()
    raw = '{"text":"a\\nb"}'
    lines, cot = parser.parse(raw, expected_count=0)
    assert lines == ["a", "b"]


@pytest.mark.unit
def test_response_parser_braced_plain_text():
    parser = ResponseParser()
    raw = "{\nline1\nline2\n}"
    lines, cot = parser.parse(raw, expected_count=0)
    assert lines == ["line1", "line2"]


@pytest.mark.unit
def test_response_parser_open_think_tag():
    parser = ResponseParser()
    raw = "<think>partial\nline1"
    lines, cot = parser.parse(raw, expected_count=0)
    assert "think" in cot
    assert lines == [""]


@pytest.mark.unit
def test_response_parser_preserves_empty_lines():
    parser = ResponseParser()
    raw = "a\n\nb"
    lines, cot = parser.parse(raw, expected_count=0)
    assert lines == ["a", "", "b"]
