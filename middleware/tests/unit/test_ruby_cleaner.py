import pytest

from murasaki_translator.fixer.ruby_cleaner import RubyCleaner


@pytest.mark.unit
def test_ruby_cleaner_basic():
    text = "<ruby><rb>\u6f22\u5b57</rb><rt>\u304b\u3093\u3058</rt></ruby>"
    out = RubyCleaner.clean(text, aggressive=False)
    assert out == "\u6f22\u5b57"


@pytest.mark.unit
def test_ruby_cleaner_aggressive():
    text = "\uff5c\u6f22\u5b57\u300a\u304b\u3093\u3058\u300b"
    out = RubyCleaner.clean(text, aggressive=True)
    assert out == "\u6f22\u5b57"
