"""
Translation Cache - 翻译缓存模块
按 block 为单位保存翻译结果，用于校对界面。
模型是长文本训练的，支持合并句子，所以按 block 存储和重翻。
"""

import json
import os
from typing import List, Dict, Optional
from dataclasses import dataclass, field


@dataclass
class CacheBlock:
    """翻译缓存块 - 对应一次模型调用"""
    index: int                  # block 索引 (0-indexed)
    src: str                    # 原文（可能多行）
    dst: str                    # 译文（可能多行，行数可能与原文不同）
    status: str = 'processed'   # 状态: none, processed, edited
    warnings: List[str] = None  # 警告列表
    cot: str = ''               # 思维链（调试用）
    
    def __post_init__(self):
        if self.warnings is None:
            self.warnings = []
    
    @property
    def src_lines(self) -> int:
        """原文行数"""
        return len([l for l in self.src.split('\n') if l.strip()])
    
    @property
    def dst_lines(self) -> int:
        """译文行数"""
        return len([l for l in self.dst.split('\n') if l.strip()])
    
    @property
    def src_chars(self) -> int:
        """原文字符数"""
        return len(self.src)
    
    @property
    def dst_chars(self) -> int:
        """译文字符数"""
        return len(self.dst)
    
    def to_dict(self) -> Dict:
        return {
            'index': self.index,
            'src': self.src,
            'dst': self.dst,
            'status': self.status,
            'warnings': self.warnings,
            'cot': self.cot,
            'srcLines': self.src_lines,
            'dstLines': self.dst_lines
        }
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'CacheBlock':
        return cls(
            index=data.get('index', 0),
            src=data.get('src', ''),
            dst=data.get('dst', ''),
            status=data.get('status', 'processed'),
            warnings=data.get('warnings', []),
            cot=data.get('cot', '')
        )


class TranslationCache:
    """翻译缓存管理器 - 按 block 为单位"""
    
    CACHE_SUFFIX = '.cache.json'
    
    def __init__(self, output_path: str, custom_cache_dir: Optional[str] = None, source_path: str = ""):
        self.output_path = output_path
        self.source_path = source_path
        
        if custom_cache_dir and os.path.isdir(custom_cache_dir):
            filename = os.path.basename(output_path) + self.CACHE_SUFFIX
            self.cache_path = os.path.join(custom_cache_dir, filename)
        else:
            self.cache_path = output_path + self.CACHE_SUFFIX
            
        self.blocks: List[CacheBlock] = []
        self.metadata: Dict = {}
    
    def add_block(self, index: int, src: str, dst: str, 
                  warnings: List[str] = None, cot: str = '') -> CacheBlock:
        """添加翻译 block"""
        block = CacheBlock(
            index=index,
            src=src,
            dst=dst,
            status='processed',
            warnings=warnings or [],
            cot=cot
        )
        self.blocks.append(block)
        return block
    
    def save(self, model_name: str = '', glossary_path: str = '', concurrency: int = 1) -> bool:
        """保存缓存到文件"""
        try:
            # 计算统计信息
            total_src_lines = sum(b.src_lines for b in self.blocks)
            total_dst_lines = sum(b.dst_lines for b in self.blocks)
            total_src_chars = sum(b.src_chars for b in self.blocks)
            total_dst_chars = sum(b.dst_chars for b in self.blocks)
            
            data = {
                'version': '2.0',  # block-based version
                'outputPath': self.output_path,
                'sourcePath': self.source_path,
                'modelName': model_name,
                'glossaryPath': glossary_path,
                'stats': {
                    'concurrency': concurrency, # Persist concurrency count
                    'blockCount': len(self.blocks),
                    'srcLines': total_src_lines,
                    'dstLines': total_dst_lines,
                    'srcChars': total_src_chars,
                    'dstChars': total_dst_chars
                },
                'blocks': [block.to_dict() for block in self.blocks]
            }
            with open(self.cache_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            print(f"[Cache] Failed to save: {e}")
            return False
    
    def load(self) -> bool:
        """从文件加载缓存"""
        if not os.path.exists(self.cache_path):
            return False
        try:
            with open(self.cache_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            self.metadata = data
            self.source_path = data.get('sourcePath', '')
            self.blocks = [CacheBlock.from_dict(b) for b in data.get('blocks', [])]
            return True
        except Exception as e:
            print(f"[Cache] Failed to load: {e}")
            return False
    
    def get_block(self, index: int) -> Optional[CacheBlock]:
        """根据索引获取 block"""
        for block in self.blocks:
            if block.index == index:
                return block
        return None
    
    def update_block(self, index: int, dst: str = None, status: str = None,
                     warnings: List[str] = None) -> bool:
        """更新 block"""
        block = self.get_block(index)
        if block is None:
            return False
        if dst is not None:
            block.dst = dst
            block.status = 'edited'  # 标记为已编辑
        if status is not None:
            block.status = status
        if warnings is not None:
            block.warnings = warnings
        return True
    
    def export_to_text(self) -> str:
        """导出为纯文本（按 block 顺序拼接译文）"""
        sorted_blocks = sorted(self.blocks, key=lambda x: x.index)
        return '\n'.join(block.dst for block in sorted_blocks)
    
    def get_stats(self) -> Dict:
        """获取统计信息"""
        return {
            'blockCount': len(self.blocks),
            'srcLines': sum(b.src_lines for b in self.blocks),
            'dstLines': sum(b.dst_lines for b in self.blocks),
            'srcChars': sum(b.src_chars for b in self.blocks),
            'dstChars': sum(b.dst_chars for b in self.blocks),
            'withWarnings': sum(1 for b in self.blocks if b.warnings),
            'edited': sum(1 for b in self.blocks if b.status == 'edited')
        }


# 便捷函数
def get_cache_path(output_path: str) -> str:
    """获取缓存文件路径"""
    return output_path + TranslationCache.CACHE_SUFFIX


def load_cache(output_path: str) -> Optional[TranslationCache]:
    """加载已有缓存"""
    cache = TranslationCache(output_path)
    if cache.load():
        return cache
    return None
