"""Document Factory - Instantiates the appropriate handler based on file extension."""

import os
from .base import BaseDocument
from .txt import TxtDocument
from .srt import SrtDocument
from .ass import AssDocument
from .epub import EpubDocument

class DocumentFactory:
    @staticmethod
    def get_document(path: str) -> BaseDocument:
        ext = os.path.splitext(path)[1].lower()
        
        if ext == '.srt':
            return SrtDocument(path)
        elif ext in ['.ass', '.ssa']:
            return AssDocument(path)
        elif ext == '.epub':
            return EpubDocument(path)
        else:
            # Default to TXT (supports .txt, .md, etc.)
            return TxtDocument(path)
