import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import term_extractor as te


@pytest.mark.unit
def test_term_extractor_clean_ruby():
    extractor = te.TermExtractor(top_k=10)
    text = "|\u6f22\u5b57\u300a\u304b\u3093\u3058\u300b"
    cleaned = extractor._clean_ruby(text)
    assert "\u304b\u3093\u3058" not in cleaned


@pytest.mark.unit
def test_term_extractor_is_valid_filters_short_and_stopwords():
    extractor = te.TermExtractor(top_k=10)
    assert extractor._is_valid("\u79c1") is False
    assert extractor._is_valid("\u3042") is False
    assert extractor._is_valid("123") is False


@pytest.mark.unit
def test_term_extractor_katakana_names():
    extractor = te.TermExtractor(top_k=10)
    text = "\u30a2\u30ea\u30b9\u30fb\u30dc\u30d6"
    entities = extractor._extract_katakana_names(text)
    assert "\u30a2\u30ea\u30b9\u30fb\u30dc\u30d6" in entities
    assert entities["\u30a2\u30ea\u30b9\u30fb\u30dc\u30d6"]["category"] == "Person"
