import re
from typing import List, Dict, Tuple, Optional
from murasaki_translator.core.chunker import TextBlock
from murasaki_translator.core.anchor_guard import (
    normalize_anchor_stream,
    repair_and_validate_anchor_output,
)
import logging

logger = logging.getLogger("murasaki.alignment")

class AlignmentHandler:
    """
    Handles strict formatting alignment for comic translation (Alignment Mode).
    Enforces 1-to-1 strict line mapping and protects content with boundary tags.
    """
    
    TAG_MARKER_PATTERN = re.compile(r'@(?:id|end)=(\d+)@', re.IGNORECASE)
    _STRICT_PAIR_PATTERN = re.compile(
        r'@id=(?P<id>\d+)@\s*\n?(?P<content>.*?)\n?\s*@end=(?P=id)@',
        re.DOTALL | re.IGNORECASE,
    )
    _LOOSE_PAIR_PATTERN = re.compile(
        r'@id=(?P<id>\d+)@\s*\n?(?P<content>.*?)(?:\n?\s*@end=(?P=id)@|(?=@id=\d+@)|\Z)',
        re.DOTALL | re.IGNORECASE,
    )

    @staticmethod
    def load_lines(input_path: str) -> "Tuple[List[dict], Dict[int, int], int]":
        """
        Load lines with Logical IDs and Structure Map.
        - Skips empty lines.
        - Assigns sequential Logical IDs (1, 2, 3...) to non-empty lines.
        - Records mapping: Logical ID -> Nominal Physical Line Index (0-based).
        - Returns: (items, structure_map, total_physical_lines)
        """
        logger.info(f"Preparing {input_path} for Alignment Mode (Logical Structure Strategy)...")
        items = []
        structure_map = {} # {logical_id: physical_line_index}
        
        try:
            with open(input_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
                total_physical_lines = len(lines)
                
                logical_id = 1
                for phys_idx, line in enumerate(lines):
                    content = line.rstrip('\r\n')
                    if not content.strip():
                        continue 
                        
                    # Structure Map: Record where this logical ID belongs in the physical file
                    structure_map[logical_id] = phys_idx
                    
                    # Compact tagging with Logical ID + Double Newline for Chunker
                    # Ref: srt.py uses \n\n to ensure clear block separation for LLM
                    tagged_text = f"@id={logical_id}@ {content} @end={logical_id}@\n\n"
                    items.append({'text': tagged_text, 'meta': 'alignment_structural'})
                    
                    logical_id += 1
                        
            logger.info(f"Tagged {len(items)} logical lines. Map size: {len(structure_map)}")
            return items, structure_map, total_physical_lines
        except Exception as e:
            logger.error(f"Failed to load lines: {e}")
            raise e

    @staticmethod
    def process_result(text: str) -> str:
        """
        Post-process result for alignment mode preview.
        - Removes @id=x@ markers using robust regex.
        - Enforces single-line output for cleaner preview.
        """
        # 1. Remove ID markers (Start and End)
        out = re.sub(AlignmentHandler.TAG_MARKER_PATTERN, '', text).strip()
        
        # 2. Enforce Single Line for Preview? NO.
        # In Alignment Mode (Chunking), a block contains multiple lines.
        # We should PRESERVE newlines so the user can see the structure in the preview.
        # if '\n' in out:
        #    out = out.replace('\n', ' ').strip()
            
        return out

    @staticmethod
    def save_reconstructed(
        output_path: str,
        translated_blocks: List[TextBlock],
        structure_map: Dict[int, int],
        total_physical_lines: int,
        source_blocks: Optional[List[TextBlock]] = None,
    ):
        """
        Final Structured Reconstruction Formula.
        1. Collects translations (Logical IDs).
        2. Maps Logical ID -> Physical Line Index.
        3. Fills a blank canvas of size `total_physical_lines`.
        """
        # 1. Consolidate
        full_stream = "\n".join([b.prompt_text for b in translated_blocks])
        full_stream = normalize_anchor_stream(full_stream)

        expected_ids = sorted(structure_map.keys())
        expected_source = "\n".join(
            f"@id={idx}@\n@end={idx}@"
            for idx in expected_ids
        )
        repaired_stream, repair_ok, repair_meta = repair_and_validate_anchor_output(
            expected_source,
            full_stream,
            mode="alignment",
        )
        if repair_meta.get("repaired"):
            logger.info(
                "[Reconstruct] Alignment stream repaired: %s",
                ",".join(repair_meta.get("repair_steps", [])),
            )
        full_stream = repaired_stream

        if not repair_ok:
            logger.warning(
                "[Reconstruct] Repair validation incomplete: missing=%s strict_missing=%s foreign=%s",
                repair_meta.get("missing_count", 0),
                repair_meta.get("strict_pair_missing_count", 0),
                repair_meta.get("foreign_count", 0),
            )

        # 2. Extract content by Logical ID (strict first, then loose fallback)
        # [Debugging] Dump stream head to log
        if len(full_stream) > 0:
            logger.info(f"[Reconstruct] Full stream head (500 chars):\n{full_stream[:500]}")

        logical_trans_map = AlignmentHandler._extract_logical_map(
            full_stream,
            expected_ids=expected_ids,
        )

        missing_ids = [log_id for log_id in expected_ids if log_id not in logical_trans_map]
        if missing_ids and source_blocks:
            assigned_from_block = AlignmentHandler._fill_missing_from_block_plain_text(
                logical_trans_map,
                missing_ids,
                source_blocks,
                translated_blocks,
            )
            if assigned_from_block > 0:
                logger.warning(
                    "[Reconstruct] Filled %s missing logical IDs via block-level fallback.",
                    assigned_from_block,
                )

        missing_ids = [log_id for log_id in expected_ids if log_id not in logical_trans_map]
        if missing_ids and source_blocks:
            source_stream = normalize_anchor_stream(
                "\n".join((b.prompt_text or "") for b in source_blocks)
            )
            source_map = AlignmentHandler._extract_logical_map(
                source_stream,
                expected_ids=missing_ids,
            )
            source_filled = 0
            for log_id in missing_ids:
                fallback_text = source_map.get(log_id)
                if fallback_text:
                    logical_trans_map[log_id] = fallback_text
                    source_filled += 1
            if source_filled > 0:
                logger.warning(
                    "[Reconstruct] Filled %s missing logical IDs with source fallback.",
                    source_filled,
                )

        missing_ids = [log_id for log_id in expected_ids if log_id not in logical_trans_map]
        if missing_ids:
            logger.warning(
                "[Reconstruct] Missing logical IDs after parse: %s%s",
                missing_ids[:20],
                "..." if len(missing_ids) > 20 else "",
            )

        logger.info(f"[Reconstruct] Found {len(logical_trans_map)} logical items. Map size: {len(structure_map)}")

        # 3. Physical Fulfillment (The "Background Array" Strategy)
        # Create a blank canvas of empty strings
        physical_lines = [""] * total_physical_lines
        
        filled_count = 0
        for log_id in expected_ids:
            content = logical_trans_map.get(log_id)
            if content is None:
                continue
            phys_idx = structure_map.get(log_id)
            if phys_idx is None:
                logger.warning(f"[Reconstruct] Logical ID {log_id} has no physical mapping! (Hallucination?)")
                continue
            if 0 <= phys_idx < total_physical_lines:
                physical_lines[phys_idx] = content
                filled_count += 1
            else:
                logger.warning(f"[Reconstruct] Physical index {phys_idx} out of bounds (Max: {total_physical_lines})")

        # 4. Save
        with open(output_path, 'w', encoding='utf-8') as f:
            for line in physical_lines:
                f.write(line + "\n")
        
        logger.info(f"Reconstruction fulfilled {filled_count}/{len(structure_map)} logical items into {total_physical_lines} physical lines.")

    @staticmethod
    def _extract_logical_map(text: str, expected_ids: Optional[List[int]] = None) -> Dict[int, str]:
        expected_set = set(expected_ids) if expected_ids else None
        logical_map: Dict[int, str] = {}

        def _clean_content(raw: str) -> str:
            cleaned = AlignmentHandler.TAG_MARKER_PATTERN.sub("", raw or "")
            return cleaned.replace('\n', ' ').replace('\r', '').strip()

        for match in AlignmentHandler._STRICT_PAIR_PATTERN.finditer(text):
            log_id = int(match.group('id'))
            if expected_set is not None and log_id not in expected_set:
                continue
            if log_id in logical_map:
                continue
            content = _clean_content(match.group('content'))
            logical_map[log_id] = content

        for match in AlignmentHandler._LOOSE_PAIR_PATTERN.finditer(text):
            log_id = int(match.group('id'))
            if expected_set is not None and log_id not in expected_set:
                continue
            if log_id in logical_map:
                continue
            content = _clean_content(match.group('content'))
            logical_map[log_id] = content

        return logical_map

    @staticmethod
    def _ordered_ids_from_text(text: str) -> List[int]:
        ordered: List[int] = []
        seen = set()
        for value in re.findall(r"@id=(\d+)@", normalize_anchor_stream(text or "")):
            curr = int(value)
            if curr in seen:
                continue
            seen.add(curr)
            ordered.append(curr)
        return ordered

    @staticmethod
    def _fill_missing_from_block_plain_text(
        logical_trans_map: Dict[int, str],
        missing_ids: List[int],
        source_blocks: List[TextBlock],
        translated_blocks: List[TextBlock],
    ) -> int:
        missing_set = set(missing_ids)
        assigned = 0
        max_len = min(len(source_blocks), len(translated_blocks))

        for idx in range(max_len):
            if not missing_set:
                break

            block_all_ids = AlignmentHandler._ordered_ids_from_text(
                source_blocks[idx].prompt_text
            )
            expected_block_ids = [
                log_id
                for log_id in block_all_ids
                if log_id in missing_set
            ]
            if not expected_block_ids:
                continue

            block_text = normalize_anchor_stream(translated_blocks[idx].prompt_text or "")
            if not block_text.strip():
                continue

            # First, retry extraction at block scope (can recover from local malformed spans).
            block_map = AlignmentHandler._extract_logical_map(
                block_text,
                expected_ids=expected_block_ids,
            )
            for log_id in expected_block_ids:
                content = block_map.get(log_id)
                if content is None or log_id not in missing_set:
                    continue
                logical_trans_map[log_id] = content
                missing_set.remove(log_id)
                assigned += 1

            unresolved_ids = [log_id for log_id in expected_block_ids if log_id in missing_set]
            if not unresolved_ids:
                continue

            plain_block = AlignmentHandler.TAG_MARKER_PATTERN.sub("", block_text).strip()
            plain_lines = [line.strip() for line in plain_block.splitlines() if line.strip()]
            if not plain_lines:
                continue

            # Conservative mapping: only map when count is exact, or block has single logical line.
            if len(unresolved_ids) == 1:
                unresolved_id = unresolved_ids[0]
                candidate = ""
                # Safe path A: this block only carries one logical line.
                if len(block_all_ids) == 1:
                    candidate = " ".join(plain_lines).strip()
                # Safe path B: line count matches full block ids, map by source-id order.
                elif len(plain_lines) == len(block_all_ids):
                    unresolved_pos = block_all_ids.index(unresolved_id)
                    if 0 <= unresolved_pos < len(plain_lines):
                        candidate = plain_lines[unresolved_pos]
                # Safe path C: unresolved set itself is one line and output is also one line.
                elif len(expected_block_ids) == 1 and len(plain_lines) == 1:
                    candidate = plain_lines[0]

                if candidate:
                    logical_trans_map[unresolved_id] = candidate
                    missing_set.remove(unresolved_id)
                    assigned += 1
                continue

            if len(plain_lines) == len(unresolved_ids):
                for log_id, line in zip(unresolved_ids, plain_lines):
                    logical_trans_map[log_id] = line
                    missing_set.remove(log_id)
                    assigned += 1

        return assigned
