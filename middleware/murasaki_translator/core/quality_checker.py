"""
Quality Checker - Translation output quality validation module.
提供翻译输出的质量检测功能，包括：
1. 假名/谚文残留检测
2. 原文译文相似度检测
3. 术语表生效验证
4. 行数一致性检测
"""

import re
import unicodedata
from typing import List, Tuple, Dict, Any, Optional


class WarningType:
    """检查警告类型"""
    KANA_RESIDUE = "kana_residue"          # 假名残留
    HANGEUL_RESIDUE = "hangeul_residue"    # 谚文残留
    HIGH_SIMILARITY = "high_similarity"     # 相似度过高（可能未翻译）
    GLOSSARY_MISSED = "glossary_missed"     # 术语表未生效
    LINE_MISMATCH = "line_mismatch"         # 行数不匹配
    EMPTY_OUTPUT = "empty_output"           # 空输出


class QualityChecker:
    """
    翻译质量检查器
    
    用于验证翻译输出的质量，检测潜在问题并生成警告。
    """
    
    # 日语假名 Unicode 范围
    HIRAGANA_RANGE = (0x3040, 0x309F)
    KATAKANA_RANGE = (0x30A0, 0x30FF)
    
    # 韩语谚文 Unicode 范围
    HANGEUL_RANGE = (0xAC00, 0xD7AF)
    HANGEUL_JAMO_RANGE = (0x1100, 0x11FF)
    
    def __init__(self, glossary: Any = None):
        """
        初始化质量检查器
        
        Args:
            glossary: 术语表数据。支持两种格式：
                      1. List[Dict]: [{"src": "原文", "dst": "译文"}, ...]
                      2. Dict[str, str]: {"原文": "译文", ...}
        """
        if isinstance(glossary, dict):
            self.glossary = [{"src": k, "dst": v} for k, v in glossary.items()]
        else:
            self.glossary = glossary or []
        
    def check_output(
        self, 
        source_lines: List[str], 
        output_lines: List[str],
        source_lang: str = "ja"
    ) -> List[Dict[str, Any]]:
        """
        检查翻译输出质量
        
        Args:
            source_lines: 原文行列表
            output_lines: 译文行列表
            source_lang: 源语言代码 ("ja", "ko", "en" 等)
            
        Returns:
            警告列表，每个警告包含 type, line, message 字段
        """
        warnings = []
        
        # 1. 行数检测 (忽略空行)
        src_non_empty = [l for l in source_lines if l.strip()]
        dst_non_empty = [l for l in output_lines if l.strip()]
        if len(src_non_empty) != len(dst_non_empty):
            warnings.append({
                "type": WarningType.LINE_MISMATCH,
                "line": 0,
                "message": f"行数不匹配: 原文 {len(src_non_empty)} 行, 译文 {len(dst_non_empty)} 行 (忽略空行)"
            })
        
        # 2. 逐行检测
        for i, (src, dst) in enumerate(zip(source_lines, output_lines)):
            line_num = i + 1
            
            # 空输出检测 (仅当原文不为空时)
            if src.strip() and not dst.strip():
                warnings.append({
                    "type": WarningType.EMPTY_OUTPUT,
                    "line": line_num,
                    "message": f"第 {line_num} 行译文为空 (原文非空)"
                })
                continue
            
            # 假名残留检测（仅日语源）
            if source_lang == "ja":
                kana_warnings = self._check_kana_residue(dst, line_num)
                warnings.extend(kana_warnings)
            
            # 谚文残留检测（仅韩语源）
            if source_lang == "ko":
                hangeul_warnings = self._check_hangeul_residue(dst, line_num)
                warnings.extend(hangeul_warnings)
            
            # 相似度检测
            if self._is_high_similarity(src, dst):
                warnings.append({
                    "type": WarningType.HIGH_SIMILARITY,
                    "line": line_num,
                    "message": f"第 {line_num} 行原文与译文高度相似，可能未翻译"
                })
            
            # 术语表检测
            glossary_warnings = self._check_glossary(src, dst, line_num)
            warnings.extend(glossary_warnings)
        
        return warnings
    
    def _check_kana_residue(self, text: str, line_num: int) -> List[Dict[str, Any]]:
        """检测假名残留"""
        warnings = []
        
        # 检测平假名
        hiragana_chars = [c for c in text if self._is_hiragana(c)]
        # 检测片假名
        katakana_chars = [c for c in text if self._is_katakana(c)]
        
        # 排除常用标点和符号
        hiragana_chars = [c for c in hiragana_chars if c not in 'ー・']
        katakana_chars = [c for c in katakana_chars if c not in 'ー・']
        
        if hiragana_chars:
            warnings.append({
                "type": WarningType.KANA_RESIDUE,
                "line": line_num,
                "message": f"第 {line_num} 行检测到平假名残留: {''.join(hiragana_chars[:5])}..."
            })
        
        if katakana_chars:
            # 片假名可能是外来语音译，只警告较多的情况
            if len(katakana_chars) > 3:
                warnings.append({
                    "type": WarningType.KANA_RESIDUE,
                    "line": line_num,
                    "message": f"第 {line_num} 行检测到片假名残留: {''.join(katakana_chars[:5])}..."
                })
        
        return warnings
    
    def _check_hangeul_residue(self, text: str, line_num: int) -> List[Dict[str, Any]]:
        """检测谚文残留"""
        warnings = []
        
        hangeul_chars = [c for c in text if self._is_hangeul(c)]
        
        if hangeul_chars:
            warnings.append({
                "type": WarningType.HANGEUL_RESIDUE,
                "line": line_num,
                "message": f"第 {line_num} 行检测到谚文残留: {''.join(hangeul_chars[:5])}..."
            })
        
        return warnings
    
    def _is_high_similarity(self, src: str, dst: str, threshold: float = 0.8) -> bool:
        """检测原文和译文的相似度是否过高"""
        src_clean = src.strip()
        dst_clean = dst.strip()
        
        # 空字符串不算高相似
        if not src_clean or not dst_clean:
            return False
        
        # 完全相同
        if src_clean == dst_clean:
            return True
        
        # 包含关系
        if src_clean in dst_clean or dst_clean in src_clean:
            return True
        
        # Ignore short lines (common for symbols, names, or short phrases)
        if len(src_clean) < 10:
            return False

        # Jaccard 相似度
        similarity = self._jaccard_similarity(src_clean, dst_clean)
        return similarity > threshold
    
    def _jaccard_similarity(self, s1: str, s2: str) -> float:
        """计算两个字符串的 Jaccard 相似度"""
        set1 = set(s1)
        set2 = set(s2)
        
        intersection = len(set1 & set2)
        union = len(set1 | set2)
        
        return intersection / union if union > 0 else 0.0
    
    def _check_glossary(self, src: str, dst: str, line_num: int) -> List[Dict[str, Any]]:
        """检测术语表是否生效"""
        warnings = []
        
        # DEBUG: Print if glossary is empty (once)
        if not hasattr(self, '_debug_logged'):

            self._debug_logged = True

        for entry in self.glossary:
            term_src = entry.get("src", "")
            term_dst = entry.get("dst", "")
            
            if not term_src or not term_dst:
                continue
            
            # 原文包含术语，但译文不包含对应翻译
            if term_src in src and term_dst not in dst:
                # DEBUG
                # print(f"[QualityChecker] Miss match in line {line_num}: {term_src} -> {term_dst} (Src: {src[:20]}...)")
                warnings.append({
                    "type": WarningType.GLOSSARY_MISSED,
                    "line": line_num,
                    "message": f"第 {line_num} 行术语 '{term_src}' -> '{term_dst}'可能未生效"
                })
        
        return warnings
    
    def _is_hiragana(self, char: str) -> bool:
        """判断是否为平假名"""
        cp = ord(char)
        return self.HIRAGANA_RANGE[0] <= cp <= self.HIRAGANA_RANGE[1]
    
    def _is_katakana(self, char: str) -> bool:
        """判断是否为片假名"""
        cp = ord(char)
        return self.KATAKANA_RANGE[0] <= cp <= self.KATAKANA_RANGE[1]
    
    def _is_hangeul(self, char: str) -> bool:
        """判断是否为谚文"""
        cp = ord(char)
        return (self.HANGEUL_RANGE[0] <= cp <= self.HANGEUL_RANGE[1] or
                self.HANGEUL_JAMO_RANGE[0] <= cp <= self.HANGEUL_JAMO_RANGE[1])


def format_warnings_for_log(warnings: List[Dict[str, Any]]) -> str:
    """将警告列表格式化为日志字符串"""
    if not warnings:
        return ""
    
    lines = ["[Quality Check] 检测到以下问题:"]
    for w in warnings:
        lines.append(f"  - [{w['type']}] {w['message']}")
    
    return "\n".join(lines)


def count_warnings_by_type(warnings: List[Dict[str, Any]]) -> Dict[str, int]:
    """按类型统计警告数量"""
    counts = {}
    for w in warnings:
        t = w["type"]
        counts[t] = counts.get(t, 0) + 1
    return counts


def calculate_glossary_coverage(
    source_text: str, 
    translated_text: str, 
    glossary: Dict[str, str],
    cot_text: str = "",
    output_hit_threshold: float = 60.0,
    cot_coverage_threshold: float = 80.0
) -> Tuple[bool, float, float, int, int]:
    """
    计算术语表覆盖率（支持 CoT 检查）
    
    判定规则：
    - 输出精确命中 >= output_hit_threshold → Pass
    - 或 CoT 中日文术语覆盖 >= cot_coverage_threshold → Pass（说明模型意识到了术语）
    
    Args:
        source_text: 原文文本
        translated_text: 译文文本
        glossary: 术语表 {原文: 译文}
        cot_text: 模型思考过程文本（可选）
        output_hit_threshold: 输出精确命中阈值（默认 60%）
        cot_coverage_threshold: CoT 覆盖阈值（默认 80%）
        
    Returns:
        (是否通过, 输出覆盖率, CoT覆盖率, 命中数, 应命中总数)
    """
    if not glossary:
        print("[Glossary Check] Skipped (Zero glossary entries found/loaded).")
        return True, 100.0, 0.0, 0, 0
    
    # 找出原文中出现的术语
    relevant_terms = {}
    for src_term, dst_term in glossary.items():
        # 排除单字术语
        if len(src_term) > 1 and src_term in source_text:
            relevant_terms[src_term] = dst_term
    
    if not relevant_terms:
        print(f"[Glossary Check] Skipped (No relevant terms found in {len(source_text)} chars of source text).")
        return True, 100.0, 0.0, 0, 0
    
    total = len(relevant_terms)
    
    # 1. 精确匹配：检查译文中命中了多少
    output_hit_count = 0
    for src_term, dst_term in relevant_terms.items():
        if dst_term in translated_text:
            output_hit_count += 1
    
    output_coverage = (output_hit_count / total * 100) if total > 0 else 100.0
    
    # 2. CoT 检查
    cot_coverage = 0.0
    cot_hit_count = 0
    if cot_text:
        for src_term in relevant_terms.keys():
            # Check if source term appears in CoT (Model noticed the term)
            if src_term in cot_text:
                cot_hit_count += 1
        cot_coverage = (cot_hit_count / total * 100) if total > 0 else 0.0

    # 判定逻辑 (Pass if EITHER output OR CoT meets threshold)
    # Bug Fix / Improvement: Log detailed breakdown for debugging
    passed = False
    reason = "Failed"
    
    if output_coverage >= output_hit_threshold:
        passed = True
        reason = f"Output Coverage ({output_coverage:.1f}%) >= Threshold ({output_hit_threshold}%)"
    elif cot_coverage >= cot_coverage_threshold:
        passed = True
        reason = f"CoT Coverage ({cot_coverage:.1f}%) >= Threshold ({cot_coverage_threshold}%)"
    
    # Detailed Logging (Only if not passed or debug)
    # Construct a log message regardless to help user trace
    missed_output = [t for t, d in relevant_terms.items() if d not in translated_text]
    missed_cot = [t for t in relevant_terms.keys() if t not in cot_text] if cot_text else []
    
    log_msg = (
        f"[Glossary Check] {reason}. "
        f"Total Terms: {total}. "
        f"Output Hit: {output_hit_count} ({output_coverage:.1f}%), "
        f"CoT Hit: {cot_hit_count} ({cot_coverage:.1f}%). "
    )
    
    if not passed:
        log_msg += f"\n  Missed in Output: {', '.join(missed_output[:10])}..."
    
    # Print to stdout/log for debugging
    print(log_msg)

    return passed, output_coverage, cot_coverage, output_hit_count, total


