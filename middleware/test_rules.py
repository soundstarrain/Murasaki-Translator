import sys
import json
import os

# Add parent directory to path to allow importing middleware modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Force UTF-8 for stdin/stdout/stderr (Windows console fix)
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

try:
    from rule_processor import RuleProcessor
    from murasaki_translator.core.text_protector import TextProtector
except ImportError as e:
    print(json.dumps({"success": False, "error": f"Import error: {str(e)}"}))
    sys.exit(1)

def main():
    try:
        # Read from stdin (more reliable for large JSON)
        input_data = sys.stdin.read()
        if not input_data:
            return

        payload = json.loads(input_data)
        text = payload.get('text', '')
        src_text_overlay = payload.get('source_text') # Try to get real source text from sandbox
        rules = payload.get('rules', [])
        
        protection_rules = [r for r in rules if r.get('pattern') == 'restore_protection']
        protector = None
        if protection_rules:
            # Collect all custom patterns from all protection rules
            patterns = [r.get('options', {}).get('customPattern') for r in protection_rules if r.get('options', {}).get('customPattern')]
            protector = TextProtector(patterns=patterns if patterns else None)

        steps = []
        # Initial step
        steps.append({"label": "Source", "text": text})

        current_text = text
        for i, rule in enumerate(rules):
            if not rule.get('active', True):
                continue

            if rule.get('type') == 'protect':
                steps.append({
                    "label": "text_protect",
                    "text": current_text,
                    "changed": False,
                    "error": None,
                })
                continue
            
            # Create a single-rule processor to capture step-by-step
            p = RuleProcessor([rule])
            # Pass source_text if available, otherwise fallback to current_text (which might be the translated text)
            # Use src_text_overlay to make Fixers like NumberFixer and PunctuationFixer work in sandbox
            new_text = p.process(current_text, src_text=src_text_overlay or current_text, protector=protector)
            
            label = rule.get('type', 'rule')
            if label == 'format':
                label = rule.get('pattern', 'format')
            elif label == 'regex':
                label = f"regex: {rule.get('pattern')[:20]}..."

            error = None
            if rule.get('type') == 'python':
                script = rule.get('script') or rule.get('pattern', '')
                error = p.get_python_script_error(script) or None

            steps.append({
                "label": label,
                "text": new_text,
                "changed": new_text != current_text,
                "error": error,
            })
            current_text = new_text

        print(json.dumps({"success": True, "steps": steps}))

    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == "__main__":
    main()
