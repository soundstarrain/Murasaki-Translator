# Chunk policy implementations for Pipeline V2.

from __future__ import annotations

from typing import Any, Dict, List

from murasaki_translator.core.chunker import Chunker, TextBlock


class ChunkPolicyError(RuntimeError):
    pass


class ChunkPolicy:
    def __init__(self, profile: Dict[str, Any]):
        self.profile = profile

    def chunk(self, items: List[Dict[str, Any]]) -> List[TextBlock]:
        raise NotImplementedError


class LegacyChunkPolicy(ChunkPolicy):
    def chunk(self, items: List[Dict[str, Any]]) -> List[TextBlock]:
        options = self.profile.get("options") or {}
        mode = "chunk"
        target_chars = int(options.get("target_chars") or 1000)
        max_chars = int(options.get("max_chars") or target_chars * 2)
        enable_balance = bool(
            options.get("enable_balance")
            if options.get("enable_balance") is not None
            else True
        )
        balance_threshold = float(options.get("balance_threshold") or 0.6)
        balance_count = int(options.get("balance_count") or 3)
        chunker = Chunker(
            target_chars=target_chars,
            max_chars=max_chars,
            mode=mode,
            enable_balance=enable_balance,
            balance_threshold=balance_threshold,
            balance_range=balance_count,
        )
        return chunker.process(items)


class LineChunkPolicy(ChunkPolicy):
    def chunk(self, items: List[Dict[str, Any]]) -> List[TextBlock]:
        options = self.profile.get("options") or {}
        strict = bool(options.get("strict") or False)
        keep_empty = bool(
            options.get("keep_empty")
            if options.get("keep_empty") is not None
            else strict
        )

        blocks: List[TextBlock] = []
        for idx, item in enumerate(items):
            if isinstance(item, dict):
                text = str(item.get("text") or "")
                meta = item.get("meta")
            else:
                text = str(item)
                meta = None
            line = text.rstrip("\n")

            if strict:
                content = line
            else:
                if not line.strip() and not keep_empty:
                    continue
                content = line if keep_empty else line.strip()

            if meta is None:
                meta = idx

            blocks.append(
                TextBlock(
                    id=len(blocks) + 1,
                    prompt_text=content,
                    metadata=[meta] if meta is not None else [],
                )
            )

        return blocks
