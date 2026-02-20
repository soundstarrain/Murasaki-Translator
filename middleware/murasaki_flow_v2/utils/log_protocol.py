"""Dashboard-compatible JSON log protocol for Pipeline V2.

Emits structured logs to stdout that the Electron Dashboard can parse.
Protocol prefixes:
  JSON_PROGRESS:   – block progress, speed, ETA
  JSON_PREVIEW_BLOCK: – real-time source/output preview
  JSON_OUTPUT_PATH: – final output file path
  JSON_FINAL:      – summary statistics
  JSON_RETRY:      – retry event
  JSON_WARNING:    – quality warnings
  JSON_ERROR:      – critical failure
"""

from __future__ import annotations

import json
import sys
import threading
import time
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

_stdout_lock = threading.Lock()


def emit(prefix: str, data: Dict[str, Any]) -> None:
    """Thread-safe JSON log emission compatible with Dashboard's onLogUpdate."""
    with _stdout_lock:
        sys.stdout.write(f"\n{prefix}:{json.dumps(data, ensure_ascii=False)}\n")
        sys.stdout.flush()


def emit_progress(
    *,
    current: int,
    total: int,
    elapsed: float,
    speed_chars: float = 0,
    total_lines: int = 0,
    total_chars: int = 0,
    source_lines: int = 0,
    source_chars: int = 0,
) -> None:
    """Emit JSON_PROGRESS compatible with Dashboard's progress parser."""
    percent = round(current / max(total, 1) * 100, 1)
    remaining = (elapsed / max(current, 1)) * (total - current) if current > 0 else 0
    emit("JSON_PROGRESS", {
        "current": current,
        "total": total,
        "percent": percent,
        "elapsed": round(elapsed, 1),
        "remaining": round(max(0, remaining), 1),
        "speed_chars": round(speed_chars, 1),
        "total_lines": total_lines,
        "total_chars": total_chars,
        "source_lines": source_lines,
        "source_chars": source_chars,
    })


def emit_preview_block(block_idx: int, src: str, output: str) -> None:
    """Emit JSON_PREVIEW_BLOCK for real-time translation preview."""
    emit("JSON_PREVIEW_BLOCK", {
        "block": block_idx,
        "src": src,
        "output": output,
    })


def emit_output_path(path: str) -> None:
    """Emit JSON_OUTPUT_PATH when the output file path is determined."""
    emit("JSON_OUTPUT_PATH", {"path": path})


def emit_final(
    *,
    total_time: float,
    avg_speed: float,
    source_lines: int,
    source_chars: int,
    output_lines: int,
    output_chars: int,
    # V2 API 专属统计（可选，V1 不传）
    total_requests: int = 0,
    total_retries: int = 0,
    total_errors: int = 0,
    total_input_tokens: int = 0,
    total_output_tokens: int = 0,
    error_status_codes: Optional[Dict[str, int]] = None,
) -> None:
    """Emit JSON_FINAL summary statistics."""
    data: Dict[str, Any] = {
        "totalTime": round(total_time, 1),
        "avgSpeed": round(avg_speed, 1),
        "sourceLines": source_lines,
        "sourceChars": source_chars,
        "outputLines": output_lines,
        "outputChars": output_chars,
    }
    # V2 专属字段仅在有值时才输出
    if total_requests > 0:
        data["totalRequests"] = total_requests
        data["totalRetries"] = total_retries
        data["totalErrors"] = total_errors
        data["totalInputTokens"] = total_input_tokens
        data["totalOutputTokens"] = total_output_tokens
        if error_status_codes:
            data["errorStatusCodes"] = error_status_codes
    emit("JSON_FINAL", data)


def emit_retry(
    block: int,
    attempt: int,
    error_type: str,
    *,
    src_lines: int = 0,
    dst_lines: int = 0,
) -> None:
    """Emit JSON_RETRY for retry events."""
    payload: Dict[str, Any] = {
        "block": block,
        "attempt": attempt,
        "type": error_type,
    }
    if src_lines or dst_lines:
        payload["src_lines"] = src_lines
        payload["dst_lines"] = dst_lines
    emit("JSON_RETRY", payload)


def emit_warning(block: int, message: str, warn_type: str = "quality") -> None:
    """Emit JSON_WARNING for quality check warnings."""
    emit("JSON_WARNING", {
        "block": block,
        "type": warn_type,
        "message": message,
    })


def emit_error(message: str, title: str = "Pipeline V2 Error") -> None:
    """Emit JSON_ERROR for critical failures shown as alert dialog."""
    emit("JSON_ERROR", {
        "title": title,
        "message": message,
    })


@dataclass
class ProgressTracker:
    """Accumulates per-block stats and emits periodic progress updates."""

    total_blocks: int = 0
    completed_blocks: int = 0
    total_source_lines: int = 0
    total_source_chars: int = 0
    total_output_lines: int = 0
    total_output_chars: int = 0
    start_time: float = field(default_factory=time.time)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    # --- V2 API 专属统计 ---
    total_requests: int = 0
    total_retries: int = 0
    total_errors: int = 0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    error_status_codes: Counter = field(default_factory=Counter)

    def block_done(
        self,
        block_idx: int,
        src_text: str,
        output_text: str,
        *,
        emit_preview: bool = True,
    ) -> None:
        """Record a completed block and emit progress + preview."""
        src_lines = src_text.count("\n") + 1 if src_text else 0
        src_chars = len(src_text)
        out_lines = output_text.count("\n") + 1 if output_text else 0
        out_chars = len(output_text)

        with self._lock:
            self.completed_blocks += 1
            self.total_output_lines += out_lines
            self.total_output_chars += out_chars
            completed = self.completed_blocks
            elapsed = time.time() - self.start_time

        speed_chars = self.total_output_chars / max(elapsed, 0.1)

        emit_progress(
            current=completed,
            total=self.total_blocks,
            elapsed=elapsed,
            speed_chars=speed_chars,
            total_lines=self.total_output_lines,
            total_chars=self.total_output_chars,
            source_lines=self.total_source_lines,
            source_chars=self.total_source_chars,
        )

        if emit_preview:
            # Truncate very long blocks for preview
            max_preview = 2000
            preview_src = src_text[:max_preview] if len(src_text) > max_preview else src_text
            preview_out = output_text[:max_preview] if len(output_text) > max_preview else output_text
            emit_preview_block(block_idx + 1, preview_src, preview_out)

    def note_request(
        self,
        *,
        input_tokens: int = 0,
        output_tokens: int = 0,
    ) -> None:
        """Record a successful API request with token usage."""
        with self._lock:
            self.total_requests += 1
            self.total_input_tokens += input_tokens
            self.total_output_tokens += output_tokens

    def note_retry(self, status_code: Optional[int] = None) -> None:
        """Record a retry event."""
        with self._lock:
            self.total_retries += 1
            if status_code is not None:
                self.error_status_codes[status_code] += 1

    def note_error(self, status_code: Optional[int] = None) -> None:
        """Record a final error (exhausted retries)."""
        with self._lock:
            self.total_errors += 1
            if status_code is not None:
                self.error_status_codes[status_code] += 1

    def emit_final_stats(self) -> None:
        """Emit JSON_FINAL with accumulated statistics (incl. V2 API stats)."""
        elapsed = time.time() - self.start_time
        avg_speed = self.total_output_chars / max(elapsed, 0.1)
        emit_final(
            total_time=elapsed,
            avg_speed=avg_speed,
            source_lines=self.total_source_lines,
            source_chars=self.total_source_chars,
            output_lines=self.total_output_lines,
            output_chars=self.total_output_chars,
            total_requests=self.total_requests,
            total_retries=self.total_retries,
            total_errors=self.total_errors,
            total_input_tokens=self.total_input_tokens,
            total_output_tokens=self.total_output_tokens,
            error_status_codes=dict(self.error_status_codes),
        )
