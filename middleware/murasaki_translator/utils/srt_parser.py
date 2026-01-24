"""
SRT 字幕解析器 (SRT Parser)
功能：解析和输出 SRT 字幕文件，保留时间轴信息
"""
import re
import os
from typing import List, Dict, Optional
from dataclasses import dataclass


@dataclass
class SRTEntry:
    """SRT 字幕条目"""
    index: int
    timestamp: str  # 时间轴（如 "00:00:08,120 --> 00:00:10,460"）
    text: str       # 字幕文本（可能多行）
    translated: Optional[str] = None


class SRTParser:
    """
    SRT 字幕解析器
    
    SRT 格式示例：
    1
    00:00:08,120 --> 00:00:10,460
    にゃにゃにゃ
    
    2
    00:00:14,000 --> 00:00:15,880
    えーこの部屋一人で使える
    """
    
    # 时间轴正则
    TIMESTAMP_PATTERN = re.compile(
        r"(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})"
    )

    @classmethod
    def parse(cls, content: str) -> List[SRTEntry]:
        """
        解析 SRT 内容
        :param content: SRT 文件内容
        :return: 字幕条目列表
        """
        entries = []
        
        # 按空行分割块
        chunks = re.split(r"\n{2,}", content.strip())
        
        for chunk in chunks:
            lines = [line.strip() for line in chunk.splitlines()]
            
            # 至少需要3行：序号、时间轴、文本
            if len(lines) < 3:
                continue
            
            # 第一行应该是数字序号
            if not lines[0].isdecimal():
                continue
            
            # 第二行应该匹配时间轴格式
            if not cls.TIMESTAMP_PATTERN.match(lines[1]):
                continue
            
            # 剩余行是字幕文本
            text = "\n".join(lines[2:])
            if text.strip():
                entries.append(SRTEntry(
                    index=int(lines[0]),
                    timestamp=lines[1],
                    text=text
                ))
        
        return entries

    @classmethod
    def parse_file(cls, file_path: str, encoding: str = "utf-8") -> List[SRTEntry]:
        """
        解析 SRT 文件
        :param file_path: 文件路径
        :param encoding: 文件编码
        :return: 字幕条目列表
        """
        with open(file_path, "r", encoding=encoding) as f:
            return cls.parse(f.read())

    @classmethod
    def format(cls, entries: List[SRTEntry], use_translated: bool = True) -> str:
        """
        格式化为 SRT 内容
        :param entries: 字幕条目列表
        :param use_translated: 是否使用翻译后的文本
        :return: SRT 格式字符串
        """
        result = []
        for entry in entries:
            text = entry.translated if use_translated and entry.translated else entry.text
            result.append(f"{entry.index}\n{entry.timestamp}\n{text}\n")
        return "\n".join(result)

    @classmethod
    def format_bilingual(cls, entries: List[SRTEntry]) -> str:
        """
        格式化为双语 SRT 内容（原文 + 译文）
        :param entries: 字幕条目列表
        :return: 双语 SRT 格式字符串
        """
        result = []
        for entry in entries:
            if entry.translated and entry.translated != entry.text:
                text = f"{entry.text}\n{entry.translated}"
            else:
                text = entry.text
            result.append(f"{entry.index}\n{entry.timestamp}\n{text}\n")
        return "\n".join(result)

    @classmethod
    def save(cls, entries: List[SRTEntry], output_path: str, 
             use_translated: bool = True, encoding: str = "utf-8") -> None:
        """
        保存 SRT 文件
        :param entries: 字幕条目列表
        :param output_path: 输出路径
        :param use_translated: 是否使用翻译后的文本
        :param encoding: 文件编码
        """
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        content = cls.format(entries, use_translated)
        with open(output_path, "w", encoding=encoding) as f:
            f.write(content)

    @classmethod
    def to_translation_lines(cls, entries: List[SRTEntry]) -> List[str]:
        """
        提取所有字幕文本用于翻译
        :return: 文本行列表
        """
        return [entry.text for entry in entries]

    @classmethod
    def apply_translations(cls, entries: List[SRTEntry], translations: List[str]) -> None:
        """
        将翻译结果应用到字幕条目
        :param entries: 字幕条目列表
        :param translations: 翻译结果列表
        """
        for i, entry in enumerate(entries):
            if i < len(translations):
                entry.translated = translations[i]
