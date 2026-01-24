"""Murasaki Translator v1.0 - Production Translation Engine"""

import argparse
import sys
import os
import time
import json
import re
import subprocess
from contextlib import nullcontext
from typing import List, Dict, Optional
from concurrent.futures import ThreadPoolExecutor, Future

from pathlib import Path

# Add middleware directory to sys.path for package imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Force UTF-8 for stdout/stderr (Windows console fix)
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

from murasaki_translator.core.chunker import Chunker
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

def load_glossary(path: Optional[str]) -> Dict[str, str]:
    """Load glossary from JSON or TXT file. Returns empty dict on error."""
    if not path or not os.path.exists(path):
        return {}
    
    try:
        # JSON Support
        if path.endswith('.json'):
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
        
        # TXT Support (Key=Value or Key:Value per line)
        elif path.endswith('.txt'):
            glossary = {}
            with open(path, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith('#'): continue
                    
                    # Try to split by first '=' or ':'
                    if '=' in line:
                        k, v = line.split('=', 1)
                    elif ':' in line:
                        k, v = line.split(':', 1)
                    else:
                        continue
                        
                    glossary[k.strip()] = v.strip()
            return glossary
            
        else:
            return {}
            
    except (json.JSONDecodeError, IOError, Exception) as e:
        print(f"[Warning] Failed to load glossary: {e}")
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
        
        # 分割为行，过滤空行
        lines = [l for l in content.split('\n') if l.strip()]
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
    
    feedback = f"\n\n【系统提示】上一轮翻译术语覆盖率仅为 {coverage:.0f}%。以下术语未正确应用：{terms_str}。请在本次翻译中严格使用术语表中的标准译法，不要擅自简化或省略。"
    
    return feedback


def calculate_skip_blocks(blocks, existing_lines: int) -> int:
    """
    根据已翻译行数计算应该跳过的块数。
    采用保守策略：只跳过完全匹配的块。
    """
    if existing_lines <= 0:
        return 0
    
    cumulative_lines = 0
    for i, block in enumerate(blocks):
        # 估算这个块的输出行数（与输入行数大致相同）
        block_lines = block.prompt_text.count('\n') + 1
        cumulative_lines += block_lines
        
        # 如果累积行数超过已有行数，返回前一个块
        if cumulative_lines >= existing_lines:
            return i  # 从这个块开始重新翻译（保守策略）
    
    return len(blocks)  # 所有块都已完成


def get_gpu_name():
    try:
        # Try finding nvidia-smi
        try:
            # shell=True sometimes helps on Windows if PATH is weird, but usually not needed.
            # Using 'gb18030' to handle Chinese Windows output correctly
            result = subprocess.check_output("nvidia-smi -L", shell=True, stderr=subprocess.STDOUT).decode('gb18030', errors='ignore')
        except:
             return "Unknown / CPU (nvidia-smi failed)"

        names = []
        for line in result.strip().split('\n'):
            if ":" in line and "GPU" in line:
                # Format: GPU 0: NVIDIA GeForce RTX 3090 (UUID: ...)
                # Split by ':' -> ["GPU 0", " NVIDIA GeForce RTX 3090 (UUID", " ...)"]
                parts = line.split(":")
                if len(parts) >= 2:
                    name_part = parts[1].strip()
                    # Remove UUID part if exists
                    if "(" in name_part:
                        name_part = name_part.split("(")[0].strip()
                    names.append(name_part)
        return " & ".join(names) if names else "Unknown GPU"
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
        gpu_layers=args.gpu_layers,
        ctx_size=args.ctx,
        temperature=args.temperature,
        rep_base=getattr(args, 'rep_penalty_base', 1.0),
        rep_max=getattr(args, 'rep_penalty_max', 1.5),
        no_spawn=getattr(args, 'no_server_spawn', False)
    )
    
    # Load Glossary
    glossary = load_glossary(args.glossary)
    
    # Load Rules (Optional)
    rules_pre = load_rules(args.rules_pre) if hasattr(args, 'rules_pre') and args.rules_pre else []
    rules_post = load_rules(args.rules_post) if hasattr(args, 'rules_post') and args.rules_post else []
    
    prompt_builder = PromptBuilder(glossary)
    parser = ResponseParser()
    rule_processor = RuleProcessor(rules_pre, rules_post)
    
    # Initialize Text Protector
    protector = TextProtector() if args.text_protect else None
    
    try:
        engine.start_server()
        
        # 1. Input Validation
        src_text = args.single_block
        if not src_text or not src_text.strip():
            raise ValueError("Input text is empty")
            
        # 2. Pre-processing & Protection
        processed_src = rule_processor.process_pre(src_text)
        if protector:
            processed_src = protector.protect(processed_src)
            
        # 3. Build Prompt
        messages = prompt_builder.build_messages(
            processed_src,
            enable_cot=args.debug,
            preset=args.preset
        )
        
        # 4. Translate
        raw_output = ""
        def on_chunk(chunk):
            nonlocal raw_output
            raw_output += chunk
        
        success = engine.translate_block(messages, on_chunk)
        
        if success and raw_output:
            # 5. Parse & Post-process
            cot, main_text = parser.parse(raw_output)
            
            # Restore protected text
            if protector:
                main_text = protector.restore(main_text)
                
            # Post-rules
            dst_text = rule_processor.process_post(main_text)
            
            # Format lines
            lines = [l for l in dst_text.split('\n') if l.strip()]
            final_dst = '\n'.join(lines)
            
            result = {
                'success': True,
                'src': src_text,
                'dst': final_dst,
                'cot': cot if args.debug else ''
            }
        else:
            result = {
                'success': False,
                'src': src_text,
                'dst': '',
                'error': 'Translation failed or empty output'
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
    # Argument Parsing
    # Default server path relative to middleware directory
    middleware_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    default_server = os.path.join(middleware_dir, "llama-b7770-bin-win-cuda-12.4-x64", "llama-server.exe")
    default_model = os.path.join(middleware_dir, "models", "ACGN-8B-Step150-Q4_K_M.gguf")
    
    parser = argparse.ArgumentParser(description="Murasaki Translator v1.0")
    parser.add_argument("--file", required=True, help="Input file path")
    parser.add_argument("--server", default=default_server)
    parser.add_argument("--model", default=default_model)
    parser.add_argument("--glossary", help="Glossary JSON path")
    parser.add_argument("--gpu-layers", type=int, default=-1)
    parser.add_argument("--ctx", type=int, default=8192)
    parser.add_argument("--preset", default="training", choices=["minimal", "training", "short"], help="Prompt preset")
    parser.add_argument("--mode", default="doc", choices=["doc", "line"], help="Translation mode: doc (novel) or line (game/contrast)")
    parser.add_argument("--chunk-size", type=int, default=1000, help="Target char count for doc mode")
    parser.add_argument("--debug", action="store_true", help="Enable CoT stats and timing")
    parser.add_argument("--line-format", default="single", choices=["single", "double"], help="Line spacing format")
    parser.add_argument("--output", help="Custom output file path")
    parser.add_argument("--rules-pre", help="Path to pre-processing rules JSON")
    parser.add_argument("--rules-post", help="Path to post-processing rules JSON")
    parser.add_argument("--save-cot", action="store_true", help="Save CoT debug file")
    parser.add_argument("--save-summary", action="store_true", help="Append summary to output")
    parser.add_argument("--traditional", action="store_true", help="Convert output to Traditional Chinese")
    
    # Experimental Features (可在 GUI 高级设置中开关)
    parser.add_argument("--fix-ruby", action="store_true", help="[Experimental] Clean Ruby annotations from source")
    parser.add_argument("--fix-kana", action="store_true", help="[Experimental] Remove orphan kana from output")
    parser.add_argument("--fix-punctuation", action="store_true", help="[Experimental] Normalize punctuation in output")
    
    # Quality Control Settings (高级质量控制)
    parser.add_argument("--temperature", type=float, default=0.7, help="Model temperature (0.1-1.5, default 0.7)")
    parser.add_argument("--line-check", action="store_true", help="Enable line count validation and auto-retry")
    parser.add_argument("--line-tolerance-abs", type=int, default=10, help="Line count absolute tolerance (default 10)")
    parser.add_argument("--line-tolerance-pct", type=float, default=0.2, help="Line count percent tolerance (default 0.2 = 20%%)")
    parser.add_argument("--rep-penalty-base", type=float, default=1.0, help="Initial repetition penalty (default 1.0)")
    parser.add_argument("--rep-penalty-max", type=float, default=1.5, help="Max repetition penalty (default 1.5)")
    parser.add_argument("--max-retries", type=int, default=3, help="Max retries for empty output (default 3)")
    
    # Glossary Coverage Check (术语表覆盖率检测)
    parser.add_argument("--output-hit-threshold", type=float, default=60.0, help="Min output exact hit percentage to pass (default 60)")
    parser.add_argument("--cot-coverage-threshold", type=float, default=80.0, help="Min CoT coverage percentage to pass (default 80)")
    parser.add_argument("--coverage-retries", type=int, default=3, help="Max retries for low coverage (default 3)")
    
    # Dynamic Retry Strategy (动态重试策略)
    parser.add_argument("--retry-temp-boost", type=float, default=0.2, help="Temperature boost per retry (default 0.2)")
    parser.add_argument("--retry-rep-boost", type=float, default=0.1, help="Repetition penalty boost per retry (default 0.1)")
    parser.add_argument("--retry-prompt-feedback", action="store_true", default=True, help="Inject feedback about missed terms in retry prompts")
    
    # Incremental Translation (增量翻译)
    parser.add_argument("--resume", action="store_true", help="Resume from existing output file (skip translated content)")
    
    # Text Protection (文本保护)
    parser.add_argument("--text-protect", action="store_true", help="Protect variables/tags from translation")
    parser.add_argument("--protect-patterns", help="Path to custom protection patterns file (one regex per line)")
    
    # Cache & Proofreading (缓存与校对)
    parser.add_argument("--save-cache", action="store_true", help="Save translation cache for proofreading")
    parser.add_argument("--cache-path", help="Custom directory to store cache files")
    parser.add_argument("--single-block", help="Translate a single block (for proofreading retranslate)")
    parser.add_argument("--json-output", action="store_true", help="Output result as JSON (for single-block mode)")
    parser.add_argument("--no-server-spawn", action="store_true", help="Client mode: connect to existing server")
    
    args = parser.parse_args()
    
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
    if args.output:
        output_path = args.output
        base, ext = os.path.splitext(output_path)
        cot_path = f"{base}_cot{ext}"
    else:
        base, ext = os.path.splitext(input_path)
        # Unified naming format v0.1
        suffix = f"_Murasaki-8B-v0.1_{args.preset}_{args.mode}"
        output_path = f"{base}{suffix}{ext}"
        cot_path = f"{base}{suffix}_cot{ext}"

    # Load Glossary (Already loaded above)
    print(f"[Init] Loaded glossary: {len(glossary)} entries from {glossary_path or 'None'}")

    # Initialize Components
    print(f"Initializing Engine (Server: {args.server})...")
    engine = InferenceEngine(
        server_path=args.server, 
        model_path=args.model, 
        n_gpu_layers=args.gpu_layers,
        n_ctx=args.ctx,
        no_spawn=args.no_server_spawn
    )
    
    chunker = Chunker(
        target_chars=args.chunk_size, 
        max_chars=args.chunk_size * 2,
        mode=args.mode
    )
    
    prompt_builder = PromptBuilder(glossary)
    response_parser = ResponseParser()
    

    
    # Initialize Rule Processors
    pre_rules = load_rules(args.rules_pre)
    post_rules = load_rules(args.rules_post)
    
    # Inject Line Format Rule (Backend System Rule)
    # Only inject if user hasn't defined their own format rule in post_rules
    has_format_rule = any(r.get('pattern', '').startswith('ensure_') for r in post_rules)
    
    if not has_format_rule:
        if args.line_format == "single":
            post_rules.append({"type": "format", "pattern": "ensure_single_newline", "active": True})
        elif args.line_format == "double":
            post_rules.append({"type": "format", "pattern": "ensure_double_newline", "active": True})
    
    pre_processor = RuleProcessor(pre_rules)
    post_processor = RuleProcessor(post_rules)
    
    # Initialize OpenCC if enabled
    cc_converter = None
    if args.traditional:
        try:
            import opencc
            cc_converter = opencc.OpenCC('s2tw')
            print("OpenCC initialized: Simplified -> Traditional Chinese")
        except Exception as e:
            print(f"[Warning] Failed to initialize OpenCC: {e}")

    print(f"Loaded {len(pre_processor.rules)} pre-processing rules.")
    print(f"Loaded {len(post_processor.rules)} post-processing rules.")

    try:
        engine.start_server()
        
        # Read Input
        if input_path.lower().endswith('.epub'):
            print("Detected EPUB input. Extracting text...")
            try:
                from murasaki_translator.utils.epub_loader import extract_text_from_epub
                lines = extract_text_from_epub(input_path)
                print(f"Extracted {len(lines)} lines from EPUB.")
            except ImportError as e:
                print(f"Error: {e}")
                return
            except Exception as e:
                print(f"Error reading EPUB: {e}")
                return
        else:
            with open(input_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            
        # Chunking
        blocks = chunker.process(lines)
        print(f"[{args.mode.upper()} Mode] Input split into {len(blocks)} blocks.")
        
        # 源文本统计（用于历史记录） - 仅统计非空行
        source_lines = len([l for l in lines if l.strip()])
        source_chars = sum(len(l) for l in lines if l.strip())
        
        # Debug output (only when --debug is enabled)
        if args.debug:
            print(f"[DEBUG] Input lines: {source_lines}, Total chars: {source_chars}")
            for bi, blk in enumerate(blocks):
                print(f"[DEBUG] Block {bi+1}: {len(blk.prompt_text)} chars")
        
        # Streaming Processing
        total_chars = 0
        total_cot_chars = 0
        total_main_chars = 0
        total_time = 0
        total_tokens = 0 # Track total tokens used
        total_lines = 0 # Track total output lines for stats
        
        # 累积预览数据（用于 GUI 实时预览）
        all_src_previews = []
        all_out_previews = []
        
        # 初始化翻译缓存（用于校对界面）
        translation_cache = TranslationCache(output_path, custom_cache_dir=args.cache_path) if args.save_cache else None
        
        # Initialize Text Protector (with custom patterns support)
        protect_patterns = None
        if args.protect_patterns and os.path.exists(args.protect_patterns):
             try:
                 with open(args.protect_patterns, 'r', encoding='utf-8') as f:
                     protect_patterns = [line.strip() for line in f if line.strip()]
                 print(f"Loaded {len(protect_patterns)} custom protection patterns.")
             except Exception as e:
                 print(f"[Warning] Failed to load protection patterns: {e}")
        
        batch_protector = TextProtector(patterns=protect_patterns, enabled=args.text_protect)
        
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
        print(f"  Line Check: {'✓ Enabled' if args.line_check else '✗ Disabled'} (±{args.line_tolerance_abs}/{args.line_tolerance_pct*100:.0f}%)")
        print(f"  Rep Penalty Retry: Base={args.rep_penalty_base}, Max={args.rep_penalty_max}")
        print(f"  Max Retries: {args.max_retries}")
        print(f"  Glossary Coverage: {'✓ Enabled' if args.output_hit_threshold < 100 else '✗ Disabled'} (Output>={args.output_hit_threshold}% or CoT>={args.cot_coverage_threshold}%, Retries={args.coverage_retries})")
        print(f"  Dynamic Retry: TempBoost={args.retry_temp_boost}, RepBoost={args.retry_rep_boost}, Feedback={'✓' if args.retry_prompt_feedback else '✗'}")
        print(f"  Text Protect: {'✓ Enabled' if args.text_protect else '✗ Disabled'}")
        print(f"  Traditional Chinese: {'✓ Enabled' if args.traditional else '✗ Disabled'}")
        print(f"  Resume Mode: {'✓ Enabled' if args.resume else '✗ Disabled'}")
        print(f"  Save Cache: {'✓ Enabled' if args.save_cache else '✗ Disabled'}")
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
        
        # 增量翻译检测
        skip_blocks = 0
        existing_content = []
        if args.resume:
            existing_lines, existing_content, is_valid = load_existing_output(output_path)
            if existing_lines == -1:
                print("[Resume] Output file already complete. Nothing to do.")
                return
            elif is_valid and existing_lines > 0:
                skip_blocks = calculate_skip_blocks(blocks, existing_lines)
                if skip_blocks >= len(blocks):
                    print(f"[Resume] All {len(blocks)} blocks already translated. Nothing to do.")
                    return
                print(f"[Resume] Found {existing_lines} existing lines. Skipping {skip_blocks}/{len(blocks)} blocks.")
            else:
                print("[Resume] No valid existing output found. Starting fresh.")
        
        # Open output file, and optionally CoT file
        # 增量模式使用追加写入，否则覆盖写入
        output_mode = 'a' if (args.resume and skip_blocks > 0) else 'w'
        cot_context = open(cot_path, 'w', encoding='utf-8', buffering=1) if args.save_cot else nullcontext()
        with open(output_path, output_mode, encoding='utf-8', buffering=1) as f_out, \
             cot_context as f_cot:

            # Define Async Post-Processing Function
            def post_process_and_save(block_idx: int, block_data: object, parsed_lines: List[str], 
                                    gen_time: float, cot_content: str, raw_output: str):
                """
                Execute all CPU-intensive post-processing and File I/O in a background thread.
                """
                try:
                    # 1. Join parsed lines into text block
                    final_block_text = "\n".join(parsed_lines)
                    
                    # 2. Apply Fixers (Line-level)
                    fixed_lines = []
                    src_lines = block_data.prompt_text.split('\n')
                    dst_lines = final_block_text.split('\n')
                    for line_idx, dst_line in enumerate(dst_lines):
                        src_line = src_lines[line_idx] if line_idx < len(src_lines) else ""
                        dst_line = NumberFixer.fix(src_line, dst_line)
                        if args.fix_punctuation: dst_line = PunctuationFixer.fix(src_line, dst_line)
                        if args.fix_kana: dst_line = KanaFixer.fix(src_line, dst_line)
                        fixed_lines.append(dst_line)
                    
                    preview_block_text = '\n'.join(fixed_lines)
                    
                    # 3. Restore Protected Text
                    preview_block_text = batch_protector.restore(preview_block_text)

                    # 4. Post-Process Rules (Regex, etc.)
                    processed_block_text = post_processor.process(preview_block_text)
                    
                    # 5. OpenCC Conversion
                    if cc_converter:
                        processed_block_text = cc_converter.convert(processed_block_text)
                        preview_block_text = cc_converter.convert(preview_block_text)
                    
                    # Debug: Verify content
                    if len(processed_block_text) == 0:
                        print(f"[Async Warning] Block {block_idx+1} processed text IS EMPTY! Raw len: {len(raw_output)}")

                    # 6. Quality Check (使用 preview_block_text，避免后处理规则影响行数检测)
                    try:
                        # 原文和译文都按实际内容行数检测（忽略空行）
                        source_lines_for_check = [l for l in block_data.prompt_text.split('\n') if l.strip()]
                        output_lines_for_check = [l for l in preview_block_text.split('\n') if l.strip()]
                        quality_checker = QualityChecker(glossary=glossary)
                        warnings = quality_checker.check_output(
                            source_lines_for_check, 
                            output_lines_for_check,
                            source_lang="ja"
                        )
                        if warnings:
                            # Emit Warning JSON
                            for w in warnings[:3]:
                                sys.stdout.write(f"\nJSON_WARNING:{json.dumps({'block': block_idx+1, 'type': w['type'], 'message': w['message']}, ensure_ascii=False)}\n")
                                sys.stdout.flush()
                    except Exception as e:
                        print(f"[Async Quality Check Error] {e}")
                        warnings = []
                    
                    # 7. Write to Files
                    f_out.write(processed_block_text + "\n")
                    if args.mode == "doc": f_out.write("\n")
                    f_out.flush()
                    
                    if args.save_cot and cot_content:
                        f_cot.write(f"[MURASAKI] ========== Block {block_idx+1} ==========\n")
                        f_cot.write(raw_output + "\n\n")
                        f_cot.flush()
                    
                    # 8. Update Cache
                    if translation_cache:
                        w_types = [w['type'] for w in warnings] if warnings else []
                        translation_cache.add_block(block_idx, block_data.prompt_text, preview_block_text, w_types, cot_content)
                        m_name = os.path.basename(args.model) if args.model else "Unknown"
                        translation_cache.save(model_name=m_name, glossary_path=args.glossary or "")
                    
                    # 9. Emit Preview JSON (Preview logic logic moved here to support async)
                    # Note: We access the global lists 'all_src_previews'/'all_out_previews'. 
                    # With max_workers=1, this is thread-safe.
                    try:
                        # Block-based Preview (Async/Thread-safe)
                        preview_data = {
                            "block": block_idx + 1,
                            "src": block_data.prompt_text,
                            "output": preview_block_text
                        }
                        sys.stdout.write(f"\nJSON_PREVIEW_BLOCK:{json.dumps(preview_data, ensure_ascii=False)}\n")
                        sys.stdout.flush()
                    except Exception as e:
                        print(f"[Async Preview Error] {e}")

                    # 10. Return Stats
                    cot_inner = ""
                    if cot_content:
                        inner_match = re.search(r'<think>(.*?)</think>', cot_content, re.DOTALL)
                        cot_inner = inner_match.group(1) if inner_match else cot_content
                    
                    return {
                        "chars": len(block_data.prompt_text),
                        "lines": len([l for l in fixed_lines if l.strip()]),
                        "main_chars": len(processed_block_text),
                        "cot_chars": len(cot_inner)
                    }
                except Exception as e:
                    print(f"[Async Error] {e}")
                    import traceback; traceback.print_exc()
                    return {"chars": 0, "lines": 0, "main_chars": 0, "cot_chars": 0}
            
            # Async Executor
            executor = ThreadPoolExecutor(max_workers=1)
            futures = []
            
            for i, block in enumerate(blocks):
                # 增量翻译：跳过已完成的块
                if i < skip_blocks:
                    continue
                
                # Pause Check
                pause_file = output_path + ".pause"
                if os.path.exists(pause_file):
                    print(f"\n[Paused] Waiting for resumption...")
                    while os.path.exists(pause_file):
                        time.sleep(1)
                    print(f"\n[Resumed] Continuing translation...")
                    
                print(f"Processing Block {i+1}/{len(blocks)} ({len(block.prompt_text)} chars)...", end=" ", flush=True)
                start_t = time.time()
                
                # Pre-processing
                processed_src_text = pre_processor.process(block.prompt_text)
                # 文本正规化（全角字母数字转半角，半角假名转全角）
                processed_src_text = Normalizer.normalize(processed_src_text)
                # [Experimental] Ruby 注音清理
                if args.fix_ruby:
                    processed_src_text = RubyCleaner.clean(processed_src_text)
                
                # 文本保护：替换变量/标签为占位符
                processed_src_text = batch_protector.protect(processed_src_text)
                
                # Build Prompt
                messages = prompt_builder.build_messages(
                    processed_src_text, 
                    enable_cot=args.debug,
                    preset=args.preset
                )
                
                # Define streaming callback with real-time progress
                accumulated_output = ""
                stream_start_t = time.time()
                first_token_t = 0
                eval_speed = 0.0
                gen_speed = 0.0
                
                last_progress_t = 0
                total_chars_this_block = 0
                
                def on_stream_chunk(chunk):
                    nonlocal accumulated_output, last_progress_t, total_chars_this_block
                    nonlocal first_token_t, eval_speed, gen_speed
                    
                    accumulated_output += chunk
                    total_chars_this_block += len(chunk)
                    
                    current_t = time.time()
                    
                    # 1. CoT Streaming (Pass through raw chunks to frontend for parsing)
                    if "<think>" in chunk or "</think>" in chunk or (accumulated_output.strip().startswith("<think>") and not "</think>" in accumulated_output):
                        try:
                            # Send Delta for Thinking Stream
                            sys.stdout.write(f"\nJSON_THINK_DELTA:{json.dumps(chunk, ensure_ascii=False)}\n")
                        except: pass

                    # 2. Timing Stats
                    if first_token_t == 0:
                        first_token_t = current_t
                        # Prompt Eval finished (approx)
                        eval_dur = max(0.01, first_token_t - stream_start_t)
                        eval_speed = len(block.prompt_text) / eval_dur # Src chars / sec
                    
                    elapsed_this_block = current_t - stream_start_t
                    
                    # Throttle progress updates to every 1s for smoother display (减少冲突)
                    if current_t - last_progress_t >= 1.0:
                        last_progress_t = current_t
                        
                        # ETA Logic Refactored (Based on Source Chars Processed)
                        # 1. Total Source Chars
                        total_src_chars = sum(len(b.prompt_text) for b in blocks)
                        
                        # 2. Previous Completed Source Chars
                        src_chars_prev = sum(len(b.prompt_text) for b in blocks[:i])
                        
                        # 3. Estimate Current Block Progress (0.0 - 1.0)
                        # Assumption: Output is approx 2x Input (CoT included). This is a rough heuristic for progress bar.
                        est_ratio = min(0.99, total_chars_this_block / (max(1, len(block.prompt_text)) * 2.5 + 50))
                        
                        # 4. Total Expected Source Chars Done
                        src_chars_done_est = src_chars_prev + (len(block.prompt_text) * est_ratio)
                        
                        # 5. Cumulative Elapsed Time
                        cumulative_elapsed = total_time + elapsed_this_block
                        
                        # 6. Calculate Speed & ETA
                        # Use block-level average for more stable ETA
                        eta = 0
                        if i > 0 and cumulative_elapsed > 1.0:
                            # Block-based: avg time per block * remaining blocks
                            avg_time_per_block = cumulative_elapsed / (i + est_ratio)
                            remaining_blocks = len(blocks) - i - 1 + (1 - est_ratio)
                            eta = avg_time_per_block * remaining_blocks
                        elif cumulative_elapsed > 2.0 and src_chars_done_est > 10:
                            # Char-based fallback for first block
                            avg_speed_src = src_chars_done_est / cumulative_elapsed
                            src_remaining = total_src_chars - src_chars_done_est
                            if avg_speed_src > 0:
                                eta = src_remaining / avg_speed_src
                            
                        # Smooth Percent for UI
                        smooth_percent = (src_chars_done_est / total_src_chars * 100) if total_src_chars > 0 else 0
                        
                        # Gen Speed (Output chars / Gen time) - Needed for UI Stats
                        if first_token_t > 0:
                            gen_dur = max(0.01, current_t - first_token_t)
                            gen_speed = total_chars_this_block / gen_dur

                        try:
                            progress_streaming = {
                                "current": i + 1,
                                "total": len(blocks),
                                "percent": round(smooth_percent, 1),
                                "elapsed": round(cumulative_elapsed, 1),
                                "remaining": round(eta, 0),  # Now sending actual ETA!
                                "speed_lines": round(total_lines / cumulative_elapsed, 2) if cumulative_elapsed > 0.1 else 0,
                                "speed_chars": round(gen_speed, 1), # Current Gen Speed
                                "speed_eval": round(eval_speed, 1),
                                "speed_gen": round(gen_speed, 1),
                                "total_lines": total_lines,  # For history tracking
                                "total_chars": total_chars,  # For history tracking
                                "source_lines": source_lines,  # Input line count
                                "source_chars": source_chars   # Input char count
                            }
                            # ETA Calc: Remaining Blocks * Avg Block Time
                            # ... Leave ETA simple for now (0) or frontend handles it
                            
                            # 确保输出隔离：换行 + flush
                            sys.stdout.write(f"\nJSON_PROGRESS:{json.dumps(progress_streaming, ensure_ascii=False)}\n")
                            
                            # Emit Hardware Monitor Data
                            hw_status = monitor.get_status()
                            if hw_status:
                                sys.stdout.write(f"\nJSON_MONITOR:{json.dumps(hw_status)}\n")
                            
                            sys.stdout.flush()
                        except Exception:
                            pass  # 忽略任何序列化错误

                # Inference with Retries
                max_retries = args.max_retries
                parsed_lines = []
                cot_content = ""
                raw_output = ""
                last_coverage = 0.0
                last_missed_terms = []
                
                # 追踪所有尝试的结果，最后选择覆盖率最高的
                best_result = None  # (parsed_lines, cot_content, raw_output, coverage)
                retry_reason = None  # 'empty' or 'glossary'
                
                for attempt in range(max_retries + 1):
                    # 动态参数计算
                    # 空输出重试：提高温度（增加多样性）
                    # 术语表重试：降低温度（增加确定性，更遵循指令）
                    if retry_reason == 'glossary':
                        # 术语表重试：降低温度，提高惩罚
                        current_temp = max(args.temperature - (attempt * args.retry_temp_boost), 0.3)
                        current_rep_base = args.rep_penalty_base + (attempt * args.retry_rep_boost)
                    else:
                        # 空输出重试：提高温度
                        current_temp = min(args.temperature + (attempt * args.retry_temp_boost), 1.2)
                        current_rep_base = args.rep_penalty_base + (attempt * args.retry_rep_boost)
                    
                    # 构建消息（可能包含反馈注入）
                    messages_for_attempt = messages
                    # 仅在明确因术语问题重试时才注入反馈，避免与其他重试逻辑（如行数检查）冲突
                    if attempt > 0 and args.retry_prompt_feedback and glossary and last_missed_terms and retry_reason == 'glossary':
                        # 注入反馈到用户消息末尾
                        feedback = build_retry_feedback(last_missed_terms, last_coverage)
                        if feedback:
                            messages_for_attempt = messages.copy()
                            # 在最后一条 user 消息中追加反馈
                            for j in range(len(messages_for_attempt) - 1, -1, -1):
                                if messages_for_attempt[j].get("role") == "user":
                                    messages_for_attempt[j] = {
                                        "role": "user",
                                        "content": messages_for_attempt[j]["content"] + feedback
                                    }
                                    break
                            print(f"[Dynamic Retry] 📝 Injected feedback about {len(last_missed_terms)} missed terms")
                    
                    if attempt > 0:
                        direction = "↓" if retry_reason == 'glossary' else "↑"
                        print(f"[Dynamic Retry] 🔄 Attempt {attempt+1}: temp={current_temp:.2f}{direction}, rep_base={current_rep_base:.2f} (Reason: {retry_reason})")
                    
                    raw_output = engine.chat_completion(
                        messages_for_attempt, 
                        temperature=current_temp, 
                        stream_callback=on_stream_chunk,
                        rep_base=current_rep_base,
                        rep_max=args.rep_penalty_max,
                        block_id=i+1
                    )
                    
                    # Parse immediately
                    parsed_lines, cot_content = response_parser.parse(raw_output or "", expected_count=0)
                    has_content = parsed_lines and any(line.strip() for line in parsed_lines)
                    
                    # 1. Empty Output Guard
                    if not has_content:
                        retry_reason = 'empty'
                        if attempt < max_retries:
                            print(f"\n[Empty Output Guard] ⚠️ Block {i+1} returned empty/invalid. Retrying (Attempt {attempt + 2}/{max_retries + 1})...")
                            sys.stdout.write(f"\nJSON_RETRY:{json.dumps({'block': i+1, 'attempt': attempt+1, 'type': 'empty', 'temp': current_temp})}\n")
                            sys.stdout.flush()
                            continue
                        else:
                            print(f"\n[Empty Output Guard] ❌ Block {i+1} failed after {max_retries + 1} attempts.")
                            # Fall through to fallback
                    
                    # If we have content, run quality checks
                    if has_content:
                        should_retry = False
                        current_coverage = 100.0
                        
                        # 2. Glossary Coverage Check
                        if glossary and args.output_hit_threshold > 0:
                            translated_text = '\n'.join(parsed_lines)
                            passed, coverage, cot_coverage, hit, total = calculate_glossary_coverage(
                                block.prompt_text, translated_text, glossary, cot_content,
                                args.output_hit_threshold, args.cot_coverage_threshold
                            )
                            current_coverage = coverage
                            
                            # 调试日志：始终输出详细覆盖率信息
                            if total > 0:
                                print(f"[Glossary] Block {i+1}: Output={coverage:.1f}% ({hit}/{total}), CoT={cot_coverage:.1f}% -> {'Pass' if passed else 'Fail'}")
                            
                            # 记录 missed terms 用于下一次重试反馈
                            last_coverage = coverage
                            last_missed_terms = get_missed_terms(block.prompt_text, translated_text, glossary)
                            
                            # 保存当前结果（如果覆盖率更高）
                            if best_result is None or coverage > best_result[3]:
                                best_result = (parsed_lines.copy(), cot_content, raw_output, coverage)
                            
                            if total > 0 and not passed:
                                # 优先级控制：如果当前正在处理更高优先级的错误（如行数不匹配），则忽略术语表的非致命问题，避免耗尽重试次数
                                if retry_reason and retry_reason != 'glossary':
                                    print(f"\n[Glossary Check] ⚠️ Block {i+1}: Output {coverage:.1f}% / CoT {cot_coverage:.1f}%. Skipping glossary retry to focus on fixing {retry_reason}.")
                                else:
                                    retry_reason = 'glossary'
                                    # Use separate counter for coverage retries logic, but bound by main loop attempts
                                    coverage_attempts = min(attempt + 1, args.coverage_retries)
                                    if coverage_attempts < args.coverage_retries and attempt < max_retries:
                                        missed_str = ", ".join([f"'{t[0]}'" for t in last_missed_terms[:3]])
                                        if len(last_missed_terms) > 3:
                                            missed_str += f" 等{len(last_missed_terms)}项"
                                        print(f"\n[Glossary Check] ⚠️ Block {i+1}: Output {coverage:.1f}% / CoT {cot_coverage:.1f}%. Missed: {missed_str}. Retrying (Attempt {attempt + 2}/{max_retries + 1})...")
                                        
                                        # Safe JSON emit with more info
                                        retry_data = {
                                            'block': i+1, 
                                            'attempt': attempt+1, 
                                            'type': 'glossary',
                                            'coverage': coverage,
                                            'temp': current_temp,
                                            'missed_count': len(last_missed_terms)
                                        }
                                        sys.stdout.write(f"\nJSON_RETRY:{json.dumps(retry_data)}\n")
                                        sys.stdout.flush()
                                        should_retry = True
                                    else:
                                        # 重试用尽，使用覆盖率最高的版本
                                        if best_result and best_result[3] > coverage:
                                            print(f"\n[Glossary Check] ✅ Using best result with {best_result[3]:.1f}% coverage (current: {coverage:.1f}%)")
                                            parsed_lines, cot_content, raw_output, _ = best_result
                                        else:
                                            print(f"\n[Glossary Check] ⚠️ Block {i+1}: coverage {coverage:.1f}% ({hit}/{total}) after {coverage_attempts} attempts. Proceeding with current result.")

                        # 3. Line Count Check
                        if not should_retry and args.line_check:
                            src_line_count = len([l for l in block.prompt_text.splitlines() if l.strip()])
                            dst_line_count = len([l for l in parsed_lines if l.strip()])
                            # Use logic aligned with QualityChecker: compare non-empty lines
                            # (Though parsed_lines are already stripped/filtered above? No, parsed_lines is raw list)
                            # Let's trust simple count here vs logic in QualityChecker. 
                            # Re-align with QualityChecker logic:
                            
                            diff = abs(dst_line_count - src_line_count)
                            pct_diff = diff / max(1, src_line_count)
                            
                            if diff > args.line_tolerance_abs or pct_diff > args.line_tolerance_pct:
                                if attempt < max_retries:
                                    retry_reason = 'line_check'
                                    print(f"\n[Line Check] ⚠️ Block {i+1}: line mismatch {src_line_count} -> {dst_line_count}. Retrying (Attempt {attempt + 2}/{max_retries + 1})...")
                                    
                                    retry_data = {
                                        'block': i+1, 
                                        'attempt': attempt+1, 
                                        'type': 'line_check'
                                    }
                                    sys.stdout.write(f"\nJSON_RETRY:{json.dumps(retry_data)}\n")
                                    sys.stdout.flush()
                                    should_retry = True
                                else:
                                    print(f"\n[Line Check] ⚠️ Block {i+1}: line mismatch {src_line_count} -> {dst_line_count}. Proceeding anyway.")
                        
                        if should_retry:
                            continue
                        
                        # All checks passed (or ignored)
                        break

                # Final Fallback
                if not parsed_lines or not any(line.strip() for line in parsed_lines):
                    print(f" [Fallback] Using source text for Block {i+1}")
                    parsed_lines = ["[翻译失败]"] + block.prompt_text.split('\n')
                
                # 4. Async Post-Processing (Fire and Forget)
                gen_dur = time.time() - start_t  # Calculate duration for this block
                total_time += gen_dur
                
                # Accumulate tokens if available
                if engine.last_usage:
                    total_tokens += engine.last_usage.get('total_tokens', 0)
                
                total_chars += len(block.prompt_text)
                
                total_lines += len(parsed_lines) # Estimate for progress bar
                
                future = executor.submit(
                    post_process_and_save,
                    block_idx=i, block_data=block, parsed_lines=parsed_lines,
                    gen_time=gen_dur, cot_content=cot_content, raw_output=raw_output
                )
                futures.append(future)
                
                # Simple Progress Update
                try:
                    c_speed = len(block.prompt_text) / gen_dur if gen_dur > 0 else 0
                    eta = (len(blocks) - i - 1) * (total_time / (i + 1 - skip_blocks)) if i > skip_blocks else 0
                    
                    # Calculate real token speeds from usage data
                    real_eval_speed = 0.0
                    real_gen_speed = 0.0
                    if engine.last_usage:
                        prompt_tokens = engine.last_usage.get('prompt_tokens', 0)
                        completion_tokens = engine.last_usage.get('completion_tokens', 0)
                        if gen_dur > 0:
                            real_eval_speed = prompt_tokens / gen_dur
                            real_gen_speed = completion_tokens / gen_dur
                    
                    progress_event = {
                        "current": i + 1, "total": len(blocks), "percent": round(((i + 1)/len(blocks))*100, 1),
                        "elapsed": round(total_time, 1), "remaining": round(eta, 1), "speed_chars": round(c_speed, 1),
                        "speed_lines": round(total_lines / total_time, 2) if total_time > 0 else 0,
                        "speed_gen": round(real_gen_speed, 1), "speed_eval": round(real_eval_speed, 1)
                    }
                    sys.stdout.write(f"\nJSON_PROGRESS:{json.dumps(progress_event, ensure_ascii=False)}\n")
                    sys.stdout.flush()
                except: pass
                
                print(f"Done ({gen_dur:.2f}s, {c_speed:.1f} char/s) [Async Save]")
                
                # Clean vars
                del raw_output
                del cot_content
                
                continue # Skip Sync Logic
                
                # Post-processing (on lines)
                final_block_text = "\n".join(parsed_lines)
                
                # Apply Fixers (行级修复)
                # Must run BEFORE post-processor rules that change line count/layout
                fixed_lines = []
                src_lines = block.prompt_text.split('\n')
                dst_lines = final_block_text.split('\n')
                for line_idx, dst_line in enumerate(dst_lines):
                    src_line = src_lines[line_idx] if line_idx < len(src_lines) else ""
                    
                    # 稳定修复器：数字修复（圆圈数字恢复）
                    dst_line = NumberFixer.fix(src_line, dst_line)
                    
                    # 实验性修复器（受命令行参数控制）
                    if args.fix_punctuation:
                        dst_line = PunctuationFixer.fix(src_line, dst_line)
                    if args.fix_kana:
                        dst_line = KanaFixer.fix(src_line, dst_line)
                    
                    fixed_lines.append(dst_line)
                
                # Rejoin fixed lines
                preview_block_text = '\n'.join(fixed_lines)
                
                # 文本保护还原：将占位符还原为原文
                preview_block_text = batch_protector.restore(preview_block_text)

                # Post-processing (Regex, Format Rules, OpenCC)
                # Applied LAST because format rules (e.g. double newline) break line alignment
                processed_block_text = post_processor.process(preview_block_text)
                
                # Traditional Chinese Conversion (OpenCC)
                if cc_converter:
                    processed_block_text = cc_converter.convert(processed_block_text)
                    preview_block_text = cc_converter.convert(preview_block_text) # Also convert preview
                
                final_lines = processed_block_text.split('\n')
                total_lines_raw = len(final_lines) # renamed to avoid confusion, actual total_lines updated later
                
                duration = time.time() - start_t
                total_chars += len(block.prompt_text)
                total_time += duration  # Update BEFORE emitting progress
                
                # Accumulate output character counts for final stats
                # cot_content contains <think>...<think> with tags
                # Extract inner content for char count
                cot_inner = ""
                if cot_content:
                    inner_match = re.search(r'<think>(.*?)</think>', cot_content, re.DOTALL)
                    cot_inner = inner_match.group(1) if inner_match else cot_content
                
                # Main chars = translated text (after parsing)
                # CoT chars = thinking content (inside <think> tags)
                main_chars = len(processed_block_text)
                cot_chars = len(cot_inner)
                total_main_chars += main_chars
                total_cot_chars += cot_chars
                
                # Debug stats (only when --debug is enabled)
                if args.debug:
                    print(f"[STATS] Block {i+1}: main={main_chars}, cot={cot_chars}, raw={len(raw_output)}")
                
                # Quality Check (Robustness)
                try:
                    source_lines_for_check = block.prompt_text.split('\n')
                    output_lines_for_check = final_lines
                    quality_checker = QualityChecker(glossary=glossary)
                    warnings = quality_checker.check_output(
                        source_lines_for_check, 
                        output_lines_for_check,
                        source_lang="ja"  # TODO: make configurable
                    )
                    if warnings:
                        warning_log = format_warnings_for_log(warnings)
                        print(warning_log)
                        # Emit as JSON for frontend tracking
                        for w in warnings[:3]:  # Limit to first 3 warnings per block
                            sys.stdout.write(f"\nJSON_WARNING:{json.dumps({'block': i+1, 'type': w['type'], 'message': w['message']}, ensure_ascii=False)}\n")
                            sys.stdout.flush()
                except Exception as e:
                    if args.debug:
                        print(f"[Quality Check Error] {e}")
                
                # Calculate speeds
                block_speed = len(block.prompt_text) / duration if duration > 0 else 0
                avg_speed = total_chars / total_time if total_time > 0 else 0  # Use AVERAGE speed for ETA
                
                print(f"Done ({duration:.2f}s, {block_speed:.1f} char/s)")
                
                # Emit Final JSON Logs for GUI (完整显示，不截断)
                # 使用 sys.stdout.write 确保输出隔离
                try:
                    # Block-based Preview Emission
                    # 发送当前块的完整原文和译文，让前端进行分块渲染，避免行数不匹配导致的级联错位
                    preview_data = {
                        "block": i + 1,
                        "src": block.prompt_text,
                        "output": preview_block_text
                    }
                    sys.stdout.write(f"\nJSON_PREVIEW_BLOCK:{json.dumps(preview_data, ensure_ascii=False)}\n")
                    sys.stdout.flush()
                except Exception as e:
                    print(f"[ERROR] Preview JSON failed: {e}")
                
                # Calculate remaining time using AVERAGE speed (not instantaneous)
                remaining_blocks = len(blocks) - (i + 1)
                remaining_chars = sum(len(b.prompt_text) for b in blocks[i+1:])
                eta = remaining_chars / avg_speed if avg_speed > 0 else 0
                
                # JSON_PROGRESS with improved ETA
                # Calculate lines processed
                lines_in_block = len([l for l in final_lines if l.strip()])
                total_lines += lines_in_block
                speed_lines = lines_in_block / duration if duration > 0 else 0
                
                try:
                    progress_event = {
                        "current": i + 1,
                        "total": len(blocks),
                        "percent": round((i + 1) / len(blocks) * 100, 1),
                        "elapsed": round(total_time, 1),
                        "remaining": round(eta, 1),
                        "speed_lines": round(speed_lines, 2), 
                        "speed_chars": round(avg_speed, 1)
                    }
                    sys.stdout.write(f"\nJSON_PROGRESS:{json.dumps(progress_event, ensure_ascii=False)}\n")
                    sys.stdout.flush()
                except Exception as e:
                    print(f"[ERROR] Progress JSON failed: {e}")

                # Write Output
                f_out.write(processed_block_text + "\n")
                if args.mode == "doc":
                     f_out.write("\n") # Keep block separation
                
                f_out.flush()
                
                # Write to CoT Output (if enabled)
                if args.save_cot:
                    f_cot.write(f"[MURASAKI] ========== Block {i+1}/{len(blocks)} ==========\n")
                    f_cot.write(raw_output + "\n\n")
                    f_cot.flush()
                
                # 添加到翻译缓存（用于校对界面）
                if translation_cache:
                    warning_types = [w['type'] for w in warnings] if 'warnings' in dir() and warnings else []
                    translation_cache.add_block(
                        index=i,
                        src=block.prompt_text,
                        dst=preview_block_text,
                        warnings=warning_types,
                        cot=cot_content if args.save_cot else ''
                    )

                if i > 0 and i % 5 == 0 and total_time > 0:
                     print(f"    [Global Speed] {total_chars/total_time:.1f} chars/s (Input)")
            
            # Wait for Async Tasks
            print("\n[System] Waiting for background tasks...")
            executor.shutdown(wait=True)
            
            # Accumulate Final Stats from Futures
            # Reset counters to ensure accuracy from actual processed results
            # total_time is already measured
            total_main_chars = 0
            total_cot_chars = 0
            final_output_lines = 0
            
            for f in futures:
                try:
                    res = f.result()
                    if res:
                        total_main_chars += res.get('main_chars', 0)
                        total_cot_chars += res.get('cot_chars', 0)
                        final_output_lines += res.get('lines', 0)
                except Exception as e:
                    print(f"[Stats Error] Failed to get result from future: {e}")
            
            # Update total_lines to the accurate final count
            total_lines = final_output_lines

            # Write Summary to Files (if enabled)
            if total_time > 0 and args.save_summary:
                # Simple speed calculation (divide by total time)
                cot_speed = total_cot_chars / total_time
                main_speed = total_main_chars / total_time
                total_out_speed = (total_cot_chars + total_main_chars) / total_time
                
                gpu_info = "All (-1)" if args.gpu_layers == -1 else str(args.gpu_layers)
                
                summary_text = (
                    f"\n\n{'='*20} Translation Summary {'='*20}\n"
                    f"Model:      {display_name}\n"
                    f"Params:     {params}\n"
                    f"Quant:      {quant}\n"
                    f"GPU:        {gpu_name}\n"
                    f"GPU Layers: {gpu_info}\n"
                    f"Total Time: {total_time:.2f} s\n"
                    f"Total Tokens: {total_tokens}\n"
                    f"Input Chars: {total_chars}\n"
                    f"CoT Chars:   {total_cot_chars}\n"
                    f"Main Chars:  {total_main_chars}\n"
                    f"----------------------------------------\n"
                    f"CoT Speed:   {cot_speed:.1f} chars/s\n"
                    f"Main Speed:  {main_speed:.1f} chars/s\n"
                    f"Throughput:  {total_out_speed:.1f} chars/s (Main + CoT)\n"
                    f"{'='*60}\n"
                )
                f_out.write(summary_text)
                if args.save_cot:
                    f_cot.write(summary_text)

        # 保存翻译缓存文件（用于校对界面）
        if translation_cache:
            model_name = display_name if 'display_name' in dir() else ''
            # Use resolved absolute path
            if translation_cache.save(model_name=model_name, glossary_path=glossary_path or ''):
                print(f"[Cache] Saved: {translation_cache.cache_path}")
            else:
                print("[Cache] Failed to save cache")

        print(f"\n{'='*20} Summary Report {'='*20}")
        print(f"Output File: {output_path}")
        if args.save_cot:
            print(f"CoT File:    {cot_path}")
            
        if total_time > 0:
             # Simple speed calculation (divide by total time)
             cot_speed = total_cot_chars / total_time
             main_speed = total_main_chars / total_time
             total_out_speed = (total_cot_chars + total_main_chars) / total_time
             
             gpu_info = "All (-1)" if args.gpu_layers == -1 else str(args.gpu_layers)
             
             print(f"\n[Global Stats]")
             print(f"Model:       {display_name}")
             print(f"Params:      {params}")
             print(f"Quant:       {quant}")
             print(f"GPU:         {gpu_name}")
             print(f"GPU Layers:  {gpu_info}")
             print(f"Total Time:  {total_time:.2f} s")
             print(f"Total Tokens:  {total_tokens}")
             print(f"----------------------------------------")
             print(f"CoT Speed:   {cot_speed:.1f} chars/s")
             print(f"Main Speed:  {main_speed:.1f} chars/s")
             print(f"Throughput:  {total_out_speed:.1f} chars/s (Main + CoT)")

             # 发送最终统计数据给前端
             final_stats = {
                 "sourceLines": source_lines,
                 "sourceChars": source_chars,
                 "outputLines": total_lines, 
                 "outputChars": total_main_chars,
                 "totalTokens": total_tokens,
                 "totalTime": round(total_time, 2),
                 "avgSpeed": round(total_out_speed, 1),
                 "model": display_name
             }
             sys.stdout.write(f"\nJSON_FINAL:{json.dumps(final_stats, ensure_ascii=False)}\n")
             sys.stdout.flush()
        
        print(f"{'='*56}\n")
        
    except KeyboardInterrupt:
        print("\nInterrupted.")
    finally:
        engine.stop_server()

if __name__ == "__main__":
    main()
