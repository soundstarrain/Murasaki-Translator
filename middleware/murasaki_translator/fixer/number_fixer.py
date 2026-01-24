"""
数字修复器 (Number Fixer)
功能：恢复圆圈数字 ①②③ 等
"""
import re

class NumberFixer:
    # 圆圈数字列表
    CIRCLED_NUMBERS = tuple(chr(i) for i in range(0x2460, 0x2474))  # ①-⑳
    CIRCLED_NUMBERS_CJK_01 = tuple(chr(i) for i in range(0x3251, 0x3260))  # ㉑-㉟
    CIRCLED_NUMBERS_CJK_02 = tuple(chr(i) for i in range(0x32B1, 0x32C0))  # ㊱-㊿
    CIRCLED_NUMBERS_ALL = ("",) + CIRCLED_NUMBERS + CIRCLED_NUMBERS_CJK_01 + CIRCLED_NUMBERS_CJK_02

    # 正则表达式
    PATTERN_ALL_NUM = re.compile(r"\d+|[①-⑳㉑-㉟㊱-㊿]", re.IGNORECASE)
    PATTERN_CIRCLED_NUM = re.compile(r"[①-⑳㉑-㉟㊱-㊿]", re.IGNORECASE)

    @classmethod
    def fix(cls, src: str, dst: str) -> str:
        """修复圆圈数字"""
        src_nums = cls.PATTERN_ALL_NUM.findall(src)
        dst_nums = cls.PATTERN_ALL_NUM.findall(dst)
        src_circled_nums = cls.PATTERN_CIRCLED_NUM.findall(src)

        # 如果原文中没有圆圈数字，跳过
        if len(src_circled_nums) == 0:
            return dst

        # 如果数字数量不一致，跳过
        if len(src_nums) != len(dst_nums):
            return dst

        # 如果原文圆圈数字少于译文，跳过
        dst_circled_nums = cls.PATTERN_CIRCLED_NUM.findall(dst)
        if len(src_circled_nums) < len(dst_circled_nums):
            return dst

        # 尝试恢复
        for i in range(len(src_nums)):
            src_num_str = src_nums[i]
            dst_num_str = dst_nums[i]
            dst_num_int = cls.safe_int(dst_num_str)

            if src_num_str not in cls.CIRCLED_NUMBERS_ALL:
                continue
            if dst_num_int < 0 or dst_num_int >= len(cls.CIRCLED_NUMBERS_ALL):
                continue
            if src_num_str != cls.CIRCLED_NUMBERS_ALL[dst_num_int]:
                continue

            dst = cls.fix_by_index(dst, i, src_num_str)

        return dst

    @classmethod
    def safe_int(cls, s: str) -> int:
        """安全转换为整数"""
        try:
            return int(s)
        except:
            return -1

    @classmethod
    def fix_by_index(cls, dst: str, target_i: int, target_str: str) -> str:
        """通过索引修复"""
        i = [0]

        def repl(m: re.Match) -> str:
            if i[0] == target_i:
                i[0] += 1
                return target_str
            else:
                i[0] += 1
                return m.group(0)

        return cls.PATTERN_ALL_NUM.sub(repl, dst)
