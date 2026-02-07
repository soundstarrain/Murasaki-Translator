"""Prompt Builder - Constructs system/user messages with glossary injection."""

import json
import re
from typing import List, Dict, Optional

# ============================================================
# Prompt 预设配置 (策略模式)
# 新增预设时只需在此字典中添加，无需修改 build_messages 逻辑
# ============================================================
PRESET_PROMPTS: Dict[str, str] = {
    "novel": (
        "你是一位精通二次元文化的资深轻小说翻译家。\n"
        "请将日文文本翻译成流畅、优美的中文。\n\n"
        "**核心要求：**\n"
        "1. **深度思考：** 在翻译前，先在 <think> 标签中分析文风、补全主语并梳理逻辑。\n"
        "2. **信达雅：** 译文需符合中文轻小说阅读习惯，还原原作的沉浸感与文学性。"
    ),
    "script": (
        "你是一位专注于 Galgame 与动漫台词的本地化专家。\n"
        "请将剧本/台词翻译为地道的中文口语。\n\n"
        "**核心要求：**\n"
        "1. **角色还原：** 结合语境分析说话人的性格（如傲娇、腹黑），精准还原语气与口癖。\n"
        "2. **拒绝翻译腔：** 译文必须自然生动，符合「能被读出来的台词」标准。"
    ),
    "short": (
        "你是一个严谨的 ACGN 短句翻译引擎。\n"
        "请对输入的日文短句进行精准直译。\n\n"
        "**核心要求：**\n"
        "1. **零上下文：** 严禁脑补不存在的背景或主语。指代不明时保持模糊。\n"
        "2. **精准还原：** 忠实保留原文的结构与信息量，不进行过度润色。"
    ),
}

# 默认预设（当指定的 preset 不存在时回退）
DEFAULT_PRESET = "novel"


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

    def build_messages(self, block_text: str, preset: str = "novel", enable_cot: bool = False) -> List[Dict]:
        """
        构造 Prompt 消息
        :param preset: "novel" (轻小说) / "script" (剧本) / "short" (单句)
        :param enable_cot: 是否开启 CoT (Debug 用)
        """
        # 1. 动态提取术语
        relevant_glossary = self._extract_glossary(block_text)
        
        # 2. 构建术语表字符串
        glossary_str = ""
        if relevant_glossary:
            items = [f'"{k}": "{v}"' for k, v in relevant_glossary.items()]
            glossary_str = ", ".join(items)

        # 3. 使用策略模式获取 System Prompt
        system_content = PRESET_PROMPTS.get(preset, PRESET_PROMPTS[DEFAULT_PRESET])

        # 4. 统一术语表追加逻辑：存在术语时才添加
        if relevant_glossary:
            system_content += f"\n\n【术语表】\n{glossary_str}"

        # 5. 组装消息
        messages = [
            {"role": "system", "content": system_content},
            {"role": "user", "content": f"请翻译：\n{block_text}"}
        ]
        
        return messages
