import sys
from pathlib import Path
import json

# Add middleware to path
sys.path.insert(0, str(Path(__file__).parent.resolve()))

try:
    from murasaki_flow_v2.api.sandbox_tester import SandboxTester
    
    tester = SandboxTester()
    res = tester.run_test("Hello", {})

    def _sanitize(val):
        if isinstance(val, (str, int, float, bool)) or val is None:
            return val
        if isinstance(val, list):
            return [_sanitize(v) for v in val]
        if isinstance(val, dict):
            return {str(k): _sanitize(v) for k, v in val.items()}
        return str(val)

    def clean_traces(traces):
        if not traces:
            return traces
        cleaned = []
        for t in traces:
            clean_t = {**t}
            if "rule" in clean_t:
                clean_t["rule"] = _sanitize(clean_t["rule"])
            cleaned.append(clean_t)
        return cleaned

    output = {
        "ok": res.ok,
        "source_text": res.source_text,
        "pre_processed": res.pre_processed,
        "raw_request": res.raw_request,
        "raw_response": res.raw_response,
        "parsed_result": res.parsed_result,
        "post_processed": res.post_processed,
        "pre_traces": clean_traces(res.pre_traces),
        "post_traces": clean_traces(res.post_traces),
        "error": res.error,
    }

    print("Trying to JSON Dump...")
    json.dumps(output)
    print("Success")
except Exception as e:
    import traceback
    traceback.print_exc()
