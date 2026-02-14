import os
from pathlib import Path

import pytest

from murasaki_translator.core.engine import InferenceEngine
from murasaki_translator.core.prompt import PromptBuilder
from murasaki_translator.core.parser import ResponseParser
from murasaki_translator.core.text_protector import TextProtector
from rule_processor import RuleProcessor


@pytest.mark.smoke
@pytest.mark.gpu
def test_real_engine_gpu_smoke():
    if os.environ.get("MURASAKI_TEST_REAL_ENGINE") != "1":
        pytest.skip("real engine smoke disabled")
    if os.environ.get("MURASAKI_TEST_GPU") != "1":
        pytest.skip("gpu smoke disabled")

    root = Path(__file__).resolve().parents[2]
    default_server = root / "bin" / "win-cuda" / "llama-server.exe"
    default_model = root / "models" / "Murasaki-8B-v0.2-IQ4_XS.gguf"

    server = os.environ.get("MURASAKI_TEST_SERVER") or (str(default_server) if default_server.exists() else None)
    model = os.environ.get("MURASAKI_TEST_MODEL") or (str(default_model) if default_model.exists() else None)
    if not server or not model:
        pytest.skip("missing server/model env vars")

    no_spawn = os.environ.get("MURASAKI_TEST_NO_SPAWN") == "1"
    n_parallel = int(os.environ.get("MURASAKI_TEST_GPU_PARALLEL", "1"))
    n_ctx = int(os.environ.get("MURASAKI_TEST_GPU_CTX", "2048"))
    flash_attn = os.environ.get("MURASAKI_TEST_FLASH_ATTN") == "1"

    engine = InferenceEngine(
        server_path=server,
        model_path=model,
        no_spawn=no_spawn,
        n_ctx=n_ctx,
        n_parallel=n_parallel,
        n_gpu_layers=-1,
        flash_attn=flash_attn,
    )

    try:
        engine.start_server()
        prompt_builder = PromptBuilder()
        parser = ResponseParser()

        messages = prompt_builder.build_messages("hello", preset="short")
        raw, _ = engine.chat_completion(messages=messages, temperature=0.2, stream=False)
        lines, _ = parser.parse(raw or "", expected_count=0)
        assert any(line.strip() for line in lines)

        # Second call to ensure repeated requests stay healthy
        messages = prompt_builder.build_messages("good night", preset="short")
        raw2, _ = engine.chat_completion(messages=messages, temperature=0.2, stream=False)
        lines2, _ = parser.parse(raw2 or "", expected_count=0)
        assert any(line.strip() for line in lines2)

        # Longer prompt to cover context handling
        long_text = (
            "これはテスト用の長文です。"
            "翻訳の安定性と一貫性を確認するために、少し長めの入力を使います。"
            "余計な改変をせず、自然な中国語にしてください。"
        )
        messages = prompt_builder.build_messages(long_text, preset="short")
        raw3, _ = engine.chat_completion(messages=messages, temperature=0.2, stream=False)
        lines3, _ = parser.parse(raw3 or "", expected_count=0)
        assert any(line.strip() for line in lines3)

        # Text protection end-to-end (protect -> translate -> restore)
        original = "Hello [[Alice]] <b>HP</b>!"
        protector = TextProtector(patterns=[r"\[\[.+?\]\]", r"<[^>]+>"])
        protected = protector.protect(original)
        messages = prompt_builder.build_messages(protected, preset="short")
        raw4, _ = engine.chat_completion(messages=messages, temperature=0.2, stream=False)
        lines4, _ = parser.parse(raw4 or "", expected_count=0)
        assert any(line.strip() for line in lines4)
        out_text = "\n".join(lines4)
        post_processor = RuleProcessor(
            [{"type": "format", "pattern": "restore_protection", "active": True}]
        )
        restored = post_processor.process(
            out_text, src_text=original, protector=protector, strict_line_count=False
        )
        assert "[[Alice]]" in restored
        assert "<b>HP</b>" in restored
    finally:
        engine.stop_server()
