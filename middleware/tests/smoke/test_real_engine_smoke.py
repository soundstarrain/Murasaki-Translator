import os
import pytest

from murasaki_translator.core.engine import InferenceEngine
from murasaki_translator.core.prompt import PromptBuilder
from murasaki_translator.core.parser import ResponseParser


@pytest.mark.smoke
def test_real_engine_smoke():
    if os.environ.get("MURASAKI_TEST_REAL_ENGINE") != "1":
        pytest.skip("real engine smoke disabled")

    server = os.environ.get("MURASAKI_TEST_SERVER")
    model = os.environ.get("MURASAKI_TEST_MODEL")
    if not server or not model:
        pytest.skip("missing server/model env vars")

    no_spawn = os.environ.get("MURASAKI_TEST_NO_SPAWN") == "1"

    engine = InferenceEngine(
        server_path=server,
        model_path=model,
        no_spawn=no_spawn,
        n_ctx=1024,
        n_parallel=1,
    )

    try:
        engine.start_server()
        prompt_builder = PromptBuilder()
        parser = ResponseParser()
        messages = prompt_builder.build_messages("hello", preset="short")
        raw, _ = engine.chat_completion(messages=messages, temperature=0.2, stream=False)
        lines, _ = parser.parse(raw or "", expected_count=0)
        assert any(line.strip() for line in lines)
    finally:
        engine.stop_server()
