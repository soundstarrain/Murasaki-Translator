"""Text Chunker - Splits input text into translation-sized blocks."""

from typing import List, Any, Dict, Union
from dataclasses import dataclass, field
import re

@dataclass
class TextBlock:
    """分块数据类"""
    id: int
    prompt_text: str  # 用于 Prompt 的文本
    metadata: List[Any] = field(default_factory=list) # 源数据的元信息 (如行号、节点ID、时间戳)

class Chunker:
    def __init__(self, target_chars: int = 1200, max_chars: int = 2000, mode: str = "chunk", 
                 enable_balance: bool = True, balance_threshold: float = 0.6, balance_range: int = 3):
        self.target_chars = target_chars
        self.max_chars = max_chars
        self.mode = mode
        self.enable_balance = enable_balance
        self.balance_threshold = balance_threshold
        self.balance_range = balance_range

    def process(self, items: List[Union[str, Dict[str, Any]]]) -> List[TextBlock]:
        """
        Process a list of strings or dicts into chunks.
        If dicts, expects {'text': str, 'meta': Any}
        """
        # Normalize input to list of (text, meta) tuples
        normalized_items = []
        for item in items:
            if isinstance(item, str):
                normalized_items.append((item, None))
            elif isinstance(item, dict):
                normalized_items.append((item.get('text', ''), item.get('meta')))
            
        mode = str(self.mode or "").strip().lower()
        if mode == "line":
            return self._process_line_by_line(normalized_items)
        else:
            return self._process_rubber_band(normalized_items)

    def _process_line_by_line(self, items: List[tuple]) -> List[TextBlock]:
        """
        Mode: Line (Identity Strategy)
        每一行（非空）作为一个独立的 Block。
        """
        blocks = []
        for text, meta in items:
            clean_text = text.strip()
            if clean_text:
                blocks.append(TextBlock(
                    id=len(blocks)+1, 
                    prompt_text=clean_text,
                    metadata=[meta] if meta is not None else []
                ))
        return blocks

    def _process_rubber_band(self, items: List[tuple]) -> List[TextBlock]:
        """
        Mode: Chunk (Rubber Band Strategy)
        智能合并多行，通过标点符号寻找最佳切分点。
        """
        blocks = []
        current_chunk_text = []
        current_chunk_meta = []
        current_char_count = 0
        
        # 安全断句符号
        SAFE_PUNCTUATION = ['。', '！', '？', '……', '”', '」', '\n']

        for text, meta in items:
            # text_stripped = text.strip() # Don't strip here, keep original spacing for detection if needed
            # But line-based logic usually assumes lines.
            
            # 累积
            current_chunk_text.append(text)
            if meta is not None:
                current_chunk_meta.append(meta)
            
            current_char_count += len(text)
            
            # 检查是否满足切分条件
            # 1. 超过目标长度 (或接近目标长度前30字) 且 遇到标点
            # 2. 超过最大强制长度
            text_stripped = text.strip()
            
            # [Optimization] Numeric Protection (Veto)
            # Prevent splitting immediately after a line containing generic numbers (risk of hallucination/header break)
            is_numeric_risky = False
            
            # For Alignment Mode, we must strip the @id=x@ tags to check actual content
            if meta == 'alignment_structural':
                 # Remove tags: @id=1@ content @id=1@
                 inner_content = re.sub(r'(@id=\d+@)', '', text).strip()
                 if re.search(r'\d', inner_content):
                     is_numeric_risky = True
            elif re.search(r'\d', text):
                 # For normal chunk mode, checking raw text is enough
                 is_numeric_risky = True

            if current_char_count >= (self.target_chars - 30):
                is_safe_punct = any(text_stripped.endswith(p) for p in SAFE_PUNCTUATION)
                
                # VETO rule: If line has numbers, force extend (unless we hit hard max)
                if is_numeric_risky and current_char_count < self.max_chars:
                    is_safe_punct = False 

                if is_safe_punct or current_char_count >= self.max_chars:
                   self._create_block(blocks, current_chunk_text, current_chunk_meta)
                   current_chunk_text = []
                   current_chunk_meta = []
                   current_char_count = 0
        
        # 处理剩余内容
        if current_chunk_text:
             # 创建最后一个块
             self._create_block(blocks, current_chunk_text, current_chunk_meta)
             
        # 平衡最后几个块 (Tail Balancing)
        if self.enable_balance and len(blocks) >= 2:
            self._balance_tail(blocks)
            
        return blocks
    
    def _create_block(self, blocks: List[TextBlock], lines: List[str], meta: List[Any]):
        """Helper to create a block"""
        text = "".join(lines)
        if not text.strip():
            return
        blocks.append(TextBlock(
            id=len(blocks)+1, 
            prompt_text=text,
            metadata=meta
        ))

    def _balance_tail(self, blocks: List[TextBlock]):
        """
        Configurable Tail Balancing
        If the last block is too small (below threshold), merge it with previous N blocks
        and redistribute the content evenly.
        
        WARNING: Generative redistribution destroys metadata mapping if not careful.
        For now, we will DISABLE precise metadata mapping for balanced blocks or 
        we simply attach all metadata to the first block of the group (imprecise).
        
        Ideally, we should redistribute metadata based on text length which is complex.
        Given strict "Original Output" requirement, we must be careful.
        
        Strategic Decision: If metadata is present (Structured Document), we should probably 
        DISABLE aggressive re-balancing that splits lines, OR ensure line-level integrity.
        
        However, since `items` are passed as lines, and `splitlines` effectively restores them 
        if we join them... 
        But wait, `_balance_tail` does `combined_text.splitlines()`. 
        If the input was broken mid-sentence (e.g. fixed width file), splitlines works.
        If input was granular nodes (e.g. EPUB p tags), `splitlines` might split a single p tag 
        if it contained \n. 
        
        For Safety in v1.0 Multi-Format:
        We will SKIP balancing if the blocks have metadata to ensure safety.
        """
        # Check if we have metadata
        if any(b.metadata for b in blocks):
             # Structured documents (EPUB/SRT) should not have blocks rebalanced
             return

        # Determine how many blocks to involve (min of existing blocks and configured range)
        n = min(len(blocks), self.balance_range)
        if n < 2: return

        last = blocks[-1]
        
        # Check if balancing is triggered
        # Trigger if last block size < target * threshold
        if len(last.prompt_text) >= self.target_chars * self.balance_threshold:
            return # No balancing needed

        # debug_print = print  # Replace with logging if available
        # debug_print(f"[Chunker] Balancing triggered. Last block {len(last.prompt_text)} < {self.target_chars * self.balance_threshold}")

        # 1. Merge the last N blocks
        tail_blocks = blocks[-n:]
        combined_text = "".join([b.prompt_text for b in tail_blocks])
        lines = combined_text.splitlines(keepends=True)
        
        total_len = sum(len(l) for l in lines)
        ideal_len_per_block = total_len // n
        
        # 2. Redistribute into N chunks
        new_texts = []
        current_lines = []
        current_len = 0
        
        for line in lines:
            current_lines.append(line)
            current_len += len(line)
            
            # If we reached ideal length (and we are not filling the very last slot yet)
            if len(new_texts) < n - 1:
                # Greedy split: if we reached or exceeded the ideal size
                if current_len >= ideal_len_per_block:
                    # Decide whether to split here or wait (simple greedy is usually fine)
                    new_texts.append("".join(current_lines))
                    current_lines = []
                    current_len = 0
        
        # Add remaining content as the last chunk
        if current_lines:
            new_texts.append("".join(current_lines))
        
        # If logical split resulted in fewer chunks than N (very rare edge case if greedy logic is tight),
        # validation isn't strictly necessary as long as we put content back.
        # But we must ensure we don't change the number of blocks in the list if we can avoid it, 
        # OR we just update the content of the tail blocks.
        
        # 3. Update the blocks in place
        start_idx = len(blocks) - n
        for i in range(n):
             original_idx = start_idx + i
             if i < len(new_texts):
                blocks[original_idx].prompt_text = new_texts[i]
             else:
                # Clear redundant blocks if re-chunking resulted in fewer pieces
                blocks[original_idx].prompt_text = ""
                # Note: We keep the block ID to avoid breaking UI indices, 
                # but empty text won't be sent or processed usually.
                # If we really want to delete them, we'd need to rebuild the list, 
                # but that's risky for concurrent logic waiting on IDs.
