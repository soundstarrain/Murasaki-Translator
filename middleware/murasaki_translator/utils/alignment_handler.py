import re
from typing import List, Dict, Tuple
from murasaki_translator.core.chunker import TextBlock
import logging

logger = logging.getLogger("murasaki.alignment")

class AlignmentHandler:
    """
    Handles strict formatting alignment for comic translation (Alignment Mode).
    Enforces 1-to-1 strict line mapping and protects content with boundary tags.
    """
    
    TAG_ID_PATTERN = re.compile(r'@id=(\d+)@', re.IGNORECASE)

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
                    tagged_text = f"@id={logical_id}@ {content} @id={logical_id}@\n\n"
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
        out = re.sub(AlignmentHandler.TAG_ID_PATTERN, '', text).strip()
        
        # 2. Enforce Single Line for Preview? NO.
        # In Alignment Mode (Chunking), a block contains multiple lines.
        # We should PRESERVE newlines so the user can see the structure in the preview.
        # if '\n' in out:
        #    out = out.replace('\n', ' ').strip()
            
        return out

    @staticmethod
    def save_reconstructed(output_path: str, translated_blocks: List[TextBlock], structure_map: Dict[int, int], total_physical_lines: int):
        """
        Final Structured Reconstruction Formula.
        1. Collects translations (Logical IDs).
        2. Maps Logical ID -> Physical Line Index.
        3. Fills a blank canvas of size `total_physical_lines`.
        """
        # 1. Consolidate
        full_stream = "\n".join([b.prompt_text for b in translated_blocks])
        
        # 2. Extract content by Logical ID
        pattern = re.compile(r'@id=(?P<id>\d+)@\s*\n?(?P<content>.*?)\n?\s*@id=(?P=id)@', re.DOTALL | re.IGNORECASE)
        
        # [Debugging] Dump stream head to log
        if len(full_stream) > 0:
            logger.info(f"[Reconstruct] Full stream head (500 chars):\n{full_stream[:500]}")
        
        logical_trans_map = {}
        for match in pattern.finditer(full_stream):
            log_id = int(match.group('id'))
            content = match.group('content').strip()
            logical_trans_map[log_id] = content.replace('\n', ' ').replace('\r', '').strip()

        logger.info(f"[Reconstruct] Found {len(logical_trans_map)} logical items. Map size: {len(structure_map)}")

        # 3. Physical Fulfillment (The "Background Array" Strategy)
        # Create a blank canvas of empty strings
        physical_lines = [""] * total_physical_lines
        
        filled_count = 0
        for log_id, content in logical_trans_map.items():
            if log_id in structure_map:
                phys_idx = structure_map[log_id]
                if 0 <= phys_idx < total_physical_lines:
                    physical_lines[phys_idx] = content
                    filled_count += 1
                else:
                    logger.warning(f"[Reconstruct] Physical index {phys_idx} out of bounds (Max: {total_physical_lines})")
            else:
                logger.warning(f"[Reconstruct] Logical ID {log_id} has no physical mapping! (Hallucination?)")

        # 4. Save
        with open(output_path, 'w', encoding='utf-8') as f:
            for line in physical_lines:
                f.write(line + "\n")
        
        logger.info(f"Reconstruction fulfilled {filled_count}/{len(structure_map)} logical items into {total_physical_lines} physical lines.")
