"""Profile Store for Pipeline V2 (YAML-based)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional
import os
import re

import yaml


@dataclass
class ProfileRef:
    kind: str
    profile_id: str
    path: str
    name: str
    chunk_type: Optional[str] = None


class ProfileStore:
    def __init__(self, base_dir: str):
        self.base_dir = base_dir

    @staticmethod
    def is_safe_profile_id(value: str) -> bool:
        if not value:
            return False
        trimmed = str(value).strip()
        if not trimmed:
            return False
        if ".." in trimmed:
            return False
        if "/" in trimmed or "\\" in trimmed:
            return False
        return bool(re.match(r"^[A-Za-z0-9_][A-Za-z0-9_.-]*$", trimmed))

    def _normalize_path(self, path: str) -> str:
        normalized = os.path.abspath(path)
        return normalized.lower() if os.name == "nt" else normalized

    def _is_within_base_dir(self, path: str) -> bool:
        base = self._normalize_path(self.base_dir)
        target = self._normalize_path(path)
        if target == base:
            return True
        return target.startswith(base + os.sep)

    def _kind_dir(self, kind: str) -> str:
        return os.path.join(self.base_dir, kind)

    def ensure_dirs(self, kinds: List[str]) -> None:
        for kind in kinds:
            os.makedirs(self._kind_dir(kind), exist_ok=True)

    @staticmethod
    def _normalize_chunk_type(value: Any) -> str:
        raw = str(value or "").strip().lower()
        if raw == "legacy":
            return "block"
        if raw in {"block", "line"}:
            return raw
        return ""

    def list_profiles(self, kind: str) -> List[ProfileRef]:
        result: List[ProfileRef] = []
        kind_dir = self._kind_dir(kind)
        if not os.path.isdir(kind_dir):
            return result
        for name in sorted(os.listdir(kind_dir)):
            if not name.endswith((".yaml", ".yml")):
                continue
            path = os.path.join(kind_dir, name)
            data = self.load_profile_by_path(path)
            if not isinstance(data, dict):
                continue
            fallback_id = os.path.splitext(name)[0]
            if not self.is_safe_profile_id(fallback_id):
                continue
            raw_id = str(data.get("id") or "").strip()
            profile_id = raw_id if self.is_safe_profile_id(raw_id) else fallback_id
            display_name = str(data.get("name") or profile_id)
            chunk_type = None
            if kind == "chunk":
                raw_chunk_type = data.get("chunk_type") or data.get("type") or ""
                normalized = self._normalize_chunk_type(raw_chunk_type)
                if normalized:
                    chunk_type = normalized
            result.append(
                ProfileRef(
                    kind=kind,
                    profile_id=profile_id,
                    path=path,
                    name=display_name,
                    chunk_type=chunk_type,
                )
            )
        return result

    def load_profile(self, kind: str, ref: str) -> Dict[str, Any]:
        path = self.resolve_profile_path(kind, ref)
        if not path:
            raise FileNotFoundError(f"Profile not found: {kind}:{ref}")
        return self.load_profile_by_path(path)

    def load_profile_by_path(self, path: str) -> Dict[str, Any]:
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        if not isinstance(data, dict):
            raise ValueError(f"Invalid profile YAML: {path}")
        fallback_id = os.path.splitext(os.path.basename(path))[0]
        if not self.is_safe_profile_id(fallback_id):
            raise ValueError(f"Invalid profile id: {fallback_id}")
        raw_id = str(data.get("id") or "").strip()
        if self.is_safe_profile_id(raw_id):
            data["id"] = raw_id
        else:
            data["id"] = fallback_id
        data.setdefault("name", data.get("id"))
        data.setdefault("_path", path)
        if os.path.basename(os.path.dirname(path)) == "chunk":
            raw_chunk_type = data.get("chunk_type") or data.get("type") or ""
            normalized = self._normalize_chunk_type(raw_chunk_type)
            if normalized:
                data["chunk_type"] = normalized
        return data

    def resolve_profile_path(self, kind: str, ref: str) -> Optional[str]:
        if not ref:
            return None
        if os.path.isabs(ref) and os.path.exists(ref):
            return ref if self._is_within_base_dir(ref) else None
        if ref.endswith((".yaml", ".yml")):
            base = os.path.splitext(os.path.basename(ref))[0]
            if not self.is_safe_profile_id(base):
                return None
            if "/" in ref or "\\" in ref:
                return None
            candidate = os.path.join(self._kind_dir(kind), ref)
            if os.path.exists(candidate):
                return candidate
        if not self.is_safe_profile_id(ref):
            return None
        candidate = os.path.join(self._kind_dir(kind), f"{ref}.yaml")
        if os.path.exists(candidate):
            return candidate
        for profile in self.list_profiles(kind):
            if profile.profile_id == ref:
                return profile.path
        return None
