"""
标点符号修复器 (Punctuation Fixer)
功能：全角/半角标点转换、引号修复
"""
import re

class PunctuationFixer:
    # 数量匹配规则 A：全角 -> 半角
    RULE_SAME_COUNT_A = {
        "　": (" ", ),           # 全角空格和半角空格
        "：": (":", ),
        "・": ("·", ),
        "？": ("?", ),
        "！": ("!", ),
        "—": ("-", "―"),        # 破折号
        "―": ("-", "—"),
        "<": ("＜", "《"),
        ">": ("＞", "》"),
        "＜": ("<", "《"),
        "＞": (">", "》"),
        "[": ("【", ),
        "]": ("】", ),
        "【": ("[", ),
        "】": ("]", ),
        "(": ("（", ),
        ")": ("）", ),
        "（": ("(", ),
        "）": (")", ),
        "「": ("'", """, "『"),
        "」": ("'", """, "』"),
        "『": ("'", """, "「"),
        "』": ("'", """, "」"),
        "'": (""", "「", "『"),
        "'": (""", "」", "』"),
        """: ("'", "「", "『"),
        """: ("'", "」", "』"),
    }

    # 数量匹配规则 B：半角 -> 全角
    RULE_SAME_COUNT_B = {
        " ": ("　", ),
        ":": ("：", ),
        "·": ("・", ),
        "?": ("？", ),
        "!": ("！", ),
        "-": ("—", "―"),
    }

    # 强制替换规则（CJK 语言）
    RULE_FORCE_CJK = {
        "「": """,
        "」": """,
    }

    @classmethod
    def fix(cls, src: str, dst: str, target_is_cjk: bool = True) -> str:
        """
        修复标点符号
        :param src: 原文
        :param dst: 译文
        :param target_is_cjk: 目标语言是否为 CJK
        """
        # 首尾标点修正
        dst = cls.fix_start_end(src, dst, target_is_cjk)
        
        # 应用规则
        dst = cls.apply_fix_rules(src, dst, cls.RULE_SAME_COUNT_A)
        dst = cls.apply_fix_rules(src, dst, cls.RULE_SAME_COUNT_B)
        
        # CJK 强制规则
        if target_is_cjk:
            for key, value in cls.RULE_FORCE_CJK.items():
                dst = dst.replace(key, value)
        
        return dst

    @classmethod
    def check(cls, src: str, dst: str, key: str, value: tuple) -> bool:
        """检查是否需要修复"""
        num_s_x = src.count(key)
        num_s_y = sum(src.count(t) for t in value)
        num_t_x = dst.count(key)
        num_t_y = sum(dst.count(t) for t in value)
        
        return (num_s_x > 0 and 
                num_s_x != num_s_y and 
                num_s_x > num_t_x and 
                num_s_x == num_t_x + num_t_y)

    @classmethod
    def apply_fix_rules(cls, src: str, dst: str, rules: dict) -> str:
        """应用修复规则"""
        for key, value in rules.items():
            if cls.check(src, dst, key, value):
                for t in value:
                    dst = dst.replace(t, key)
        return dst

    @classmethod
    def fix_start_end(cls, src: str, dst: str, target_is_cjk: bool) -> str:
        """修正首尾引号"""
        # 修正开头引号
        if dst.startswith(("'", '"', "'", """, "「", "『")):
            if src.startswith(("「", "『")):
                dst = f"{src[0]}{dst[1:]}"
            elif target_is_cjk and src.startswith(("'", """)):
                dst = f"{src[0]}{dst[1:]}"
        
        # 修正结尾引号
        if dst.endswith(("'", '"', "'", """, "」", "』")):
            if src.endswith(("」", "』")):
                dst = f"{dst[:-1]}{src[-1]}"
            elif target_is_cjk and src.endswith(("'", """)):
                dst = f"{dst[:-1]}{src[-1]}"
        
        return dst
