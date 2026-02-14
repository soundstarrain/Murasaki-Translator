import pytest

from murasaki_translator.utils.srt_parser import SRTParser


@pytest.mark.unit
def test_srt_parser_roundtrip():
    content = """1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\nWorld\n"""
    entries = SRTParser.parse(content)
    assert len(entries) == 2
    assert entries[0].text == "Hello"
    assert entries[1].timestamp == "00:00:03,000 --> 00:00:04,000"

    SRTParser.apply_translations(entries, ["Hola", "Mundo"])
    out = SRTParser.format(entries, use_translated=True)
    assert "Hola" in out
    assert "Mundo" in out


@pytest.mark.unit
def test_srt_parser_format_bilingual():
    content = """1\n00:00:01,000 --> 00:00:02,000\nHello\n"""
    entries = SRTParser.parse(content)
    SRTParser.apply_translations(entries, ["你好"])
    out = SRTParser.format_bilingual(entries)
    assert "Hello" in out
    assert "你好" in out
