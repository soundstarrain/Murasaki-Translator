import io
import sys
import time
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from murasaki_translator.core.chunker import TextBlock
from murasaki_translator.documents.epub import EpubDocument

SERVER_DIR = Path(__file__).resolve().parents[2] / "server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import api_server as server


class FakeRemoteEpubWorker:
    model_path = "fake-model.gguf"

    def is_ready(self) -> bool:
        return True

    def uptime(self) -> float:
        return 0.0

    async def translate(self, task):
        uploaded_path = Path(task.request.file_path)
        output_dir = Path(server.__file__).resolve().parent.parent / "outputs"
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / f"{task.task_id}_output.epub"

        doc = EpubDocument(str(uploaded_path))
        items = doc.load()
        assert len(items) >= 2

        first_meta = items[0]["meta"]
        second_meta = items[1]["meta"]
        first_uid = first_meta["uid"]
        second_uid = second_meta["uid"]

        translated_blocks = [
            TextBlock(
                id=1,
                prompt_text=f"@id={first_uid}@translated-one@end={first_uid}@",
                metadata=[first_meta, second_meta],
            ),
            TextBlock(
                id=2,
                prompt_text=f"@id={second_uid}@translated-two@end={second_uid}@",
                metadata=[first_meta],
            ),
        ]

        task.add_log(f"[Final] Reconstructing structured document: {output_path}...")
        doc.save(str(output_path), translated_blocks)
        task.set_output_path(str(output_path))
        task.set_progress(1.0, len(items), len(items))
        task.add_log(f"[Final] Reconstruction complete: {output_path}")
        return f"[Binary output: {output_path}]"


def _build_epub_bytes() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        zf.writestr("mimetype", "application/epub+zip")
        zf.writestr(
            "Text/ch1.xhtml",
            "<html><body><p>hello</p><p>world</p></body></html>",
        )
    return buffer.getvalue()


@pytest.mark.integration
def test_api_server_remote_epub_roundtrip(monkeypatch):
    monkeypatch.setenv("MURASAKI_API_KEY", "unit-test-key")
    monkeypatch.setattr(server, "tasks", {})
    monkeypatch.setattr(server, "worker", FakeRemoteEpubWorker())

    client = TestClient(server.app)
    headers = {"Authorization": "Bearer unit-test-key"}

    upload_path = None
    output_path = None

    try:
        upload_response = client.post(
            "/api/v1/upload/file",
            headers=headers,
            files={
                "file": (
                    "book.epub",
                    _build_epub_bytes(),
                    "application/epub+zip",
                )
            },
        )
        assert upload_response.status_code == 200
        upload_payload = upload_response.json()
        upload_path = Path(upload_payload["file_path"])
        assert upload_path.suffix == ".epub"
        assert upload_path.exists() is True

        create_response = client.post(
            "/api/v1/translate",
            headers=headers,
            json={
                "file_path": str(upload_path),
                "model": "fake-model.gguf",
                "save_cache": False,
            },
        )
        assert create_response.status_code == 200
        task_id = create_response.json()["task_id"]

        status_payload = None
        for _ in range(20):
            status_response = client.get(f"/api/v1/translate/{task_id}", headers=headers)
            assert status_response.status_code == 200
            status_payload = status_response.json()
            if status_payload["status"] == "completed":
                break
            time.sleep(0.01)

        assert status_payload is not None
        assert status_payload["status"] == "completed"
        assert status_payload["result"].startswith("[Binary output:")
        assert any("Starting translation..." in line for line in status_payload["logs"])
        assert any("Reconstruction complete" in line for line in status_payload["logs"])

        task = server.tasks[task_id]
        output_path = Path(task.get_output_path())
        assert output_path.suffix == ".epub"
        assert output_path.exists() is True

        download_response = client.get(f"/api/v1/download/{task_id}", headers=headers)
        assert download_response.status_code == 200
        content_disposition = download_response.headers.get("content-disposition", "")
        assert "_output.epub" in content_disposition

        with zipfile.ZipFile(io.BytesIO(download_response.content), "r") as zf:
            chapter = zf.read("Text/ch1.xhtml").decode("utf-8", errors="ignore")

        assert "translated-one" in chapter
        assert "translated-two" in chapter
        assert "hello" not in chapter
        assert "world" not in chapter
    finally:
        if upload_path and upload_path.exists():
            upload_path.unlink()
        if output_path and output_path.exists():
            output_path.unlink()
