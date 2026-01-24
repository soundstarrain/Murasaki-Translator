"""Response Parser - Extracts translated text, removes CoT thinking blocks."""

import re
import json
import logging
from typing import List, Tuple

logger = logging.getLogger(__name__)

class ResponseParser:
    """
    解析器：处理 CoT 去除和行号对齐校验
    支持多种输出格式：
    1. 标准 <think>...</think> 格式
    2. JSON 格式 {"think": "...", "translation": "..."}
    3. 纯文本格式
    """
    def __init__(self):
        self.think_pattern = re.compile(r'<think>.*?</think>', re.DOTALL)
        # 兼容 [1] xxx, [01] xxx, 1. xxx 等多种格式
        self.line_pattern_strict = re.compile(r'^\[(\d+)\]\s*(.*)')
        
    def parse(self, raw_output: str, expected_count: int = 0) -> Tuple[List[str], str]:
        """
        解析输出文本，返回 (清洗后的行列表, CoT内容)
        v4.0 Mode: expected_count=0 表示不校验行数
        """
        cot_content = ""
        clean_text = raw_output.strip()
        
        # 1. 尝试解析 JSON 格式 (某些模型会输出 {"think": "...", "translation": "..."})
        if clean_text.startswith('{') and clean_text.endswith('}'):
            try:
                # 尝试找到有效的 JSON 块
                json_data = json.loads(clean_text)
                if isinstance(json_data, dict):
                    # 提取 think 内容
                    if 'think' in json_data:
                        cot_content = f"<think>{json_data['think']}</think>"
                    
                    # 提取 translation 内容
                    if 'translation' in json_data:
                        clean_text = json_data['translation']
                        logger.debug("Extracted translation from JSON format")
                    elif 'output' in json_data:
                        clean_text = json_data['output']
                    elif 'text' in json_data:
                        clean_text = json_data['text']
                    else:
                        # JSON 但没有预期的键，尝试移除外层括号
                        clean_text = clean_text[1:-1].strip()
            except json.JSONDecodeError:
                # 不是有效 JSON，按原方式处理
                pass
        
        # 2. 提取 <think> 标签内容 (如果还没提取到)
        if not cot_content:
            think_match = self.think_pattern.search(clean_text)
            cot_content = think_match.group(0) if think_match else ""
        
        # 3. 移除 <think> 标签得到正文
        clean_text = self.think_pattern.sub('', clean_text).strip()
        # 3.1 移除可能的残留标签 (如模型幻觉产生的孤立 </think>)
        clean_text = clean_text.replace('<think>', '').replace('</think>', '')
        
        # 3.2 再次检查是否有 JSON 包装 (处理嵌套情况)
        clean_text = clean_text.strip()
        if clean_text.startswith('{') and clean_text.endswith('}'):
            inner = clean_text[1:-1].strip()
            # 如果内部包含换行且不是纯键值对格式，移除外层括号
            if '\n' in inner and not inner.startswith('"'):
                clean_text = inner
        
        # 4. 按换行切分
        lines = clean_text.split('\n')
        # 过滤掉可能的尾部空白行
        lines = [l.strip() for l in lines]
        while lines and not lines[-1]:
            lines.pop()
            
        return lines, cot_content

