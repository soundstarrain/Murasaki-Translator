import pytest

from murasaki_translator.core.text_protector import TextProtector, create_protector


@pytest.mark.unit
def test_text_protector_protect_and_restore_fullwidth():
    protector = TextProtector()
    text = "<i>hi</i> {\\k10} x"
    protected = protector.protect(text)
    assert "@" in protected
    assert "<i>" not in protected
    assert "{\\k10}" not in protected

    # Use full-width placeholder to test fuzzy restore
    placeholder = next(iter(protector.replacements.keys()))
    mangled = placeholder.replace("@", "\uff20").replace("1", "\uff11")
    restored = protector.restore(mangled)
    assert restored == protector.replacements[placeholder]


@pytest.mark.unit
def test_text_protector_stats_and_factory():
    protector = create_protector(enabled=False)
    assert protector.enabled is False
    stats = protector.get_stats()
    assert stats["enabled"] is False
    assert stats["protected_count"] == 0


@pytest.mark.unit
def test_text_protector_avoids_placeholder_collision():
    protector = TextProtector(patterns=[r"\{[^}]+\}"])
    text = "keep @P1@ {var}"
    protected = protector.protect(text)
    assert "@P1@" in protected
    assert len(protector.replacements) == 1
    placeholder = next(iter(protector.replacements.keys()))
    assert placeholder != "@P1@"
    restored = protector.restore(protected)
    assert restored == text
