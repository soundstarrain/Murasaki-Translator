"""
智能行对齐器 - Smart Line Aligner
功能：处理模型翻译时合并行导致的行数不匹配问题
算法：基于汉字 Jaccard 相似度的贪婪匹配
"""
import re
from typing import List, Tuple


class LineAligner:
    """智能行对齐器：将不等长的原文行和译文行进行最优匹配"""
    
    # CJK 汉字 Unicode 范围
    CJK_RANGES = [
        (0x4E00, 0x9FFF),    # CJK 统一汉字
        (0x3400, 0x4DBF),    # CJK 扩展 A
        (0x20000, 0x2A6DF),  # CJK 扩展 B
        (0xF900, 0xFAFF),    # CJK 兼容汉字
    ]
    
    @classmethod
    def extract_hanzi(cls, text: str) -> set:
        """提取文本中的汉字集合"""
        hanzi = set()
        for char in text:
            code = ord(char)
            for start, end in cls.CJK_RANGES:
                if start <= code <= end:
                    hanzi.add(char)
                    break
        return hanzi
    
    @classmethod
    def jaccard_similarity(cls, set_a: set, set_b: set) -> float:
        """计算两个集合的 Jaccard 相似度"""
        if not set_a and not set_b:
            return 0.0
        union = len(set_a | set_b)
        intersection = len(set_a & set_b)
        return intersection / union if union > 0 else 0.0
    
    @classmethod
    def align(cls, src_lines: List[str], dst_lines: List[str]) -> List[Tuple[str, str]]:
        """
        对齐原文行和译文行
        
        Args:
            src_lines: 原文行列表
            dst_lines: 译文行列表
            
        Returns:
            List[Tuple[str, str]]: 对齐后的 (原文, 译文) 对列表
            
        当行数相等时直接一一对应；
        当行数不等时，使用汉字相似度匹配：
        - 原文多于译文：多个原文行对应同一个译文行
        - 译文多于原文：多个译文行对应同一个原文行
        """
        # 过滤空行
        src_lines = [l.strip() for l in src_lines if l.strip()]
        dst_lines = [l.strip() for l in dst_lines if l.strip()]
        
        # Guard: 空列表检查，防止除零错误
        if not src_lines and not dst_lines:
            return []
        if not dst_lines:
            # 译文为空，返回原文配空译文
            return [(src, "") for src in src_lines]
        if not src_lines:
            # 原文为空（不太可能），返回空原文配译文
            return [("", dst) for dst in dst_lines]
        
        # 行数相等，直接对应
        if len(src_lines) == len(dst_lines):
            return list(zip(src_lines, dst_lines))
        
        # 行数不等，使用汉字相似度匹配
        result = []
        
        # 提取所有汉字特征
        src_hanzi = [cls.extract_hanzi(line) for line in src_lines]
        dst_hanzi = [cls.extract_hanzi(line) for line in dst_lines]
        
        if len(src_lines) > len(dst_lines):
            # 原文多于译文：多个原文对应一个译文
            # 使用比例分配而非贪婪匹配，避免同一译文重复使用
            # 策略：按比例将 dst_lines 分配到 src_lines
            ratio = len(src_lines) / len(dst_lines)
            for i, src_line in enumerate(src_lines):
                # 计算当前 src 行应对应的 dst 索引
                dst_idx = min(int(i / ratio), len(dst_lines) - 1)
                result.append((src_line, dst_lines[dst_idx]))
        else:
            # 译文多于原文：多个译文合并到对应的原文
            # 策略：按比例将 src_lines 分配到 dst_lines
            ratio = len(dst_lines) / len(src_lines)
            for j, dst_line in enumerate(dst_lines):
                src_idx = min(int(j / ratio), len(src_lines) - 1)
                result.append((src_lines[src_idx], dst_line))
        
        return result
    
    @classmethod
    def align_for_preview(cls, src_text: str, dst_text: str, separator: str = "\n\n") -> Tuple[str, str]:
        """
        对齐文本块并返回用于预览的格式化文本
        
        Args:
            src_text: 原文文本块
            dst_text: 译文文本块
            separator: 行分隔符（默认双换行用于轻小说样式）
            
        Returns:
            Tuple[str, str]: (对齐后的原文, 对齐后的译文)
        """
        src_lines = src_text.split('\n') if src_text else []
        dst_lines = dst_text.split('\n') if dst_text else []
        
        aligned = cls.align(src_lines, dst_lines)
        
        if not aligned:
            return src_text, dst_text
        
        aligned_src = separator.join(pair[0] for pair in aligned)
        aligned_dst = separator.join(pair[1] for pair in aligned)
        
        return aligned_src, aligned_dst
