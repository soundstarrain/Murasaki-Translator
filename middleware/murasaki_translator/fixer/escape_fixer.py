"""
转义字符修复器 (Escape Fixer)
功能：修复翻译过程中可能被破坏的转义序列
"""
import re


class EscapeFixer:
    # 匹配连续的反斜杠
    RE_ESCAPE_PATTERN = re.compile(r"\\+", flags=re.IGNORECASE)

    @classmethod
    def fix(cls, src: str, dst: str) -> str:
        """
        修复转义字符
        :param src: 原文
        :param dst: 译文
        :return: 修复后的译文
        """
        if not src or not dst:
            return dst
        
        # 如果译文中出现了真正的换行符，还原为 \\n
        # 注意：这可能会影响某些特殊情况，需要谨慎
        # dst = dst.replace("\n", "\\n")  # 暂时禁用，可能导致问题
        
        src_results = cls.RE_ESCAPE_PATTERN.findall(src)
        dst_results = cls.RE_ESCAPE_PATTERN.findall(dst)

        # 如果完全相同，无需修复
        if src_results == dst_results:
            return dst

        # 如果数量不一致，无法修复
        if len(src_results) != len(dst_results):
            return dst

        # 逐一替换：将译文中的转义序列替换为原文中对应的
        i = [0]
        
        def repl(m):
            result = src_results[i[0]]
            i[0] += 1
            return result
        
        dst = cls.RE_ESCAPE_PATTERN.sub(repl, dst)

        return dst
