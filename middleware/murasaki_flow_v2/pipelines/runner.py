"""Pipeline V2 runner."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple
import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

from murasaki_translator.documents.factory import DocumentFactory
from murasaki_translator.documents.txt import TxtDocument
from murasaki_translator.core.chunker import TextBlock

from murasaki_flow_v2.registry.profile_store import ProfileStore
from murasaki_flow_v2.providers.registry import ProviderRegistry
from murasaki_flow_v2.parsers.registry import ParserRegistry
from murasaki_flow_v2.prompts.registry import PromptRegistry
from murasaki_flow_v2.prompts.builder import build_messages
from murasaki_flow_v2.policies.registry import PolicyRegistry
from murasaki_flow_v2.policies.chunk_registry import ChunkPolicyRegistry
from murasaki_flow_v2.policies.line_policy import LinePolicyError
from murasaki_flow_v2.parsers.base import ParserError
from murasaki_flow_v2.providers.base import ProviderError
from murasaki_flow_v2.utils.adaptive_concurrency import AdaptiveConcurrency
from murasaki_flow_v2.utils.line_format import extract_line_for_policy, parse_jsonl_entries


class PipelineRunner:
    def __init__(self, store: ProfileStore, pipeline_profile: Dict[str, Any]):
        self.store = store
        self.pipeline = pipeline_profile
        self.providers = ProviderRegistry(store)
        self.parsers = ParserRegistry(store)
        self.prompts = PromptRegistry(store)
        self.line_policies = PolicyRegistry(store)
        self.chunk_policies = ChunkPolicyRegistry(store)

    def _load_glossary(self, glossary_path: Optional[str]) -> str:
        if not glossary_path:
            return ""
        if not os.path.exists(glossary_path):
            return ""
        try:
            with open(glossary_path, "r", encoding="utf-8") as f:
                raw = f.read()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                return raw.strip()
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
            return raw.strip()
        except Exception:
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
        # block_end 标识块的结束行（不含），用于块模式 context
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
            for line_id in expected_line_ids:
                key = str(line_id + 1)
                if key in entries:
                    lines.append(entries[key])
                    continue
                if line_id < len(ordered):
                    lines.append(ordered[line_id])
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

    def run(self, input_path: str, output_path: Optional[str] = None) -> str:
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
        apply_line_policy = bool(
            pipeline.get("apply_line_policy") or chunk_type == "line"
        )
        line_policy_per_line = bool(
            line_policy and apply_line_policy and chunk_type == "line"
        )
        line_policy_errors: List[Dict[str, Any]] = []
        _lpe_lock = threading.Lock()

        doc = DocumentFactory.get_document(input_path)
        items = doc.load()
        source_lines = self._extract_source_lines(items)
        blocks = chunk_policy.chunk(items)

        glossary_text = self._load_glossary(pipeline.get("glossary"))

        settings = pipeline.get("settings") or {}
        max_retries = int(settings.get("max_retries") or 0)
        adaptive: Optional[AdaptiveConcurrency] = None

        compat_cfg = pipeline.get("v1_compat") or {}
        compat_processor = None
        if compat_cfg:
            try:
                from murasaki_flow_v2.utils import v1_compat as v1_compat
            except Exception as exc:
                raise RuntimeError("v1_compat_unavailable") from exc

            rules_pre_path = str(compat_cfg.get("rules_pre") or "").strip()
            rules_post_path = str(compat_cfg.get("rules_post") or "").strip()
            glossary_path = str(
                compat_cfg.get("glossary") or pipeline.get("glossary") or ""
            ).strip()
            source_lang = str(compat_cfg.get("source_lang") or "ja").strip() or "ja"
            enable_quality = compat_cfg.get("enable_quality")
            if enable_quality is None:
                enable_quality = bool(compat_cfg)
            enable_text_protect = compat_cfg.get("text_protect")
            if enable_text_protect is None:
                enable_text_protect = bool(compat_cfg)
            strict_line_count = bool(compat_cfg.get("strict_line_count"))

            pre_rules = (
                v1_compat.load_rules(rules_pre_path) if rules_pre_path else []
            )
            post_rules = (
                v1_compat.load_rules(rules_post_path) if rules_post_path else []
            )
            glossary_dict = (
                v1_compat.load_glossary(glossary_path) if glossary_path else {}
            )
            if (
                pre_rules
                or post_rules
                or glossary_dict
                or enable_text_protect
                or enable_quality
            ):
                compat_processor = v1_compat.V1CompatProcessor(
                    v1_compat.V1CompatOptions(
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
        if compat_processor and compat_processor.has_pre_rules and source_lines:
            prompt_source_lines = [
                compat_processor.apply_pre(line) for line in source_lines
            ]

        translated_blocks: List[Optional[TextBlock]] = [None] * len(blocks)

        def translate_block(idx: int, block: TextBlock) -> Tuple[int, TextBlock]:
            context_cfg = prompt_profile.get("context") or {}
            line_index = None
            if block.metadata:
                meta = block.metadata[0]
                if isinstance(meta, int):
                    line_index = meta
            # 块模式 context：基于块的完整行范围，而非仅首行
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
            if not use_jsonl and compat_processor:
                source_text = compat_processor.apply_pre(source_text)

            protector = compat_processor.create_protector() if compat_processor else None
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
                source_text = self._build_jsonl_range(active_source_lines, start, end)
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
                    if use_jsonl and target_line_ids:
                        translated = self._parse_jsonl_response(
                            response.text, target_line_ids
                        )
                    else:
                        parsed = parser.parse(response.text)
                        translated = parsed.text.strip("\n")
                    if compat_processor:
                        # BUG-5: jsonl 模式下不传入 protector，保持 protect/restore 对称
                        effective_protector = protector if not use_jsonl else None
                        translated = compat_processor.apply_post(
                            translated, src_text=block.prompt_text, protector=effective_protector
                        )
                    last_translation = translated
                    if (
                        line_policy_per_line
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
                    if attempt > max_retries:
                        if (
                            isinstance(exc, LinePolicyError)
                            and line_policy_per_line
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
                            return idx, TextBlock(
                                id=idx + 1,
                                prompt_text=fallback_text,
                                metadata=block.metadata,
                            )
                        raise
            if last_error:
                raise RuntimeError(last_error)
            raise RuntimeError("unknown_error")

        try:
            raw_concurrency = settings.get("concurrency")
            if raw_concurrency is None or raw_concurrency == "":
                concurrency = 1
            else:
                concurrency = int(raw_concurrency)
        except (TypeError, ValueError):
            concurrency = 1

        if concurrency == 0:
            adaptive = AdaptiveConcurrency(max_limit=max(1, min(len(blocks), 16)))
        else:
            concurrency = max(1, concurrency)

        if adaptive is not None and len(blocks) > 1:
            with ThreadPoolExecutor(max_workers=adaptive.max_limit) as executor:
                next_idx = 0
                futures: Dict[Any, int] = {}
                while next_idx < len(blocks) or futures:
                    limit = adaptive.get_limit()
                    while next_idx < len(blocks) and len(futures) < limit:
                        futures[executor.submit(translate_block, next_idx, blocks[next_idx])] = next_idx
                        next_idx += 1
                    if not futures:
                        continue
                    for future in as_completed(futures):
                        idx = futures.pop(future)
                        try:
                            _, translated_block = future.result()
                            translated_blocks[idx] = translated_block
                            adaptive.note_success()
                        except Exception:
                            for pending in futures:
                                pending.cancel()
                            raise
                        break
        elif concurrency <= 1 or len(blocks) <= 1:
            for idx, block in enumerate(blocks):
                _, translated_block = translate_block(idx, block)
                translated_blocks[idx] = translated_block
        else:
            with ThreadPoolExecutor(max_workers=concurrency) as executor:
                futures = {
                    executor.submit(translate_block, idx, block): idx
                    for idx, block in enumerate(blocks)
                }
                for future in as_completed(futures):
                    idx = futures[future]
                    try:
                        _, translated_block = future.result()
                        translated_blocks[idx] = translated_block
                    except Exception:
                        for pending in futures:
                            pending.cancel()
                        raise

        if any(block is None for block in translated_blocks):
            raise RuntimeError("translation_incomplete")

        translated_blocks = [block for block in translated_blocks if block is not None]

        if line_policy and apply_line_policy and not line_policy_per_line:
            output_lines: List[str] = []
            for block in translated_blocks:
                line_text = block.prompt_text
                if block.metadata:
                    meta = block.metadata[0]
                    if isinstance(meta, int):
                        compat_line = extract_line_for_policy(line_text, meta)
                        if compat_line is not None:
                            line_text = compat_line
                output_lines.append(line_text)
            # BUG-P4: 长度不匹配时跳过全局 line_policy 对齐
            if len(output_lines) != len(source_lines):
                print(
                    f"[LinePolicy] Skipping global alignment: "
                    f"source={len(source_lines)} output={len(output_lines)}"
                )
            else:
                aligned_lines = line_policy.apply(source_lines, output_lines)
                rebuilt_blocks: List[TextBlock] = []
                for idx, line in enumerate(aligned_lines):
                    meta = items[idx].get("meta") if idx < len(items) else None
                    rebuilt_blocks.append(
                        TextBlock(
                            id=len(rebuilt_blocks) + 1,
                            prompt_text=line,
                            metadata=[meta] if meta is not None else [],
                        )
                    )
                translated_blocks = rebuilt_blocks

        if not output_path:
            base, ext = os.path.splitext(input_path)
            output_path = f"{base}_translated{ext}"

        if compat_processor and compat_processor.options.enable_quality:
            output_lines = [b.prompt_text for b in translated_blocks]
            if source_lines and len(output_lines) == len(source_lines):
                warnings = compat_processor.check_quality(
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
        return output_path
