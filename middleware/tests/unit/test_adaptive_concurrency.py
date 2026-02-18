import pytest

from murasaki_flow_v2.utils.adaptive_concurrency import AdaptiveConcurrency, classify_error


@pytest.mark.unit
def test_adaptive_concurrency_success_growth():
    adaptive = AdaptiveConcurrency(max_limit=4)
    assert adaptive.get_limit() == 2
    adaptive.note_success()
    assert adaptive.get_limit() == 3
    adaptive.note_success()
    assert adaptive.get_limit() == 4


@pytest.mark.unit
def test_adaptive_concurrency_rate_limit_backoff():
    adaptive = AdaptiveConcurrency(max_limit=8, start_limit=6)
    assert adaptive.get_limit() == 6
    adaptive.note_error("OpenAI-compatible HTTP 429: rate limit")
    assert adaptive.get_limit() == 3


@pytest.mark.unit
def test_classify_error():
    assert classify_error("HTTP 429") == "rate_limited"
    assert classify_error("OpenAI-compatible HTTP 503") == "server_error"
    assert classify_error("timeout") == "network"
