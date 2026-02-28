import pytest

from murasaki_translator.core.anchor_guard import (
    normalize_anchor_stream,
    prepare_local_anchor_context,
    repair_and_validate_anchor_output,
    restore_output_anchors,
)


@pytest.mark.unit
def test_anchor_guard_prepare_and_restore_local_mapping():
    source = "@id=1201@\nA\n@end=1201@\n@id=1202@\nB\n@end=1202@"
    ctx = prepare_local_anchor_context(source, source, mode="epub")

    assert ctx.enabled is True
    assert "@id=1@" in ctx.source_text_local
    assert "@id=2@" in ctx.source_text_local
    assert "1201" not in ctx.source_text_local

    localized_output = "@id=1@\nAA\n@end=1@\n@id=2@\nBB\n@end=2@"
    restored = restore_output_anchors(localized_output, ctx.local_to_global)
    assert "@id=1201@" in restored
    assert "@end=1201@" in restored
    assert "@id=1202@" in restored
    assert "@end=1202@" in restored


@pytest.mark.unit
def test_anchor_guard_normalize_full_width_tokens():
    text = "＠ ｉ ｄ ＝ ３ ＠\nhello\n＠ｅｎｄ＝３＠"
    normalized = normalize_anchor_stream(text)
    assert normalized == "@id=3@\nhello\n@end=3@"


@pytest.mark.unit
def test_anchor_guard_repair_alignment_double_id_success():
    source = "@id=1@\nfoo\n@end=1@\n@id=2@\nbar\n@end=2@"
    output_old_style = "@id=1@\n译1\n@id=1@\n@id=2@\n译2\n@id=2@"

    repaired, ok, meta = repair_and_validate_anchor_output(
        source,
        output_old_style,
        mode="alignment",
    )

    assert ok is True
    assert "@end=1@" in repaired
    assert "@end=2@" in repaired
    assert "alignment_id_to_end" in (meta.get("repair_steps") or [])


@pytest.mark.unit
def test_anchor_guard_repair_strips_foreign_anchor_tokens():
    source = "@id=1@\nfoo\n@end=1@"
    output = "@id=1@\nok\n@end=1@\n@id=999@\nbad\n@end=999@"

    repaired, ok, meta = repair_and_validate_anchor_output(source, output, mode="epub")

    assert ok is True
    assert "@id=999@" not in repaired
    assert "@end=999@" not in repaired
    assert "strip_foreign_anchor" in (meta.get("repair_steps") or [])


@pytest.mark.unit
def test_anchor_guard_repair_rebuild_from_loose_segments():
    source = "@id=1@\nfoo\n@end=1@\n@id=2@\nbar\n@end=2@"
    output = "@id=1@\nA\n@id=2@\nB\n@end=2@"

    repaired, ok, meta = repair_and_validate_anchor_output(source, output, mode="epub")

    assert ok is True
    assert "@id=1@" in repaired
    assert "@end=1@" in repaired
    assert "@id=2@" in repaired
    assert "@end=2@" in repaired
    assert "rebuild_anchor_pairs" in (meta.get("repair_steps") or [])


@pytest.mark.unit
def test_anchor_guard_repair_mismatched_end_pairs_rebuilds_strictly():
    source = "@id=1@\nfoo\n@end=1@\n@id=2@\nbar\n@end=2@"
    output = "@id=1@\nX\n@end=2@\n@id=2@\nY\n@end=1@"

    repaired, ok, meta = repair_and_validate_anchor_output(source, output, mode="epub")

    assert ok is True
    assert "@id=1@\nX\n@end=1@" in repaired
    assert "@id=2@\nY\n@end=2@" in repaired
    assert "rebuild_anchor_pairs" in (meta.get("repair_steps") or [])
    assert int(meta.get("strict_pair_missing_count") or 0) == 0


@pytest.mark.unit
def test_anchor_guard_repair_fail_when_missing_segment():
    source = "@id=1@\nfoo\n@end=1@\n@id=2@\nbar\n@end=2@"
    output = "@id=1@\nA\n@end=1@"

    repaired, ok, meta = repair_and_validate_anchor_output(source, output, mode="epub")

    assert ok is False
    assert "@id=1@" in repaired
    assert int(meta.get("missing_count") or 0) >= 1
