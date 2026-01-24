"""
假名修复器 (Kana Fixer)
功能：移除孤立的拟声词假名（当翻译残留时清理）
"""


class KanaFixer:
    # 常见的拟声词假名（小写假名和促音）
    ONOMATOPOEIA_KANA = frozenset({
        "ッ", "っ",  # 促音
        "ぁ", "ぃ", "ぅ", "ぇ", "ぉ",  # 小写平假名
        "ゃ", "ゅ", "ょ", "ゎ",
    })
    
    # 平假名范围
    HIRAGANA_START = 0x3040
    HIRAGANA_END = 0x309F
    
    # 片假名范围
    KATAKANA_START = 0x30A0
    KATAKANA_END = 0x30FF

    @classmethod
    def is_kana(cls, char: str) -> bool:
        """判断字符是否为假名"""
        if not char:
            return False
        code = ord(char)
        return (cls.HIRAGANA_START <= code <= cls.HIRAGANA_END or 
                cls.KATAKANA_START <= code <= cls.KATAKANA_END)

    @classmethod
    def fix(cls, dst: str) -> str:
        """
        移除孤立的拟声词假名
        只有当假名的前后都不是假名时才移除
        """
        if not dst:
            return dst
        
        result = []
        length = len(dst)

        for i, char in enumerate(dst):
            if char in cls.ONOMATOPOEIA_KANA:
                # 检查前后字符
                prev_char = dst[i - 1] if i > 0 else None
                next_char = dst[i + 1] if i < length - 1 else None

                is_prev_kana = prev_char is not None and cls.is_kana(prev_char)
                is_next_kana = next_char is not None and cls.is_kana(next_char)

                # 如果前后有假名，保留当前字符（它是拟声词的一部分）
                if is_prev_kana or is_next_kana:
                    result.append(char)
                # 否则是孤立的，移除（不添加到结果）
            else:
                result.append(char)

        return "".join(result)
