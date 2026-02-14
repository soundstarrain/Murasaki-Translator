import pytest

from murasaki_translator.core.quality_checker import QualityChecker, WarningType


@pytest.mark.unit
def test_quality_checker_glossary_miss():
    qc = QualityChecker(glossary={"foo": "bar"})
    warnings = qc.check_output(["foo"], ["baz"], source_lang="ja")
    types = {w["type"] for w in warnings}
    assert WarningType.GLOSSARY_MISSED in types


@pytest.mark.unit
def test_quality_checker_kana_residue_and_similarity():
    qc = QualityChecker()
    src = "abcdefghij"
    dst = "abc\u3042defghij"
    warnings = qc.check_output([src], [dst], source_lang="ja")
    types = {w["type"] for w in warnings}
    assert WarningType.KANA_RESIDUE in types


@pytest.mark.unit
def test_quality_checker_empty_output():
    qc = QualityChecker()
    warnings = qc.check_output(["hello"], [""], source_lang="ja")
    types = {w["type"] for w in warnings}
    assert WarningType.EMPTY_OUTPUT in types


@pytest.mark.unit
def test_quality_checker_hangeul_residue():
    qc = QualityChecker()
    warnings = qc.check_output(["hello"], ["\uac00"], source_lang="ko")
    types = {w["type"] for w in warnings}
    assert WarningType.HANGEUL_RESIDUE in types
