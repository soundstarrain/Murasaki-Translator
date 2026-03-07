"""Base Document Class - Defines the interface for different document formats."""

from typing import List, Dict, Any
from abc import ABC, abstractmethod
from murasaki_translator.core.chunker import TextBlock


class BaseDocument(ABC):
    def __init__(self, path: str):
        self.path = path
        self.raw_lines = []
        self.metadata = {}
        self.runtime_context: Dict[str, Any] = {}

    def set_runtime_context(self, **kwargs: Any):
        for key, value in kwargs.items():
            if value is not None:
                self.runtime_context[key] = value
        return self

    def get_runtime_option(self, key: str, default: Any = None) -> Any:
        return self.runtime_context.get(key, default)

    @abstractmethod
    def load(self) -> List[Dict[str, Any]]:
        """
        Load document and return a list of items for the chunker.
        Each item: {'text': str, 'meta': Any}
        """
        pass

    @abstractmethod
    def save(self, output_path: str, blocks: List[TextBlock]):
        """
        Reconstruct and save the document with translated text.
        """
        pass
