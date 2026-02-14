import pytest

from murasaki_translator.documents.factory import DocumentFactory
from murasaki_translator.documents.srt import SrtDocument
from murasaki_translator.documents.ass import AssDocument
from murasaki_translator.documents.epub import EpubDocument
from murasaki_translator.documents.txt import TxtDocument


@pytest.mark.unit
def test_document_factory_selects_by_extension():
    assert isinstance(DocumentFactory.get_document("a.srt"), SrtDocument)
    assert isinstance(DocumentFactory.get_document("a.ass"), AssDocument)
    assert isinstance(DocumentFactory.get_document("a.ssa"), AssDocument)
    assert isinstance(DocumentFactory.get_document("a.epub"), EpubDocument)
    assert isinstance(DocumentFactory.get_document("a.txt"), TxtDocument)
