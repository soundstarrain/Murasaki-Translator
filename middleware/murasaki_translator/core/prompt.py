"""Prompt Builder - Constructs system/user messages with glossary injection."""

import json
import re
from typing import List, Dict, Optional

class PromptBuilder:
    def __init__(self, glossary: Dict[str, str] = None):
        self.glossary = glossary or {}
        
    def _extract_glossary(self, text: str) -> Dict[str, str]:
        """
        Simple KeywordGacha: 简单的术语提取
        检查文本中是否包含术语表中的 Key
        注意：排除单字术语，避免误匹配
        """
        extracted = {}
        for k, v in self.glossary.items():
            # 排除单字术语，避免误匹配
            if len(k) > 1 and k in text:
                extracted[k] = v
        
        # 限制数量，防止 Prompt 过长 (Top 20)
        return dict(list(extracted.items())[:20])

    def build_messages(self, block_text: str, preset: str = "training", enable_cot: bool = False) -> List[Dict]:
        """
        构造 Prompt 消息
        :param preset: "minimal" (极简) 或 "training" (训练格式)
        :param enable_cot: 是否开启 CoT (Debug 用)
        """
        # 1. 动态提取术语
        relevant_glossary = self._extract_glossary(block_text)
        
        # Optimize Injection Format: Remove outer braces to match training format
        # Format: "Key": "Value", "Key2": "Value2"
        glossary_str = ""
        if relevant_glossary:
            # Manually construct string to ensure control over formatting
            items = [f'"{k}": "{v}"' for k, v in relevant_glossary.items()]
            glossary_str = ", ".join(items)
        else:
            glossary_str = "(无)"

        system_content = ""

        if preset == "minimal":
            # Preset 1: 极简模式
            system_content = (
                "你是一位精通二次元文化的资深轻小说翻译家。请将以下日文文本翻译成中文。"
                "要求：保持原文的段落结构和换行，不要随意合并段落。"
            )
            if relevant_glossary:
                 system_content += f"\n\n【强制术语表】\n{glossary_str}"

        elif preset == "training":
            # Preset 2: 训练格式
            system_content = (
                "你是一位精通二次元文化的资深轻小说翻译家。\n\n"
                f"【强制术语表】\n{glossary_str}\n\n"
                "**任务要求：**\n"
                "1. **文风自适应：** 根据原文判断作品风格（异世界/校园/严肃等）并定调。\n"
                "2. **隐形参考：** 译文需参考人类译文，但在思维链中严禁提及“参考译文”。\n"
                "3. **逻辑推导：** 必须分析省略主语、指代关系和倒装句。"
            )

        elif preset == "short":
            # Preset 3: 短文本模式
            system_content = (
                "你是一个严谨的二次元短句翻译引擎。\n\n"
                "**任务要求：**\n"
                "1. **零上下文：** 严禁脑补前文背景，指代不明时保持模糊。\n"
                "2. **精准直译：** 捕捉句尾语气词（ね/よ/ぞ），拒绝过度意译。"
            )
            if relevant_glossary:
                 system_content += f"\n\n【强制术语表】\n{glossary_str}"
            
        # 3. 组装
        messages = [
            {"role": "system", "content": system_content},
            {"role": "user", "content": f"请翻译：\n{block_text}"}
        ]
        
        return messages
