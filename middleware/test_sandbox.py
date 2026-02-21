import sys
import json
from pathlib import Path

# Add middleware to path
sys.path.insert(0, str(Path(__file__).parent.resolve()))

try:
    from murasaki_flow_v2.api.sandbox_tester import SandboxTester
    
    tester = SandboxTester()
    res = tester.run_test("Hello", {})
    print(res)
except Exception as e:
    import traceback
    traceback.print_exc()
