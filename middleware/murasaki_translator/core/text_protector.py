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
    
    # 默认保护模式
    DEFAULT_PATTERNS = [
        r'\{[^}]+\}',           # {变量}
        r'\[[^[\]]*\]',         # [标签] (非嵌套)
        r'<[^>]+>',             # <HTML标签>
        r'%[sd%]',              # %s, %d, %% 格式化
        r'\\n',                 # 转义换行符
        r'\$\{[^}]+\}',         # ${模板变量}
        r'{{[^}]+}}',           # {{双花括号变量}}
    ]
    
    def __init__(self, patterns: List[str] = None, enabled: bool = True):
        """
        初始化文本保护器。
        
        Args:
            patterns: 正则表达式列表，匹配需要保护的文本
            enabled: 是否启用保护（False 则直接返回原文）
        """
        self.patterns = patterns if patterns is not None else self.DEFAULT_PATTERNS
        self.enabled = enabled
        self.replacements: Dict[str, str] = {}  # 占位符 -> 原文
        self.counter = 0  # 占位符计数器
    
    def protect(self, text: str) -> str:
        """
        将匹配的文本替换为占位符。
        
        Args:
            text: 原始文本
            
        Returns:
            替换后的文本
        """
        if not self.enabled:
            return text
        
        # 重置状态
        self.replacements = {}
        self.counter = 0
        
        result = text
        for pattern in self.patterns:
            try:
                # 使用回调函数进行替换，确保每个匹配都有唯一占位符
                def replace_match(match):
                    original = match.group()
                    # 如果已有相同的原文，复用占位符
                    for placeholder, orig in self.replacements.items():
                        if orig == original:
                            return placeholder
                    # 创建新占位符
                    placeholder = f"⟦P{self.counter}⟧"
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
        将占位符还原为原文。
        
        Args:
            text: 包含占位符的翻译结果
            
        Returns:
            还原后的文本
        """
        if not self.enabled or not self.replacements:
            return text
        
        result = text
        for placeholder, original in self.replacements.items():
            result = result.replace(placeholder, original)
        
        return result
    
    def get_stats(self) -> Dict:
        """获取保护统计信息"""
        return {
            "enabled": self.enabled,
            "patterns_count": len(self.patterns),
            "protected_count": len(self.replacements),
            "replacements": dict(self.replacements)
        }


# 便捷函数
def create_protector(patterns: List[str] = None, enabled: bool = True) -> TextProtector:
    """创建文本保护器的工厂函数"""
    return TextProtector(patterns, enabled)
