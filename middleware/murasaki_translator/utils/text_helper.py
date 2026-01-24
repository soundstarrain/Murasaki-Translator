"""
文本辅助工具 (Text Helper)
功能：标点检测、相似度计算、假名检测等
"""
import re
import unicodedata


class TextHelper:
    # CJK 标点符号
    CJK_PUNCTUATION = frozenset(
        chr(c) for start, end in (
            (0x3001, 0x303F),  # CJK 标点
            (0xFF01, 0xFF0F),  # 全角标点
            (0xFF1A, 0xFF1F),
            (0xFF3B, 0xFF40),
            (0xFF5B, 0xFF65),
        ) for c in range(start, end + 1)
    )

    # 拉丁标点符号
    LATIN_PUNCTUATION = frozenset(
        chr(c) for start, end in (
            (0x0021, 0x002F),
            (0x003A, 0x0040),
            (0x005B, 0x0060),
            (0x007B, 0x007E),
            (0x2000, 0x206F),
        ) for c in range(start, end + 1)
    )

    # 平假名范围
    HIRAGANA_START = 0x3040
    HIRAGANA_END = 0x309F
    
    # 片假名范围
    KATAKANA_START = 0x30A0
    KATAKANA_END = 0x30FF
    
    # 谚文范围
    HANGEUL_START = 0xAC00
    HANGEUL_END = 0xD7AF

    @classmethod
    def is_punctuation(cls, char: str) -> bool:
        """判断是否为标点符号"""
        return char in cls.CJK_PUNCTUATION or char in cls.LATIN_PUNCTUATION

    @classmethod
    def is_hiragana(cls, char: str) -> bool:
        """判断是否为平假名"""
        code = ord(char)
        return cls.HIRAGANA_START <= code <= cls.HIRAGANA_END

    @classmethod
    def is_katakana(cls, char: str) -> bool:
        """判断是否为片假名"""
        code = ord(char)
        return cls.KATAKANA_START <= code <= cls.KATAKANA_END

    @classmethod
    def is_kana(cls, char: str) -> bool:
        """判断是否为假名（平假名或片假名）"""
        return cls.is_hiragana(char) or cls.is_katakana(char)

    @classmethod
    def is_hangeul(cls, char: str) -> bool:
        """判断是否为谚文（韩文）"""
        code = ord(char)
        return cls.HANGEUL_START <= code <= cls.HANGEUL_END

    @classmethod
    def any_hiragana(cls, text: str) -> bool:
        """文本中是否包含平假名"""
        return any(cls.is_hiragana(c) for c in text)

    @classmethod
    def any_katakana(cls, text: str) -> bool:
        """文本中是否包含片假名"""
        return any(cls.is_katakana(c) for c in text)

    @classmethod
    def any_kana(cls, text: str) -> bool:
        """文本中是否包含假名"""
        return any(cls.is_kana(c) for c in text)

    @classmethod
    def any_hangeul(cls, text: str) -> bool:
        """文本中是否包含谚文"""
        return any(cls.is_hangeul(c) for c in text)

    @classmethod
    def jaccard_similarity(cls, a: str, b: str) -> float:
        """计算 Jaccard 相似度"""
        set_a = set(a)
        set_b = set(b)
        union = len(set_a | set_b)
        intersection = len(set_a & set_b)
        return intersection / union if union > 0 else 0.0

    @classmethod
    def strip_punctuation(cls, text: str) -> str:
        """移除首尾标点符号"""
        if not text:
            return text
        
        chars = list(text.strip())
        start, end = 0, len(chars) - 1
        
        while start <= end and cls.is_punctuation(chars[start]):
            start += 1
        while end >= start and cls.is_punctuation(chars[end]):
            end -= 1
        
        return "".join(chars[start:end + 1]) if start <= end else ""

    @classmethod
    def get_display_length(cls, text: str) -> int:
        """计算字符串的显示宽度（全角字符为2，半角为1）"""
        return sum(1 if unicodedata.east_asian_width(c) in "NaH" else 2 for c in text)
