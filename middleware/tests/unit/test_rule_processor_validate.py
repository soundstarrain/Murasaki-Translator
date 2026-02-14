import pytest

from rule_processor import validate_regex


@pytest.mark.unit
def test_validate_regex_empty_and_invalid():
    ok, err = validate_regex("")
    assert ok is False
    assert "Empty" in err

    ok, err = validate_regex("(")
    assert ok is False
    assert "Invalid" in err
