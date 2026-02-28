import threading
from types import SimpleNamespace

import pytest

from murasaki_translator.core.parser import ResponseParser
from murasaki_translator.core.prompt import PromptBuilder
from murasaki_translator.core.quality_checker import WarningType
from rule_processor import RuleProcessor
from murasaki_translator.main import translate_block_with_retry


class FakeEngine:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = 0
        self.messages = []

    def chat_completion(
        self,
        messages,
        temperature=0.7,
        stream=True,
        stream_callback=None,
        rep_base=1.0,
        rep_max=1.5,
        rep_step=0.1,
        block_id=0,
    ):
        idx = min(self.calls, len(self._responses) - 1)
        self.calls += 1
        self.messages.append(messages)
        resp = self._responses[idx]
        if stream_callback and resp:
            stream_callback(resp[:1])
        return resp, {}


def _make_args(**overrides):
    base = SimpleNamespace(
        debug=False,
        preset="novel",
        max_retries=1,
        coverage_retries=0,
        anchor_check=False,
        anchor_check_retries=0,
        temperature=0.7,
        rep_penalty_base=1.0,
        rep_penalty_max=1.5,
        rep_penalty_step=0.1,
        retry_temp_boost=0.1,
        retry_prompt_feedback=False,
        line_check=False,
        line_tolerance_abs=0,
        line_tolerance_pct=0.0,
        output_hit_threshold=0,
        cot_coverage_threshold=80,
        file="",
        alignment_mode=False,
    )
    for key, value in overrides.items():
        setattr(base, key, value)
    return base


def _run_flow(original_src, responses, args, strict_mode=False, glossary=None):
    engine = FakeEngine(responses)
    prompt_builder = PromptBuilder(glossary or {})
    response_parser = ResponseParser()
    post_processor = RuleProcessor([])
    stdout_lock = threading.Lock()
    result = translate_block_with_retry(
        block_idx=0,
        original_src_text=original_src,
        processed_src_text=original_src,
        args=args,
        engine=engine,
        prompt_builder=prompt_builder,
        response_parser=response_parser,
        post_processor=post_processor,
        glossary=glossary or {},
        stdout_lock=stdout_lock,
        strict_mode=strict_mode,
        protector=None,
    )
    result["_engine_messages"] = engine.messages
    return result


@pytest.mark.integration
def test_main_flow_empty_output_retry():
    args = _make_args(max_retries=1)
    result = _run_flow("hello", ["", "ok"], args)
    types = [item.get("type") for item in result["retry_history"]]
    assert "empty" in types
    assert result["out_text"].strip() == "ok"


@pytest.mark.integration
def test_main_flow_line_check_retry():
    args = _make_args(max_retries=1, line_check=True, line_tolerance_abs=0, line_tolerance_pct=0.0)
    result = _run_flow("a\nb", ["x", "x\ny"], args)
    types = [item.get("type") for item in result["retry_history"]]
    assert "line_check" in types
    assert result["out_text"].splitlines() == ["x", "y"]


@pytest.mark.integration
def test_main_flow_strict_line_check_retry():
    args = _make_args(max_retries=1)
    result = _run_flow("a\nb", ["x", "x\ny"], args, strict_mode=True)
    types = [item.get("type") for item in result["retry_history"]]
    assert "strict_line_check" in types


@pytest.mark.integration
def test_main_flow_structural_retry_does_not_skip_followup_glossary_retry():
    glossary = {"foo": "bar"}
    args = _make_args(
        max_retries=1,
        coverage_retries=1,
        output_hit_threshold=100,
        line_check=True,
        line_tolerance_abs=0,
        line_tolerance_pct=0.0,
    )
    result = _run_flow(
        "foo\nfoo",
        [
            "foo",  # 触发行数重试
            "foo\nfoo",  # 行数恢复，但仍未命中术语
            "bar\nbar",  # 术语重试后命中
        ],
        args,
        glossary=glossary,
    )
    retry_types = [item.get("type") for item in result["retry_history"]]
    assert "line_check" in retry_types
    assert "glossary" in retry_types
    assert result["out_text"].splitlines() == ["bar", "bar"]


@pytest.mark.integration
def test_main_flow_glossary_retry():
    glossary = {"foo": "bar"}
    args = _make_args(max_retries=0, coverage_retries=1, output_hit_threshold=100)
    result = _run_flow("foo", ["foo translated", "bar"], args, glossary=glossary)
    types = [item.get("type") for item in result["retry_history"]]
    assert "glossary" in types
    assert "bar" in result["out_text"]


@pytest.mark.integration
def test_main_flow_retry_prompt_feedback_appended():
    glossary = {"foo": "bar"}
    args = _make_args(
        max_retries=0,
        coverage_retries=1,
        output_hit_threshold=100,
        retry_prompt_feedback=True,
    )
    result = _run_flow("foo", ["foo translated", "bar"], args, glossary=glossary)
    messages = result.get("_engine_messages") or []
    assert len(messages) >= 2
    user1 = [m for m in messages[0] if m.get("role") == "user"][0]["content"]
    user2 = [m for m in messages[1] if m.get("role") == "user"][0]["content"]
    assert "系统提示" not in user1
    assert "系统提示" in user2


@pytest.mark.integration
def test_main_flow_glossary_best_result_selected():
    glossary = {"foo": "bar", "baz": "qux"}
    args = _make_args(max_retries=0, coverage_retries=1, output_hit_threshold=100)
    result = _run_flow("foo baz", ["bar", "nope"], args, glossary=glossary)
    types = [item.get("type") for item in result["retry_history"]]
    assert "glossary" in types
    # Best result should keep higher coverage output ("bar")
    assert result["out_text"].strip() == "bar"


@pytest.mark.integration
def test_main_flow_anchor_repair_alignment_no_retry():
    args = _make_args(anchor_check=True, anchor_check_retries=1, alignment_mode=True)
    original = "@id=1@\nhello\n@end=1@"
    result = _run_flow(original, ["@id=1@\nhello", original], args)
    types = [item.get("type") for item in result["retry_history"]]
    assert "anchor_missing" not in types
    assert "@end=1@" in result["out_text"]
    assert len(result.get("_engine_messages") or []) == 1


@pytest.mark.integration
def test_main_flow_anchor_repair_epub_no_retry():
    args = _make_args(anchor_check=True, anchor_check_retries=1, file="book.epub")
    original = "@id=1@\nhello\n@end=1@"
    result = _run_flow(original, ["@id=1@\nhello", original], args)
    types = [item.get("type") for item in result["retry_history"]]
    assert "anchor_missing" not in types
    assert "@end=1@" in result["out_text"]
    assert len(result.get("_engine_messages") or []) == 1


@pytest.mark.integration
def test_main_flow_anchor_retry_srt():
    args = _make_args(anchor_check=True, anchor_check_retries=1, file="clip.srt")
    original = "1\n00:00:01,000 --> 00:00:02,000\nhello\n"
    result = _run_flow(original, ["1\nhello\n", original], args)
    types = [item.get("type") for item in result["retry_history"]]
    assert "anchor_missing" in types


@pytest.mark.integration
def test_main_flow_line_check_tolerance_pct_allows_diff():
    args = _make_args(
        max_retries=0,
        line_check=True,
        line_tolerance_abs=0,
        line_tolerance_pct=0.6,
    )
    result = _run_flow("a\nb\nc\nd", ["x\ny"], args)
    assert result["retry_history"] == []
    assert result["out_text"].splitlines() == ["x", "y"]


@pytest.mark.integration
def test_main_flow_quality_warnings():
    args = _make_args()
    result = _run_flow("abcdefghij", ["abc\u3042defghij"], args)
    types = {w.get("type") for w in result["warnings"]}
    assert WarningType.KANA_RESIDUE in types


@pytest.mark.integration
def test_main_flow_kana_residue_retry_not_consume_max_retry_budget():
    args = _make_args(max_retries=0, coverage_retries=0, anchor_check=False)
    result = _run_flow("hello", ["\u304b\u306a\u304b\u306a\u304b\u306a", "中文输出"], args)
    retry_types = [item.get("type") for item in result["retry_history"]]
    assert "kana_residue" in retry_types
    assert result["out_text"] == "中文输出"


@pytest.mark.integration
def test_main_flow_empty_output_no_retry_fallback():
    args = _make_args(max_retries=0)
    result = _run_flow("hello", [""], args)
    assert result["out_text"].splitlines()[0] == "[翻译失败]"


@pytest.mark.integration
def test_main_flow_empty_output_no_retry_fallback_keeps_epub_anchor_ids():
    args = _make_args(max_retries=0, file="book.epub")
    original = "@id=0@\nA\n@end=0@\n@id=1@\nB\n@end=1@"
    result = _run_flow(original, [""], args)
    out_text = result["out_text"]

    assert out_text.splitlines()[0] == "[翻译失败]"
    assert out_text.count("@id=0@") == 1
    assert out_text.count("@end=0@") == 1
    assert out_text.count("@id=1@") == 1
    assert out_text.count("@end=1@") == 1


@pytest.mark.integration
def test_main_flow_text_protect_restore():
    from murasaki_translator.core.text_protector import TextProtector

    args = _make_args(max_retries=0)
    original = "Hello [[Alice]]"
    protector = TextProtector(patterns=[r"\[\[.+?\]\]"])
    processed = protector.protect(original)
    placeholder = next(iter(protector.replacements.keys()))

    engine = FakeEngine([f"你好 {placeholder}"])
    prompt_builder = PromptBuilder({})
    response_parser = ResponseParser()
    post_processor = RuleProcessor(
        [{"type": "format", "pattern": "restore_protection", "active": True}]
    )
    stdout_lock = threading.Lock()

    result = translate_block_with_retry(
        block_idx=0,
        original_src_text=original,
        processed_src_text=processed,
        args=args,
        engine=engine,
        prompt_builder=prompt_builder,
        response_parser=response_parser,
        post_processor=post_processor,
        glossary={},
        stdout_lock=stdout_lock,
        strict_mode=False,
        protector=protector,
    )
    assert result["out_text"] == "你好 [[Alice]]"


@pytest.mark.integration
def test_translate_single_block_structured_ignores_user_custom_protect(monkeypatch, tmp_path):
    import murasaki_translator.main as main_mod

    protect_file = tmp_path / "protect_patterns.txt"
    protect_file.write_text("+USER_FILE_PATTERN\n!@id=\\d+@\n", encoding="utf-8")

    pre_rules = [
        {
            "type": "protect",
            "pattern": "text_protect",
            "active": True,
            "options": {"patterns": ["+USER_PRE_RULE"]},
        }
    ]
    post_rules = [
        {
            "type": "format",
            "pattern": "restore_protection",
            "active": True,
            "options": {"customPattern": "+USER_POST_RULE"},
        }
    ]

    class FakeEngineSingle:
        def __init__(self, *args, **kwargs):
            pass

        def start_server(self):
            return None

        def stop_server(self):
            return None

    class FakeProtector:
        last_patterns = None

        def __init__(self, patterns=None, **kwargs):
            FakeProtector.last_patterns = list(patterns) if isinstance(patterns, list) else patterns

        def protect(self, text):
            return text

        def restore(self, text):
            return text

    captured = {}

    def fake_load_rules(path):
        if path == "pre_rules.json":
            return pre_rules
        if path == "post_rules.json":
            return post_rules
        return []

    def fake_translate_block_with_retry(**kwargs):
        captured["protector"] = kwargs.get("protector")
        return {
            "success": True,
            "out_text": "ok",
            "cot": "",
        }

    monkeypatch.setattr(main_mod, "InferenceEngine", FakeEngineSingle)
    monkeypatch.setattr(main_mod, "TextProtector", FakeProtector)
    monkeypatch.setattr(main_mod, "load_glossary", lambda _path: {})
    monkeypatch.setattr(main_mod, "load_rules", fake_load_rules)
    monkeypatch.setattr(main_mod, "translate_block_with_retry", fake_translate_block_with_retry)

    args = SimpleNamespace(
        server="dummy-server",
        model="dummy-model",
        gpu_layers=0,
        ctx=1024,
        no_server_spawn=True,
        flash_attn=False,
        kv_cache_type="f16",
        use_large_batch=False,
        batch_size=None,
        seed=None,
        glossary=None,
        rules_pre="pre_rules.json",
        rules_post="post_rules.json",
        file="book.epub",
        alignment_mode=False,
        text_protect=True,
        protect_patterns=str(protect_file),
        strict_mode="subs",
        single_block="@id=1@\nhello\n@end=1@",
        json_output=True,
        debug=False,
        preset="novel",
        balance_enable=True,
    )

    main_mod.translate_single_block(args)

    assert captured.get("protector") is not None
    assert FakeProtector.last_patterns == [r"@id=\d+@", r"@end=\d+@", r"<[^>]+>"]
    assert "USER_PRE_RULE" not in "".join(FakeProtector.last_patterns or [])
    assert "USER_POST_RULE" not in "".join(FakeProtector.last_patterns or [])
    assert "USER_FILE_PATTERN" not in "".join(FakeProtector.last_patterns or [])
    assert args.protect_patterns is None
