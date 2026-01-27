"""
Text Protector - 文本保护模块
在翻译前将特定文本替换为占位符，翻译后还原。
用于保护变量、标签、代码等不应被翻译的内容。
"""

import re
from typing import List, Dict


class TextProtector:
    """
    文本保护器：将匹配正则表达式的文本替换为占位符。
    
    用法:
        protector = TextProtector([r'\{[^}]+\}', r'<[^>]+>'])
        protected_text = protector.protect(source_text)
        # ... 翻译 protected_text ...
        final_text = protector.restore(translated_text)
    """
    
    # 默认保护模式: 增加了对 SRT/HTML 常见标签的优先级支持
    DEFAULT_PATTERNS = [
        r'<[^>]+>',             # <HTML标签/SRT样式>
        r'\{[^}]+\}',           # {变量/ASS标签}
        r'\[[^[\]]*\]',         # [标签]
        r'%[sd%]',              # %s, %d, %% 格式化
        r'\\n',                 # 转义换行符
        r'\$\{[^}]+\}',         # ${模板变量}
        r'{{[^}]+}}',           # {{双花括号变量}}
    ]

    # 字幕专用保护模式: 仅保护合法标签，不拦截 【】 （） [ ] 等可能包含翻译内容的括号
    SUBTITLE_PATTERNS = [
        r'<[^>]+>',             # <HTML: <i>, <font>...>
        r'\{(?:\\[^}]*?)\}',    # {ASS Tag}: Must start with \ (e.g., {\k}, {\pos})
        r'\{[A-Z0-9_]+\}',      # {ID} or {T1} uppercase placeholders
    ]
    
    
    def __init__(self, patterns: List[str] = None, enabled: bool = True, placeholder_format: str = "@{index}@", block_id: int = 0, aggressive_cleaning: bool = False):
        """
        初始化文本保护器。
        
        Args:
            patterns: 正则表达式列表，匹配需要保护的文本
            enabled: 是否启用保护
            placeholder_format: 占位符格式，默认为 @{index}@
            block_id: 当前分块 ID，用于元数据追踪
            aggressive_cleaning: 是否启用激进的占位符清洗（吞噬占位符后的空格）。
                                 ASS 格式建议开启（防止排版偏移），SRT 格式建议关闭（防止吞噬换行）。
        """
        self.patterns = patterns if patterns is not None else self.DEFAULT_PATTERNS
        self.enabled = enabled
        self.placeholder_format = placeholder_format
        self.block_id = block_id
        self.aggressive_cleaning = aggressive_cleaning
        self.replacements: Dict[str, str] = {}  # 占位符 -> 原文
        self.counter = 1  # 占位符计数器 (从 1 开始)
    
    def protect(self, text: str) -> str:
        """
        将匹配的文本替换为占位符。
        """
        if not self.enabled:
            return text
        
        # 重置状态
        self.replacements = {}
        self.counter = 1
        
        result = text
        for pattern in self.patterns:
            try:
                def replace_match(match):
                    original = match.group()
                    # 防止由于多个 Pattern 导致同一个地方被重复保护
                    for placeholder, orig in self.replacements.items():
                        if orig == original:
                            return placeholder
                    
                    placeholder = self.placeholder_format.replace("{block_id}", str(self.block_id)).replace("{index}", str(self.counter))
                    self.counter += 1
                    self.replacements[placeholder] = original
                    return placeholder
                
                result = re.sub(pattern, replace_match, result)
            except re.error as e:
                print(f"[TextProtector] Invalid pattern '{pattern}': {e}")
                continue
        
        return result
    
    def restore(self, text: str) -> str:
        """
        极尽稳健的占位符还原。处理模型可能产生的各种变形：全角化、空格化、符号丢失。
        """
        if not self.enabled or not self.replacements:
            return text
        
        result = text
        
        # 按照索引降序尝试还原（防止 @11@ 先被 @1@ 替换）
        # 我们这里重新构建一个索引映射，因为 keys 现在可能是 @1@ 这种格式
        # 假设格式是 @{index}@
        items = []
        for placeholder, original in self.replacements.items():
            match = re.search(r'(\d+)', placeholder)
            idx = int(match.group(1)) if match else 0
            items.append((idx, placeholder, original))
        
        # 按索引从大到小排序
        items.sort(key=lambda x: x[0], reverse=True)
        
        for idx, placeholder, original in items:
            # 统一使用模糊正则匹配，以处理模型可能产生的各种变形（全角、空格插入等）
            # 核心修复：之前的 strict replace 无法消除模型在占位符后插入的空格
            # 现在的正则会自动吞噬占位符后的所有空白 (\s*)
            
            # 针对 @N@ 格式构造一个模糊正则
            # 允许在 @ 符号和数字之间有任意空格，允许全半角混杂
            safe_placeholder = re.escape(placeholder) # e.g. \@1\@
            # 构造一个能匹配 @1@, @ 1 @, ＠１＠, ＠　１　＠ 的正则
            # 把每个字符都变成 [字符|全角字符]\s*
            fuzzy_pattern = ""
            for i, char in enumerate(placeholder):
                fw_char = self._to_mangled_potential(char)
                if char == fw_char:
                    char_part = re.escape(char)
                else:
                    char_part = f"[{re.escape(char)}{re.escape(fw_char)}]"
                
                # Logic for appending space consumer
                # If aggressive_cleaning is False (SRT/TXT), we DO NOT consume trailing spaces
                # to preserve structural newlines or intended spaces.
                is_last = (i == len(placeholder) - 1)
                if is_last and not self.aggressive_cleaning:
                    fuzzy_pattern += char_part
                else:
                    fuzzy_pattern += char_part + r"\s*"
            
            try:
                # 使用这个模糊正则寻找并替换
                # CRITICAL FIX: Use lambda for replacement to prevent regex driver from
                # interpreting backslashes in the 'original' string (e.g. {\pos} -> {os})
                result = re.sub(fuzzy_pattern.strip(), lambda m: original, result)
            except:
                # Fallback to strict if regex fails for some reason
                if placeholder in result:
                    result = result.replace(placeholder, original)

        return result

    def _to_mangled_potential(self, s: str) -> str:
        """
        转换字符串为可能的被损坏后的形式（全角化）。
        """
        # 数字和下划线、字母的全角转换表
        table = str.maketrans(
            "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_@#!$%^&*()[]{}<>",
            "０１２３４５６７８９ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ＿＠＃！＄％＾＆＊（）［］｛｝＜＞"
        )
        return s.translate(table)
    
    def get_stats(self) -> Dict:
        """获取保护统计信息"""
        return {
            "block_id": self.block_id,
            "enabled": self.enabled,
            "patterns_count": len(self.patterns),
            "protected_count": len(self.replacements),
            "replacements": dict(self.replacements)
        }


# 便捷函数
def create_protector(patterns: List[str] = None, enabled: bool = True, aggressive_cleaning: bool = False) -> TextProtector:
    """创建文本保护器的工厂函数"""
    return TextProtector(patterns, enabled, aggressive_cleaning=aggressive_cleaning)
