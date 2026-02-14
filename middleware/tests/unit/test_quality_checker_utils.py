import pytest

from murasaki_translator.core.quality_checker import (
    format_warnings_for_log,
    count_warnings_by_type,
)


@pytest.mark.unit
def test_quality_checker_format_and_count():
    warnings = [
        {"type": "kana_residue", "message": "a"},
        {"type": "kana_residue", "message": "b"},
        {"type": "line_mismatch", "message": "c"},
    ]
    summary = format_warnings_for_log(warnings)
    assert "kana_residue" in summary
    counts = count_warnings_by_type(warnings)
    assert counts["kana_residue"] == 2
    assert counts["line_mismatch"] == 1
