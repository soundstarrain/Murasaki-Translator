import pytest

from murasaki_translator.utils.text_helper import TextHelper


@pytest.mark.unit
def test_text_helper_kana_and_hangeul():
    assert TextHelper.is_kana("\u3042")
    assert TextHelper.is_hangeul("\uac00")


@pytest.mark.unit
def test_text_helper_strip_punctuation():
    assert TextHelper.strip_punctuation("!!abc??") == "abc"
    assert TextHelper.strip_punctuation("\u3002abc\u3002") == "abc"
