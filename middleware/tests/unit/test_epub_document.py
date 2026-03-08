import zipfile
from pathlib import Path

import pytest

from murasaki_translator.core.chunker import TextBlock
from murasaki_translator.documents.epub import EpubDocument


def _make_epub(tmp_path: Path) -> Path:
    epub_path = tmp_path / "sample.epub"
    with zipfile.ZipFile(epub_path, "w") as zf:
        content = """
        <html><body>
        <p>hello <ruby><rb>漢字</rb><rt>かな</rt></ruby> and <ruby>谷<rt>たに</rt></ruby></p>
        <p>world</p>
        </body></html>
        """
        zf.writestr("Text/ch1.xhtml", content)
    return epub_path


@pytest.mark.unit
def test_epub_document_load_strips_ruby_wrappers(tmp_path: Path):
    epub_path = _make_epub(tmp_path)
    doc = EpubDocument(str(epub_path))
    items = doc.load()
    assert len(items) >= 2
    first = items[0]["text"]
    assert "@id=" in first
    assert "@end=" in first
    assert "<rt>" not in first
    assert "<rb>" not in first
    assert "<ruby" not in first.lower()
    assert "漢字" in first
    assert "谷" in first


@pytest.mark.unit
def test_epub_document_save_strips_ruby_wrappers(tmp_path: Path):
    epub_path = _make_epub(tmp_path)
    doc = EpubDocument(str(epub_path))
    items = doc.load()
    combined = "\n".join(item["text"] for item in items)
    output_path = tmp_path / "out.epub"
    doc.save(
        str(output_path),
        [TextBlock(id=1, prompt_text=combined, metadata=[item["meta"] for item in items])],
    )
    with zipfile.ZipFile(output_path, "r") as zf:
        chapter = zf.read("Text/ch1.xhtml").decode("utf-8", errors="ignore").lower()
    assert "<ruby" not in chapter
    assert "<rb>" not in chapter
    assert "<rt>" not in chapter


@pytest.mark.unit
def test_epub_document_save_recovers_missing_uid_from_ordered_fallback(tmp_path: Path):
    epub_path = _make_epub(tmp_path)
    doc = EpubDocument(str(epub_path))
    items = doc.load()
    output_path = tmp_path / "fallback.epub"

    first_uid = items[0]["meta"]["uid"]
    second_uid = items[1]["meta"]["uid"]
    blocks = [
        TextBlock(
            id=1,
            prompt_text=f"@id={first_uid}@translated-one@end={first_uid}@",
            metadata=[items[0]["meta"], items[1]["meta"]],
        ),
        TextBlock(
            id=2,
            prompt_text=f"@id={second_uid}@translated-two@end={second_uid}@",
            metadata=[items[0]["meta"]],
        ),
    ]

    doc.save(str(output_path), blocks)

    with zipfile.ZipFile(output_path, "r") as zf:
        chapter = zf.read("Text/ch1.xhtml").decode("utf-8", errors="ignore")

    assert "translated-one" in chapter
    assert "translated-two" in chapter

@pytest.mark.unit
def test_epub_document_normalize_anchor_stream():
    doc = EpubDocument("dummy.epub")
    text = "＠ｉｄ＝１＠\nhello\n＠ｅｎｄ＝１＠"
    normalized = doc._normalize_anchor_stream(text)
    assert normalized == "@id=1@\nhello\n@end=1@"
