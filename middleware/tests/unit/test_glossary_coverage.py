import pytest

from murasaki_translator.core.quality_checker import calculate_glossary_coverage


@pytest.mark.unit
def test_glossary_coverage_cot_path():
    glossary = {"foo": "bar"}
    passed, out_cov, cot_cov, hit, total = calculate_glossary_coverage(
        "foo", "missing", glossary, cot_text="foo", output_hit_threshold=100, cot_coverage_threshold=80
    )
    assert passed is True
    assert out_cov == 0.0
    assert cot_cov == 100.0
    assert hit == 0
    assert total == 1
