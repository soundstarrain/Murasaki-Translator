"""Pipeline V2 runner."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple
import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

from murasaki_translator.documents.factory import DocumentFactory
from murasaki_translator.documents.txt import TxtDocument
from murasaki_translator.documents.srt import SrtDocument
from murasaki_translator.documents.ass import AssDocument
from murasaki_translator.core.cache import TranslationCache
from murasaki_translator.core.chunker import TextBlock

from murasaki_flow_v2.registry.profile_store import ProfileStore
from murasaki_flow_v2.providers.registry import ProviderRegistry
from murasaki_flow_v2.parsers.registry import ParserRegistry
from murasaki_flow_v2.prompts.registry import PromptRegistry
from murasaki_flow_v2.prompts.builder import build_messages
from murasaki_flow_v2.policies.registry import PolicyRegistry
from murasaki_flow_v2.policies.chunk_registry import ChunkPolicyRegistry
from murasaki_flow_v2.policies.chunk_policy import LineChunkPolicy
from murasaki_flow_v2.policies.line_policy import LinePolicyError
from murasaki_flow_v2.parsers.base import ParserError
from murasaki_flow_v2.providers.base import ProviderError
from murasaki_flow_v2.utils.adaptive_concurrency import AdaptiveConcurrency
from murasaki_flow_v2.utils.line_format import extract_line_for_policy, parse_jsonl_entries
from murasaki_flow_v2.utils import processing as v2_processing
from murasaki_flow_v2.utils.log_protocol import (
    ProgressTracker, emit_output_path, emit_cache_path, emit_retry, emit_error, emit_warning,
)

MAX_CONCURRENCY = 256


class PipelineRunner:
    def __init__(self, store: ProfileStore, pipeline_profile: Dict[str, Any]):
        self.store = store
        self.pipeline = pipeline_profile
        self.providers = ProviderRegistry(store)
        self.parsers = ParserRegistry(store)
        self.prompts = PromptRegistry(store)
        self.line_policies = PolicyRegistry(store)
        self.chunk_policies = ChunkPolicyRegistry(store)

    def _format_glossary_text(self, data: Any) -> str:
        if isinstance(data, dict):
            return "\n".join([f"{k}: {v}" for k, v in data.items()])
        if isinstance(data, list):
            lines = []
            for item in data:
                if isinstance(item, dict):
                    src = item.get("src") or item.get("source") or ""
                    dst = item.get("dst") or item.get("target") or ""
                    if src or dst:
                        lines.append(f"{src}: {dst}")
                else:
                    lines.append(str(item))
            return "\n".join(lines)
        return str(data).strip()

    def _load_glossary(self, glossary_spec: Any) -> str:
        if glossary_spec is None:
            return ""
        if isinstance(glossary_spec, (dict, list)):
            return self._format_glossary_text(glossary_spec)
        if isinstance(glossary_spec, str):
            raw = glossary_spec.strip()
            if not raw:
                return ""
            if os.path.exists(raw):
                try:
                    with open(raw, "r", encoding="utf-8") as f:
                        content = f.read()
                    try:
                        data = json.loads(content)
                        return self._format_glossary_text(data)
                    except json.JSONDecodeError:
                        return content.strip()
                except Exception:
                    return ""
            try:
                data = json.loads(raw)
                return self._format_glossary_text(data)
            except json.JSONDecodeError:
                return raw
        return ""

    def _extract_source_lines(self, items: List[Dict[str, Any]]) -> List[str]:
        lines: List[str] = []
        for item in items:
            text = str(item.get("text") or "")
            lines.append(text.rstrip("\n"))
        return lines

    @staticmethod
    def _block_line_range(block: TextBlock) -> Tuple[int, int]:
        """Return (first_line_index, last_line_index+1) covered by *block*."""
        indices = [
            m for m in (block.metadata or []) if isinstance(m, int)
        ]
        if not indices:
            return (0, 0)
        return (min(indices), max(indices) + 1)

    @staticmethod
    def _filter_target_line_ids(
        metadata: List[Any], start: int, end: int
    ) -> List[int]:
        ids: List[int] = []
        seen: set[int] = set()
        for item in metadata:
            if not isinstance(item, int):
                continue
            if item < start or item >= end:
                continue
            if item in seen:
                continue
            seen.add(item)
            ids.append(item)
        return ids

    @staticmethod
    def _normalize_txt_blocks(blocks: List[TextBlock]) -> None:
        for block in blocks:
            text = block.prompt_text
            if text.endswith("\n"):
                block.prompt_text = text[:-1]

    @staticmethod
    def _ensure_line_chunk_keeps_empty(doc: object, chunk_policy: Any) -> None:
        if not isinstance(chunk_policy, LineChunkPolicy):
            return
        if not isinstance(doc, (SrtDocument, AssDocument)):
            return
        options = (
            chunk_policy.profile.get("options")
            if isinstance(chunk_policy.profile.get("options"), dict)
            else {}
        )
        if "keep_empty" not in options:
            options["keep_empty"] = True
            chunk_policy.profile["options"] = options

    @staticmethod
    def _load_resume_file(
        path: str,
        expected: Optional[Dict[str, Any]] = None,
    ) -> Tuple[Dict[int, Dict[str, str]], bool]:
        entries: Dict[int, Dict[str, str]] = {}
        if not os.path.exists(path):
            return entries, False
        matched = False
        try:
            with open(path, "r", encoding="utf-8") as f:
                lines = [line.strip() for line in f.readlines() if line.strip()]
        except Exception:
            return entries, False

        start_idx = 0
        if lines:
            try:
                header = json.loads(lines[0])
            except Exception:
                header = None
            if isinstance(header, dict) and header.get("type") == "fingerprint":
                start_idx = 1
                matched = True
                if expected:
                    for key, value in expected.items():
                        if value is None or value == "":
                            continue
                        if header.get(key) != value:
                            return {}, False

        for raw in lines[start_idx:]:
            try:
                data = json.loads(raw)
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            idx = data.get("index")
            if idx is None:
                idx = data.get("block_idx") or data.get("block")
            if idx is None:
                continue
            try:
                idx = int(idx)
            except (TypeError, ValueError):
                continue
            dst = (
                data.get("dst")
                if data.get("dst") is not None
                else data.get("output")
                if data.get("output") is not None
                else data.get("preview_text")
                if data.get("preview_text") is not None
                else data.get("out_text")
            )
            if dst is None:
                continue
            src = data.get("src") if data.get("src") is not None else data.get("src_text")
            entries[idx] = {"src": str(src or ""), "dst": str(dst or "")}

        if entries and start_idx == 0:
            matched = True
        return entries, matched

    @staticmethod
    def _load_resume_cache(
        output_path: str,
        cache_dir: Optional[str] = None,
    ) -> Dict[int, Dict[str, str]]:
        resolved_cache_dir = cache_dir if cache_dir and os.path.isdir(cache_dir) else None
        cache = TranslationCache(output_path, custom_cache_dir=resolved_cache_dir, source_path="")
        if not cache.load():
            return {}
        entries: Dict[int, Dict[str, str]] = {}
        for block in cache.blocks:
            entries[block.index] = {"src": block.src, "dst": block.dst}
        return entries

    @staticmethod
    def _should_apply_line_policy(
        pipeline: Dict[str, Any],
        line_policy: Optional[Any],
        chunk_type: str,
    ) -> bool:
        if not line_policy or chunk_type != "line":
            return False
        apply_flag = pipeline.get("apply_line_policy")
        if apply_flag is False:
            return False
        return True

    @staticmethod
    def _apply_protection_to_lines(
        lines: List[str],
        start: int,
        end: int,
        protector: Optional[Any],
    ) -> Tuple[List[str], Optional[Any]]:
        if not protector or start >= end:
            return lines, protector
        segment = "\n".join(lines[start:end])
        if segment:
            protected_segment = protector.protect(segment)
            protected_lines = protected_segment.split("\n")
        else:
            protected_lines = []
        if len(protected_lines) != (end - start):
            return lines, None
        merged = list(lines)
        merged[start:end] = protected_lines
        return merged, protector

    def _build_context(
        self,
        source_lines: List[str],
        line_index: int,
        context_cfg: Dict[str, Any],
        *,
        block_end: Optional[int] = None,
    ) -> Dict[str, str]:
        before = int(context_cfg.get("before_lines") or 0)
        after = int(context_cfg.get("after_lines") or 0)
        joiner = str(context_cfg.get("joiner") or "\n")
        if before <= 0 and after <= 0:
            return {"before": "", "after": ""}
        # block_end 标识块的结束行（不含），用于分块模式 context
        content_end = block_end if block_end is not None else line_index + 1
        start = max(0, line_index - before)
        end = min(len(source_lines), content_end + after)
        before_lines = source_lines[start:line_index]
        after_lines = source_lines[content_end:end]
        return {
            "before": joiner.join(before_lines).strip(),
            "after": joiner.join(after_lines).strip(),
        }

    def _resolve_source_window(
        self,
        source_lines: List[str],
        line_index: int,
        context_cfg: Dict[str, Any],
    ) -> Tuple[int, int]:
        total = int(context_cfg.get("source_lines") or 0)
        if total <= 0:
            total = 1
        start = max(0, line_index)
        end = min(len(source_lines), start + total)
        return start, end

    def _build_jsonl_source(
        self,
        source_lines: List[str],
        line_index: int,
        context_cfg: Dict[str, Any],
    ) -> str:
        start, end = self._resolve_source_window(source_lines, line_index, context_cfg)
        rows: List[str] = []
        for idx in range(start, end):
            payload = {str(idx + 1): source_lines[idx]}
            rows.append(f"jsonline{json.dumps(payload, ensure_ascii=False)}")
        return "\n".join(rows).strip()

    def _build_jsonl_range(
        self,
        source_lines: List[str],
        start: int,
        end: int,
    ) -> str:
        if start >= end:
            return ""
        rows: List[str] = []
        for idx in range(start, end):
            payload = {str(idx + 1): source_lines[idx]}
            rows.append(f"jsonline{json.dumps(payload, ensure_ascii=False)}")
        return "\n".join(rows).strip()

    def _parse_jsonl_response(
        self,
        text: str,
        expected_line_ids: List[int],
    ) -> str:
        entries, ordered = parse_jsonl_entries(text)
        if not entries and not ordered:
            raise ParserError("JsonlParser: empty output")
        if expected_line_ids:
            missing: List[str] = []
            lines: List[str] = []
            for i, line_id in enumerate(expected_line_ids):
                key = str(line_id + 1)
                if key in entries:
                    lines.append(entries[key])
                    continue
                if i < len(ordered):
                    lines.append(ordered[i])
                    continue
                missing.append(key)
            if missing:
                raise ParserError(
                    f"JsonlParser: missing lines {','.join(missing)}"
                )
            return "\n".join(lines).strip("\n")
        if entries:
            try:
                ordered_entries = sorted(entries.items(), key=lambda item: int(item[0]))
                return "\n".join([value for _, value in ordered_entries]).strip("\n")
            except (TypeError, ValueError):
                return "\n".join(entries.values()).strip("\n")
        return "\n".join(ordered).strip("\n")

    def run(
        self,
        input_path: str,
        output_path: Optional[str] = None,
        *,
        resume: bool = False,
        save_cache: bool = True,
        cache_dir: Optional[str] = None,
    ) -> str:
        pipeline = self.pipeline
        provider_ref = str(pipeline.get("provider") or "")
        prompt_ref = str(pipeline.get("prompt") or "")
        parser_ref = str(pipeline.get("parser") or "")
        line_policy_ref = str(pipeline.get("line_policy") or "")
        chunk_policy_ref = str(pipeline.get("chunk_policy") or "")

        provider = self.providers.get_provider(provider_ref)
        prompt_profile = self.prompts.get_prompt(prompt_ref)
        parser = self.parsers.get_parser(parser_ref)
        line_policy = (
            self.line_policies.get_line_policy(line_policy_ref)
            if line_policy_ref
            else None
        )
        chunk_policy = self.chunk_policies.get_chunk_policy(chunk_policy_ref)
        chunk_type = str(
            chunk_policy.profile.get("chunk_type")
            or chunk_policy.profile.get("type")
            or ""
        )
        context_cfg = prompt_profile.get("context") or {}
        source_format = str(context_cfg.get("source_format") or "").strip().lower()
        parser_type = ""
        if parser is not None:
            parser_type = str(parser.profile.get("type") or "").strip().lower()
        if source_format == "jsonl" and chunk_type == "line":
            if parser_type and parser_type != "jsonl":
                emit_warning(
                    0,
                    "source_format=jsonl forces JSONL parsing; selected parser will be ignored.",
                    "quality",
                )
        apply_line_policy = self._should_apply_line_policy(
            pipeline, line_policy, chunk_type
        )
        line_policy_errors: List[Dict[str, Any]] = []
        _lpe_lock = threading.Lock()

        doc = DocumentFactory.get_document(input_path)
        self._ensure_line_chunk_keeps_empty(doc, chunk_policy)
        items = doc.load()
        source_lines = self._extract_source_lines(items)
        blocks = chunk_policy.chunk(items)

        temp_progress_path = f"{output_path}.temp.jsonl" if output_path else f"{input_path}.temp.jsonl"
        pipeline_id = str(pipeline.get("id") or "")
        fingerprint = {
            "type": "fingerprint",
            "version": 1,
            "input": input_path,
            "pipeline": pipeline_id,
            "chunk_type": chunk_type,
        }
        expected_fingerprint = {
            "input": input_path,
            "pipeline": pipeline_id,
            "chunk_type": chunk_type,
        }
        resume_entries: Dict[int, Dict[str, str]] = {}
        resume_matched = False
        if resume:
            resume_entries, resume_matched = self._load_resume_file(
                temp_progress_path, expected=expected_fingerprint
            )
            if not resume_entries:
                resume_entries = self._load_resume_cache(output_path, cache_dir)
                resume_matched = False

        processing_cfg = pipeline.get("processing") or {}
        if not isinstance(processing_cfg, dict):
            processing_cfg = {}
        processing_enabled = bool(processing_cfg)
        glossary_spec = processing_cfg.get("glossary")
        if glossary_spec is None:
            glossary_spec = pipeline.get("glossary")
        glossary_text = self._load_glossary(glossary_spec)

        settings = pipeline.get("settings") or {}
        try:
            raw_max_retries = settings.get("max_retries")
            if raw_max_retries is None or raw_max_retries == "":
                raw_max_retries = provider.profile.get("max_retries")
            if raw_max_retries is None or str(raw_max_retries).strip() == "":
                max_retries = 3
            else:
                max_retries = int(raw_max_retries)
        except (ValueError, TypeError):
            max_retries = 3
        adaptive: Optional[AdaptiveConcurrency] = None

        processing_processor = None
        rules_pre_spec = processing_cfg.get("rules_pre")
        rules_post_spec = processing_cfg.get("rules_post")
        if rules_pre_spec is None:
            rules_pre_spec = pipeline.get("rules_pre")
        if rules_post_spec is None:
            rules_post_spec = pipeline.get("rules_post")
        if rules_pre_spec or rules_post_spec:
            processing_enabled = True
        source_lang = (
            str(processing_cfg.get("source_lang") or "ja").strip() or "ja"
        )
        # 默认禁用质量检查 — 用户需在 Pipeline YAML processing.enable_quality
        # 或 CLI --enable-quality 中显式启用
        enable_quality = processing_cfg.get("enable_quality")
        if enable_quality is None:
            enable_quality = False
        # 默认禁用文本保护 — 用户需在 Pipeline YAML processing.text_protect
        # 或 CLI --text-protect 中显式启用
        enable_text_protect = processing_cfg.get("text_protect")
        if enable_text_protect is None:
            enable_text_protect = False
        strict_line_count = bool(processing_cfg.get("strict_line_count"))

        if processing_enabled:
            pre_rules = v2_processing.load_rules(rules_pre_spec)
            post_rules = v2_processing.load_rules(rules_post_spec)
            glossary_dict = v2_processing.load_glossary(glossary_spec)
            if (
                pre_rules
                or post_rules
                or glossary_dict
                or enable_text_protect
                or enable_quality
            ):
                processing_processor = v2_processing.ProcessingProcessor(
                    v2_processing.ProcessingOptions(
                        rules_pre=pre_rules,
                        rules_post=post_rules,
                        glossary=glossary_dict,
                        source_lang=source_lang,
                        strict_line_count=strict_line_count,
                        enable_quality=bool(enable_quality),
                        enable_text_protect=bool(enable_text_protect),
                    )
                )

        prompt_source_lines = source_lines
        if (
            processing_processor
            and processing_processor.has_pre_rules
            and source_lines
        ):
            prompt_source_lines = [
                processing_processor.apply_pre(line) for line in source_lines
            ]

        # --- Dashboard 日志协议 ---
        temp_progress_file = None
        temp_lock = threading.Lock()
        try:
            temp_mode = "a" if resume and resume_entries and resume_matched else "w"
            temp_progress_file = open(
                temp_progress_path, temp_mode, encoding="utf-8", buffering=1
            )
            if temp_mode == "w":
                temp_progress_file.write(
                    json.dumps(fingerprint, ensure_ascii=False) + "\n"
                )
                temp_progress_file.flush()
        except Exception:
            temp_progress_file = None

        def write_temp_entry(idx: int, src_text: str, dst_text: str) -> None:
            if not temp_progress_file:
                return
            payload = {
                "type": "block",
                "index": idx,
                "src": src_text,
                "dst": dst_text,
            }
            with temp_lock:
                temp_progress_file.write(
                    json.dumps(payload, ensure_ascii=False) + "\n"
                )
                temp_progress_file.flush()

        tracker = ProgressTracker(
            total_blocks=len(blocks),
            total_source_lines=len(source_lines),
            total_source_chars=sum(len(l) for l in source_lines),
        )

        translated_blocks: List[Optional[TextBlock]] = [None] * len(blocks)
        resume_completed = 0
        resume_output_lines = 0
        resume_output_chars = 0
        if resume_entries:
            for idx, block in enumerate(blocks):
                entry = resume_entries.get(idx)
                if not entry:
                    continue
                dst_text = str(entry.get("dst") or "")
                translated_blocks[idx] = TextBlock(
                    id=idx + 1,
                    prompt_text=dst_text,
                    metadata=block.metadata,
                )
                resume_completed += 1
                if dst_text:
                    resume_output_lines += dst_text.count("\n") + 1
                    resume_output_chars += len(dst_text)
            if resume_completed > 0:
                tracker.seed_progress(
                    completed_blocks=resume_completed,
                    output_lines=resume_output_lines,
                    output_chars=resume_output_chars,
                )

        def translate_block(idx: int, block: TextBlock) -> Tuple[int, TextBlock]:
            context_cfg = prompt_profile.get("context") or {}
            line_index = None
            if block.metadata:
                meta = block.metadata[0]
                if isinstance(meta, int):
                    line_index = meta
            # 分块模式 context：基于块的完整行范围，而非仅首行
            blk_start, blk_end = self._block_line_range(block)
            context_before = ""
            context_after = ""
            target_line_ids: List[int] = []
            active_source_lines = prompt_source_lines if prompt_source_lines else source_lines
            if line_index is not None and active_source_lines:
                context = self._build_context(
                    active_source_lines, line_index, context_cfg,
                    block_end=blk_end if blk_end > blk_start else None,
                )
                context_before = context["before"]
                context_after = context["after"]

            source_text = block.prompt_text
            source_format = str(context_cfg.get("source_format") or "").strip().lower()
            use_jsonl = source_format == "jsonl" and chunk_type == "line"
            if not use_jsonl and processing_processor:
                source_text = processing_processor.apply_pre(source_text)

            protector = (
                processing_processor.create_protector()
                if processing_processor
                else None
            )
            if protector and not use_jsonl:
                source_text = protector.protect(source_text)

            if use_jsonl and line_index is not None and active_source_lines:
                start, end = self._resolve_source_window(
                    active_source_lines, line_index, context_cfg
                )
                before_count = max(0, int(context_cfg.get("before_lines") or 0))
                after_count = max(0, int(context_cfg.get("after_lines") or 0))
                before_start = max(0, start - before_count)
                after_end = min(len(active_source_lines), end + after_count)
                context_before = self._build_jsonl_range(
                    active_source_lines, before_start, start
                )
                context_after = self._build_jsonl_range(
                    active_source_lines, end, after_end
                )
                protected_lines, protector = self._apply_protection_to_lines(
                    active_source_lines, start, end, protector
                )
                source_text = self._build_jsonl_range(protected_lines, start, end)
                if block.metadata:
                    target_line_ids = self._filter_target_line_ids(
                        block.metadata, start, end
                    )
                if not target_line_ids:
                    target_line_ids = [line_index]

            messages = build_messages(
                prompt_profile,
                source_text=source_text,
                context_before=context_before,
                context_after=context_after,
                glossary_text=glossary_text,
                line_index=line_index,
            )

            attempt = 0
            last_error: Optional[str] = None
            last_translation: Optional[str] = None
            while attempt <= max_retries:
                try:
                    request = provider.build_request(messages, settings)
                    response = provider.send(request)
                    # 记录 API 请求统计（token usage）
                    _usage = (response.raw or {}).get("usage", {})
                    tracker.note_request(
                        input_tokens=_usage.get("prompt_tokens", 0) or 0,
                        output_tokens=_usage.get("completion_tokens", 0) or 0,
                    )
                    if use_jsonl and target_line_ids:
                        translated = self._parse_jsonl_response(
                            response.text, target_line_ids
                        )
                    else:
                        parsed = parser.parse(response.text)
                        translated = parsed.text.strip("\n")
                    if processing_processor:
                        translated = processing_processor.apply_post(
                            translated,
                            src_text=block.prompt_text,
                            protector=protector,
                        )
                    last_translation = translated
                    if (
                        apply_line_policy
                        and line_policy
                        and line_index is not None
                        and line_index < len(source_lines)
                    ):
                        compat_line = extract_line_for_policy(translated, line_index)
                        if compat_line is not None:
                            translated = compat_line
                        if "\n" in translated:
                            raise LinePolicyError("LinePolicy: line count mismatch")
                        checked = line_policy.apply(
                            [source_lines[line_index]],
                            [translated],
                        )
                        if not checked:
                            raise LinePolicyError("LinePolicy: empty output")
                        if len(checked) != 1:
                            raise LinePolicyError(
                                "LinePolicy: unexpected line count"
                            )
                        translated = checked[0]
                        last_translation = translated
                    write_temp_entry(idx, block.prompt_text, translated)
                    return idx, TextBlock(
                        id=idx + 1,
                        prompt_text=translated,
                        metadata=block.metadata,
                    )
                except (ProviderError, ParserError, LinePolicyError) as exc:
                    last_error = str(exc)
                    if adaptive is not None and isinstance(exc, ProviderError):
                        adaptive.note_error(last_error)
                    attempt += 1
                    error_type = (
                        "line_mismatch" if isinstance(exc, LinePolicyError)
                        else "empty" if isinstance(exc, ParserError)
                        else "provider_error"
                    )
                    # 提取 HTTP 状态码（如果是 ProviderError）
                    _status_code = None
                    if isinstance(exc, ProviderError):
                        import re as _re
                        _m = _re.search(r"HTTP (\d{3})", str(exc))
                        if _m:
                            _status_code = int(_m.group(1))
                    tracker.note_retry(_status_code)
                    emit_retry(idx + 1, attempt, error_type)
                    if attempt > max_retries:
                        if (
                            isinstance(exc, LinePolicyError)
                            and apply_line_policy
                            and line_index is not None
                            and line_index < len(source_lines)
                        ):
                            with _lpe_lock:
                                line_policy_errors.append(
                                    {"line": line_index + 1, "error": last_error}
                                )
                            fallback_text = (
                                last_translation
                                if last_translation is not None
                                else source_lines[line_index]
                            )
                            write_temp_entry(idx, block.prompt_text, fallback_text)
                            return idx, TextBlock(
                                id=idx + 1,
                                prompt_text=fallback_text,
                                metadata=block.metadata,
                            )
                        tracker.note_error(_status_code)
                        raise
            if last_error:
                raise RuntimeError(last_error)
            raise RuntimeError("unknown_error")

        try:
            raw_concurrency = settings.get("concurrency")
            if raw_concurrency is None or raw_concurrency == "":
                raw_concurrency = provider.profile.get("concurrency")
            if raw_concurrency is None or raw_concurrency == "":
                concurrency = 1
            else:
                concurrency = int(raw_concurrency)
        except (TypeError, ValueError):
            concurrency = 1

        if concurrency == 0:
            adaptive = AdaptiveConcurrency(max_limit=max(1, min(len(blocks), 128)))
        else:
            concurrency = max(1, min(concurrency, MAX_CONCURRENCY))

        pending_indices = [
            idx for idx, block in enumerate(blocks) if translated_blocks[idx] is None
        ]

        try:
            if adaptive is not None and len(pending_indices) > 1:
                with ThreadPoolExecutor(max_workers=adaptive.max_limit) as executor:
                    next_pos = 0
                    futures: Dict[Any, int] = {}
                    while next_pos < len(pending_indices) or futures:
                        limit = adaptive.get_limit()
                        while next_pos < len(pending_indices) and len(futures) < limit:
                            idx = pending_indices[next_pos]
                            futures[executor.submit(translate_block, idx, blocks[idx])] = idx
                            next_pos += 1
                        if not futures:
                            continue
                        for future in as_completed(futures):
                            idx = futures.pop(future)
                            try:
                                _, translated_block = future.result()
                                translated_blocks[idx] = translated_block
                                adaptive.note_success()
                                tracker.block_done(
                                    idx, blocks[idx].prompt_text, translated_block.prompt_text
                                )
                            except Exception:
                                for pending in futures:
                                    pending.cancel()
                                raise
                            break
            elif pending_indices:
                if concurrency <= 1 or len(pending_indices) <= 1:
                    for idx in pending_indices:
                        _, translated_block = translate_block(idx, blocks[idx])
                        translated_blocks[idx] = translated_block
                        tracker.block_done(
                            idx, blocks[idx].prompt_text, translated_block.prompt_text
                        )
                else:
                    with ThreadPoolExecutor(max_workers=concurrency) as executor:
                        futures = {
                            executor.submit(translate_block, idx, blocks[idx]): idx
                            for idx in pending_indices
                        }
                        for future in as_completed(futures):
                            idx = futures[future]
                            try:
                                _, translated_block = future.result()
                                translated_blocks[idx] = translated_block
                                tracker.block_done(
                                    idx, blocks[idx].prompt_text, translated_block.prompt_text
                                )
                            except Exception:
                                for pending in futures:
                                    pending.cancel()
                                raise
        finally:
            if temp_progress_file:
                try:
                    temp_progress_file.close()
                except Exception:
                    pass

        if any(block is None for block in translated_blocks):
            raise RuntimeError("translation_incomplete")

        translated_blocks = [block for block in translated_blocks if block is not None]

        if not output_path:
            base, ext = os.path.splitext(input_path)
            output_path = f"{base}_translated{ext}"

        emit_output_path(output_path)

        if processing_processor and processing_processor.options.enable_quality:
            output_lines = [b.prompt_text for b in translated_blocks]
            if source_lines and len(output_lines) == len(source_lines):
                warnings = processing_processor.check_quality(
                    source_lines, output_lines
                )
                if warnings:
                    warn_path = f"{output_path}.quality_warnings.jsonl"
                    try:
                        with open(warn_path, "w", encoding="utf-8") as f:
                            for entry in warnings:
                                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
                        print(
                            f"[QualityCheck] {len(warnings)} warnings. Saved to {warn_path}"
                        )
                    except Exception:
                        pass
                    for entry in warnings:
                        try:
                            emit_warning(
                                int(entry.get("line", 0) or 0),
                                str(entry.get("message", "")),
                                str(entry.get("type", "quality") or "quality"),
                            )
                        except Exception:
                            continue

        if line_policy_errors:
            error_path = f"{output_path}.line_errors.jsonl"
            try:
                with open(error_path, "w", encoding="utf-8") as f:
                    for entry in line_policy_errors:
                        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
                print(
                    f"[LinePolicy] {len(line_policy_errors)} lines failed checks. Saved to {error_path}"
                )
            except Exception:
                pass

        if isinstance(doc, TxtDocument):
            self._normalize_txt_blocks(translated_blocks)

        doc.save(output_path, translated_blocks)

        if save_cache:
            resolved_cache_dir = (
                cache_dir if cache_dir and os.path.isdir(cache_dir) else None
            )
            translation_cache = TranslationCache(
                output_path,
                custom_cache_dir=resolved_cache_dir,
                source_path=input_path,
            )
            for idx, block in enumerate(blocks):
                translated_block = translated_blocks[idx]
                if translated_block is None:
                    continue
                translation_cache.add_block(
                    idx,
                    block.prompt_text,
                    translated_block.prompt_text,
                )
            provider_model = str(provider.profile.get("model") or "").strip()
            model_name = (
                provider_model or provider_ref or pipeline_id or "unknown"
            )
            glossary_path = (
                glossary_spec if isinstance(glossary_spec, str) else ""
            )
            translation_cache.save(
                model_name=model_name,
                glossary_path=glossary_path,
                concurrency=concurrency,
            )
            if hasattr(translation_cache, 'cache_path') and translation_cache.cache_path:
                emit_cache_path(translation_cache.cache_path)

        tracker.emit_final_stats()
        try:
            if os.path.exists(temp_progress_path):
                os.remove(temp_progress_path)
        except Exception:
            pass
        return output_path
