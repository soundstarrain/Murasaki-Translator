#!/usr/bin/env python3
"""
HuggingFace Model Downloader
Downloads GGUF models from HuggingFace with progress reporting.
"""

import sys
import json
import os
from pathlib import Path

def output_progress(percent: float, speed: str = "", downloaded: str = "", total: str = "", status: str = "downloading"):
    """Output progress as JSON line for IPC parsing."""
    print(json.dumps({
        "type": "progress",
        "percent": round(percent, 1),
        "speed": speed,
        "downloaded": downloaded,
        "total": total,
        "status": status
    }), flush=True)

def output_error(message: str):
    """Output error message for IPC parsing."""
    print(json.dumps({
        "type": "error",
        "message": message
    }), flush=True)

def output_complete(file_path: str):
    """Output completion message for IPC parsing."""
    print(json.dumps({
        "type": "complete",
        "file_path": file_path
    }), flush=True)

def format_size(size_bytes: int) -> str:
    """Format bytes to human readable string."""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"

def check_network(timeout: int = 10):
    """
    Check network connectivity to HuggingFace.
    
    Args:
        timeout: Connection timeout in seconds
    """
    try:
        import requests
    except ImportError:
        print(json.dumps({"type": "network", "status": "error", "message": "Missing requests library"}))
        sys.exit(1)
    
    try:
        response = requests.head("https://huggingface.co", timeout=timeout, allow_redirects=True)
        if response.status_code < 400:
            print(json.dumps({"type": "network", "status": "ok", "message": "Connected to HuggingFace"}))
        else:
            print(json.dumps({"type": "network", "status": "error", "message": f"HTTP {response.status_code}"}))
    except requests.exceptions.Timeout:
        print(json.dumps({"type": "network", "status": "error", "message": "Connection timeout"}))
    except requests.exceptions.ConnectionError:
        print(json.dumps({"type": "network", "status": "error", "message": "Cannot connect to HuggingFace"}))
    except Exception as e:
        print(json.dumps({"type": "network", "status": "error", "message": str(e)}))


def download_with_progress(repo_id: str, filename: str, local_dir: str, mirror: str = "direct"):
    """
    Download a file from HuggingFace with progress reporting.
    Supports resume download and skips if file is already complete.
    
    Args:
        repo_id: HuggingFace repository ID (e.g., 'Murasaki-Project/Murasaki-8B-v0.1-GGUF')
        filename: File to download (e.g., 'Murasaki-8B-v0.1-IQ4_XS.gguf')
        local_dir: Local directory to save the file
        mirror: Download source - 'direct' for huggingface.co, 'hf_mirror' for hf-mirror.com
    """
    try:
        import requests
        import time
    except ImportError:
        output_error("Missing requests library")
        sys.exit(1)
    
    output_progress(0, status="starting")
    
    # 安全检查：防止路径遍历攻击
    if ".." in filename or "/" in filename or "\\" in filename:
        output_error("Invalid filename: path traversal detected")
        sys.exit(1)
    filename = os.path.basename(filename)  # 强制只取文件名
    
    # Create local directory if not exists
    Path(local_dir).mkdir(parents=True, exist_ok=True)
    
    file_path = Path(local_dir) / filename
    
    # Select download URL based on mirror choice
    if mirror == "hf_mirror":
        base_url = "https://hf-mirror.com"
    else:
        base_url = "https://huggingface.co"
    
    download_url = f"{base_url}/{repo_id}/resolve/main/{filename}"

    
    try:
        # Get remote file size via HEAD request
        output_progress(0, status="checking")
        head_response = requests.head(download_url, timeout=30, allow_redirects=True)
        head_response.raise_for_status()
        remote_size = int(head_response.headers.get('content-length', 0))
        
        if remote_size == 0:
            output_error("Could not determine remote file size")
            sys.exit(1)
        
        # Check local file
        local_size = 0
        if file_path.exists():
            local_size = file_path.stat().st_size
            
            if local_size == remote_size:
                # File is already complete, skip download
                output_progress(100, status="skipped")
                output_complete(str(file_path))
                return
            elif local_size > remote_size:
                # Local file is larger (corrupted?), delete and restart
                file_path.unlink()
                local_size = 0
        
        # Setup headers for resume
        headers = {}
        if local_size > 0:
            headers['Range'] = f'bytes={local_size}-'
            output_progress((local_size / remote_size) * 100, status="resuming")
        else:
            output_progress(0, status="connecting")
        
        # Start download with streaming
        response = requests.get(download_url, stream=True, timeout=60, allow_redirects=True, headers=headers)
        
        # Handle response codes
        if response.status_code == 416:
            # Range not satisfiable - file might be complete or server doesn't support range
            output_progress(100, status="skipped")
            output_complete(str(file_path))
            return
        
        response.raise_for_status()
        
        # For resumed downloads, content-length is remaining bytes
        if response.status_code == 206:
            # Partial content - resume successful
            total_size = remote_size
            downloaded = local_size
        else:
            # Full download (server didn't support range or fresh start)
            total_size = int(response.headers.get('content-length', 0))
            if total_size == 0:
                total_size = remote_size
            downloaded = 0
            local_size = 0  # Reset, will overwrite
        
        last_percent = -1
        start_time = time.time()
        last_time = start_time
        last_downloaded = downloaded
        
        # Use larger chunk size for better performance
        chunk_size = 1024 * 1024  # 1MB chunks
        
        # Open in append mode for resume, write mode for fresh start
        write_mode = 'ab' if local_size > 0 else 'wb'
        
        with open(file_path, write_mode) as f:
            for chunk in response.iter_content(chunk_size=chunk_size):
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)
                    
                    percent = (downloaded / total_size) * 100 if total_size > 0 else 0
                    current_time = time.time()
                    
                    # Always calculate speed
                    time_diff = current_time - last_time
                    speed = ""
                    if time_diff > 0:
                        bytes_diff = downloaded - last_downloaded
                        speed_bytes = bytes_diff / time_diff
                        speed = f"{format_size(int(speed_bytes))}/s"
                    
                    # Report progress with speed
                    if int(percent) > last_percent:
                        last_percent = int(percent)
                        output_progress(
                            percent,
                            speed=speed,
                            downloaded=format_size(downloaded),
                            total=format_size(total_size)
                        )
                    
                    # Update time references
                    last_time = current_time
                    last_downloaded = downloaded
        
        output_progress(100, status="complete")
        output_complete(str(file_path))
        
    except requests.exceptions.RequestException as e:
        output_error(f"Network error: {str(e)}")
        sys.exit(1)
    except Exception as e:
        output_error(f"Download failed: {str(e)}")
        sys.exit(1)


def list_repo_files(repo_id: str):
    """
    List GGUF files in a HuggingFace repository.
    
    Args:
        repo_id: HuggingFace repository ID (e.g., 'Murasaki-Project/Murasaki-8B-v0.1-GGUF')
    """
    try:
        import requests
    except ImportError:
        output_error("Missing requests library")
        sys.exit(1)
    
    try:
        # Use HuggingFace API to list files in repository (with blobs=true for size info)
        api_url = f"https://huggingface.co/api/models/{repo_id}?blobs=true"
        response = requests.get(api_url, timeout=30)
        response.raise_for_status()
        
        model_info = response.json()
        siblings = model_info.get("siblings", [])
        
        gguf_files = []
        for file_info in siblings:
            filename = file_info.get("rfilename", "")
            if filename.endswith('.gguf'):
                # Try to get size from different possible locations
                size = 0
                # First try direct size field
                if file_info.get("size"):
                    size = file_info["size"]
                # Then try lfs object (for large files stored with LFS)
                elif file_info.get("lfs") and file_info["lfs"].get("size"):
                    size = file_info["lfs"]["size"]
                # Also check blobId approach
                elif file_info.get("blobId"):
                    # Size might be in a different format
                    size = file_info.get("size", 0) or 0
                
                gguf_files.append({
                    "name": filename,
                    "size": size,
                    "sizeFormatted": format_size(size)
                })
        
        # Sort by size (largest first for user convenience)
        gguf_files.sort(key=lambda x: x["size"], reverse=True)
        
        print(json.dumps({
            "type": "files",
            "files": gguf_files
        }), flush=True)
        
    except requests.exceptions.RequestException as e:
        output_error(f"Network error: {str(e)}")
        sys.exit(1)
    except Exception as e:
        output_error(f"Failed to list files: {str(e)}")
        sys.exit(1)

def list_org_repos(org_name: str):
    """
    List all model repositories under a HuggingFace organization.
    
    Args:
        org_name: HuggingFace organization name (e.g., 'Murasaki-Project')
    """
    try:
        import requests
    except ImportError:
        output_error("Missing requests library")
        sys.exit(1)
    
    try:
        # Use HuggingFace API to list models by author/organization
        api_url = f"https://huggingface.co/api/models?author={org_name}"
        response = requests.get(api_url, timeout=30)
        response.raise_for_status()
        
        models = response.json()
        repos = []
        
        for model in models:
            model_id = model.get("modelId", "")
            # Include all public repos (user can filter if needed)
            repos.append({
                "id": model_id,
                "name": model_id.split("/")[-1],  # Get repo name without org
                "downloads": model.get("downloads", 0),
                "lastModified": model.get("lastModified", ""),
                "private": model.get("private", False)
            })
        
        # Sort by name for consistent display
        repos.sort(key=lambda x: x["name"])
        
        print(json.dumps({
            "type": "repos",
            "repos": repos
        }), flush=True)
        
    except requests.exceptions.RequestException as e:
        output_error(f"Network error: {str(e)}")
        sys.exit(1)
    except Exception as e:
        output_error(f"Failed to list repos: {str(e)}")
        sys.exit(1)

def verify_model(org_name: str, local_file_path: str):
    """
    Verify if a local model matches an official model from HuggingFace.
    
    Args:
        org_name: HuggingFace organization name
        local_file_path: Full path to local file
    """
    try:
        import requests
        import os
        import re
    except ImportError:
        output_error("Missing requests library")
        sys.exit(1)
    
    # Get local file info
    if not os.path.exists(local_file_path):
        output_error(f"File not found: {local_file_path}")
        sys.exit(1)
    
    local_filename = os.path.basename(local_file_path)
    local_size = os.path.getsize(local_file_path)
    
    # Extract core pattern for fuzzy matching (e.g., "Murasaki-8B-v0.1-IQ4_XS")
    # Remove .gguf extension and normalize
    def normalize_name(name: str) -> str:
        # Remove extension
        name = re.sub(r'\.gguf$', '', name, flags=re.IGNORECASE)
        # Normalize case and separators
        return name.lower().replace('_', '-').replace(' ', '-')
    
    local_normalized = normalize_name(local_filename)
    
    try:
        # First, get all repos under the organization
        api_url = f"https://huggingface.co/api/models?author={org_name}"
        response = requests.get(api_url, timeout=30)
        response.raise_for_status()
        
        models = response.json()
        
        best_match = None
        best_match_score = 0
        
        # Search for matching file in all repos
        for model in models:
            repo_id = model.get("modelId", "")
            
            # Get files in this repo
            repo_api_url = f"https://huggingface.co/api/models/{repo_id}?blobs=true"
            try:
                repo_response = requests.get(repo_api_url, timeout=30)
                repo_response.raise_for_status()
                repo_info = repo_response.json()
                
                siblings = repo_info.get("siblings", [])
                for file_info in siblings:
                    remote_filename = file_info.get("rfilename", "")
                    if not remote_filename.endswith('.gguf'):
                        continue
                    
                    remote_normalized = normalize_name(remote_filename)
                    
                    # Exact match
                    if remote_normalized == local_normalized:
                        remote_size = 0
                        if file_info.get("size"):
                            remote_size = file_info["size"]
                        elif file_info.get("lfs") and file_info["lfs"].get("size"):
                            remote_size = file_info["lfs"]["size"]
                        
                        # Compare sizes
                        is_valid = (remote_size > 0 and local_size == remote_size)
                        
                        print(json.dumps({
                            "type": "verify_result",
                            "status": "valid" if is_valid else "invalid",
                            "is_official": True,
                            "is_valid": is_valid,
                            "local_size": local_size,
                            "remote_size": remote_size,
                            "local_size_formatted": format_size(local_size),
                            "remote_size_formatted": format_size(remote_size),
                            "repo_id": repo_id,
                            "matched_file": remote_filename,
                            "local_file": local_filename
                        }), flush=True)
                        return
                    
                    # Fuzzy match: check if core version matches
                    # e.g., "murasaki-8b-v0.1-iq4-xs" contains "murasaki" and similar quant
                    if local_normalized in remote_normalized or remote_normalized in local_normalized:
                        # Calculate match score based on similarity
                        score = len(set(local_normalized.split('-')) & set(remote_normalized.split('-')))
                        if score > best_match_score:
                            best_match_score = score
                            remote_size = file_info.get("size", 0) or (file_info.get("lfs", {}).get("size", 0))
                            best_match = {
                                "repo_id": repo_id,
                                "remote_filename": remote_filename,
                                "remote_size": remote_size
                            }
                        
            except:
                continue
        
        # If we found a fuzzy match but no exact match
        if best_match and best_match_score >= 3:  # At least 3 matching parts
            remote_size = best_match["remote_size"]
            is_valid = (remote_size > 0 and local_size == remote_size)
            print(json.dumps({
                "type": "verify_result",
                "status": "valid" if is_valid else "invalid",
                "is_official": True,
                "is_valid": is_valid,
                "local_size": local_size,
                "remote_size": remote_size,
                "local_size_formatted": format_size(local_size),
                "remote_size_formatted": format_size(remote_size),
                "repo_id": best_match["repo_id"],
                "matched_file": best_match["remote_filename"],
                "local_file": local_filename,
                "fuzzy_match": True
            }), flush=True)
            return
        
        # File not found in any repo - unknown status
        print(json.dumps({
            "type": "verify_result",
            "status": "unknown",
            "is_official": False,
            "is_valid": False,
            "local_size": local_size,
            "remote_size": 0,
            "local_size_formatted": format_size(local_size),
            "remote_size_formatted": "N/A",
            "repo_id": "",
            "matched_file": "",
            "local_file": local_filename
        }), flush=True)
        
    except requests.exceptions.RequestException as e:
        output_error(f"Network error: {str(e)}")
        sys.exit(1)
    except Exception as e:
        output_error(f"Verification failed: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage:")
        print("  Check network:  python hf_downloader.py network")
        print("  List org repos: python hf_downloader.py repos <org_name>")
        print("  List files:     python hf_downloader.py list <repo_id>")
        print("  Download:       python hf_downloader.py download <repo_id> <filename> <local_dir>")
        print("  Verify model:   python hf_downloader.py verify <org_name> <file_path>")
        sys.exit(1)
    
    command = sys.argv[1]
    
    if command == "network":
        check_network()
    
    elif command == "repos":
        if len(sys.argv) < 3:
            output_error("Missing org_name argument")
            sys.exit(1)
        org_name = sys.argv[2]
        list_org_repos(org_name)

    
    elif command == "list":
        repo_id = sys.argv[2]
        list_repo_files(repo_id)
    
    elif command == "download":
        if len(sys.argv) < 5:
            output_error("Missing arguments for download")
            sys.exit(1)
        repo_id = sys.argv[2]
        filename = sys.argv[3]
        local_dir = sys.argv[4]
        mirror = sys.argv[5] if len(sys.argv) > 5 else "direct"
        download_with_progress(repo_id, filename, local_dir, mirror)

    
    elif command == "verify":
        if len(sys.argv) < 4:
            output_error("Missing arguments for verify")
            sys.exit(1)
        org_name = sys.argv[2]
        file_path = sys.argv[3]
        verify_model(org_name, file_path)
    
    else:
        output_error(f"Unknown command: {command}")
        sys.exit(1)
