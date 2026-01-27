"""Inference Engine - Manages llama-server.exe lifecycle and API calls."""

import os
import time
import json
import logging
import subprocess
import requests
import atexit
import threading
from typing import List, Dict, Optional, Callable

logger = logging.getLogger(__name__)


class InferenceEngine:
    """
    Inference Engine wrapping llama-server.exe.
    Handles server startup, health checks, chat completions with retry logic.
    """

    def __init__(self, server_path: str, model_path: str, host: str = "127.0.0.1", port: int = 8080, 
                 n_gpu_layers: int = -1, n_ctx: int = 8192, n_parallel: int = 1, no_spawn: bool = False,
                 # Granular High-Fidelity Options
                 flash_attn: bool = False,
                 kv_cache_type: str = "q8_0",
                 use_large_batch: bool = False,
                 batch_size: Optional[int] = None,
                 seed: Optional[int] = None):
        self.server_path = server_path
        self.model_path = model_path
        self.host = host
        self.port = port
        self.n_gpu_layers = n_gpu_layers
        self.n_ctx = n_ctx
        self.n_parallel = n_parallel
        self.no_spawn = no_spawn
        
        # Store Granular Options
        self.flash_attn = flash_attn
        self.kv_cache_type = kv_cache_type
        self.use_large_batch = use_large_batch
        self.batch_size = batch_size
        self.seed = seed
        
        self._usage_lock = threading.Lock()
        self.last_usage = None
        self.base_url = f"http://{host}:{port}"
        self.session = requests.Session()
        self.process = None


    def start_server(self):
        if self.no_spawn:
            logger.info("External server mode enabled. Skipping server spawn.")
            self._wait_for_ready()
            return

        if not os.path.exists(self.server_path):
             raise FileNotFoundError(f"Server binary not found: {self.server_path}")
        if not os.path.exists(self.model_path):
             raise FileNotFoundError(f"Model file not found: {self.model_path}")

        cmd = [
            self.server_path,
            "-m", self.model_path,
            "--host", self.host,
            "--port", str(self.port),
            "-ngl", str(self.n_gpu_layers),
            "-c", str(self.n_ctx),
            "--ctx-size", str(self.n_ctx),
            "--parallel", str(self.n_parallel),
            "--reasoning-format", "deepseek-legacy"
        ]
        
        # --- Granular High-Fidelity CLI Construction ---
        
        # 1. Flash Attention (Required for stability in high concurrency)
        if self.flash_attn:
            cmd.extend(["-fa", "on"])
            
        # 2. KV Cache Selection (Default Q8_0)
        if self.kv_cache_type:
            cmd.extend(["--cache-type-k", self.kv_cache_type, "--cache-type-v", self.kv_cache_type])
            
        # 3. Large Batch Size (Forced Physical Sync - Safe min(1024, ctx))
        if self.batch_size:
            final_batch = min(self.batch_size, self.n_ctx)
            cmd.extend(["-b", str(final_batch), "-ub", str(final_batch)])
        elif self.use_large_batch:
            safe_batch = min(1024, self.n_ctx)
            cmd.extend(["-b", str(safe_batch), "-ub", str(safe_batch)])
            
        # 5. Seed Locking
        if self.seed is not None:
            cmd.extend(["-s", str(self.seed)])
            
        # Logging active features
        features = []
        if self.flash_attn: features.append("FlashAttn")
        if self.kv_cache_type != "q8_0": features.append(f"KV:{self.kv_cache_type}")
        if self.batch_size: features.append(f"Batch:{self.batch_size}")
        elif self.use_large_batch: features.append("BigBatch(1024)")
        if self.seed is not None: features.append(f"Seed={self.seed}")
        
        if features:
            logger.info(f"High-Fidelity Features Enabled: {', '.join(features)}")
        
        # 将输出重定向到 server.log，保持 GUI 日志清洁
        self.server_log = open("server.log", "w", encoding='utf-8')
        self.process = subprocess.Popen(cmd, stdout=self.server_log, stderr=self.server_log) 

        atexit.register(self.stop_server)
        self._wait_for_ready()
        
    def _wait_for_ready(self, timeout=60):
        logger.info("Waiting for server to be ready...")
        start = time.time()
        while time.time() - start < timeout:
            try:
                # 使用标准健康检查接口
                resp = self.session.get(f"{self.base_url}/v1/models", timeout=5)
                if resp.status_code == 200:
                    logger.info("Server is ready!")
                    return
            except Exception:
                pass
            time.sleep(1)
            
        self.stop_server()
        
        # Try to extract a useful error from the log
        error_hint = "Server failed to start within timeout"
        try:
            if os.path.exists("server.log"):
                with open("server.log", "r", encoding='utf-8', errors='ignore') as f:
                    lines = f.readlines()[-20:]
                    log_tail = "".join(lines)
                    if "error" in log_tail.lower() or "fail" in log_tail.lower():
                        if "flash_attn" in log_tail or "-fa" in log_tail:
                            error_hint = "Flash Attention is NOT supported by this model/hardware."
                        elif "CUDA error" in log_tail:
                            error_hint = "CUDA Error: Likely Out of Memory (VRAM)."
                        elif "unsupported" in log_tail:
                            error_hint = f"Unsupported parameter or architecture found in logs."
        except: pass
        
        raise TimeoutError(f"{error_hint} (Check server.log for details)")

    def stop_server(self):
        if self.no_spawn:
            return

        if self.process:
            pid = self.process.pid
            logger.info(f"Stopping server (PID: {pid})...")
            try:
                self.process.terminate()
                try:
                    self.process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                     logger.warning("Server terminate timeout, forcing kill...")
                     self.process.kill()
                     self.process.wait()
            except Exception as e:
                logger.error(f"Error stopping server: {e}")
            
            # Windows specific: ensure llama-server is 100% killed
            if os.name == 'nt':
                try:
                    # Hide the CMD window for taskkill
                    startupinfo = subprocess.STARTUPINFO()
                    startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                    startupinfo.wShowWindow = 0 # SW_HIDE
                    
                    subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], 
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 startupinfo=startupinfo)
                except: pass
                
            self.process = None
            
        if hasattr(self, 'session') and self.session:
             try:
                 self.session.close()
             except: pass

        if hasattr(self, 'server_log') and self.server_log:
            try:
                self.server_log.close()
            except: pass
            self.server_log = None

    def chat_completion(self, messages: List[Dict], temperature: float = 0.7, stream: bool = True, stream_callback=None, rep_base: float = 1.0, rep_max: float = 1.5, block_id: int = 0) -> str:
        """
        调用 Chat Completion API (With Auto-Retry Strategy)
        Strategy:
        1. Try with RepetitionPenalty=rep_base (Training Default).
        2. If Repetition Loop detected, Retry with higher penalty up to rep_max.
        """
        
        # Local state for this request (Thread-Safe)
        local_last_usage = None
        local_token_count = 0
        
        # 动态生成尝试策略
        attempts = [rep_base]
        if rep_base < rep_max:
            # 第二次尝试：跳到 1.2 或 base + 0.2
            second = max(1.2, rep_base + 0.2)
            if second <= rep_max:
                attempts.append(round(second, 2))
            # 递增
            p = second + 0.1
            while p <= rep_max + 0.05:  # Allow slightly over due to float prec
                attempts.append(round(p, 2))
                p += 0.1
             
        final_idx = len(attempts) - 1
        
        # Retry loop for repetition penalty
        for idx, penalty in enumerate(attempts):
            is_final = (idx == final_idx)
            payload = {
                "messages": messages,
                "temperature": temperature,
                "top_p": 0.95,  # Fixed value for consistent results
                "stream": stream,
                "n_predict": -1,  # Generate until EOS or context full
                "repetition_penalty": penalty,
                "presence_penalty": 0.0,
                "frequency_penalty": 0.0,
                # Comprehensive Stop Tokens for Llama3, Qwen, Mistral, ChatML
                "stop": [
                    "<|im_end|>",       # ChatML
                    "<|endoftext|>",    # GPT/Base
                    "</s>",             # Llama 2/Mistral
                    "<|eot_id|>",       # Llama 3
                    "<|end_of_text|>",  # Llama 3 Base
                    "\\n\\n\\n"         # Heuristic Safety Net
                ] 
            }
            
            if stream:
                payload["stream_options"] = {"include_usage": True}
            
            try:
                if idx > 0:
                    prefix = f"[Block {block_id}] " if block_id is not None else ""
                    logger.info(f"{prefix}Detected loop. Internal retry ({idx}) with RepetitionPenalty={penalty}...")
                    # Notify GUI of retry
                    retry_data = {
                        "block": block_id,
                        "attempt": idx, # Current attempt index (0 was first, so 1 is first retry)
                        "type": "repetition",
                        "penalty": penalty
                    }
                    import sys
                    sys.stdout.write(f"\nJSON_RETRY:{json.dumps(retry_data, ensure_ascii=False)}\n")
                    sys.stdout.flush()
                
                req_start_time = time.time()
                response = self.session.post(
                    f"{self.base_url}/v1/chat/completions",
                    json=payload,
                    stream=stream,
                    timeout=(10, 600) # (Connect timeout, Read timeout)
                )
                response.raise_for_status()
                
                full_reasoning = ""
                full_text = ""
                loop_detected = False
                
                if stream:
                    
                    for line in response.iter_lines():
                        if not line: continue
                        line = line.decode('utf-8')
                        if not line.startswith('data: '): continue
                        data = line[6:]
                        if data == '[DONE]': break
                        try:
                            chunk = json.loads(data)
                            
                            if 'usage' in chunk:
                                local_last_usage = chunk['usage']
                            
                            if 'choices' not in chunk or len(chunk['choices']) == 0:
                                continue
                                
                            delta = chunk['choices'][0]['delta']
                            
                            reasoning = delta.get('reasoning_content', '')
                            content = delta.get('content', '')
                            
                            if reasoning:
                                full_reasoning += reasoning
                                # Count reasoning tokens (fallback)
                                if local_last_usage is None:
                                    local_token_count += 1
                                
                            if content:
                                full_text += content
                                if stream_callback:
                                    stream_callback(content)
                                # Count completion tokens (fallback)
                                if local_last_usage is None:
                                    local_token_count += 1
                                
                                # Repetition Guard
                                if len(full_text) > 20:
                                    last_char = full_text[-1]
                                    # Whitelist for stylistic repetition (Light Novel style)
                                    # Allow: Ellipsis, Dash, Tilde, Exclamation, Spaces, 'Ah', 'Ugh', etc.
                                    SAFE_LOOP_CHARS = {'…', '—', '─', '~', '～', '！', '!', '？', '?', '.', '。', ' ', '\n', '　', '啊', 'ー', '”', '’'}
                                    
                                    # Dynamic threshold
                                    loop_threshold = 20
                                    if last_char in SAFE_LOOP_CHARS:
                                        loop_threshold = 80  # Allow much longer stylistic loops
                                    
                                    # 1. Single Char Loop (e.g. ".......")
                                    if len(full_text) >= loop_threshold and full_text[-loop_threshold:] == last_char * loop_threshold:
                                        logger.warning(f"Detected char loop on '{last_char}' (Limit={loop_threshold}). Aborting.")
                                        loop_detected = True
                                    
                                    # 2. Phrase Loop (e.g. "output... output...")
                                    # Check for repeated suffixes of length 20 to 1000
                                    if not loop_detected and len(full_text) > 60:
                                        # Optimization: Check only specific logical boundaries or plain range
                                        limit = min(1000, len(full_text) // 2)
                                        for length in range(20, limit):
                                            # Quick check last char to avoid slice cost
                                            if full_text[-1] != full_text[-1-length]: continue
                                            
                                            # Check if the last 'length' chars are same as previous 'length'
                                            if full_text[-length:] == full_text[-2*length:-length]:
                                                logger.warning(f"Detected phrase loop (len={length}). Aborting.")
                                                loop_detected = True
                                                break
                                    
                                    if loop_detected:
                                        response.close()
                                        break
                                        
                        except: pass
                    
                    # Fallback Usage Construction
                    if local_last_usage is None:
                        # Estimate prompt tokens
                        prompt_est = 0
                        is_fallback = True
                        if 'messages' in payload:
                            # Improved estimation for CJK: Chars * 1.3
                            txt_len = sum(len(m['content']) for m in payload['messages'])
                            prompt_est = int(txt_len * 1.3) 
                        
                        local_last_usage = {
                            "prompt_tokens": prompt_est,
                            "completion_tokens": local_token_count,
                            "total_tokens": prompt_est + local_token_count,
                            "fallback": True
                        }
                        if is_final:
                             logger.warning(f"Usage statistics missing from server. Using fallback estimation (Chars*1.3).")
                    
                    # Add duration for TPS calculation
                    req_duration = time.time() - req_start_time
                    local_last_usage["duration"] = max(0.001, req_duration)
                    
                    # Update global last_usage (Thread-Safe update for monitoring)
                    with self._usage_lock:
                        self.last_usage = local_last_usage
                    
                    # Decide what to do

                    if loop_detected:
                        if not is_final:
                            # Trigger Retry
                            continue 
                        else:
                            # Final attempt failed too. Return what we have.
                            logger.error(f"Final attempt also looped. Returning truncated text.")
                    
                    # Success or Final Fail -> Return Result
                    final_text = full_text
                    if full_reasoning:
                        final_text = f"<think>{full_reasoning}</think>\n{full_text}"
                    
                    return final_text, local_last_usage

                else:
                    # Non-stream not supported for loop detection currently
                    resp_json = response.json()
                    usage = None
                    if 'usage' in resp_json:
                        with self._usage_lock:
                            self.last_usage = resp_json['usage']
                        usage = resp_json['usage']
                    
                    msg = resp_json['choices'][0]['message']
                    return msg.get('content', ''), usage
                    
            except Exception as e:
                logger.error(f"Inference Error: {e}")
                logger.warning(f"API call failed: {e}")
                if is_final:
                    logger.error(f"Final attempt failed. Returning empty.")
                    return "", None
                # If network error, maybe don't retry with higher penalty? 
                # But here we stick to the plan.
        
        return "", None
