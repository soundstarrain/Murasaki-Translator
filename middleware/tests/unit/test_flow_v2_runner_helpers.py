import os
import sys
import tempfile
import unittest
from pathlib import Path

_MIDDLEWARE_ROOT = Path(__file__).resolve().parents[2]
if str(_MIDDLEWARE_ROOT) not in sys.path:
    sys.path.insert(0, str(_MIDDLEWARE_ROOT))

from murasaki_flow_v2.pipelines.runner import PipelineRunner
from murasaki_flow_v2.registry.profile_store import ProfileStore
from murasaki_flow_v2.validation import validate_profile
from murasaki_translator.core.chunker import TextBlock


class TestFlowV2RunnerHelpers(unittest.TestCase):
    def test_filter_target_line_ids_window(self) -> None:
        metadata = [0, 1, "x", 1, 3, 5]
        result = PipelineRunner._filter_target_line_ids(metadata, 0, 3)
        self.assertEqual(result, [0, 1])

    def test_normalize_txt_blocks_removes_single_trailing_newline(self) -> None:
        blocks = [
            TextBlock(id=1, prompt_text="a\n"),
            TextBlock(id=2, prompt_text="b\n\n"),
        ]
        PipelineRunner._normalize_txt_blocks(blocks)
        self.assertEqual(blocks[0].prompt_text, "a")
        self.assertEqual(blocks[1].prompt_text, "b\n")

    def test_validate_jsonl_prompt_requires_marker(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            os.makedirs(os.path.join(temp_dir, "api"), exist_ok=True)
            os.makedirs(os.path.join(temp_dir, "prompt"), exist_ok=True)
            os.makedirs(os.path.join(temp_dir, "parser"), exist_ok=True)
            os.makedirs(os.path.join(temp_dir, "chunk"), exist_ok=True)

            with open(os.path.join(temp_dir, "api", "api1.yaml"), "w", encoding="utf-8") as f:
                f.write(
                    "id: api1\n"
                    "name: api1\n"
                    "type: openai_compat\n"
                    "base_url: http://example\n"
                    "model: demo\n"
                )
            with open(os.path.join(temp_dir, "prompt", "prompt1.yaml"), "w", encoding="utf-8") as f:
                f.write(
                    "id: prompt1\n"
                    "name: prompt1\n"
                    "user_template: \"{{source}}\"\n"
                )
            with open(os.path.join(temp_dir, "parser", "parser1.yaml"), "w", encoding="utf-8") as f:
                f.write(
                    "id: parser1\n"
                    "name: parser1\n"
                    "type: jsonl\n"
                )
            with open(os.path.join(temp_dir, "chunk", "chunk1.yaml"), "w", encoding="utf-8") as f:
                f.write(
                    "id: chunk1\n"
                    "name: chunk1\n"
                    "chunk_type: legacy\n"
                )

            store = ProfileStore(temp_dir)
            pipeline = {
                "id": "pipe1",
                "name": "pipe1",
                "provider": "api1",
                "prompt": "prompt1",
                "parser": "parser1",
                "chunk_policy": "chunk1",
                "apply_line_policy": False,
            }
            result = validate_profile("pipeline", pipeline, store=store)
            self.assertIn("parser_requires_jsonl_prompt", result.errors)


if __name__ == "__main__":
    unittest.main()
