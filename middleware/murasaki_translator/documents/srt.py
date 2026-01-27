"""SRT Document Handler - Supports subtitle files while preserving timecodes."""

import re
from typing import List, Dict, Any, Optional
from .base import BaseDocument
from murasaki_translator.core.chunker import TextBlock

class SrtDocument(BaseDocument):
    def load(self) -> List[Dict[str, Any]]:
        with open(self.path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # 使用双换行分割字幕块
        # 但要注意保留块内部的换行（序号、时间、文本）
        blocks = re.split(r'\n\s*\n', content.strip())
        items = []
        
        for block in blocks:
            if block.strip():
                # 针对 SRT 的特殊工程化优化：直接透传整个块内容
                # 让模型看到序号和时间，但后端保护文本中的标签
                items.append({'text': block.strip() + "\n\n", 'meta': 'srt_structural'})
                
        return items

    def save(self, output_path: str, blocks: List[TextBlock]):
        with open(output_path, 'w', encoding='utf-8') as f:
            for block in blocks:
                # 在结构化透传模式下，prompt_text 已经包含了 序号、时间轴 和 文本
                # 我们只需要确保块之间有正确的空行
                out_text = block.prompt_text.strip()
                if out_text:
                    f.write(out_text + "\n\n")
