"""Murasaki Translator - Production Translation Engine"""
import argparse
import sys
import os
import time
import json
import re
import subprocess
import threading
import shutil  # [修复] 用于备份损坏的缓存文件
from contextlib import nullcontext
from typing import List, Dict, Optional
from concurrent.futures import ThreadPoolExecutor, Future, as_completed

from pathlib import Path
import logging

# Module-level logger for all functions (fixes NameError in nested functions)
logger = logging.getLogger("murasaki")

# Add middleware directory to sys.path for package imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Force UTF-8 for stdout/stderr (Windows console fix)
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

# Global Lock for thread-safe printing to stdout
stdout_lock = threading.Lock()

def safe_print_json(prefix, data):
    """Thread-safe JSON printing to stdout."""
    with stdout_lock:
        sys.stdout.write(f"\n{prefix}:{json.dumps(data, ensure_ascii=False)}\n")
        sys.stdout.flush()

def safe_print(msg):
    """Thread-safe generic printing."""
    with stdout_lock:
        print(msg)

def _estimate_cot_ratio_for_ctx(ctx_value: int) -> float:
    if ctx_value >= 8192:
        return 3.2
    if ctx_value <= 1024:
        return 3.5
    slope = (3.2 - 3.5) / (8192 - 1024)
    return 3.5 + slope * (ctx_value - 1024)

def _estimate_max_chunk_chars_for_ctx(ctx_value: int) -> int:
    cot_ratio = _estimate_cot_ratio_for_ctx(ctx_value)
    theoretical = round(((ctx_value * 0.9 - 500) / cot_ratio) * 1.3)
    return max(128, theoretical)

def _estimate_ctx_for_chunk_limit(chunk_chars: int) -> int:
    target = max(128, int(chunk_chars))
    for ctx_candidate in range(1024, 20001):
        if _estimate_max_chunk_chars_for_ctx(ctx_candidate) >= target:
            return ctx_candidate
    return 20000


from murasaki_translator.core.chunker import Chunker, TextBlock
from murasaki_translator.core.prompt import PromptBuilder
from murasaki_translator.core.engine import InferenceEngine
from murasaki_translator.core.parser import ResponseParser
from murasaki_translator.core.quality_checker import QualityChecker, format_warnings_for_log, calculate_glossary_coverage
from murasaki_translator.core.text_protector import TextProtector  # [Experimental] 占位符保护
from murasaki_translator.core.cache import TranslationCache  # 翻译缓存用于校对
from rule_processor import RuleProcessor
from murasaki_translator.utils.monitor import HardwareMonitor
from murasaki_translator.utils.line_aligner import LineAligner
from murasaki_translator.fixer import NumberFixer, Normalizer, PunctuationFixer, KanaFixer, RubyCleaner
from murasaki_translator.documents import DocumentFactory
from murasaki_translator.utils.alignment_handler import AlignmentHandler

def load_glossary(path: Optional[str]) -> Dict[str, str]:
    """
    Robustly load glossary from JSON file.
    Supports: 
    - Murasaki Dict: {"jp": "zh"}
    - 通用对象列表: [{"src": "jp", "dst": "zh"}]
    """
    if not path or not os.path.exists(path) or not path.lower().endswith('.json'):
        return {}
    
    try:
        with open(path, 'r', encoding='utf-8-sig') as f:
            data = json.load(f)
        
        # Case 1: Standard Dict format {"src": "dst"}
        if isinstance(data, dict):
            return {str(k): str(v) for k, v in data.items() if k and v}
        
        # Case 2: List of objects
        elif isinstance(data, list):
            glossary = {}
            for idx, entry in enumerate(data):
                if not isinstance(entry, dict): continue
                
                # Heuristic search for source/target keys
                src = entry.get('src') or entry.get('jp') or entry.get('original')
                dst = entry.get('dst') or entry.get('zh') or entry.get('translation')
                
                if src and dst:
                    s, d = str(src), str(dst)
                    if s in glossary:
                         print(f"[Debug] Overwriting glossary entry: {s} (Old: {glossary[s]}, New: {d})")
                    glossary[s] = d
            
            print(f"[Init] Detected List format JSON. Parsed {len(glossary)} valid entries.")
            return glossary
            
        return {}
            
    except Exception as e:
        print(f"[Warning] Failed to load glossary {os.path.basename(path)}: {e}")
        return {}

def load_rules(path: Optional[str]) -> List[Dict]:
    """Load rules from JSON file."""
    if not path or not os.path.exists(path):
        return []
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"[Warning] Failed to load rules: {e}")
        return []


def load_existing_output(output_path: str) -> tuple:
    """
    加载已有输出文件，用于增量翻译。
    返回 (已翻译行数, 已翻译内容列表, 是否有效)
    """
    if not os.path.exists(output_path):
        return 0, [], False
    
    try:
        with open(output_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # 检查是否包含 summary（完整翻译的标志）
        if '=' * 20 in content and 'Translation Summary' in content:
            # 文件已完成，不需要续翻
            return -1, [], False
        
        # 分割为行，保留物理行结构（不进行 strip 过滤，也不过滤空行）
        lines = content.split('\n')
        # 如果文件以换行符结尾，内容中的最后一个空字符串是 split 产生的噪音，移除它
        if content.endswith('\n'):
            lines = lines[:-1]
            
        return len(lines), lines, True
    except Exception as e:
        print(f"[Warning] Failed to load existing output: {e}")
        return 0, [], False


def get_missed_terms(source_text: str, translated_text: str, glossary: Dict[str, str]) -> List[tuple]:
    """
    获取原文中出现但译文中未正确翻译的术语列表。
    返回 [(原文术语, 目标译文), ...]
    """
    missed = []
    for src_term, dst_term in glossary.items():
        # 排除单字术语
        if len(src_term) > 1 and src_term in source_text:
            if dst_term not in translated_text:
                missed.append((src_term, dst_term))
    return missed


def build_retry_feedback(missed_terms: List[tuple], coverage: float) -> str:
    """
    构建重试时注入的反馈文本，用于提醒模型注意漏掉的术语。
    """
    if not missed_terms:
        return ""
    
    # 构建术语列表
    terms_str = "、".join([f"「{src}」→「{dst}」" for src, dst in missed_terms[:5]])
    if len(missed_terms) > 5:
        terms_str += f" 等 {len(missed_terms)} 项"
    
    feedback = f"\n\n【系统提示】上一轮翻译中以下术语未正确应用：{terms_str}。请在本次翻译中严格使用术语表中的标准译法，不要擅自简化或省略。"
    
    return feedback


def _parse_protect_pattern_lines(lines: List[str]) -> tuple:
    """
    Parse protection pattern lines.
    - Ignore empty lines and comments (# or //)
    - Prefix '!' to remove a base pattern
    - Prefix '+' to force add (same as plain)
    """
    additions: List[str] = []
    removals: List[str] = []
    for raw in lines:
        line = (raw or "").strip()
        if not line:
            continue
        if line.startswith("#") or line.startswith("//"):
            continue
        if line.startswith("!"):
            pat = line[1:].strip()
            if pat:
                removals.append(pat)
            continue
        if line.startswith("+"):
            line = line[1:].strip()
        if line:
            additions.append(line)
    return additions, removals


def _parse_protect_pattern_payload(raw) -> List[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(p) for p in raw if str(p).strip()]
    if isinstance(raw, str):
        stripped = raw.strip()
        if not stripped:
            return []
        try:
            parsed = json.loads(stripped)
            if isinstance(parsed, list):
                return [str(p) for p in parsed if str(p).strip()]
        except Exception:
            pass
        return [line for line in stripped.splitlines() if line.strip()]
    return []


def _collect_protect_rule_lines(rules: List[Dict]) -> tuple:
    enabled = False
    lines: List[str] = []
    for rule in rules or []:
        if not rule or not rule.get("active", True):
            continue
        if rule.get("type") == "protect" or rule.get("pattern") == "text_protect":
            enabled = True
            options = rule.get("options") if isinstance(rule.get("options"), dict) else {}
            raw = options.get("patterns")
            lines.extend(_parse_protect_pattern_payload(raw))
    return enabled, lines


def _collect_legacy_protect_lines(post_rules: List[Dict]) -> List[str]:
    lines: List[str] = []
    for rule in post_rules or []:
        if not rule or not rule.get("active", True):
            continue
        if rule.get("pattern") == "restore_protection":
            options = rule.get("options") if isinstance(rule.get("options"), dict) else {}
            raw = options.get("customPattern")
            lines.extend(_parse_protect_pattern_payload(raw))
    return lines


def _merge_protect_patterns(base: Optional[List[str]], additions: List[str], removals: List[str]) -> List[str]:
    merged = list(base) if base else []
    for pat in additions:
        if pat and pat not in merged:
            merged.append(pat)
    if removals:
        merged = [p for p in merged if p not in removals]
    return merged


def _allow_text_protect(input_path: Optional[str], args) -> bool:
    if getattr(args, "single_block", None) and not input_path:
        return True
    if getattr(args, "alignment_mode", False):
        if not input_path:
            return True
        return os.path.splitext(input_path)[1].lower() == ".txt"
    if not input_path:
        return False
    ext = os.path.splitext(input_path)[1].lower()
    return ext == ".txt"


def _normalize_anchor_stream(text: str) -> str:
    """Normalize potentially mangled @id/@end anchors (full-width, spaces, newlines)."""
    if not text:
        return text

    def _normalize_digits(s: str) -> str:
        return s.translate(str.maketrans("０１２３４５６７８９", "0123456789"))

    def _fix_id(m: re.Match) -> str:
        return f"@id={_normalize_digits(m.group(1))}@"

    def _fix_end(m: re.Match) -> str:
        return f"@end={_normalize_digits(m.group(1))}@"

    text = re.sub(
        r"[@＠]\s*[iｉIＩ]\s*[dｄDＤ]\s*[=＝]\s*([0-9０-９]+)\s*[@＠]",
        _fix_id,
        text,
    )
    text = re.sub(
        r"[@＠]\s*[eｅEＥ]\s*[nｎNＮ]\s*[dｄDＤ]\s*[=＝]\s*([0-9０-９]+)\s*[@＠]",
        _fix_end,
        text,
    )
    return text


def _detect_anchor_missing(original_src_text: str, output_text: str, args) -> tuple:
    """
    Detect missing core anchors for structured formats.
    Returns (missing: bool, meta: dict).
    """
    if not getattr(args, "anchor_check", False):
        return False, {}

    file_path = getattr(args, "file", "") or ""
    ext = os.path.splitext(file_path)[1].lower()

    # Alignment mode: @id=ID@ ... @id=ID@ (same marker twice)
    if getattr(args, "alignment_mode", False):
        src_norm = _normalize_anchor_stream(original_src_text)
        out_norm = _normalize_anchor_stream(output_text)
        src_ids = re.findall(r"@id=(\d+)@", src_norm)
        if not src_ids:
            return False, {}
        out_ids = re.findall(r"@id=(\d+)@", out_norm)
        counts = {}
        for uid in out_ids:
            counts[uid] = counts.get(uid, 0) + 1
        missing = [uid for uid in set(src_ids) if counts.get(uid, 0) < 2]
        if missing:
            return True, {"format": "alignment", "missing_count": len(missing)}
        return False, {}

    # EPUB: require both @id= and @end= anchors for each id in the block
    if ext == ".epub":
        src_norm = _normalize_anchor_stream(original_src_text)
        out_norm = _normalize_anchor_stream(output_text)
        src_ids = re.findall(r"@id=(\d+)@", src_norm)
        if not src_ids:
            return False, {}
        out_id_set = set(re.findall(r"@id=(\d+)@", out_norm))
        out_end_set = set(re.findall(r"@end=(\d+)@", out_norm))
        missing = [
            uid for uid in set(src_ids)
            if uid not in out_id_set or uid not in out_end_set
        ]
        if missing:
            return True, {"format": "epub", "missing_count": len(missing)}
        return False, {}

    # Subtitles (SRT/ASS/SSA): require timecode lines to remain
    if ext in (".srt", ".ass", ".ssa"):
        timecode_re = re.compile(
            r"\d{2}:\d{2}:\d{2}[,\.]\d{1,3}\s*[-=]+>\s*\d{2}:\d{2}:\d{2}[,\.]\d{1,3}"
        )
        src_count = len(timecode_re.findall(original_src_text))
        if src_count == 0:
            return False, {}
        dst_count = len(timecode_re.findall(output_text))
        if dst_count < src_count:
            return True, {"format": "subtitle", "src_count": src_count, "dst_count": dst_count}

    return False, {}


def translate_block_with_retry(
    block_idx: int,
    original_src_text: str,   # Needed for glossary checks and post-processing
    processed_src_text: str,  # Actual text to send to model (already normalized/protected)
    args,
    engine,
    prompt_builder,
    response_parser,
    post_processor,
    glossary,
    stdout_lock,
    strict_mode: bool,
    protector=None
):
    """
    Unified A/B/C/D retry strategy for a single block.
    Used by both batch translation and single-block re-translation.
    """
    # Build Initial Prompt
    messages = prompt_builder.build_messages(
        processed_src_text, 
        enable_cot=args.debug,
        preset=args.preset
    )
    
    global_attempts = 0
    glossary_attempts = 0
    retry_reason = None
    last_missed_terms = []
    last_coverage = 0.0
    best_result = None
    retry_history = []  # Track all retry attempts for debugging
    anchor_attempts = 0
    structural_retry_happened = False
    anchor_retry_budget = 0
    if getattr(args, "anchor_check", False):
        try:
            anchor_retry_budget = max(0, int(getattr(args, "anchor_check_retries", 0)))
        except Exception:
            anchor_retry_budget = 0
    
    final_output = None

    total_retry_budget = max(0, args.max_retries, args.coverage_retries, anchor_retry_budget)

    while True:
        attempt = global_attempts + glossary_attempts + anchor_attempts
        if attempt > total_retry_budget:
            break

        current_temp = args.temperature
        current_rep_base = args.rep_penalty_base
        
        if retry_reason in ('line_check', 'strict_line_check', 'anchor_missing'):
            retry_steps = max(1, global_attempts + anchor_attempts)
            current_temp = min(args.temperature + (retry_steps * args.retry_temp_boost), 1.2)
        elif retry_reason == 'glossary':
            current_temp = max(args.temperature - (glossary_attempts * args.retry_temp_boost), 0.3)

        messages_for_attempt = messages
        if attempt > 0 and args.retry_prompt_feedback and glossary and last_missed_terms and retry_reason == 'glossary':
            feedback = build_retry_feedback(last_missed_terms, last_coverage)
            if feedback:
                messages_for_attempt = messages.copy()
                for j in range(len(messages_for_attempt) - 1, -1, -1):
                    if messages_for_attempt[j].get("role") == "user":
                        messages_for_attempt[j] = {
                            "role": "user",
                            "content": messages_for_attempt[j]["content"] + feedback
                        }
                        break
        
        accumulated_output = ""
        def on_stream_chunk(chunk):
            nonlocal accumulated_output
            accumulated_output += chunk
            if "<think>" in chunk or "</think>" in chunk or (accumulated_output.strip().startswith("<think>") and not "</think>" in accumulated_output):
                try:
                    with stdout_lock:
                        sys.stdout.write(f"\nJSON_THINK_DELTA:{json.dumps(chunk, ensure_ascii=False)}\n")
                        sys.stdout.flush()
                except: pass

        full_response_text, block_usage = engine.chat_completion(
            messages=messages_for_attempt,
            temperature=current_temp,
            stream=True,
            stream_callback=on_stream_chunk,
            rep_base=current_rep_base,
            rep_max=args.rep_penalty_max,
            rep_step=args.rep_penalty_step,
            block_id=block_idx + 1
        )
        
        raw_output = full_response_text
        parsed_lines, cot_content = response_parser.parse(raw_output or "", expected_count=0)
        has_content = parsed_lines and any(line.strip() for line in parsed_lines)

        if not has_content:
            if global_attempts < args.max_retries:
                global_attempts += 1
                retry_reason = 'empty'
                structural_retry_happened = True
                retry_history.append({'attempt': global_attempts, 'type': 'empty', 'raw_output': raw_output or ''})
                safe_print_json("JSON_RETRY", {'block': block_idx + 1, 'attempt': global_attempts, 'type': 'empty', 'temp': round(current_temp, 2)})
                continue
            else: break

        src_line_count = len([l for l in original_src_text.splitlines() if l.strip()])
        dst_line_count = len([l for l in parsed_lines if l.strip()])
        diff = abs(dst_line_count - src_line_count)
        pct_diff = diff / max(1, src_line_count)
        
        is_invalid_lines = False
        error_type = 'line_check'
        if strict_mode and diff > 0:
            is_invalid_lines = True
            error_type = 'strict_line_check'
        elif args.line_check and (diff > args.line_tolerance_abs or pct_diff > args.line_tolerance_pct):
            is_invalid_lines = True
            error_type = 'line_check'

        if is_invalid_lines:
            if global_attempts < args.max_retries:
                global_attempts += 1
                retry_reason = error_type
                structural_retry_happened = True
                retry_history.append({'attempt': global_attempts, 'type': error_type, 'src_lines': src_line_count, 'dst_lines': dst_line_count, 'raw_output': raw_output or ''})
                safe_print_json("JSON_RETRY", {'block': block_idx + 1, 'attempt': global_attempts, 'type': error_type, 'src_lines': src_line_count, 'dst_lines': dst_line_count, 'temp': round(current_temp, 2)})
                continue
            else:
                # No retry budget left: keep current output and skip lower-priority retries
                structural_retry_happened = True
        
        # Core Anchor Check (EPUB / Subtitle / Alignment)
        anchor_check_text = "\n".join(parsed_lines)
        if protector:
            try:
                anchor_check_text = protector.restore(anchor_check_text)
            except Exception:
                pass
        anchor_missing, anchor_meta = _detect_anchor_missing(
            original_src_text,
            anchor_check_text,
            args
        )
        if anchor_missing:
            if anchor_attempts < anchor_retry_budget:
                anchor_attempts += 1
                retry_reason = 'anchor_missing'
                structural_retry_happened = True
                retry_payload = {
                    'block': block_idx + 1,
                    'attempt': anchor_attempts,
                    'type': 'anchor_missing',
                    'temp': round(current_temp, 2),
                }
                retry_payload.update(anchor_meta or {})
                retry_history.append({**retry_payload, 'raw_output': raw_output or ''})
                safe_print_json("JSON_RETRY", retry_payload)
                continue
            # No retry budget left: keep current output and skip lower-priority retries
            structural_retry_happened = True

        if glossary and args.output_hit_threshold > 0 and not structural_retry_happened:
            translated_text = '\n'.join(parsed_lines)
            passed, coverage, cot_coverage, hit, total = calculate_glossary_coverage(
                original_src_text, translated_text, glossary, cot_content,
                args.output_hit_threshold, args.cot_coverage_threshold
            )
            last_coverage = coverage
            last_missed_terms = get_missed_terms(original_src_text, translated_text, glossary)
            
            if best_result is None or coverage > best_result[3]:
                best_result = (parsed_lines.copy(), cot_content, raw_output, coverage, block_usage)

            if total > 0 and not passed:
                if glossary_attempts < args.coverage_retries:
                    glossary_attempts += 1
                    retry_reason = 'glossary'
                    retry_history.append({'attempt': glossary_attempts, 'type': 'glossary', 'coverage': round(coverage, 1), 'missed_count': len(last_missed_terms)})
                    safe_print_json("JSON_RETRY", {
                        'block': block_idx + 1, 'attempt': glossary_attempts, 'type': 'glossary',
                        'coverage': round(coverage, 1), 'temp': round(current_temp, 2),
                        'missed_count': len(last_missed_terms)
                    })
                    continue
                elif best_result and best_result[3] > coverage:
                    parsed_lines, cot_content, raw_output, _, block_usage = best_result
        
        final_output = {
            "parsed_lines": parsed_lines,
            "cot": cot_content,
            "raw": raw_output,
            "usage": block_usage
        }
        break

    if final_output is None:
        if best_result:
            parsed_lines, cot_content, raw_output, _, block_usage = best_result
        else:
            parsed_lines = ["[翻译失败]"] + original_src_text.split('\n')
            cot_content, raw_output, block_usage = "", "", {}
        final_output = {"parsed_lines": parsed_lines, "cot": cot_content, "raw": raw_output, "usage": block_usage}

    base_text = '\n'.join(final_output["parsed_lines"])
    processed_text = post_processor.process(base_text, src_text=original_src_text, protector=protector, strict_line_count=strict_mode)
    
    warnings = []
    try:
        qc = QualityChecker(glossary=glossary)
        warnings = qc.check_output(
            [l for l in original_src_text.split('\n') if l.strip()], 
            [l for l in processed_text.split('\n') if l.strip()], 
            source_lang="ja"
        )
    except Exception as e:
        logger.debug(f"[QualityChecker] Check failed: {e}")

    return {
        "success": True,
        "block_idx": block_idx,
        "src_text": original_src_text,
        "out_text": processed_text,
        "preview_text": processed_text,
        "cot": final_output["cot"],
        "raw_output": final_output["raw"],
        "warnings": warnings,
        "lines_count": len([l for l in processed_text.splitlines() if l.strip()]),
        "chars_count": len(original_src_text),
        "cot_chars": len(final_output["cot"]),
        "usage": final_output["usage"],
        "protector_stats": protector.get_stats() if protector else None,
        "retry_history": retry_history  # For debugging: all retry attempts
    }


def calculate_skip_blocks(blocks, existing_lines: int, is_doc_mode: bool = False) -> int:
    """
    根据已翻译行数计算应该跳过的块数。
    采用保守策略：只跳过完全匹配的块。
    """
    if existing_lines <= 0:
        return 0
    
    cumulative_lines = 0
    for i, block in enumerate(blocks):
        # 估算这个块的应有输出行数（与输入行数相同）
        block_lines = block.prompt_text.count('\n') + 1
        
        # doc 模式下，每个块输出后会多加一个空行
        physical_lines = block_lines + 1 if is_doc_mode else block_lines
        
        # 如果当前块全部加入后超过了已有行数，说明此块不完整或未开始
        if cumulative_lines + physical_lines > existing_lines:
            return i
            
        cumulative_lines += physical_lines
    
    return len(blocks)


def get_gpu_name():
    """跨平台获取 GPU 名称"""
    import sys as _sys
    
    try:
        if _sys.platform == 'darwin':
            # macOS: 使用 system_profiler
            try:
                import json as _json
                result = subprocess.run(
                    ['system_profiler', 'SPDisplaysDataType', '-json'],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                if result.returncode == 0:
                    data = _json.loads(result.stdout)
                    displays = data.get('SPDisplaysDataType', [])
                    for display in displays:
                        name = display.get('sppci_model', '')
                        if name:
                            return name
            except Exception:
                pass
            return "Apple GPU (Metal)"
        
        elif _sys.platform == 'win32':
            # Windows: 优先 nvidia-smi，回退 wmic
            try:
                result = subprocess.check_output(
                    "nvidia-smi -L", 
                    shell=True, 
                    stderr=subprocess.STDOUT
                ).decode('gb18030', errors='ignore')
                
                names = []
                for line in result.strip().split('\n'):
                    if ":" in line and "GPU" in line:
                        parts = line.split(":")
                        if len(parts) >= 2:
                            name_part = parts[1].strip()
                            if "(" in name_part:
                                name_part = name_part.split("(")[0].strip()
                            names.append(name_part)
                if names:
                    return " & ".join(names)
            except Exception:
                pass
            
            # 回退到 wmic
            try:
                result = subprocess.run(
                    ['wmic', 'path', 'win32_VideoController', 'get', 'Name', '/format:csv'],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                if result.returncode == 0:
                    lines = [l.strip() for l in result.stdout.strip().split('\n') if l.strip() and 'Node' not in l]
                    for line in lines:
                        parts = line.split(',')
                        if len(parts) >= 2:
                            name = parts[-1].strip()
                            if name and 'Microsoft' not in name and 'Basic' not in name:
                                return name
            except Exception:
                pass
            return "Unknown GPU (Windows)"
        
        else:
            # Linux: 优先 nvidia-smi，回退 lspci
            try:
                result = subprocess.run(
                    ['nvidia-smi', '--query-gpu=name', '--format=csv,noheader'],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                if result.returncode == 0:
                    return result.stdout.strip().split('\n')[0]
            except Exception:
                pass
            
            # 回退到 lspci
            try:
                result = subprocess.run(['lspci'], capture_output=True, text=True, timeout=5)
                if result.returncode == 0:
                    for line in result.stdout.split('\n'):
                        if 'VGA' in line or '3D' in line:
                            return line.split(':')[-1].strip()
            except Exception:
                pass
            return "Unknown GPU (Linux)"
    
    except Exception as e:
        return f"Unknown / CPU (Error: {str(e)})"

def format_model_info(model_path: str):
    filename = os.path.basename(model_path)
    
    # Custom Override for Murasaki model
    display_name = filename
    params = "Unknown"
    quant = "Unknown"
    
    if "Murasaki" in filename or "ACGN" in filename or "Step150" in filename:
        display_name = "Murasaki-8B-v0.1"
    
    # Extract details from filename (standard GGUF naming convention: Name-Size-Quant.gguf)
    lower_name = filename.lower()
    
    # Rough parsing
    if "8b" in lower_name: params = "8B"
    elif "72b" in lower_name: params = "72B"
    
    if "q4_k_m" in lower_name: quant = "Q4_K_M"
    elif "q8_0" in lower_name: quant = "Q8_0"
    elif "fp16" in lower_name: quant = "FP16"
    
    return display_name, params, quant


def translate_single_block(args):
    """
    单块翻译模式 - 用于校对界面的重翻功能
    直接翻译 args.single_block 中的文本，支持文本保护，输出 JSON 格式结果
    """
    middleware_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    # Initialize Engine
    engine = InferenceEngine(
        server_path=args.server,
        model_path=args.model,
        n_gpu_layers=args.gpu_layers,
        n_ctx=args.ctx,
        no_spawn=getattr(args, 'no_server_spawn', False),
        flash_attn=getattr(args, 'flash_attn', False),
        kv_cache_type=getattr(args, 'kv_cache_type', "f16"),
        use_large_batch=getattr(args, 'use_large_batch', False),
        batch_size=getattr(args, 'batch_size', None),
        seed=getattr(args, 'seed', None)
    )
    
    # Load Glossary
    glossary = load_glossary(args.glossary)
    
    # Load Rules (Optional)
    pre_rules = load_rules(args.rules_pre) if hasattr(args, 'rules_pre') and args.rules_pre else []
    post_rules = load_rules(args.rules_post) if hasattr(args, 'rules_post') and args.rules_post else []

    protect_rule_enabled, protect_rule_lines = _collect_protect_rule_lines(pre_rules)
    legacy_protect_lines = _collect_legacy_protect_lines(post_rules)
    input_path = getattr(args, 'file', '') or ""
    text_protect_allowed = _allow_text_protect(input_path, args)
    if text_protect_allowed:
        if protect_rule_enabled and not args.text_protect:
            print("[Auto-Config] Pre-rules text protection enabled.")
            args.text_protect = True
        if legacy_protect_lines and not args.text_protect:
            print("[Auto-Config] Legacy protection rule detected. Enabling TextProtector.")
            args.text_protect = True
        if args.protect_patterns and not args.text_protect:
            print("[Auto-Config] protect_patterns provided. Enabling TextProtector.")
            args.text_protect = True
    else:
        if args.text_protect or protect_rule_enabled or legacy_protect_lines or args.protect_patterns:
            print("[TextProtect] Disabled for non-txt input.")
        args.text_protect = False
        protect_rule_lines = []
        legacy_protect_lines = []

    post_rules = [r for r in post_rules if r.get('pattern') != 'restore_protection']
    if text_protect_allowed and args.text_protect:
        post_rules.append({"type": "format", "pattern": "restore_protection", "active": True})

    custom_protector_patterns = None
    if text_protect_allowed:
        if getattr(args, 'file', '').lower().endswith(('.srt', '.ass', '.ssa')):
            custom_protector_patterns = TextProtector.SUBTITLE_PATTERNS
        elif getattr(args, 'file', '').lower().endswith('.epub'):
            custom_protector_patterns = [r'@id=\d+@', r'@end=\d+@', r'<[^>]+>']
        elif args.alignment_mode:
            anchor_patterns = [r'@id=\d+@', r'@end=\d+@']
            custom_protector_patterns = _merge_protect_patterns(
                TextProtector.DEFAULT_PATTERNS,
                anchor_patterns,
                []
            )

        additions: List[str] = []
        removals: List[str] = []
        if protect_rule_lines:
            add, rem = _parse_protect_pattern_lines(protect_rule_lines)
            additions.extend(add)
            removals.extend(rem)
        if legacy_protect_lines:
            add, rem = _parse_protect_pattern_lines(legacy_protect_lines)
            additions.extend(add)
            removals.extend(rem)
        if args.protect_patterns and os.path.exists(args.protect_patterns):
            try:
                raw_text = ""
                with open(args.protect_patterns, 'r', encoding='utf-8') as f:
                    raw_text = f.read()
                file_lines = _parse_protect_pattern_payload(raw_text)
                add, rem = _parse_protect_pattern_lines(file_lines)
                additions.extend(add)
                removals.extend(rem)
            except Exception as e:
                print(f"[Warning] Failed to load protection patterns: {e}")

        if additions or removals:
            base_patterns = (
                custom_protector_patterns
                if custom_protector_patterns
                else TextProtector.DEFAULT_PATTERNS
            )
            custom_protector_patterns = _merge_protect_patterns(base_patterns, additions, removals)

    pre_processor = RuleProcessor(pre_rules)
    post_processor = RuleProcessor(post_rules)
    prompt_builder = PromptBuilder(glossary)
    parser = ResponseParser()
    
    # Initialize Text Protector
    protector = None
    if text_protect_allowed and getattr(args, 'text_protect', False):
         protector = TextProtector(patterns=custom_protector_patterns)
    
    
    # 针对 SRT/ASS 的特殊工程化处理 (Rule Melting)
    is_sub = getattr(args, 'file', '').lower().endswith(('.srt', '.ass', '.ssa')) if args.file else False
    
    # Strict mode logic for retranslate:
    # - all: Force strict line count
    # - subs: Force for subtitles and epub (epub usually isn't retranslated this way but for completeness)
    # - off: Disable
    strict_policy = getattr(args, 'strict_mode', 'subs')
    enforce_strict_alignment = False
    if strict_policy == "all":
        enforce_strict_alignment = True
    elif strict_policy == "subs":
        # Check by file extension
        ext = os.path.splitext(args.file)[1].lower() if args.file else ""
        enforce_strict_alignment = ext in ['.srt', '.ass', '.ssa', '.epub']
        
    if is_sub:
        # Rule melting for retranslate
        melt_patterns = ['ensure_single_newline', 'ensure_double_newline', 'clean_empty_lines', 'merge_short_lines']
        pre_processor.rules = [r for r in pre_rules if r.get('pattern') not in melt_patterns]
        post_processor.rules = [r for r in post_rules if r.get('pattern') not in melt_patterns]
        logger.info(f"[Retranslate] Subtitle detected. Rule melting applied (Strict Policy: {strict_policy}).")

    try:
        engine.start_server()
        
        # 1. Input Validation
        src_text = args.single_block
        if not src_text or not src_text.strip():
            raise ValueError("Input text is empty")
            
        print(f"[Init] Retranslate started for block {args.file or 'Manual'}")
        
        # Pre-processing & Protection
        print(f"[Process] Applying pre-processing rules (Strict: {enforce_strict_alignment})...")
        processed_src = pre_processor.process(src_text, strict_line_count=enforce_strict_alignment)
        processed_src = Normalizer.normalize(processed_src)
            
        if protector:
            print(f"[Process] Applying text protection...")
            processed_src = protector.protect(processed_src)

        # 4. Translation with Unified Retry Strategy
        print(f"[Inference] Starting chat completion with unified retry strategy...")
        
        # Disable balance logs in single block
        args.balance_enable = False 
        
        result_payload = translate_block_with_retry(
            block_idx=0,
            original_src_text=src_text,
            processed_src_text=processed_src,
            args=args,
            engine=engine,
            prompt_builder=prompt_builder,
            response_parser=parser,
            post_processor=post_processor,
            glossary=glossary,
            stdout_lock=threading.Lock(), # Local lock for single block
            strict_mode=enforce_strict_alignment,
            protector=protector
        )

        print("\n[Inference] Done.")
        
        if result_payload["success"]:
            print(f"\n[Retranslate] Success! Generated {len(result_payload['out_text'])} chars.")
            result = {
                'success': True,
                'src': src_text,
                'dst': result_payload['out_text'],
                'cot': result_payload['cot'] if args.debug else ''
            }
        else:
            result = {
                'success': False,
                'src': src_text,
                'dst': '',
                'error': result_payload.get('error') or 'Translation failed'
            }
        
        # Output
        if args.json_output:
            print(f"JSON_RESULT:{json.dumps(result, ensure_ascii=False)}")
        else:
            print(result.get('dst', ''))
            
    except Exception as e:
        if args.json_output:
            print(f"JSON_RESULT:{json.dumps({'success': False, 'error': str(e)}, ensure_ascii=False)}")
        else:
            print(f"Error: {e}")
    finally:
        engine.stop_server()


def main():
    import logging
    logging.basicConfig(
        level=logging.INFO,
        format='[%(asctime)s] [%(levelname)s] %(message)s',
        datefmt='%H:%M:%S',
        stream=sys.stdout
    )
    logger = logging.getLogger("murasaki")

    # Argument Parsing
    # Default server path relative to middleware directory
    middleware_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    # 跨平台 llama-server 路径检测
    def get_llama_server_path(mdir: str) -> str:
        """根据平台自动选择正确的 llama-server 二进制"""
        import platform as plt
        import subprocess
        system = sys.platform
        machine = plt.machine().lower()
        
        # 跨平台检测 NVIDIA GPU（支持 Windows 多路径）
        def has_nvidia_gpu() -> bool:
            import shutil
            # Windows 上 nvidia-smi 可能不在 PATH 中
            nvidia_smi_paths = ['nvidia-smi']
            if system == 'win32':
                nvidia_smi_paths.extend([
                    r'C:\Windows\System32\nvidia-smi.exe',
                    r'C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe'
                ])
            
            for nvidia_smi in nvidia_smi_paths:
                try:
                    # 检查命令是否存在
                    if not os.path.isabs(nvidia_smi) and not shutil.which(nvidia_smi):
                        continue
                    if os.path.isabs(nvidia_smi) and not os.path.exists(nvidia_smi):
                        continue
                    
                    result = subprocess.run(
                        [nvidia_smi, '--query-gpu=name', '--format=csv,noheader'],
                        capture_output=True, text=True, timeout=5
                    )
                    if result.returncode == 0 and result.stdout.strip():
                        logger.info(f"NVIDIA GPU detected: {result.stdout.strip()}")
                        return True
                except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
                    continue
            
            logger.info("No NVIDIA GPU detected, using Vulkan/Metal fallback")
            return False
        
        # 平台映射表
        if system == 'win32':
            # Windows: 检测 NVIDIA GPU
            if has_nvidia_gpu():
                subdir, binary = 'win-cuda', 'llama-server.exe'
            else:
                subdir, binary = 'win-vulkan', 'llama-server.exe'
        elif system == 'darwin':
            # macOS: ARM64 用 Metal，x64 用 CPU
            if 'arm' in machine or 'aarch64' in machine:
                subdir, binary = 'darwin-metal', 'llama-server'
            else:
                subdir, binary = 'darwin-x64', 'llama-server'
        elif system == 'linux':
            # Linux: 有 NVIDIA GPU 则用 CUDA，否则 Vulkan
            if has_nvidia_gpu():
                subdir, binary = 'linux-cuda', 'llama-server'
                # 如果 CUDA 版本不存在，回退 Vulkan
                cuda_path = os.path.join(mdir, 'bin', subdir, binary)
                if not os.path.exists(cuda_path):
                    subdir = 'linux-vulkan'
            else:
                subdir, binary = 'linux-vulkan', 'llama-server'
        else:
            raise RuntimeError(f"Unsupported platform: {system}")
        
        # 优先检查新的 bin/ 目录结构
        new_path = os.path.join(mdir, 'bin', subdir, binary)
        if os.path.exists(new_path):
            logger.info(f"Using llama-server: {new_path}")
            return new_path
        
        # 回退：扫描旧的目录结构 (llama-*)
        for entry in os.listdir(mdir):
            entry_path = os.path.join(mdir, entry)
            if os.path.isdir(entry_path):
                candidate = os.path.join(entry_path, binary)
                if os.path.exists(candidate):
                    logger.info(f"Using legacy llama-server: {candidate}")
                    return candidate
        
        raise FileNotFoundError(f"llama-server not found in {mdir}")
    
    try:
        default_server = get_llama_server_path(middleware_dir)
    except FileNotFoundError as e:
        logger.warning(f"No llama-server found: {e}. Will require --server argument.")
        default_server = None
    default_model = os.path.join(middleware_dir, "models", "ACGN-8B-Step150-Q4_K_M.gguf")
    
    parser = argparse.ArgumentParser(description="Murasaki Translator - High Fidelity System 2 Translation")
    parser.add_argument("--file", help="Input file path") # Check manually later
    parser.add_argument("--server", default=default_server)
    parser.add_argument("--model", default=default_model)
    parser.add_argument("--glossary", help="Glossary JSON path")
    parser.add_argument("--gpu-layers", type=int, default=-1)
    parser.add_argument("--ctx", type=int, default=8192)
    parser.add_argument("--preset", default="novel", choices=["novel", "script", "short"], help="Prompt preset: novel (轻小说), script (剧本), short (单句)")
    parser.add_argument("--mode", default="doc", choices=["doc", "line"], help="Translation mode: doc (novel) or line (game/contrast)")
    parser.add_argument("--chunk-size", type=int, default=1000, help="Target char count for doc mode")
    parser.add_argument("--debug", action="store_true", help="Enable CoT stats and timing")
    parser.add_argument("--line-format", default="single", choices=["single", "double"], help="Line spacing format")
    parser.add_argument("--output", help="Custom output file path")
    parser.add_argument("--rules-pre", help="Path to pre-processing rules JSON")
    parser.add_argument("--rules-post", help="Path to post-processing rules JSON")
    parser.add_argument("--save-cot", action="store_true", help="Save CoT debug file")
    parser.add_argument("--alignment-mode", action="store_true", help="Enable Auxiliary Alignment mode (Comic)")
    parser.add_argument("--save-summary", action="store_true", help="Append summary to output")
    parser.add_argument("--traditional", action="store_true", help="Convert output to Traditional Chinese")
    parser.add_argument("--strict-mode", default="subs", choices=["off", "subs", "all"], help="Strict line alignment mode (default: subs)")
    
    # Experimental Features (可在 GUI 高级设置中开关)
    parser.add_argument("--fix-ruby", action="store_true", help="[Experimental] Clean Ruby annotations from source")
    parser.add_argument("--fix-kana", action="store_true", help="[Experimental] Remove orphan kana from output")
    parser.add_argument("--fix-punctuation", action="store_true", help="[Experimental] Normalize punctuation in output")
    
    # Quality Control Settings (高级质量控制)
    parser.add_argument("--temperature", type=float, default=0.7, help="Model temperature (0.1-1.5, default 0.7)")
    parser.add_argument("--line-check", action="store_true", help="Enable line count validation and auto-retry")
    parser.add_argument("--line-tolerance-abs", type=int, default=10, help="Line count absolute tolerance (default 10)")
    parser.add_argument("--line-tolerance-pct", type=float, default=0.2, help="Line count percent tolerance (default 0.2 = 20%%)")
    parser.add_argument("--anchor-check", action="store_true", help="Enable core anchor validation and auto-retry (EPUB/SRT/ASS/Alignment)")
    parser.add_argument("--anchor-check-retries", type=int, default=1, help="Max retries for anchor check (default 1)")
    parser.add_argument("--rep-penalty-base", type=float, default=1.0, help="Initial repetition penalty (default 1.0)")
    parser.add_argument("--rep-penalty-max", type=float, default=1.5, help="Max repetition penalty (default 1.5)")
    parser.add_argument("--rep-penalty-step", type=float, default=0.1, help="Internal loop penalty increment (default 0.1)")
    parser.add_argument("--max-retries", type=int, default=3, help="Max retries for empty output (default 3)")
    
    # Glossary Coverage Check (术语表覆盖率检测)
    parser.add_argument("--output-hit-threshold", type=float, default=60.0, help="Min output exact hit percentage to pass (default 60)")
    parser.add_argument("--cot-coverage-threshold", type=float, default=80.0, help="Min CoT coverage percentage to pass (default 80)")
    parser.add_argument("--coverage-retries", type=int, default=1, help="Max retries for low coverage (default 1)")
    
    # Dynamic Retry Strategy (动态重试策略)
    parser.add_argument("--retry-temp-boost", type=float, default=0.05, help="Temperature boost per retry (default 0.05)")
    retry_prompt_group = parser.add_mutually_exclusive_group()
    retry_prompt_group.add_argument(
        "--retry-prompt-feedback",
        dest="retry_prompt_feedback",
        action="store_true",
        help="Inject feedback about missed terms in retry prompts",
    )
    retry_prompt_group.add_argument(
        "--no-retry-prompt-feedback",
        dest="retry_prompt_feedback",
        action="store_false",
        help="Disable retry prompt feedback injection",
    )
    parser.set_defaults(retry_prompt_feedback=True)
    
    # Incremental Translation (增量翻译)
    parser.add_argument("--resume", action="store_true", help="Resume from existing output file (skip translated content)")

    # Text Protection (文本保护)
    parser.add_argument("--text-protect", action="store_true", help="Protect variables/tags from translation")
    parser.add_argument(
        "--protect-patterns",
        help="Path to custom protection patterns file (JSON list or one regex per line; supports #/ // comments, ! remove, + add)",
    )

    # Cache & Proofreading (缓存与校对)
    parser.add_argument("--save-cache", action="store_true", help="Save translation cache for proofreading")
    parser.add_argument("--cache-path", help="Custom directory to store cache files")
    parser.add_argument("--force-translation", action="store_true", help="Force re-translation (ignore existing cache)")
    parser.add_argument("--single-block", help="Translate a single block (for proofreading retranslate)")
    parser.add_argument("--json-output", action="store_true", help="Output result as JSON (for single-block mode)")
    parser.add_argument("--rebuild-from-cache", help="Rebuild document from specified cache JSON file")
    parser.add_argument("--no-server-spawn", action="store_true", help="Client mode: connect to existing server")
    parser.add_argument("--server-host", default="127.0.0.1", help="External server host (default: 127.0.0.1)")
    parser.add_argument("--server-port", type=int, default=8080, help="External server port (default: 8080)")
    
    parser.add_argument("--concurrency", type=int, default=1, help="Parallel slots count (default 1)")
    # High-Fidelity Granular Settings
    parser.add_argument("--high-fidelity", action="store_true", help="Master Switch: Enable recommended High-Fidelity settings")
    parser.add_argument("--flash-attn", action="store_true", help="Enable Flash Attention")
    parser.add_argument("--kv-cache-type", default="f16", choices=["f16", "q8_0", "q5_1", "q4_0"], help="KV Cache Quantization (default: f16)")
    parser.add_argument("--use-large-batch", action="store_true", help="Use large batch sizes (b=ub=1024 for safety)")
    parser.add_argument("--batch-size", type=int, help="Manual physical batch size (overrides large-batch default)")
    parser.add_argument("--seed", type=int, help="Lock sampling seed (e.g. 42)")
    
    # Chunk Balancing Strategy
    parser.add_argument("--balance-enable", action="store_true", help="Enable chunk tail balancing")
    parser.add_argument("--balance-threshold", type=float, default=0.6, help="Tail balance threshold (default 0.6)")
    parser.add_argument("--balance-count", type=int, default=3, help="Tail balance range count (default 3)")
    
    args = parser.parse_args()

    # Manual validation for --file
    if not args.single_block and not args.rebuild_from_cache and not args.file:
        parser.error("the following arguments are required: --file")
    
    # High-Fidelity Logic is now handled by the frontend.
    # The backend simply respects the explicit arguments passed for kv_cache, batch size, etc.
    # if args.high_fidelity: ... (Removed)
    
    # ========================================
    # Rebuild Mode (Non-translation)
    # ========================================
    if args.rebuild_from_cache:
        try:
            print(f"[Rebuild] Loading cache from: {args.rebuild_from_cache}")
            if not os.path.exists(args.rebuild_from_cache):
                print(f"[Error] Cache file not found: {args.rebuild_from_cache}")
                return
            
            with open(args.rebuild_from_cache, 'r', encoding='utf-8') as f:
                cache_data = json.load(f)
            
            source_path = cache_data.get('sourcePath')
            output_path = args.output or cache_data.get('outputPath')
            
            if not source_path or not os.path.exists(source_path):
                print(f"[Error] Source file not found or not recorded in cache: {source_path}")
                # Fallback: if output_path is txt, we can still rebuild it without source
                if output_path and output_path.lower().endswith('.txt'):
                     print(f"[Rebuild] Falling back to text-only rebuild for {output_path}")
                else:
                    sys.exit(1) # Signal failure to Electron
            
            from murasaki_translator.core.chunker import TextBlock
            blocks = []
            for b_data in cache_data.get('blocks', []):
                blocks.append(TextBlock(
                    id=b_data['index'],
                    prompt_text=b_data['dst'], # Use dst as the new text
                    metadata=b_data.get('metadata') # Try to get metadata if saved (v2.1+)
                ))
            
            # Re-sort to ensure order
            blocks.sort(key=lambda x: x.id)
            
            # Use DocumentFactory
            if source_path and os.path.exists(source_path):
                doc = DocumentFactory.get_document(source_path)
                doc.load()
                print(f"[Rebuild] Loaded document structure from: {source_path}")
                doc.save(output_path, blocks)
            elif output_path.lower().endswith('.txt'):
                # Simple TXT rebuild
                with open(output_path, 'w', encoding='utf-8') as f:
                    for b in blocks:
                        f.write(b.prompt_text + "\n\n")
            
            print(f"[Success] Document rebuilt successfully: {output_path}")
            return
            
        except Exception as e:
            print(f"[Error] Rebuild failed: {e}")
            import traceback
            traceback.print_exc()
            sys.exit(1)

    # ========================================
    # 单块翻译模式 (用于校对界面重翻)
    # ========================================
    if args.single_block:
        return translate_single_block(args)

    # Path Setup
    input_path = os.path.abspath(args.file)
    if not os.path.exists(input_path):
        print(f"Error: File not found {input_path}")
        return

    # Resolve glossary path before loading
    glossary_path = args.glossary
    if not glossary_path:
        glossary = {}
    else:
        # Try resolving path
        if not os.path.exists(glossary_path):
            # Try finding in glossaries subdirectory relative to script
            script_dir = os.path.dirname(os.path.abspath(__file__))
            candidate = os.path.join(script_dir, 'glossaries', glossary_path)
            if os.path.exists(candidate):
                glossary_path = candidate
            else:
                # Try finding in glossaries subdirectory relative to CWD
                candidate = os.path.join('glossaries', glossary_path)
                if os.path.exists(candidate):
                    glossary_path = candidate
                else:
                    print(f"[Warning] Glossary not found: {glossary_path} (checked absolute, script/glossaries, cwd/glossaries)")
                    glossary_path = None # Indicate no valid glossary path found
        
        if glossary_path:
            glossary = load_glossary(glossary_path)
        else:
            glossary = {}

    # Determine Output Paths
    _, file_ext = os.path.splitext(input_path)
    # Determine Architecture (Novel vs Structured vs Alignment)
    # is_structured: True for subtitle formats and alignment mode (which uses pseudo-SRT tags)
    # 注意：普通 .txt 文件无论使用何种模式都不需要额外的 .txt 后缀
    is_structured = file_ext.lower() in ['.epub', '.srt', '.ass', '.ssa'] or args.alignment_mode
    # is_structured_doc: 决定是否需要写入临时 .txt 文件（仅对二进制/结构化格式需要）
    is_structured_doc = is_structured  # 只有真正的结构化文档才需要临时 txt

    if args.output:
        output_path = args.output
        base, ext = os.path.splitext(output_path)
        cot_path = f"{base}_cot{ext}"
    else:
        base, ext = os.path.splitext(input_path)
        # 动态获取模型名称（从文件名提取，去掉扩展名）
        model_name = os.path.splitext(os.path.basename(args.model))[0] if args.model else "unknown"
        # 统一命名格式: 原文件名_模型名称
        suffix = f"_{model_name}"
        output_path = f"{base}{suffix}{ext}"
        cot_path = f"{base}{suffix}_cot{ext}"

    # Structured docs (EPUB/SRT/Alignment) need binary post-processing or formulaic reconstruction.
    # We write to a .txt sidecar during translation to avoid corrupting the binary target (or to allow re-ordering in alignment mode).
    actual_output_path = output_path + ".txt" if is_structured_doc else output_path

    # Temp Progress Path (Deterministic for Resume)
    temp_progress_path = f"{output_path}.temp.jsonl"
    
    # Clean up OLD temp files in output directory (not glossary dir)
    try:
        out_dir = os.path.dirname(os.path.abspath(output_path))
        for f in os.listdir(out_dir):
            if f.endswith(".temp.jsonl") and f != os.path.basename(temp_progress_path):
                full_p = os.path.join(out_dir, f)
                # Clean files older than 24h
                if time.time() - os.path.getmtime(full_p) > 86400:
                    os.remove(full_p)
    except Exception: pass

    # Load Glossary (Already loaded above)
    print(f"[Init] Loaded glossary: {len(glossary)} entries from {glossary_path or 'None'}")

    # Initialize Components
    total_ctx = args.ctx * args.concurrency

    # Generate Configuration Fingerprint for Resume Integrity
    import hashlib
    config_payload = {
        "chunk_size": args.chunk_size,
        "model": os.path.basename(args.model),
        "concurrency": args.concurrency,
        "preset": args.preset,
        "line_format": args.line_format,
        "ctx": args.ctx,
        "text_protect": args.text_protect,
        "fix_ruby": args.fix_ruby,
        "fix_kana": args.fix_kana,
        "fix_punctuation": args.fix_punctuation,
        "traditional": args.traditional,
        "glossary_path": glossary_path,
        "rules_pre": args.rules_pre,
        "rules_post": args.rules_post,
        "high_fidelity": args.high_fidelity,
        "flash_attn": args.flash_attn,
        "kv_cache_type": args.kv_cache_type,
        "use_large_batch": args.use_large_batch,
        "seed": args.seed,
        "balance_enable": args.balance_enable,
        "balance_threshold": args.balance_threshold,
        "balance_count": args.balance_count,
    }
    config_hash = hashlib.sha256(json.dumps(config_payload, sort_keys=True).encode()).hexdigest()[:16]
    
    # Concurrency Warning (Flops/Bandwidth Bottleneck)
    # Concurrency Warning (Flops/Bandwidth Bottleneck)
    if args.concurrency >= 4:
        print(f"\n[Warning] Concurrency set to {args.concurrency} (>=4). High concurrency may decrease processing speed instead of increasing it.")
        print(f"[Tip] Real speed depends on GPU compute (FLOPs), bandwidth, and parallel processing quantity. If speed drops, try reducing concurrency.\n")

    print(f"Initializing Engine (Server: {args.server}, Parallel: {args.concurrency}, HighFidelity: {args.high_fidelity})...")
    engine = InferenceEngine(
        server_path=args.server, 
        model_path=args.model,
        host=args.server_host,
        port=args.server_port,
        n_gpu_layers=args.gpu_layers,
        n_ctx=total_ctx,
        n_parallel=args.concurrency,
        no_spawn=args.no_server_spawn,
        flash_attn=args.flash_attn,
        kv_cache_type=args.kv_cache_type,
        use_large_batch=args.use_large_batch,
        batch_size=args.batch_size,
        seed=args.seed
    )
    
    # --- Smart Chunk Size Reduction for Structured Formats ---
    # These formats have significant token overhead that the chunker (char-based) cannot account for.
    effective_chunk_size = args.chunk_size
    
    # 1. Alignment Mode: @id=X@ content @id=X@ anchors
    # Token overhead analysis:
    #   - Each @id=123@ ≈ 5-6 tokens (Qwen3)
    #   - Double anchor per line = ~12 tokens overhead
    #   - For short manga lines (~10 chars content), anchors add ~40% token overhead
    #   - Model must reproduce anchors in output, doubling effective overhead
    # Use 40% reduction (0.6x) to compensate, similar to ASS handling
    if args.alignment_mode:
        effective_chunk_size = int(args.chunk_size * 0.6)
        print(f"[Auto-Config] Alignment mode: chunk_size {args.chunk_size} -> {effective_chunk_size} (anchor overhead compensation)")
    
    # 2. ASS/SSA: Pseudo-SRT format with timestamps, indices
    # ~60-70% structural overhead, use 50% reduction
    elif file_ext.lower() in ['.ass', '.ssa']:
        effective_chunk_size = int(args.chunk_size * 0.5)
        print(f"[Auto-Config] ASS format: chunk_size {args.chunk_size} -> {effective_chunk_size} (pseudo-SRT overhead)")

    chunker = Chunker(
        target_chars=effective_chunk_size, 
        max_chars=effective_chunk_size * 2, # Soft limit doubled for buffer
        mode=args.mode,
        enable_balance=args.balance_enable,
        balance_threshold=args.balance_threshold,
        balance_range=args.balance_count
    )
    
    prompt_builder = PromptBuilder(glossary)
    response_parser = ResponseParser()
    

    
    # --- Unified Pipeline Injection ---
    def add_unique_rule(rule_list, pattern, r_type='format', pos='append'):
        if any(r.get('pattern') == pattern for r in rule_list): return
        rule_obj = {"type": r_type, "pattern": pattern, "active": True}
        if pos == 'prepend': rule_list.insert(0, rule_obj)
        else: rule_list.append(rule_obj)

    # 1. Pre-rules
    pre_rules = load_rules(args.rules_pre) if args.rules_pre else []
    if args.fix_ruby:
        add_unique_rule(pre_rules, "ruby_cleaner", pos='prepend')
    
    # 2. Post-rules
    post_rules = load_rules(args.rules_post) if args.rules_post else []
    if args.fix_kana:
        add_unique_rule(post_rules, "kana_fixer")
    if args.fix_punctuation:
        add_unique_rule(post_rules, "punctuation_fixer")
    if args.traditional:
        add_unique_rule(post_rules, "traditional_chinese")

    add_unique_rule(post_rules, "number_fixer")
    protect_rule_enabled, protect_rule_lines = _collect_protect_rule_lines(pre_rules)
    legacy_protect_lines = _collect_legacy_protect_lines(post_rules)
    text_protect_allowed = _allow_text_protect(input_path, args)
    if text_protect_allowed:
        if protect_rule_enabled and not args.text_protect:
            print("[Auto-Config] Pre-rules text protection enabled.")
            args.text_protect = True
        if legacy_protect_lines and not args.text_protect:
            print("[Auto-Config] Legacy protection rule detected. Enabling TextProtector.")
            args.text_protect = True
    else:
        if args.text_protect or protect_rule_enabled or legacy_protect_lines or args.protect_patterns:
            print("[TextProtect] Disabled for non-txt input.")
        args.text_protect = False
        protect_rule_lines = []
        legacy_protect_lines = []

    # [Formula Factory] Structured engineering
    if is_structured:
        # 规则熔断：针对字幕格式和对齐模式，剔除所有可能破坏换行或合并行数的规则
        # Alignment Mode 必须享受同等的规则熔断待遇，否则 PostProcess 会破坏 @id@ 结构
        is_sub = input_path.lower().endswith(('.srt', '.ass', '.ssa')) or args.alignment_mode
        if is_sub:
            melt_patterns = ['ensure_single_newline', 'ensure_double_newline', 'clean_empty_lines', 'merge_short_lines']
            original_count = len(post_rules)
            post_rules = [r for r in post_rules if r.get('pattern') not in melt_patterns]
            if len(post_rules) < original_count:
                print(f"[Auto-Config] Subtitle/Alignment detected. Disabled {original_count - len(post_rules)} formatting rules to preserve structure.")

    if text_protect_allowed and args.protect_patterns and not args.text_protect:
        print("[Auto-Config] protect_patterns provided. Enabling TextProtector.")
        args.text_protect = True

    # [Critical Fix] 强制将样式还原逻辑置于所有后处理规则的最末端，确保还原后不会再次被误伤
    # 先移除已有的（如果有），再追加到最后
    post_rules = [r for r in post_rules if r.get('pattern') != 'restore_protection']
    if text_protect_allowed and args.text_protect:
        add_unique_rule(post_rules, "restore_protection")
        print("[Auto-Config] Ensured 'restore_protection' is the final post-processing rule.")

    custom_protector_patterns = None
    if text_protect_allowed:
        if input_path.lower().endswith(('.srt', '.ass', '.ssa')):
            # [Specialized Rule] 针对字幕，优先使用合法的标签捕获规则，避免拦截 【】 （） [ ] 等
            custom_protector_patterns = TextProtector.SUBTITLE_PATTERNS
            print("[Auto-Config] Using restrictive SUBTITLE_PATTERNS for legal tags only.")
        elif input_path.lower().endswith('.epub'):
            # [Specialized Rule] 针对 EPUB，保护 @id=ID@/@end=ID@ 锚点和可能残留的 HTML 标签
            custom_protector_patterns = [r'@id=\d+@', r'@end=\d+@', r'<[^>]+>']
            print("[Auto-Config] Using EPUB_ANCHOR_PATTERNS for @id=ID@ anchors.")
        elif args.alignment_mode:
            # [Specialized Rule] 对齐模式基于 TXT：默认规则 + @id 锚点
            anchor_patterns = [r'@id=\d+@', r'@end=\d+@']
            custom_protector_patterns = _merge_protect_patterns(
                TextProtector.DEFAULT_PATTERNS,
                anchor_patterns,
                []
            )
            print("[Auto-Config] Using ALIGNMENT_PATTERNS (DEFAULT + @id anchors).")

    additions: List[str] = []
    removals: List[str] = []
    if text_protect_allowed:
        if protect_rule_lines:
            add, rem = _parse_protect_pattern_lines(protect_rule_lines)
            additions.extend(add)
            removals.extend(rem)
        if legacy_protect_lines:
            add, rem = _parse_protect_pattern_lines(legacy_protect_lines)
            additions.extend(add)
            removals.extend(rem)

    pre_processor = RuleProcessor(pre_rules)
    post_processor = RuleProcessor(post_rules)

    # [Block Separator] 动态检测：如果后处理规则包含 ensure_double_newline，则 block 间使用双换行
    # 这确保 block 内部和 block 之间的换行风格一致
    use_double_newline_separator = any(
        r.get('pattern') == 'ensure_double_newline' and r.get('active', True) 
        for r in post_rules
    )

    print(f"Loaded {len(pre_processor.rules)} pre-processing rules.")
    print(f"Loaded {len(post_processor.rules)} post-processing rules.")

    try:
        engine.start_server()
        
        
        if args.alignment_mode and input_path.lower().endswith('.txt'):
            print(f"[Alignment Mode] ENABLED: Context-aware alignment for {input_path}")
            items, structure_map, source_lines = AlignmentHandler.load_lines(input_path)
            # Use normal chunker for context!
            blocks = chunker.process(items)
            print(f"[Alignment Mode] Tagged lines merged into {len(blocks)} context blocks.")
            doc = None # Not used here
        else:
            doc = DocumentFactory.get_document(input_path)
            items = doc.load()
            
            # Source Lines Calculation (for Novel/Doc mode)
            # For Alignment Mode, source_lines is already exact physical count needed for reconstruction
            source_lines = len([i for i in items if i['text'].strip()])
            structure_map = {} # Not used
            
            # Chunking
            blocks = chunker.process(items)
            print(f"[{args.mode.upper()} Mode] Input split into {len(blocks)} blocks.")
        
        # Helper for printing stats (Alignment mode has already calculated exact source lines)
        source_chars = sum(len(i['text']) for i in items if i['text'].strip())
        
        # Debug output (only when --debug is enabled)
        if args.debug:
            print(f"[DEBUG] Input lines: {source_lines}, Total chars: {source_chars}")
            for bi, blk in enumerate(blocks):
                print(f"[DEBUG] Block {bi+1}: {len(blk.prompt_text)} chars")
        
        # Streaming Processing
        start_time = time.time() # Ensure initialized early
        total_chars = 0
        total_cot_chars = 0
        total_out_chars = 0  
        total_time = 0
        total_tokens = 0 # Track total tokens used
        total_gen_tokens = 0 # Track total generated tokens (for smooth speed)
        total_gen_time = 0 # Track total generation duration (for smooth speed)
        total_lines = 0 # Track total output lines for stats
        last_progress_time = 0 # For rate limiting
        
        # 初始化翻译缓存（用于校对界面）
        translation_cache = TranslationCache(output_path, custom_cache_dir=args.cache_path, source_path=input_path) if args.save_cache else None

        # [修复] 在断点续传或已有缓存时，先加载已有缓存数据
        # 这样可以保留之前翻译的块，避免校对界面只显示恢复后的部分
        # 除非使用 --force-translation 强制重新翻译
        if translation_cache and translation_cache.cache_path and os.path.exists(translation_cache.cache_path):
            if args.force_translation:
                print(f"[Cache] Force translation mode: ignoring existing cache and starting fresh")
            else:
                try:
                    if translation_cache.load():
                        existing_blocks = len(translation_cache.blocks)
                        print(f"[Cache] Loaded {existing_blocks} blocks from existing cache: {translation_cache.cache_path}")
                    else:
                        print(f"[Cache] Failed to load existing cache, will create new one")
                except Exception as e:
                    print(f"[Cache] Warning: Failed to load cache: {e}")
                    # [数据安全] 在清空前备份损坏的缓存文件
                    try:
                        backup_path = translation_cache.cache_path + '.bak.corrupt'
                        shutil.copy2(translation_cache.cache_path, backup_path)
                        print(f"[Cache] Backed up corrupted cache to: {backup_path}")
                    except Exception as backup_error:
                        print(f"[Cache] Warning: Failed to backup corrupted cache: {backup_error}")
                    # [封装] 使用 clear() 方法，避免直接操作内部结构
                    translation_cache.clear()
        
        # Load legacy/custom protection patterns file if provided via CLI
        if text_protect_allowed and args.protect_patterns and os.path.exists(args.protect_patterns):
             try:
                 with open(args.protect_patterns, 'r', encoding='utf-8') as f:
                     raw_text = f.read()
                 file_lines = _parse_protect_pattern_payload(raw_text)
                 add, rem = _parse_protect_pattern_lines(file_lines)
                 additions.extend(add)
                 removals.extend(rem)
             except Exception as e:
                 print(f"[Warning] Failed to load protection patterns: {e}")

        if text_protect_allowed and (additions or removals):
            base_patterns = (
                custom_protector_patterns
                if custom_protector_patterns
                else TextProtector.DEFAULT_PATTERNS
            )
            merged_patterns = _merge_protect_patterns(base_patterns, additions, removals)
            custom_protector_patterns = merged_patterns
            print(
                f"[TextProtect] Merged custom patterns (+{len(additions)} / -{len(removals)}). "
                f"Total={len(custom_protector_patterns)}"
            )
        
        gpu_name = get_gpu_name()  # Get GPU Name once
        display_name, params, quant = format_model_info(args.model)
        
        print("\nStarting Translation...")
        print(f"Output: {output_path}")
        if args.save_cot:
            print(f"Debug CoT: {cot_path}")
        print(f"GPU: {gpu_name} (Layers: {args.gpu_layers})")
        print(f"Model: {display_name} ({params}, {quant})")
        
        # 详细配置状态日志
        print("\n[Config] Feature Status:")
        print(f"  Temperature: {args.temperature}")
        print(f"  Line Check: {'[V] Enabled' if args.line_check else '[X] Disabled'} (±{args.line_tolerance_abs}/{args.line_tolerance_pct*100:.0f}%)")
        print(f"  Anchor Check: {'[V] Enabled' if args.anchor_check else '[X] Disabled'} (Retries={args.anchor_check_retries})")
        print(f"  Rep Penalty Retry: Base={args.rep_penalty_base}, Max={args.rep_penalty_max}")
        print(f"  Max Retries: {args.max_retries}")
        print(f"  Glossary Coverage: {'[V] Enabled' if args.output_hit_threshold < 100 else '[X] Disabled'} (Output>={args.output_hit_threshold}% or CoT>={args.cot_coverage_threshold}%, Retries={args.coverage_retries})")
        print(f"  Dynamic Retry: TempBoost={args.retry_temp_boost}, Feedback={'[V]' if args.retry_prompt_feedback else '[X]'}")
        print(f"  Text Protect: {'[V] Enabled' if args.text_protect else '[X] Disabled'}")
        print(f"  Traditional Chinese: {'[V] Enabled' if args.traditional else '[X] Disabled'}")
        print(f"  Resume Mode: {'[V] Enabled' if args.resume else '[X] Disabled'}")
        print(f"  Save Cache: {'[V] Enabled' if args.save_cache else '[X] Disabled'}")
        if args.glossary:
            print(f"  Glossary: {os.path.basename(args.glossary)} ({len(glossary)} entries)")
        else:
            print(f"  Glossary: None")
        print()
        
        # 发送输出路径给前端（用于历史记录和文件打开）
        sys.stdout.write(f"\nJSON_OUTPUT_PATH:{json.dumps({'path': output_path}, ensure_ascii=False)}\n")
        sys.stdout.flush()
        
        # Init Monitor
        monitor = HardwareMonitor()
        if monitor.enabled:
            print(f"Hardware Monitor Active: {monitor.name}")
            # Emit an initial snapshot so GUI updates immediately
            try:
                init_status = monitor.get_status() or {
                    "name": monitor.name,
                    "vram_used_gb": 0,
                    "vram_total_gb": 0,
                    "vram_percent": 0,
                    "gpu_util": 0,
                    "mem_util": 0
                }
                if "name" not in init_status:
                    init_status["name"] = monitor.name
                try:
                    metrics = engine.get_metrics()
                    if metrics:
                        init_status.update(metrics)
                except:
                    pass
                safe_print_json("JSON_MONITOR", init_status)
            except Exception:
                pass
            
            # Start Monitor Thread
            def run_monitor_loop():
                # Correctly initialize baseline to avoid initial speed spike
                try:
                    # Initialize baseline from ENGINE DIRECTLY (Fail-safe)
                    last_chars = engine.generated_chars_count
                    last_tokens = engine.generated_tokens_count
                except:
                    last_chars = 0
                    last_tokens = 0
                
                last_check_time = time.time()
                
                while True:
                    # Get Hardware Status (VRAM/GPU)
                    status = monitor.get_status() or {}
                    
                    # Get Engine Metrics (KV Cache)
                    # Get Engine Metrics (KV Cache) - HTTP Request
                    try:
                        metrics = engine.get_metrics()
                        if metrics:
                            status.update(metrics)
                    except: pass

                    # Calculate Instantaneous Speed (Real-time) - Direct Memory Access
                    # Decoupled from HTTP request stability
                    try:
                        curr_chars = engine.generated_chars_count
                        curr_tokens = engine.generated_tokens_count
                        now = time.time()
                        dt = now - last_check_time
                        
                        if dt > 0.4: # Update every ~0.5s
                             speed_c = int((curr_chars - last_chars) / dt)
                             speed_t = round((curr_tokens - last_tokens) / dt, 1)
                             status['realtime_speed_chars'] = speed_c if speed_c > 0 else 0
                             status['realtime_speed_tokens'] = speed_t if speed_t > 0 else 0
                             
                             last_chars = curr_chars
                             last_tokens = curr_tokens
                             last_check_time = now
                    except Exception as e:
                        # Should rarely happen
                        pass
                    
                    if status:
                        safe_print_json("JSON_MONITOR", status)
                    time.sleep(0.5) # Fast update for smooth charts
            
            monitor_thread = threading.Thread(target=run_monitor_loop, daemon=True)
            monitor_thread.start()
        
        # 定义全局起始时间 (Fix NameError) - MOVED TO TOP
        # start_time = time.time()
        
        # 发送初始脉冲 JSON (Initial Progress Pulse)
        # 这让 GUI 知道总块数，即使任务还未开始处理
        initial_progress = {
            "current": 0,
            "total": len(blocks),
            "percent": 0,
            "total_chars": 0,
            "total_lines": 0,
            "source_chars": source_chars,
            "source_lines": source_lines,
            "speed_chars": 0,
            "elapsed": 0
        }
        safe_print_json("JSON_PROGRESS", initial_progress)
        
        # Incremental Translation / Resume Logic
        skip_blocks_from_output = 0 # Blocks skipped based on final output file
        precalculated_temp = {}    # Blocks already processed and stored in temp file
        existing_content = []      # [Audit Fix] Store lines for document reconstruction
        resume_config_matched = False
        
        # Order-Sensitive Initialization
        all_results = [None] * len(blocks) # Pre-fill for structural reconstruction

        if args.resume:
            existing_lines, existing_content, is_valid = load_existing_output(actual_output_path)
            if existing_lines == -1:
                print("[Resume] Output file already complete. Nothing to do.")
                return
            elif is_valid and existing_lines > 0:
                # Pass mode to skip block calculation
                skip_blocks_from_output = calculate_skip_blocks(blocks, existing_lines, is_doc_mode=(args.mode == "doc"))
                if skip_blocks_from_output >= len(blocks):
                    print(f"[Resume] All {len(blocks)} blocks already translated. Nothing to do.")
                    return
                print(f"[Resume] Found {existing_lines} existing lines in output. Will skip first {skip_blocks_from_output}/{len(blocks)} blocks.")
            else:
                print("[Resume] No valid existing output found. Starting fresh.")
                existing_content = [] # Reset if invalid

            # Load temporary progress from .temp.jsonl file.
            # Returns: {block_idx: result_dict}
            if os.path.exists(temp_progress_path):
                try:
                    with open(temp_progress_path, 'r', encoding='utf-8') as f:
                        lines = f.readlines()
                        if lines:
                            # First line should be config fingerprint
                            try:
                                header = json.loads(lines[0])
                                if header.get("type") == "fingerprint":
                                    if header.get("hash") == config_hash:
                                        resume_config_matched = True
                                        logger.info(f"[Resume] Config fingerprint matched ({config_hash}).")
                                    else:
                                        logger.warning(f"[Resume] Config mismatch! (Saved: {header.get('hash')}, Current: {config_hash}). Restarting.")
                                else:
                                    logger.warning("[Resume] No fingerprint found in temp file. Restarting.")
                            except:
                                logger.warning("[Resume] Invalid fingerprint header. Restarting.")

                            if resume_config_matched:
                                for line in lines[1:]: # Skip fingerprint
                                     data = json.loads(line)
                                     idx = data.get('block_idx')
                                     if idx is not None:
                                         precalculated_temp[idx] = data
                    if precalculated_temp and resume_config_matched:
                         print(f"[Resume] Loaded {len(precalculated_temp)} blocks from temp progress file.")
                except Exception as e:
                    print(f"[Warning] Failed to load resume data from temp file: {e}")
            
            # [Audit Fix] Fill skipped blocks from output file to support EPUB/SRT reconstruction
            # This MUST happen before Precision Resume Alignment
            if skip_blocks_from_output > 0:
                print(f"[Resume] Rebuilding memory state for {skip_blocks_from_output} skipped blocks...")
                current_line_ptr = 0
                for idx in range(skip_blocks_from_output):
                    # 1. Try to find in temp progress file first (contains full metadata/cot)
                    if idx in precalculated_temp:
                         all_results[idx] = precalculated_temp[idx]
                    # 2. Extract from existing output file (requires physical line alignment)
                    elif existing_content:
                        block_lines_count = blocks[idx].prompt_text.count('\n') + 1
                        block_lines = existing_content[current_line_ptr : current_line_ptr + block_lines_count]
                        
                        if block_lines:
                            all_results[idx] = {
                                "success": True,
                                "out_text": '\n'.join(block_lines),
                                "preview_text": '\n'.join(block_lines),
                                "block_idx": idx,
                                "is_restorer": True,
                                "warnings": [],
                                "src_text": blocks[idx].prompt_text,
                                "cot_chars": 0,
                                "usage": {}
                            }
                        else:
                            print(f"[Resume] Warning: Could not find content for block {idx} in existing output.")
                    
                    # Advance pointer (account for doc mode spacer if applicable)
                    block_lines_count = blocks[idx].prompt_text.count('\n') + 1
                    current_line_ptr += (block_lines_count + 1) if args.mode == "doc" else block_lines_count
                
                # [Fix] Synchronize skipped blocks to TranslationCache to prevent data loss on final save
                if translation_cache:
                    for idx in range(skip_blocks_from_output):
                        if all_results[idx] is not None:
                            res = all_results[idx]
                            # Extract warning types from result
                            w_types = [w['type'] if isinstance(w, dict) else w for w in res.get("warnings", [])]
                            translation_cache.add_block(
                                idx, 
                                res.get('src_text', ''), 
                                res.get('preview_text', res.get('out_text', '')), 
                                w_types, 
                                res.get("cot", ""), 
                                res.get("retry_history", [])
                            )
                    logger.info(f"[Cache] Synchronized {skip_blocks_from_output} skipped blocks to memory.")
        
        # [Precision Resume] Determine how much content to KEEP from existing file
        # We rewrite the file instead of plain append ('a') to ensure perfect structural alignment
        # and eliminate residual/incomplete data from the previous crash.
        keep_content_str = ""
        if skip_blocks_from_output > 0 and existing_content:
            # Reconstruct the exact text that SHOULD be in the file for the skipped blocks
            # This accounts for mode (doc vs line) and separators
            rebuilt_parts = []
            for i in range(skip_blocks_from_output):
                if all_results[i] and all_results[i].get('success'):
                    rebuilt_parts.append(all_results[i]['out_text'])
                else:
                    # Fallback to source if missing (should not happen with resume integrity)
                    rebuilt_parts.append(blocks[i].prompt_text)
            
            block_separator = "\n\n" if (use_double_newline_separator or args.mode == "doc") else "\n"
            keep_content_str = block_separator.join(rebuilt_parts) + block_separator
            
            # Update counters based on what we are KEEPING
            total_lines = keep_content_str.count('\n') # Rough approximation
            total_out_chars = len(keep_content_str)
            print(f"[Resume] Precision alignment: Keeping {skip_blocks_from_output} blocks ({total_out_chars} chars).")

        # Open output file: Always use 'w' and write kept content to ensure truncation of junk
        output_mode = 'w'
        
        # Prepare Temp Output File (Append or Create)
        temp_file_mode = 'a' if (args.resume and len(precalculated_temp) > 0 and resume_config_matched) else 'w'
        temp_progress_file = open(temp_progress_path, temp_file_mode, encoding='utf-8', buffering=1)
        
        # If starting fresh, write fingerprint
        if temp_file_mode == 'w':
            temp_progress_file.write(json.dumps({"type": "fingerprint", "hash": config_hash}) + "\n")
            temp_progress_file.flush()
        
        cot_context = open(cot_path, 'w', encoding='utf-8', buffering=1) if args.save_cot else nullcontext()
        with open(actual_output_path, output_mode, encoding='utf-8', buffering=1) as f_out, \
             cot_context as f_cot:

            # Write kept content immediately if resuming
            if keep_content_str:
                f_out.write(keep_content_str)
                f_out.flush()
            
            # ========================================
            # Parallel Worker Function
            # ========================================
            def process_block_task(block_idx: int, block: object, strict_mode: bool = False):
                """Worker Task"""
                logger.info(f"[Block {block_idx+1}/{len(blocks)}] Starting translation...")
                start_block_time = time.time()
                if not block.prompt_text or not block.prompt_text.strip():
                     return {
                        "success": True,
                        "block_idx": block_idx,
                        "src_text": "",
                        "out_text": "",
                        "preview_text": "",
                        "cot": "",
                        "raw_output": "",
                        "warnings": [],
                        "lines_count": 0,
                        "chars_count": 0, # Source chars
                        "cot_chars": 0,
                        "usage": None
                    }

                try:
                    # Pause Check (Worker level sleeping)
                    pause_file = output_path + ".pause"
                    while os.path.exists(pause_file):
                         time.sleep(1)
                    
                    # Pre-processing using Unified RuleProcessor
                    logger.debug(f"[Block {block_idx+1}] Pre-processing start (len: {len(block.prompt_text)})")
                    processed_src_text = pre_processor.process(block.prompt_text, strict_line_count=strict_mode)
                    logger.debug(f"[Block {block_idx+1}] After Pre-rules: {len(processed_src_text)} chars")
                    
                    processed_src_text = Normalizer.normalize(processed_src_text)
                    
                    # Thread-Safe Text Protector (Local instantiation)
                    # Use custom_protector_patterns captured from outer scope
                    local_protector = None
                    if args.text_protect:
                         # Determine aggressive cleaning based on file type for thread-safe instance
                         # ASS/SSA requires aggressive cleaning to prevent layout shifted by spaces
                         # SRT/TXT requires non-aggressive cleaning to preserve structural newlines
                         _, ext = os.path.splitext(input_path)
                         is_ass_format = ext.lower() in ['.ass', '.ssa']
                         
                         local_protector = TextProtector(
                             patterns=custom_protector_patterns, 
                             block_id=block_idx + 1,
                             aggressive_cleaning=is_ass_format
                         )
                         logger.debug(f"[Block {block_idx+1}] [Experimental] Protection start")
                         processed_src_text = local_protector.protect(processed_src_text)
                         logger.debug(f"[Block {block_idx+1}] [Experimental] After Protection: {len(processed_src_text)} chars")
                    
                    # Pre-processing & Protection happens locally in caller
                    # because they might vary (different blocks/pattern instances)
                    
                    # Unified Call
                    return translate_block_with_retry(
                        block_idx=block_idx,
                        original_src_text=block.prompt_text,
                        processed_src_text=processed_src_text,
                        args=args,
                        engine=engine,
                        prompt_builder=prompt_builder,
                        response_parser=response_parser,
                        post_processor=post_processor,
                        glossary=glossary,
                        stdout_lock=stdout_lock,
                        strict_mode=strict_mode,
                        protector=local_protector
                    )



                except Exception as e:
                    return {
                        "success": False,
                        "error": str(e),
                        "block_idx": block_idx,
                        "src_text": block.prompt_text
                    }

            def restore_block_task(block_idx: int, stored_result: Dict):
                """Dummy task to restore pre-calculated result immediately."""
                stored_result["is_restorer"] = True
                return stored_result

            
            # Stats Initialization
            total_out_chars = 0      # All Output Chars (Main + Summary etc)
            total_cot_chars = 0      # CoT Thinking Chars
            total_source_chars = 0   # Source Chars
            total_source_lines = 0   # Source Lines
            total_lines = 0          # Output Lines
            total_prompt_tokens = 0  # Input/Prompt Tokens (from Engine)
            total_gen_tokens = 0     # Generation Tokens (from Engine)
            
            # ...
            # Main Execution Loop
            # ========================================
            
            # Use ThreadPoolExecutor
            max_workers = args.concurrency
            executor = ThreadPoolExecutor(max_workers=max_workers)
            
            # Submit all tasks
            # We maintain a map of future -> index
            future_to_index = {}
            

            # Determine if we should use strict line count (Retry if line count mismatch)
            _, file_ext = os.path.splitext(input_path)
            # [CRITICAL FIX] Do NOT re-calculate is_structured_doc here! 
            # It was already determined globally (lines ~770) and includes args.alignment_mode.
            # Re-calculating purely on extension would disable alignment mode for .txt.
            
            # Strict mode logic:
            # - all: Force strict line count for EVERY file
            # - subs: Force for subtitles (.srt, .ass, .ssa) and .epub
            # - off: Disable strict 1:1 matching (use tolerance-based line check if enabled)
            if args.strict_mode == "all":
                enforce_strict_alignment = True
            elif args.strict_mode == "off":
                enforce_strict_alignment = False
            else: # "subs"
                enforce_strict_alignment = is_structured_doc

            if enforce_strict_alignment:
                print(f"[Init] Strict Line Count Mode ACTIVE (Policy: {args.strict_mode}). Output MUST match source line count.")
            else:
                print(f"[Init] Strict Line Count Mode INACTIVE (Policy: {args.strict_mode}).")

            print(f"Starting execution with {max_workers} threads...")
            
            for i, block in enumerate(blocks):
                # Resume skip
                if i < skip_blocks_from_output:
                    continue
                
                # Check temp progress
                if i in precalculated_temp:
                    future = executor.submit(restore_block_task, i, precalculated_temp[i])
                    print(f"  - Restoring Block {i+1} from temp file...")
                else:
                    # Pass enforce_strict_alignment to task
                    future = executor.submit(process_block_task, i, block, enforce_strict_alignment)
                
                future_to_index[future] = i
            
            # Note: EPUB/SRT reconstruction handled by memory rebuild logic above (skip_blocks_from_output)
            
            # --- Execution Status Initialization ---
            results_buffer = {}
            preview_sent = set()
            next_write_idx = skip_blocks_from_output
            
            # 统计修正：过滤掉空块（用于负载均衡的占位块）
            effective_blocks_indices = [idx for idx, b in enumerate(blocks) if b.prompt_text.strip()]
            total_tasks_count = len(future_to_index)
            effective_total = len(effective_blocks_indices)
            completed_count = 0 
            effective_completed = 0
            
            # Session Stats for real-time speed (excluding restored blocks)
            session_out_chars = 0
            session_out_lines = 0 
            
            # Main result processing loop
            for future in as_completed(future_to_index):
                    block_idx = future_to_index[future]
                    try:
                        result = future.result() 
                    except Exception as e:
                        safe_print(f"Worker Error for Block {block_idx+1}: {e}")
                        result = {
                            "success": False, "error": str(e), "block_idx": block_idx,
                            "src_text": blocks[block_idx].prompt_text if block_idx < len(blocks) else "Unknown",
                            "out_text": "[Worker Exception]", "preview_text": "[Worker Exception]",
                            "cot": "", "raw_output": "", "warnings": [],
                            "lines_count": 0, "chars_count": 0, "cot_chars": 0, "usage": None
                        }
                    
                    # Store results in buffer for ordered processing
                    results_buffer[block_idx] = result
                    completed_count += 1
                    if result["src_text"].strip():
                        effective_completed += 1
                        
                    # Stats processing
                    if result["success"]:
                        total_out_chars += len(result["out_text"])
                        total_lines += result["lines_count"]
                        total_cot_chars += result["cot_chars"]
                        
                        # Fix for Resume Mode Speed Spike:
                        # Only count stats for REAL GEN tasks towards speed calculation
                        # "is_restorer" results are instant and distort the speed metric
                        is_generated_block = not result.get("is_restorer", False)
                        if is_generated_block:
                            session_out_chars += (len(result["out_text"]) + result.get("cot_chars", 0))
                            session_out_lines += result.get("lines_count", 0)
                            if result.get("usage"):
                                total_prompt_tokens += result["usage"].get("prompt_tokens", 0)
                                total_gen_tokens += result["usage"].get("completion_tokens", 0)
                            
                        
                        if block_idx not in precalculated_temp:
                            try:
                                temp_line = json.dumps(result, ensure_ascii=False)
                                temp_progress_file.write(temp_line + "\n")
                                temp_progress_file.flush()
                            except Exception as e:
                                logger.debug(f"[TempProgress] Write failed: {e}")
                        
                        block_src_text = result["src_text"]
                        total_source_chars += len(block_src_text)
                        total_source_lines += len([l for l in block_src_text.splitlines() if l.strip()])
                        
                        # Emit preview as soon as a block finishes (out-of-order allowed)
                        if block_idx not in preview_sent:
                            if args.alignment_mode:
                                preview_text = AlignmentHandler.process_result(result.get("out_text", ""))
                            else:
                                preview_text = result.get("preview_text") or result.get("out_text", "")
                            result["preview_text"] = preview_text
                            safe_print_json(
                                "JSON_PREVIEW_BLOCK",
                                {
                                    "block": block_idx + 1,
                                    "src": result.get("src_text", ""),
                                    "output": preview_text
                                }
                            )
                            preview_sent.add(block_idx)
                        
                        # Progress reporting
                        elapsed_so_far = max(0.1, time.time() - start_time)
                        
                        # Speed Calculation uses SESSION stats only
                        current_speed_chars = session_out_chars / elapsed_so_far
                        
                        avg_time_per_block = elapsed_so_far / max(1, completed_count)
                        remaining_time = (total_tasks_count - completed_count) * avg_time_per_block
                        
                        progress_data = {
                            "current": effective_completed + len([idx for idx in range(skip_blocks_from_output) if blocks[idx].prompt_text.strip()]),
                            "ordered_current": next_write_idx, "total": effective_total,
                            "percent": ((effective_completed + len([idx for idx in range(skip_blocks_from_output) if blocks[idx].prompt_text.strip()])) / max(1, effective_total)) * 100,
                            "total_chars": total_out_chars, "total_lines": total_lines,
                            "source_chars": total_source_chars, "source_lines": total_source_lines, 
                            "speed_chars": round(current_speed_chars, 1), "speed_lines": round(session_out_lines / elapsed_so_far, 2),
                            "speed_gen": round(total_gen_tokens / elapsed_so_far, 1), "speed_eval": round(total_prompt_tokens / elapsed_so_far, 1),
                            "total_tokens": total_gen_tokens, "elapsed": elapsed_so_far, "remaining": int(remaining_time)
                        }
                        
                        now = time.time()
                        if (now - last_progress_time > 0.1) or (completed_count == total_tasks_count):
                            safe_print_json("JSON_PROGRESS", progress_data)
                            last_progress_time = now

                    # Ordered write to file (consuming from results_buffer)
                    while next_write_idx in results_buffer:
                        res = results_buffer.pop(next_write_idx)
                        curr_disp = next_write_idx + 1
                        
                        if res["success"]:
                            # [Alignment Mode] Post-Processing
                            # CRITICAL: Do NOT overwrite res["out_text"] with stripped version!
                            # We need the tags in "out_text" for save_reconstructed to work at the end.
                            # Only strip tags for the Preview/GUI.
                            if args.alignment_mode:
                                if not res.get("preview_text"):
                                    res["preview_text"] = AlignmentHandler.process_result(res["out_text"])  
                            else:
                                res["preview_text"] = res.get("preview_text", res.get("out_text", ""))
                            if next_write_idx not in preview_sent:
                                safe_print_json(
                                    "JSON_PREVIEW_BLOCK",
                                    {"block": curr_disp, "src": res['src_text'], "output": res['preview_text']}
                                )
                                preview_sent.add(next_write_idx)
                            
                            if translation_cache:
                                w_types = [w['type'] for w in res["warnings"]] if res["warnings"] else []
                                translation_cache.add_block(next_write_idx, res["src_text"], res["preview_text"], w_types, res["cot"], res.get("retry_history", []))
                            
                            # Write to txt stream
                            # 动态分隔符：如果后处理规则包含 ensure_double_newline，则 block 间使用双换行
                            block_separator = "\n\n" if (use_double_newline_separator or args.mode == "doc") else "\n"
                            f_out.write(res["out_text"] + block_separator)
                            
                            if args.save_cot and res["cot"]:
                                f_cot.write(f"[MURASAKI] ========== Block {curr_disp} ==========\n{res['raw_output']}\n\n")
                        else:
                            f_out.write(f"\n[Block {curr_disp} Failed]\n")
                        
                        f_out.flush()
                        # CRITICAL: Store in all_results for post-processing reconstruction
                        all_results[next_write_idx] = res
                        next_write_idx += 1

            executor.shutdown(wait=True)
        
        # [Final Structured Save] 
        # 此操作在 f_out 关闭后执行，确保所有文本已落盘
        if is_structured_doc:
            try:
                # [Integrity Check] Ensure all blocks have valid results before reconstruction
                missing_blocks = [i for i in range(len(blocks)) if all_results[i] is None]
                if missing_blocks:
                    error_msg = f"[CRITICAL] Resume integrity check failed: {len(missing_blocks)} blocks missing (indices: {missing_blocks[:10]}{'...' if len(missing_blocks) > 10 else ''})"
                    print(error_msg)
                    # Output JSON error for GUI to display internal-style alert
                    safe_print_json("JSON_ERROR", {
                        "type": "resume_integrity",
                        "title": "重建失败",
                        "message": f"无法重建结构化文档！\n\n缺失 {len(missing_blocks)} 个翻译块。\n\n可能原因：\n1. 临时文件 (.temp.jsonl) 已损坏或被删除\n2. 输出文件与进度不匹配\n\n建议：删除输出文件并重新翻译。",
                        "missing_count": len(missing_blocks)
                    })
                    raise ValueError(error_msg)
                
                print(f"[Final] Reconstructing structured document: {output_path}...")
                from murasaki_translator.core.chunker import TextBlock
                translated_blocks = []
                for i in range(len(blocks)):
                    res = all_results[i]
                    if res and res.get('success'):
                        # 构造 TextBlock 对象以满足 doc.save 的签名
                        tb = TextBlock(id=i, prompt_text=res['out_text'])
                        # 注入元数据以便 EPUB 精确回填
                        if hasattr(blocks[i], 'metadata') and blocks[i].metadata:
                            tb.metadata = blocks[i].metadata
                        translated_blocks.append(tb)
                    else:
                        # Fallback: keep original text to maintain the sequence for structural injection
                        print(f"[Warning] Block {i+1} missing or failed. Using source text.")
                        tb = TextBlock(id=i, prompt_text=blocks[i].prompt_text)
                        if hasattr(blocks[i], 'metadata') and blocks[i].metadata:
                            tb.metadata = blocks[i].metadata
                        translated_blocks.append(tb)
                
                if args.alignment_mode and input_path.lower().endswith('.txt'):
                    print(f"[Debug] Invoking save_reconstructed. MapSize={len(structure_map)}, TotalLines={source_lines}, Blocks={len(translated_blocks)}")
                    AlignmentHandler.save_reconstructed(output_path, translated_blocks, structure_map, total_physical_lines=source_lines)
                else:
                    doc.save(output_path, translated_blocks)
                print(f"[Final] Reconstruction complete: {output_path}")
                
                # [Cleanup] Remove intermediate .txt file after successful reconstruction
                if actual_output_path != output_path and os.path.exists(actual_output_path):
                    try:
                        os.remove(actual_output_path)
                        print(f"[Cleanup] Removed intermediate file: {actual_output_path}")
                    except Exception as ce:
                        print(f"[Warning] Failed to remove intermediate file: {ce}")
            except Exception as e:
                print(f"[Error] Final reconstruction failed: {e}")
        else:
            print(f"[Success] Translation completed. Output saved to: {output_path}")

        # 任务结束后的总结
        total_time = time.time() - start_time
        if translation_cache:
            m_name = os.path.basename(args.model) if args.model else "Unknown"
            translation_cache.save(model_name=m_name, glossary_path=args.glossary or "", concurrency=args.concurrency)

        # 发送最终 JSON 统计
        final_stats = {
            "sourceLines": total_source_lines, "sourceChars": total_source_chars,
            "outputLines": total_lines, "outputChars": total_out_chars,
            "totalTime": round(total_time, 2), "avgSpeed": round(total_out_chars / total_time, 1) if total_time > 0 else 0
        }
        safe_print_json("JSON_FINAL", final_stats)
        
        # 清理临时文件
        try:
            temp_progress_file.close()
            if (completed_count + skip_blocks_from_output) >= len(blocks):
                if os.path.exists(temp_progress_path): 
                    os.remove(temp_progress_path)
                    print(f"[Cleanup] Removed temporary progress file: {os.path.basename(temp_progress_path)}")
        except: pass

    except KeyboardInterrupt:
        print("\n[System] Interrupted by user. Shutting down immediately...")

        # [修复] 用户中断时也保存缓存，避免翻译数据丢失
        # [信号重入保护] 使用嵌套 try 防止第二次 Ctrl+C 中断保存过程
        if 'translation_cache' in locals() and translation_cache and len(translation_cache.blocks) > 0:
            try:
                m_name = os.path.basename(args.model) if args.model else "Unknown"
                # 忽略第二次 Ctrl+C，确保缓存写入完成
                try:
                    if translation_cache.save(model_name=m_name, glossary_path=args.glossary or "", concurrency=args.concurrency):
                        print(f"[Cache] Saved {len(translation_cache.blocks)} blocks before interrupt")
                    else:
                        print("[Cache] Warning: Failed to save cache on interrupt")
                except KeyboardInterrupt:
                    # [信号重入保护] 第二次 Ctrl+C，忽略并继续退出
                    print("[Cache] Ignoring second interrupt during save, exiting...")
                except Exception as cache_error:
                    print(f"[Cache] Error saving cache on interrupt: {cache_error}")
            except Exception as e:
                print(f"[Cache] Unexpected error during cache save: {e}")

        # [中断重建] 从 temp.jsonl 重建预览 txt 供用户查看已翻译内容
        try:
            if 'temp_progress_path' in locals() and os.path.exists(temp_progress_path):
                rebuild_path = output_path + ".interrupted.txt"
                with open(temp_progress_path, 'r', encoding='utf-8') as tf:
                    lines = tf.readlines()
                if lines:
                    # json 已在顶层导入，无需重复导入
                    rebuilt_blocks = []
                    for line in lines:
                        try:
                            data = json.loads(line.strip())
                            if data.get('output'):
                                rebuilt_blocks.append(data['output'])
                        except: pass
                    if rebuilt_blocks:
                        with open(rebuild_path, 'w', encoding='utf-8') as rf:
                            rf.write("\n\n".join(rebuilt_blocks))
                        print(f"[System] Partial translation saved to: {rebuild_path}")
                        safe_print_json("JSON_INTERRUPTED", {
                            "preview_path": rebuild_path,
                            "blocks_saved": len(rebuilt_blocks)
                        })
        except Exception as e:
            print(f"[System] Failed to rebuild preview: {e}")

        if 'executor' in locals():
            executor.shutdown(wait=False, cancel_futures=True)
        if engine:
            engine.stop_server()
    except Exception as e:
        print(f"\n[System] Critical Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if 'temp_progress_file' in locals():
            try:
                temp_progress_file.close()
            except: pass
        if engine:
            engine.stop_server()

if __name__ == "__main__":
    main()
