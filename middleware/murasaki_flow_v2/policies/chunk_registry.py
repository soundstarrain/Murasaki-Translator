# Chunk policy registry for Pipeline V2.

from __future__ import annotations

from typing import Dict

from murasaki_flow_v2.registry.profile_store import ProfileStore
from .chunk_policy import (
    ChunkPolicy,
    LegacyChunkPolicy,
    LineChunkPolicy,
    ChunkPolicyError,
)


class ChunkPolicyRegistry:
    def __init__(self, store: ProfileStore):
        self.store = store
        self._cache: Dict[str, ChunkPolicy] = {}

    def get_chunk_policy(self, ref: str) -> ChunkPolicy:
        if ref in self._cache:
            return self._cache[ref]
        profile = self.store.load_profile("chunk", ref)
        policy_type = str(profile.get("chunk_type") or profile.get("type") or "block").strip().lower()
        if policy_type == "legacy":
            policy_type = "block"
        if policy_type == "block":
            policy = LegacyChunkPolicy(profile)
        elif policy_type == "line":
            policy = LineChunkPolicy(profile)
        else:
            raise ChunkPolicyError(f"Unsupported chunk policy: {policy_type}")
        self._cache[ref] = policy
        return policy
