# Pipeline V2 API server for profile management.

from __future__ import annotations

import argparse
import ipaddress
import os
from pathlib import Path
from typing import Any, Dict, List, Optional
import shutil

import yaml
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import uvicorn

from murasaki_flow_v2.registry.profile_store import ProfileStore
from murasaki_flow_v2.validation import validate_profile


PROFILE_KINDS = ["api", "prompt", "parser", "policy", "chunk", "pipeline"]


class SaveRequest(BaseModel):
    yaml: str


class ValidateRequest(BaseModel):
    kind: str
    yaml: Optional[str] = None
    data: Optional[Dict[str, Any]] = None


def _ensure_dirs(store: ProfileStore) -> None:
    store.ensure_dirs(PROFILE_KINDS)


def _seed_defaults(store: ProfileStore, base_dir: Path) -> None:
    defaults_dir = base_dir / "profiles"
    if not defaults_dir.exists():
        return
    for kind in PROFILE_KINDS:
        source_dir = defaults_dir / kind
        target_dir = Path(store.base_dir) / kind
        target_dir.mkdir(parents=True, exist_ok=True)
        if not source_dir.exists():
            continue
        for file in source_dir.iterdir():
            if file.suffix.lower() not in {".yaml", ".yml"}:
                continue
            target = target_dir / file.name
            if not target.exists():
                shutil.copy2(file, target)


def _is_loopback(host: str) -> bool:
    if not host:
        return False
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def create_app(store: ProfileStore, base_dir: Path) -> FastAPI:
    app = FastAPI(title="Murasaki Flow V2 API", version="0.1.0")

    @app.middleware("http")
    async def local_only_middleware(request: Request, call_next):
        client = request.client
        host = client.host if client else ""
        if not _is_loopback(host):
            return JSONResponse(status_code=403, content={"detail": "forbidden"})
        return await call_next(request)

    @app.get("/health")
    def health() -> Dict[str, Any]:
        return {"ok": True}

    @app.get("/profiles/dir")
    def profiles_dir() -> Dict[str, str]:
        return {"path": store.base_dir}

    @app.get("/profiles/{kind}")
    def list_profiles(kind: str) -> List[Dict[str, str]]:
        if kind not in PROFILE_KINDS:
            raise HTTPException(status_code=400, detail="invalid_kind")
        profiles = store.list_profiles(kind)
        response = []
        for p in profiles:
            payload = {
                "id": p.profile_id,
                "name": p.name,
                "filename": os.path.basename(p.path),
            }
            if kind == "chunk" and p.chunk_type:
                payload["chunk_type"] = p.chunk_type
            response.append(payload)
        return response

    @app.get("/profiles/{kind}/{profile_id}")
    def load_profile(kind: str, profile_id: str) -> Dict[str, Any]:
        if kind not in PROFILE_KINDS:
            raise HTTPException(status_code=400, detail="invalid_kind")
        if not ProfileStore.is_safe_profile_id(profile_id):
            raise HTTPException(status_code=400, detail="invalid_id")
        path = store.resolve_profile_path(kind, profile_id)
        if not path:
            raise HTTPException(status_code=404, detail="not_found")
        raw = Path(path).read_text(encoding="utf-8")
        data = store.load_profile_by_path(path)
        return {
            "id": data.get("id"),
            "name": data.get("name"),
            "yaml": raw,
            "data": data,
        }

    @app.post("/profiles/{kind}/{profile_id}")
    def save_profile(kind: str, profile_id: str, payload: SaveRequest) -> Dict[str, Any]:
        if kind not in PROFILE_KINDS:
            raise HTTPException(status_code=400, detail="invalid_kind")
        if not ProfileStore.is_safe_profile_id(profile_id):
            raise HTTPException(status_code=400, detail="invalid_id")
        try:
            data = yaml.safe_load(payload.yaml) or {}
        except yaml.YAMLError as exc:
            raise HTTPException(status_code=400, detail=f"invalid_yaml:{exc}") from exc
        if not isinstance(data, dict):
            raise HTTPException(status_code=400, detail="invalid_yaml")
        if data.get("id"):
            if not ProfileStore.is_safe_profile_id(str(data.get("id"))):
                raise HTTPException(status_code=400, detail="invalid_id")
        else:
            data["id"] = profile_id

        result = validate_profile(kind, data, store=store)
        if result.errors:
            raise HTTPException(
                status_code=400,
                detail={"errors": result.errors, "warnings": result.warnings},
            )

        target = Path(store.base_dir) / kind / f"{data['id']}.yaml"
        target.parent.mkdir(parents=True, exist_ok=True)
        dumped = yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=120)
        target.write_text(dumped, encoding="utf-8")
        return {"ok": True, "id": data["id"], "warnings": result.warnings}

    @app.delete("/profiles/{kind}/{profile_id}")
    def delete_profile(kind: str, profile_id: str) -> Dict[str, Any]:
        if kind not in PROFILE_KINDS:
            raise HTTPException(status_code=400, detail="invalid_kind")
        if not ProfileStore.is_safe_profile_id(profile_id):
            raise HTTPException(status_code=400, detail="invalid_id")
        path = Path(store.base_dir) / kind / f"{profile_id}.yaml"
        if path.exists():
            path.unlink()
        return {"ok": True}

    @app.post("/validate")
    def validate(payload: ValidateRequest) -> Dict[str, Any]:
        kind = payload.kind
        if kind not in PROFILE_KINDS:
            raise HTTPException(status_code=400, detail="invalid_kind")
        data = payload.data
        if payload.yaml:
            try:
                data = yaml.safe_load(payload.yaml) or {}
            except yaml.YAMLError as exc:
                raise HTTPException(status_code=400, detail=f"invalid_yaml:{exc}") from exc
        if not isinstance(data, dict):
            raise HTTPException(status_code=400, detail="invalid_yaml")
        if data.get("id") and not ProfileStore.is_safe_profile_id(str(data.get("id"))):
            raise HTTPException(status_code=400, detail="invalid_id")
        result = validate_profile(kind, data, store=store)
        return {"ok": result.ok, "errors": result.errors, "warnings": result.warnings}

    return app


def main() -> int:
    parser = argparse.ArgumentParser(description="Murasaki Flow V2 API Server")
    parser.add_argument("--profiles-dir", required=True, help="Base dir for profiles")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=48321)
    args = parser.parse_args()

    store = ProfileStore(args.profiles_dir)
    _ensure_dirs(store)
    _seed_defaults(store, Path(__file__).resolve().parent)

    app = create_app(store, Path(__file__).resolve().parent)
    host = "127.0.0.1"
    uvicorn.run(app, host=host, port=args.port, log_level="warning")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
