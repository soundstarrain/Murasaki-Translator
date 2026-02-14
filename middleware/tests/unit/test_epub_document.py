import zipfile
from pathlib import Path

import pytest

from murasaki_translator.documents.epub import EpubDocument


def _make_epub(tmp_path: Path) -> Path:
    epub_path = tmp_path / "sample.epub"
    with zipfile.ZipFile(epub_path, "w") as zf:
        content = """
        <html><body>
        <p>hello <ruby><rb>漢字</rb><rt>かな</rt></ruby></p>
        <p>world</p>
        </body></html>
        """
        zf.writestr("Text/ch1.xhtml", content)
    return epub_path


@pytest.mark.unit
def test_epub_document_load_removes_rt(tmp_path: Path):
    epub_path = _make_epub(tmp_path)
    doc = EpubDocument(str(epub_path))
    items = doc.load()
    assert len(items) >= 2
    first = items[0]["text"]
    assert "@id=" in first
    assert "@end=" in first
    assert "<rt>" not in first


@pytest.mark.unit
def test_epub_document_normalize_anchor_stream():
    doc = EpubDocument("dummy.epub")
    text = "＠ｉｄ＝１＠\nhello\n＠ｅｎｄ＝１＠"
    normalized = doc._normalize_anchor_stream(text)
    assert normalized == "@id=1@\nhello\n@end=1@"
