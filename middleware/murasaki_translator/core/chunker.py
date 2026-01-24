"""Text Chunker - Splits input text into translation-sized blocks."""

from typing import List
from dataclasses import dataclass

@dataclass
class TextBlock:
    """分块数据类"""
    id: int
    prompt_text: str  # 用于 Prompt 的文本

class Chunker:
    def __init__(self, target_chars: int = 1000, max_chars: int = 2000, mode: str = "doc"):
        self.target_chars = target_chars
        self.max_chars = max_chars
        self.mode = mode

    def process(self, lines: List[str]) -> List[TextBlock]:
        if self.mode == "line":
            return self._process_line_by_line(lines)
        else:
            return self._process_rubber_band(lines)

    def _process_line_by_line(self, lines: List[str]) -> List[TextBlock]:
        """
        Mode: Line (Identity Strategy)
        每一行（非空）作为一个独立的 Block。
        """
        blocks = []
        for line in lines:
            text = line.strip()
            if text:
                blocks.append(TextBlock(id=len(blocks)+1, prompt_text=text))
        return blocks

    def _process_rubber_band(self, lines: List[str]) -> List[TextBlock]:
        """
        Mode: Doc (Rubber Band Strategy)
        智能合并多行，通过标点符号寻找最佳切分点。
        """
        blocks = []
        current_chunk = []
        current_char_count = 0
        
        # 安全断句符号
        SAFE_PUNCTUATION = ['。', '！', '？', '……', '”', '」', '\n']

        for line in lines:
            line_stripped = line.strip()
            # 保留空行结构，或者至少保留换行符以便 Prompt 格式正确
            # 这里我们简单地累积原始行（保留尾部空格/换行符？）
            # 通常 lines 来自 readlines()，带 \n。
            
            # 为了准确计算字符，我们strip一下计数，但内容保留
            # 如果是空行，是否要独立切分？小说模式下空行通常是段落间隔，合并即可。
            
            current_chunk.append(line)
            current_char_count += len(line)
            
            # 检查是否满足切分条件
            if current_char_count >= self.target_chars:
                # 尝试寻找断句点
                # 如果当前行以安全标点结尾，或者真的很长了，就切分
                if any(line_stripped.endswith(p) for p in SAFE_PUNCTUATION) or current_char_count >= self.max_chars:
                    prompt_text = "".join(current_chunk)
                    blocks.append(TextBlock(id=len(blocks)+1, prompt_text=prompt_text))
                    current_chunk = []
                    current_char_count = 0
        
        # 处理剩余内容
        if current_chunk:
            prompt_text = "".join(current_chunk)
            blocks.append(TextBlock(id=len(blocks)+1, prompt_text=prompt_text))
        
        # 平衡最后两个块：如果最后一个块太小，则重新分配
        # 阈值：如果最后一块小于目标大小的 30%，则重新平衡
        if len(blocks) >= 2:
            last_block = blocks[-1]
            second_last_block = blocks[-2]
            last_len = len(last_block.prompt_text)
            second_last_len = len(second_last_block.prompt_text)
            
            # 如果最后一块太小（< 30% of target）
            if last_len < self.target_chars * 0.3:
                # 合并最后两块，然后重新平均分割
                combined_text = second_last_block.prompt_text + last_block.prompt_text
                combined_lines = combined_text.splitlines(keepends=True)
                
                # 找到大约中间位置的分割点
                mid_target = len(combined_text) // 2
                current_len = 0
                split_idx = 0
                
                for i, line in enumerate(combined_lines):
                    current_len += len(line)
                    if current_len >= mid_target:
                        split_idx = i + 1
                        break
                
                # 重建两个块
                if split_idx > 0 and split_idx < len(combined_lines):
                    first_half = "".join(combined_lines[:split_idx])
                    second_half = "".join(combined_lines[split_idx:])
                    
                    blocks[-2] = TextBlock(id=second_last_block.id, prompt_text=first_half)
                    blocks[-1] = TextBlock(id=last_block.id, prompt_text=second_half)
            
        return blocks
