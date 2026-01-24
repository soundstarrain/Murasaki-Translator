"""
注音清理器 (Ruby Cleaner)
功能：移除日文文本中的 Ruby 注音标记
"""
import re


class RubyCleaner:
    # 保守规则（适用于所有文本类型）
    CONSERVATIVE_RULES = (
        # \\r[漢字,かんじ]
        (re.compile(r"\\r\[(.+?),.+?\]", flags=re.IGNORECASE), r"\1"),
        # \\rb[漢字,かんじ]
        (re.compile(r"\\rb\[(.+?),.+?\]", flags=re.IGNORECASE), r"\1"),
        # [r_かんじ][ch_漢字]
        (re.compile(r"\[r_.+?\]\[ch_(.+?)\]", flags=re.IGNORECASE), r"\1"),
        # [ch_漢字]
        (re.compile(r"\[ch_(.+?)\]", flags=re.IGNORECASE), r"\1"),
        # <ruby = かんじ>漢字</ruby>
        (re.compile(r"<ruby\s*=\s*.*?>(.*?)</ruby>", flags=re.IGNORECASE), r"\1"),
        # <ruby><rb>漢字</rb><rtc><rt>かんじ</rt></rtc></ruby>
        (re.compile(r"<ruby>.*?<rb>(.*?)</rb>.*?</ruby>", flags=re.IGNORECASE), r"\1"),
        # [ruby text=かんじ]
        (re.compile(r"\[ruby text\s*=\s*.*?\]", flags=re.IGNORECASE), ""),
    )

    # 激进规则（仅用于通用文本）
    AGGRESSIVE_RULES = (
        # (漢字/かんじ)
        (re.compile(r"\((.+)/.+\)", flags=re.IGNORECASE), r"\1"),
        # [漢字/かんじ]
        (re.compile(r"\[(.+)/.+\]", flags=re.IGNORECASE), r"\1"),
        # |漢字[かんじ]
        (re.compile(r"\|(.+?)\[.+?\]", flags=re.IGNORECASE), r"\1"),
    )

    @classmethod
    def clean(cls, text: str, aggressive: bool = False) -> str:
        """
        清理 Ruby 注音标记
        :param text: 输入文本
        :param aggressive: 是否使用激进模式（可能误伤正常括号）
        """
        if not text:
            return text
        
        # 始终应用保守规则
        for pattern, replacement in cls.CONSERVATIVE_RULES:
            text = pattern.sub(replacement, text)

        # 激进模式额外应用规则
        if aggressive:
            for pattern, replacement in cls.AGGRESSIVE_RULES:
                text = pattern.sub(replacement, text)

        return text
