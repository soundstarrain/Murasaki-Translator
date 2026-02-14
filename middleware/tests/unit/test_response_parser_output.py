import pytest

from murasaki_translator.core.parser import ResponseParser


@pytest.mark.unit
def test_response_parser_output_key():
    parser = ResponseParser()
    raw = '{"output":"ok"}'
    lines, cot = parser.parse(raw, expected_count=0)
    assert lines == ["ok"]
    assert cot == ""
