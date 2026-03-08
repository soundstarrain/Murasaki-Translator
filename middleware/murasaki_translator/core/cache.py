"""
Translation Cache - 翻译缓存模块
按 block 为单位保存翻译结果，用于校对界面。
模型是长文本训练的，支持合并句子，所以按 block 存储和重翻。
"""

import json
import os
import threading  # [修复] 并发安全
from typing import List, Dict, Optional
from dataclasses import dataclass, field


@dataclass
class CacheBlock:
    """翻译缓存块 - 对应一次模型调用"""
    index: int                  # block 索引 (0-indexed)
    src: str                    # 原文（可能多行）
    dst: str                    # 译文（可能多行，行数可能与原文不同）
    status: str = 'processed'   # 状态: none, processed, edited
    warnings: Optional[List[str]] = None  # 警告列表
    cot: str = ''               # 思维链（调试用）
    retry_history: Optional[List[Dict]] = None  # 重试历史（调试用）
    
    def __post_init__(self):
        if self.warnings is None:
            self.warnings = []
        if self.retry_history is None:
            self.retry_history = []
    
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
        result = {
            'index': self.index,
            'src': self.src,
            'dst': self.dst,
            'status': self.status,
            'warnings': self.warnings,
            'cot': self.cot,
            'srcLines': self.src_lines,
            'dstLines': self.dst_lines
        }
        # Only include retry_history if it has data (saves space)
        if self.retry_history:
            result['retryHistory'] = self.retry_history
        return result
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'CacheBlock':
        return cls(
            index=data.get('index', 0),
            src=data.get('src', ''),
            dst=data.get('dst', ''),
            status=data.get('status', 'processed'),
            warnings=data.get('warnings', []),
            cot=data.get('cot', ''),
            retry_history=data.get('retryHistory', [])
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
        # [性能优化] 使用字典索引避免 O(N) 遍历查找
        self._index_map: Dict[int, int] = {}  # {block_index: position_in_blocks_list}
        # [并发安全] 线程锁，保护 blocks 和 _index_map 的并发访问
        self._lock = threading.Lock()
    
    def add_block(self, index: int, src: str, dst: str,
                  warnings: Optional[List[str]] = None, cot: str = '', retry_history: Optional[List[Dict]] = None) -> CacheBlock:
        """添加翻译 block，如果索引已存在则替换（线程安全，O(1)查找）"""
        block = CacheBlock(
            index=index,
            src=src,
            dst=dst,
            status='processed',
            warnings=warnings or [],
            cot=cot,
            retry_history=retry_history or []
        )
        # [并发安全] 使用锁保护 blocks 和 _index_map 的并发修改
        with self._lock:
            # 使用字典索引进行 O(1) 查找
            if index in self._index_map:
                # 已存在，替换
                pos = self._index_map[index]
                self.blocks[pos] = block
            else:
                # 不存在，追加
                self.blocks.append(block)
                self._index_map[index] = len(self.blocks) - 1
        return block
    
    def save(
        self,
        model_name: str = '',
        glossary_path: str = '',
        concurrency: int = 1,
        engine_mode: str = '',
        chunk_type: str = '',
        pipeline_id: str = '',
    ) -> bool:
        """保存缓存到文件（线程安全）"""
        try:
            # [并发安全] 加锁保护读取和保存操作
            with self._lock:
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
                normalized_engine_mode = str(engine_mode or '').strip().lower()
                if normalized_engine_mode in {'v1', 'v2'}:
                    data['engineMode'] = normalized_engine_mode

                normalized_chunk_type = str(chunk_type or '').strip().lower()
                if normalized_chunk_type in {'line', 'chunk', 'block'}:
                    data['chunkType'] = normalized_chunk_type

                normalized_pipeline_id = str(pipeline_id or '').strip()
                if normalized_pipeline_id:
                    data['pipelineId'] = normalized_pipeline_id
            # 在锁外进行文件 I/O，避免阻塞其他线程
            with open(self.cache_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            print(f"[Cache] Failed to save: {e}")
            return False
    
    def load(self) -> bool:
        """从文件加载缓存（线程安全）"""
        if not os.path.exists(self.cache_path):
            return False
        try:
            with open(self.cache_path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            # [修复] 先在锁外构建所有新数据，减少锁持有时间
            new_metadata = data
            new_source_path = data.get('sourcePath', '')
            new_blocks = [CacheBlock.from_dict(b) for b in data.get('blocks', [])]
            new_index_map = {b.index: i for i, b in enumerate(new_blocks)}

            # [并发安全] 在锁内一次性替换所有状态，确保原子性
            # 避免状态不一致：metadata、source_path、blocks、_index_map 必须同时更新
            with self._lock:
                self.metadata = new_metadata
                self.source_path = new_source_path
                self.blocks = new_blocks
                self._index_map = new_index_map
            return True
        except Exception as e:
            print(f"[Cache] Failed to load: {e}")
            # [修复] 加载失败时，不清空现有的 blocks，保留已有数据
            # 这样即使缓存文件损坏，已加载的块也不会丢失
            return False
    
    def get_block(self, index: int) -> Optional[CacheBlock]:
        """根据索引获取 block（O(1)查找，线程安全）"""
        # [并发安全] 使用锁保护读取操作
        with self._lock:
            if index in self._index_map:
                pos = self._index_map[index]
                return self.blocks[pos]
        return None
    
    def update_block(self, index: int, dst: str = None, status: str = None,
                     warnings: Optional[List[str]] = None) -> bool:
        """更新 block（线程安全，避免死锁）"""
        # [并发安全] 使用锁保护 block 的修改
        # [修复] 不能在锁内调用 get_block（会导致死锁），直接在锁内查找
        with self._lock:
            # 直接在锁内查找，避免死锁
            if index in self._index_map:
                pos = self._index_map[index]
                block = self.blocks[pos]
                if dst is not None:
                    block.dst = dst
                    block.status = 'edited'  # 标记为已编辑
                if status is not None:
                    block.status = status
                if warnings is not None:
                    block.warnings = warnings
                return True
        return False
    
    def export_to_text(self) -> str:
        """导出为纯文本（按 block 顺序拼接译文，线程安全）"""
        # [并发安全] 加锁保护读取操作
        with self._lock:
            sorted_blocks = sorted(self.blocks, key=lambda x: x.index)
            return '\n'.join(block.dst for block in sorted_blocks)

    def get_stats(self) -> Dict:
        """获取统计信息（线程安全）"""
        # [并发安全] 加锁保护读取操作
        with self._lock:
            return {
                'blockCount': len(self.blocks),
                'srcLines': sum(b.src_lines for b in self.blocks),
                'dstLines': sum(b.dst_lines for b in self.blocks),
                'srcChars': sum(b.src_chars for b in self.blocks),
                'dstChars': sum(b.dst_chars for b in self.blocks),
                'withWarnings': sum(1 for b in self.blocks if b.warnings),
                'edited': sum(1 for b in self.blocks if b.status == 'edited')
            }

    def clear(self) -> None:
        """清空所有缓存数据（线程安全）"""
        """[封装] 提供清空方法，避免外部直接操作内部结构"""
        with self._lock:
            self.blocks = []
            self._index_map = {}


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
