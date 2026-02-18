# Parser registry for Pipeline V2.

from __future__ import annotations

from typing import Dict

from murasaki_flow_v2.registry.profile_store import ProfileStore
from .base import BaseParser, ParserError
from .builtins import (
    PlainParser,
    LineStrictParser,
    JsonArrayParser,
    TaggedLineParser,
    RegexParser,
    JsonObjectParser,
    JsonlParser,
    AnyParser,
    PythonScriptParser,
)


class ParserRegistry:
    def __init__(self, store: ProfileStore):
        self.store = store
        self._cache: Dict[str, BaseParser] = {}

    def get_parser(self, ref: str) -> BaseParser:
        if ref in self._cache:
            return self._cache[ref]
        profile = self.store.load_profile("parser", ref)
        parser_type = str(profile.get("type") or "plain")
        if parser_type == "plain":
            parser = PlainParser(profile)
        elif parser_type == "line_strict":
            parser = LineStrictParser(profile)
        elif parser_type == "json_array":
            parser = JsonArrayParser(profile)
        elif parser_type == "json_object":
            parser = JsonObjectParser(profile)
        elif parser_type == "jsonl":
            parser = JsonlParser(profile)
        elif parser_type == "tagged_line":
            parser = TaggedLineParser(profile)
        elif parser_type == "regex":
            parser = RegexParser(profile)
        elif parser_type == "any":
            parser = AnyParser(profile)
        elif parser_type == "python":
            parser = PythonScriptParser(profile)
        else:
            raise ParserError(f"Unsupported parser type: {parser_type}")
        self._cache[ref] = parser
        return parser
