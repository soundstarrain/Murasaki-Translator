"""Adaptive concurrency controller for Pipeline V2."""

from __future__ import annotations

from dataclasses import dataclass
import math
import re
import threading
from typing import Optional


_RATE_LIMIT_RE = re.compile(r"(?:\b429\b|rate\s*limit|rate_limited)", re.I)
_SERVER_ERROR_RE = re.compile(r"\b5\d{2}\b")
_TIMEOUT_RE = re.compile(r"(?:timeout|timed\s*out|network)", re.I)


def classify_error(message: str | None) -> str:
    if not message:
        return "unknown"
    text = str(message)
    if _RATE_LIMIT_RE.search(text):
        return "rate_limited"
    if _SERVER_ERROR_RE.search(text) or "5xx" in text:
        return "server_error"
    if _TIMEOUT_RE.search(text):
        return "network"
    return "other"


@dataclass
class AdaptiveConcurrency:
    min_limit: int = 1
    max_limit: int = 16
    success_target: int = 2
    start_limit: Optional[int] = None
    warmup_successes: int = 10
    error_tolerance_ratio: float = 0.2  # 容忍 20% 比例内的偶发超时或 5xx 错误

    def __post_init__(self) -> None:
        self.min_limit = max(1, int(self.min_limit))
        self.max_limit = max(self.min_limit, int(self.max_limit))
        if self.start_limit is None:
            self._current = max(
                self.min_limit, int(math.ceil(self.max_limit / 2))
            )
        else:
            self._current = max(self.min_limit, min(int(self.start_limit), self.max_limit))
        self._success_streak = 0
        self._success_total = 0
        self._consecutive_errors = 0
        self._lock = threading.Lock()

    def get_limit(self) -> int:
        with self._lock:
            return self._current

    def note_success(self) -> None:
        with self._lock:
            self._success_total += 1
            self._consecutive_errors = 0  # 只要成功一次，错误连击归零
            if self._success_total <= self.warmup_successes:
                if self._current < self.max_limit:
                    self._current += 1
                self._success_streak = 0
                return
            self._success_streak += 1
            if (
                self._success_streak >= self.success_target
                and self._current < self.max_limit
            ):
                self._current += 1
                self._success_streak = 0

    def note_error(self, message: str | None) -> str:
        kind = classify_error(message)
        with self._lock:
            self._success_streak = 0
            
            if kind == "rate_limited":
                # 限流：立刻做出反应，直接砍半
                self._consecutive_errors = 0
                self._current = max(self.min_limit, int(math.ceil(self._current / 2)))
            elif kind in {"server_error", "network"}:
                self._consecutive_errors += 1
                # 超时/5xx：积攒到当前并发量的一定比例 (如 20%) 才开始压低并发，至少容忍 1 次
                tolerance_count = max(1, int(self._current * self.error_tolerance_ratio))
                if self._consecutive_errors >= tolerance_count:
                    self._current = max(self.min_limit, self._current - 1)
                    # 惩罚过后稍微留一点余地，不直接清零，以便连续出错时继续递减
                    self._consecutive_errors = max(0, tolerance_count - 1)
        return kind
