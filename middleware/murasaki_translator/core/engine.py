"""Inference Engine - Manages llama-server.exe lifecycle and API calls."""

import os
import time
import json
import logging
import subprocess
import requests
import atexit
from typing import List, Dict, Optional, Callable

logger = logging.getLogger(__name__)


class InferenceEngine:
    """
    Inference Engine wrapping llama-server.exe.
    Handles server startup, health checks, chat completions with retry logic.
    """

    def __init__(self, server_path: str, model_path: str, host: str = "127.0.0.1", port: int = 8080, n_gpu_layers: int = -1, n_ctx: int = 8192, no_spawn: bool = False):
        self.server_path = server_path
        self.model_path = model_path
        self.host = host
        self.port = port
        self.n_gpu_layers = n_gpu_layers
        self.n_ctx = n_ctx
        self.no_spawn = no_spawn
        self.base_url = f"http://{host}:{port}"
        self.process = None
        self.last_usage = None


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
            "--parallel", "1", 
            "-fa", "on" # 必须显式开启
        ]
        
        logger.info(f"Starting server: {' '.join(cmd)}")
        logger.info(f"Starting server: {' '.join(cmd)}")
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
                resp = requests.get(f"{self.base_url}/v1/models", timeout=1)
                if resp.status_code == 200:
                    logger.info("Server is ready!")
                    return
            except Exception:
                pass
            time.sleep(1)
            
        self.stop_server()
        raise TimeoutError("Server failed to start within timeout")

    def stop_server(self):
        if self.no_spawn:
            return

        if self.process and hasattr(self.process, 'terminate'):
            logger.info("Stopping server...")
            self.process.terminate()
            self.process.wait()
            self.process = None
            
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
        
        self.last_usage = None
        
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
                if penalty > 1.0:
                    import sys
                    print(f"\n[Repetition Guard] ⚠️ Retrying with RepetitionPenalty={penalty}...")
                    # Suppress JSON_RETRY for internal engine retries to avoid inflating the UI retry count
                    # sys.stdout.write(f"\nJSON_RETRY:{json.dumps({'block': block_id, 'attempt': idx, 'type': 'repetition', 'penalty': penalty})}\n")
                    sys.stdout.flush()
                
                response = requests.post(
                    f"{self.base_url}/v1/chat/completions",
                    json=payload,
                    stream=stream,
                    timeout=600
                )
                response.raise_for_status()
                
                full_reasoning = ""
                full_text = ""
                loop_detected = False
                
                if stream:
                    # Only print separator for the first success stream to avoid clutter, 
                    # but here we print it to show start.
                    # print(f"\n{'='*10} Streaming Response (RP={penalty}) {'='*10}")
                    
                    for line in response.iter_lines():
                        if not line: continue
                        line = line.decode('utf-8')
                        if not line.startswith('data: '): continue
                        data = line[6:]
                        if data == '[DONE]': break
                        try:
                            chunk = json.loads(data)
                            
                            if 'usage' in chunk:
                                self.last_usage = chunk['usage']
                            
                            if 'choices' not in chunk or len(chunk['choices']) == 0:
                                continue
                                
                            delta = chunk['choices'][0]['delta']
                            
                            reasoning = delta.get('reasoning_content', '')
                            content = delta.get('content', '')
                            
                            if reasoning:
                                # print(reasoning, end="", flush=True) 
                                full_reasoning += reasoning
                                # Count reasoning tokens (fallback)
                                if self.last_usage is None:
                                    if not hasattr(self, '_token_count'):
                                        self._token_count = 0
                                    self._token_count += 1
                                
                            if content:
                                # print(content, end="", flush=True) 
                                full_text += content
                                if stream_callback:
                                    stream_callback(content)
                                # Count completion tokens (fallback)
                                if self.last_usage is None:
                                    if not hasattr(self, '_token_count'):
                                        self._token_count = 0
                                    self._token_count += 1
                                
                                # Repetition Guard
                                if len(full_text) > 20:
                                    last_char = full_text[-1]
                                    # 1. Single Char Loop (e.g. ".......")
                                    if len(full_text) >= 20 and full_text[-20:] == last_char * 20:
                                        print(f"\n[Repetition Guard] 🛑 Detected char loop on '{last_char}'. Aborting.")
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
                                                print(f"\n[Repetition Guard] 🛑 Detected phrase loop (len={length}). Aborting.")
                                                loop_detected = True
                                                break
                                    
                                    if loop_detected:
                                        response.close()
                                        break
                                        
                        except: pass
                    print("\n")
                    
                    # Fallback Usage Construction
                    if self.last_usage is None and hasattr(self, '_token_count'):
                        # Estimate prompt tokens (rough chars/3.5)
                        prompt_est = 0
                        if 'messages' in payload:
                            # Rough estimation from messages
                            txt_len = sum(len(m['content']) for m in payload['messages'])
                            prompt_est = int(txt_len / 3.0) 
                        
                        self.last_usage = {
                            "prompt_tokens": prompt_est,
                            "completion_tokens": self._token_count,
                            "total_tokens": prompt_est + self._token_count
                        }
                    
                    # Decide what to do

                    if loop_detected:
                        if not is_final:
                            # Trigger Retry
                            continue 
                        else:
                            # Final attempt failed too. Return what we have.
                            print(f"[Repetition Guard] ❌ Final attempt also looped. Returning truncated text.")
                    
                    # Success or Final Fail -> Return Result
                    if full_reasoning:
                        return f"<think>{full_reasoning}</think>\n{full_text}"
                    else:
                        return full_text
                else:
                    # Non-stream not supported for loop detection currently
                    resp_json = response.json()
                    if 'usage' in resp_json:
                        self.last_usage = resp_json['usage']
                    
                    msg = resp_json['choices'][0]['message']
                    return msg.get('content', '')
                    
            except Exception as e:
                logger.error(f"Inference Error: {e}")
                print(f"\n[Engine Error] ⚠️ API call failed: {e}")
                if is_final:
                    print(f"[Engine Error] ❌ Final attempt failed. Returning empty.")
                    return ""
                # If network error, maybe don't retry with higher penalty? 
                # But here we stick to the plan.
        
        return ""
