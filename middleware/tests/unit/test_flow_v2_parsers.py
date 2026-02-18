import pytest

from murasaki_flow_v2.parsers.builtins import (
    AnyParser,
    JsonlParser,
    JsonObjectParser,
    PlainParser,
    PythonScriptParser,
    RegexParser,
    TaggedLineParser,
)
from murasaki_flow_v2.parsers.base import ParserError


@pytest.mark.unit
def test_flow_v2_regex_parser():
    parser = RegexParser(
        {
            "options": {
                "pattern": r"result: (?P<content>.+)",
                "group": "content",
            }
        }
    )
    output = parser.parse("result: hello")
    assert output.text == "hello"


@pytest.mark.unit
def test_flow_v2_plain_parser_strips_think_tags():
    parser = PlainParser({})
    output = parser.parse("<think>analysis</think>\nHello")
    assert output.text == "Hello"


@pytest.mark.unit
def test_flow_v2_json_object_parser():
    parser = JsonObjectParser({"options": {"path": "translation.text"}})
    output = parser.parse('{"translation": {"text": "hi"}}')
    assert output.text == "hi"


@pytest.mark.unit
def test_flow_v2_json_object_parser_accepts_code_fence():
    parser = JsonObjectParser({"options": {"path": "translation.text"}})
    output = parser.parse(
        'Result:\n```json\n{"translation": {"text": "hi"}}\n```\n',
    )
    assert output.text == "hi"


@pytest.mark.unit
def test_flow_v2_json_object_parser_accepts_python_literal():
    parser = JsonObjectParser({"options": {"path": "translation"}})
    output = parser.parse("{'translation': 'ok'}")
    assert output.text == "ok"


@pytest.mark.unit
def test_flow_v2_regex_parser_missing_pattern():
    parser = RegexParser({"options": {}})
    with pytest.raises(RuntimeError):
        parser.parse("result: hello")


@pytest.mark.unit
def test_flow_v2_any_parser_fallback():
    parser = AnyParser(
        {
            "options": {
                "parsers": [
                    {"type": "regex", "options": {"pattern": r"no_match_(?P<content>.+)"}},
                    {"type": "json_object", "options": {"path": "translation"}},
                ]
            }
        }
    )
    output = parser.parse('{"translation": "ok"}')
    assert output.text == "ok"


@pytest.mark.unit
def test_flow_v2_any_parser_requires_list():
    parser = AnyParser({"options": {}})
    with pytest.raises(ParserError):
        parser.parse("hello")


@pytest.mark.unit
def test_flow_v2_jsonl_parser():
    parser = JsonlParser({"options": {"path": "translation"}})
    output = parser.parse('{"translation": "a"}\n{"translation": "b"}')
    assert output.lines == ["a", "b"]


@pytest.mark.unit
def test_flow_v2_jsonl_parser_strips_think_tags():
    parser = JsonlParser({"options": {"path": "translation"}})
    output = parser.parse('<think>analysis</think>\n{"translation": "a"}')
    assert output.lines == ["a"]


@pytest.mark.unit
def test_flow_v2_jsonl_parser_accepts_jsonline_prefix():
    parser = JsonlParser({"options": {"path": "translation"}})
    output = parser.parse('jsonline{"translation": "a"}\njsonline{"translation": "b"}')
    assert output.lines == ["a", "b"]


@pytest.mark.unit
def test_flow_v2_jsonl_parser_accepts_code_fence():
    parser = JsonlParser({"options": {"path": "translation"}})
    output = parser.parse(
        '```jsonl\n{"translation": "a"}\n{"translation": "b"}\n```',
    )
    assert output.lines == ["a", "b"]


@pytest.mark.unit
def test_flow_v2_tagged_line_sort_by_id():
    parser = TaggedLineParser({"options": {"pattern": r"^@@(?P<id>\d+)@@(?P<text>.*)$", "sort_by_id": True}})
    output = parser.parse("@@2@@second\n@@1@@first\n@@3@@third")
    assert output.lines == ["first", "second", "third"]


@pytest.mark.unit
def test_flow_v2_python_script_parser(tmp_path):
    script_path = tmp_path / "parser_script.py"
    script_path.write_text(
        "def parse(text):\n"
        "    return [line.upper() for line in text.splitlines()]\n",
        encoding="utf-8",
    )
    parser = PythonScriptParser({"options": {"script": str(script_path)}})
    output = parser.parse("a\nb")
    assert output.lines == ["A", "B"]
