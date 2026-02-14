"""Rule Processor - Applies pre/post-processing rules (replace, regex, format).

This module provides text transformation capabilities with support for:
- Simple string replacement
- Regular expression substitution (with validation and safety checks)
- Predefined format transformers
- User-provided python scripts (`def transform(...)`)
"""

import re
import ast
import inspect
import threading
from typing import List, Dict, Any, Optional, Tuple

try:
    from murasaki_translator.fixer import RubyCleaner, PunctuationFixer, KanaFixer, NumberFixer
except ImportError:
    RubyCleaner = PunctuationFixer = KanaFixer = NumberFixer = None

import logging
logger = logging.getLogger("murasaki.rules")

try:
    import opencc
except ImportError:
    opencc = None

PYTHON_SCRIPT_MAX_LEN = 8000
PYTHON_SCRIPT_TIMEOUT_SEC = 0.5
PYTHON_SCRIPT_BANNED_CALLS = {
    "eval",
    "exec",
    "compile",
    "open",
    "__import__",
    "input",
    "globals",
    "locals",
    "vars",
    "dir",
    "getattr",
    "setattr",
    "delattr",
}

def _safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    if name == "re":
        return re
    raise ImportError("Only 're' import is allowed")

PYTHON_SCRIPT_SAFE_BUILTINS = {
    "len": len,
    "range": range,
    "min": min,
    "max": max,
    "sum": sum,
    "str": str,
    "int": int,
    "float": float,
    "bool": bool,
    "list": list,
    "dict": dict,
    "set": set,
    "tuple": tuple,
    "enumerate": enumerate,
    "zip": zip,
    "sorted": sorted,
    "abs": abs,
    "round": round,
    "__import__": _safe_import,
}


def validate_regex(pattern: str) -> Tuple[bool, str]:
    """
    Validate regex pattern for syntax and potential ReDoS patterns.
    
    Args:
        pattern: The regex pattern to validate
        
    Returns:
        Tuple of (is_valid, error_message)
    """
    if not pattern:
        return False, "Empty pattern"
    
    try:
        re.compile(pattern)
    except re.error as e:
        return False, f"Invalid regex syntax: {e}"
    
    # Check for potential ReDoS patterns (simple heuristics)
    # These patterns can cause catastrophic backtracking
    dangerous_indicators = [
        (r'(\.\*){2,}', 'Multiple .* in sequence'),
        (r'(\.\+){2,}', 'Multiple .+ in sequence'),
        (r'\(\.\*\)\+', 'Nested quantifiers with .*'),
        (r'\(\.\+\)\+', 'Nested quantifiers with .+'),
    ]
    
    for indicator, message in dangerous_indicators:
        if re.search(indicator, pattern):
            # Return warning but still allow (log for debugging)
            print(f"[RuleProcessor] Warning: {message} in pattern: {pattern}")
    
    return True, ""


class RuleProcessor:
    """
    Applies text transformation rules.
    
    Supported rule types:
    - 'replace': Simple string replacement
    - 'regex': Regular expression substitution (with validation)
    - 'format': Predefined formatters (clean_empty, smart_quotes, full_to_half_punct)
    - 'python': User script executed with input text, returns output text
      (requires `def transform(...)`)
    
    Example usage:
        rules = [
            {'type': 'replace', 'pattern': 'foo', 'replacement': 'bar', 'active': True},
            {'type': 'regex', 'pattern': r'\\s+', 'replacement': ' ', 'active': True},
            {'type': 'format', 'pattern': 'clean_empty', 'active': True}
        ]
        processor = RuleProcessor(rules)
        result = processor.process("some text")
    """
    
    def __init__(self, rules_data: Optional[List[Dict[str, Any]]] = None):
        """
        Initialize the RuleProcessor.
        
        Args:
            rules_data: List of rule dictionaries with keys:
                - type: 'replace', 'regex', or 'format'
                - pattern: The pattern to match (or format name)
                - replacement: The replacement string (for replace/regex)
                - active: Whether the rule is enabled (default True)
        """
        self.rules = rules_data if rules_data else []
        self._validated_patterns: Dict[str, bool] = {}
        self._compiled_patterns: Dict[str, Any] = {}
        self._compiled_python_scripts: Dict[str, Any] = {}
        self._python_script_errors: Dict[str, str] = {}

    def _set_python_script_error(self, script: str, error: Optional[str]) -> None:
        if not script:
            return
        if error:
            self._python_script_errors[script] = str(error)
        else:
            self._python_script_errors.pop(script, None)

    def get_python_script_error(self, script: str) -> str:
        return self._python_script_errors.get(script, "")

    def _validate_and_compile(self, pattern: str) -> Optional[Any]:
        """
        Validate and compile regex pattern, caching the result.
        
        Args:
            pattern: Regex pattern string
            
        Returns:
            Compiled pattern or None if invalid
        """
        if pattern in self._compiled_patterns:
            return self._compiled_patterns[pattern]
        
        is_valid, error = validate_regex(pattern)
        if not is_valid:
            print(f"[RuleProcessor] Regex validation failed: {error}")
            self._compiled_patterns[pattern] = None
            return None
        
        try:
            compiled = re.compile(pattern)
            self._compiled_patterns[pattern] = compiled
            return compiled
        except Exception as e:
            print(f"[RuleProcessor] Failed to compile pattern: {e}")
            self._compiled_patterns[pattern] = None
            return None

    def _validate_python_script(self, script: str) -> Tuple[bool, str]:
        try:
            tree = ast.parse(script, mode="exec")
        except Exception as e:
            return False, f"Syntax error: {e}"

        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name != "re":
                        return False, "Only 're' import is allowed"
                continue
            if isinstance(node, ast.ImportFrom):
                if node.module != "re":
                    return False, "Only 're' import is allowed"
                continue

            if isinstance(node, ast.Name) and node.id.startswith("__"):
                return False, "Dunder names are not allowed"

            if isinstance(node, ast.Call):
                func = node.func
                if isinstance(func, ast.Name) and func.id in PYTHON_SCRIPT_BANNED_CALLS:
                    return False, f"Call blocked: {func.id}"
        return True, ""

    def _script_defines_transform(self, script: str) -> bool:
        try:
            tree = ast.parse(script, mode="exec")
        except Exception:
            return False
        for node in tree.body:
            if isinstance(node, ast.FunctionDef) and node.name == "transform":
                return True
        return False

    def _call_python_func(
        self,
        func: Any,
        text: str,
        src_text: Optional[str],
        protector: Any,
    ) -> Any:
        try:
            signature = inspect.signature(func)
        except (TypeError, ValueError):
            return func(text, src_text, protector)

        params = list(signature.parameters.values())
        has_varargs = any(p.kind == inspect.Parameter.VAR_POSITIONAL for p in params)
        has_varkw = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in params)
        positional = [
            p
            for p in params
            if p.kind
            in (
                inspect.Parameter.POSITIONAL_ONLY,
                inspect.Parameter.POSITIONAL_OR_KEYWORD,
            )
        ]

        if has_varargs:
            return func(text, src_text, protector)
        if positional:
            count = len(positional)
            if count >= 3:
                return func(text, src_text, protector)
            if count == 2:
                return func(text, src_text)
            if count == 1:
                return func(text)
        if has_varkw or any(
            p.kind == inspect.Parameter.KEYWORD_ONLY for p in params
        ):
            return func(text=text, src_text=src_text, protector=protector)
        return func()

    def _normalize_python_script(self, script: str) -> str:
        if "\\n" not in script:
            return script

        # Convert literal "\n" used as line separators (avoid touching string literals)
        return re.sub(
            r"\\n(?=\s*(?:import|from|output|return|if|for|while|def|class|try|except|finally|with|lines\s*=))",
            "\n",
            script,
        )

    def _compile_python_script(self, script: str) -> Optional[Any]:
        """
        Compile a user-provided python script into a callable function.
        The script is wrapped in a function to allow `return` statements.
        """
        if script in self._compiled_python_scripts:
            return self._compiled_python_scripts[script]

        if not script or not script.strip():
            self._compiled_python_scripts[script] = None
            self._set_python_script_error(script, None)
            return None

        working_script = self._normalize_python_script(script)

        if len(working_script) > PYTHON_SCRIPT_MAX_LEN:
            err_msg = f"Script too long (max {PYTHON_SCRIPT_MAX_LEN} chars)"
            logger.error(f"[RuleProcessor] Python script too long.")
            self._compiled_python_scripts[script] = None
            self._set_python_script_error(script, err_msg)
            return None

        is_safe, reason = self._validate_python_script(working_script)
        if not is_safe:
            logger.error(f"[RuleProcessor] Python script blocked: {reason}")
            self._compiled_python_scripts[script] = None
            self._set_python_script_error(script, reason)
            return None

        if not self._script_defines_transform(working_script):
            err_msg = "Missing transform() definition"
            logger.error(f"[RuleProcessor] {err_msg}")
            self._compiled_python_scripts[script] = None
            self._set_python_script_error(script, err_msg)
            return None

        try:
            scope: Dict[str, Any] = {
                "__builtins__": PYTHON_SCRIPT_SAFE_BUILTINS,
                "re": re,
            }
            exec(working_script, scope, scope)
            func = scope.get("transform")
            if callable(func):
                self._compiled_python_scripts[script] = func
                self._set_python_script_error(script, None)
                return func
            err_msg = "Missing transform() definition"
            logger.error(f"[RuleProcessor] {err_msg}")
            self._set_python_script_error(script, err_msg)
        except Exception as e:
            err_msg = f"Compile error: {e}"
            logger.error(f"[RuleProcessor] Python script compile error: {e}")
            self._set_python_script_error(script, err_msg)

        self._compiled_python_scripts[script] = None
        return None

    def _apply_python_script(self, script: str, text: str, src_text: Optional[str] = None, protector: Any = None) -> str:
        func = self._compile_python_script(script)
        if not func:
            if script and script.strip() and not self.get_python_script_error(script):
                self._set_python_script_error(script, "Compile failed")
            return text

        result_holder: Dict[str, Any] = {"done": False, "value": None, "error": None}

        def runner():
            try:
                result_holder["value"] = self._call_python_func(
                    func,
                    text,
                    src_text,
                    protector,
                )
            except Exception as e:
                result_holder["error"] = e
            finally:
                result_holder["done"] = True

        thread = threading.Thread(target=runner, daemon=True)
        thread.start()
        thread.join(PYTHON_SCRIPT_TIMEOUT_SEC)

        if not result_holder["done"]:
            logger.error("[RuleProcessor] Python script timeout")
            self._set_python_script_error(
                script,
                f"Timeout after {PYTHON_SCRIPT_TIMEOUT_SEC}s",
            )
            return text

        if result_holder["error"] is not None:
            logger.error(
                f"[RuleProcessor] Python script runtime error: {result_holder['error']}"
            )
            self._set_python_script_error(
                script,
                f"Runtime error: {result_holder['error']}",
            )
            return text

        result = result_holder["value"]
        if result is None:
            self._set_python_script_error(script, None)
            return text
        self._set_python_script_error(script, None)
        return str(result)

    def process(self, text: str, src_text: Optional[str] = None, protector: Any = None, strict_line_count: bool = False) -> str:
        """
        Apply all active rules to input text.
        
        Args:
            text: Input text to process
            src_text: Optional original source text for context-aware fixers
            protector: Optional TextProtector instance for 'restore_protection' rule
            strict_line_count: If True, skip rules that would change the total number of lines (for EPUB/SRT)
            
        Returns:
            Processed text with all active rules applied
        """
        if not text:
            return text

        current_text = text
        original_line_count = len(text.splitlines())
        
        for i, rule in enumerate(self.rules):
            if not rule.get('active', True):
                continue

            r_type = rule.get('type')
            pattern = rule.get('pattern', '')
            replacement = rule.get('replacement', '')
            
            try:
                before_text = current_text
                if r_type == 'replace':
                    if pattern:
                        new_text = current_text.replace(pattern, replacement)
                        # Check line count safety in strict mode
                        if strict_line_count and len(new_text.splitlines()) != original_line_count:
                            logger.warning(f"[RuleProcessor] Skipping 'replace' rule {pattern} because it changes line count in strict mode.")
                        else:
                            current_text = new_text
                
                elif r_type == 'regex':
                    if pattern:
                        compiled = self._validate_and_compile(pattern)
                        if compiled:
                            new_text = compiled.sub(replacement, current_text)
                            if strict_line_count and len(new_text.splitlines()) != original_line_count:
                                logger.warning(f"[RuleProcessor] Skipping 'regex' rule {pattern} because it changes line count in strict mode.")
                            else:
                                current_text = new_text

                elif r_type == 'protect':
                    # Config-only rule for text protection; no direct text mutation here.
                    continue
                
                elif r_type == 'format':
                    options = rule.get('options', {})
                    current_text = self._apply_format(
                        pattern, 
                        current_text, 
                        src_text=src_text, 
                        options=options, 
                        protector=protector,
                        strict_line_count=strict_line_count
                    )
                
                elif r_type == 'python':
                    script = rule.get('script') or rule.get('pattern', '')
                    if script:
                        new_text = self._apply_python_script(
                            script,
                            current_text,
                            src_text=src_text,
                            protector=protector,
                        )
                        if strict_line_count and len(new_text.splitlines()) != original_line_count:
                            logger.warning(f"[RuleProcessor] Skipping python script because it changes line count in strict mode.")
                        else:
                            current_text = new_text
                
                if current_text != before_text:
                    is_experimental = r_type == 'format' and pattern in ['restore_protection', 'kana_fixer', 'punctuation_fixer']
                    if r_type == 'python':
                        logger.debug(
                            f"Core Rule [python] transformed text (chars: {len(before_text)} -> {len(current_text)})"
                        )
                    elif r_type in ['replace', 'regex'] or not is_experimental:
                        label = f"Core Rule [{r_type if r_type != 'format' else 'built-in'}:{pattern}]"
                        logger.debug(f"{label} transformed text (chars: {len(before_text)} -> {len(current_text)})")
                    else:
                        logger.debug(f"[Experimental] Format Rule [{pattern}] transformed text (chars: {len(before_text)} -> {len(current_text)})")
                
            except Exception as e:
                logger.error(f"Error processing rule {r_type}:{pattern}: {e}")
                continue
                
        return current_text

    def _apply_format(self, format_name: str, text: str, src_text: Optional[str] = None, options: Dict[str, Any] = None, protector: Any = None, strict_line_count: bool = False) -> str:
        """
        Apply a predefined format transformation.
        
        Args:
            format_name: Name of the format to apply
            text: Input text
            src_text: Optional original source text
            options: Optional dictionary of rule-specific options
            protector: Optional TextProtector for restoration
            strict_line_count: If True, disable rules that change line density
            
        Returns:
            Formatted text
        """
        if options is None:
            options = {}

        if format_name == 'restore_protection':
            if protector:
                return protector.restore(text)
            return text

        if format_name in ['clean_empty', 'clean_empty_lines']:
            if strict_line_count:
                logger.warning(f"[RuleProcessor] Skipping '{format_name}' in strict mode (EPUB/SRT support).")
                return text
            # Remove empty lines
            lines = [line for line in text.splitlines() if line.strip()]
            return "\n".join(lines)
            
        elif format_name == 'smart_quotes':
            # Convert CJK/English quotes to Corner Quotes
            # 1. Handle explicit directional quotes
            text = text.replace('“', '「').replace('”', '」').replace('‘', '『').replace('’', '』')
            
            # 2. Robust pairing for straight quotes (" and ') - Balanced check within each line
            lines = []
            for line in text.splitlines():
                # Only pair if count is even to avoid misalignment in lines with odd quotes
                if line.count('"') > 0 and line.count('"') % 2 == 0:
                    line = re.sub(r'"([^"]*)"', r'「\1」', line)
                if line.count("'") > 0 and line.count("'") % 2 == 0:
                    line = re.sub(r"'([^']*)'", r'『\1』', line)
                lines.append(line)
            return "\n".join(lines)
            
        elif format_name == 'ellipsis':
            # Standardize ellipsis formats to ……
            # Only handle 3 or more characters to avoid false positives with double periods
            text = re.sub(r'\.{3,}', '……', text)
            text = re.sub(r'。{3,}', '……', text)
            return text
            
        elif format_name == 'full_to_half_punct':
            # Full-width punctuation to half-width
            table = {
                '，': ',', '。': '.', '！': '!', '？': '?',
                '：': ':', '；': ';', '（': '(', '）': ')'
            }
            for k, v in table.items():
                text = text.replace(k, v)
            return text
            
        elif format_name == 'ensure_single_newline':
            if strict_line_count:
                logger.warning(f"[RuleProcessor] Skipping 'ensure_single_newline' in strict mode.")
                return text
            # Force single newline between paragraphs (compact)
            # Preserve leading indentation (use rstrip instead of strip)
            lines = [line.rstrip() for line in text.splitlines() if line.strip()]
            return "\n".join(lines)
            
        elif format_name == 'ensure_double_newline':
            if strict_line_count:
                logger.warning(f"[RuleProcessor] Skipping 'ensure_double_newline' in strict mode.")
                return text
            # Force double newline between paragraphs (light novel style)
            # Preserve leading indentation (use rstrip instead of strip)
            lines = [line.rstrip() for line in text.splitlines() if line.strip()]
            return "\n\n".join(lines)

        elif format_name == 'merge_short_lines':
            if strict_line_count:
                logger.warning(f"[RuleProcessor] Skipping 'merge_short_lines' in strict mode.")
                return text
            lines = text.splitlines()
            if not lines: return text
            
            merged_lines = []
            current_line = ""
            
            for line in lines:
                stripped = line.strip()
                if not stripped:
                    if current_line:
                        merged_lines.append(current_line)
                        current_line = ""
                    merged_lines.append("") 
                    continue
                
                if not current_line:
                    current_line = line
                    continue
                
                # Heuristic for merging: 
                # 1. Previous line is short (e.g. < 15 chars) 
                # 2. Previous line doesn't end with sentence-final punctuation
                # Use rstrip to ignore trailing spaces for punc check
                is_short = len(current_line.strip()) < 15
                ends_with_punc = re.search(r'[。！？！？!?.…」』”"\']\s*$', current_line.rstrip())
                
                if is_short and not ends_with_punc:
                    # Merge with a space if it's alphanumeric, or directly if it's CJK
                    # For simplicity in this context, we just join. 
                    # Most cases in LN translation are CJK.
                    current_line += stripped
                else:
                    merged_lines.append(current_line)
                    current_line = line
            
            if current_line:
                merged_lines.append(current_line)
                
            return "\n".join(merged_lines)
        
        # --- Experimental Fixers Integrated as Formats ---
        elif format_name == 'ruby_cleaner':
            if RubyCleaner:
                aggressive = options.get('aggressive', False)
                return RubyCleaner.clean(text, aggressive=aggressive)
            return text
            
        elif format_name == 'ruby_cleaner_aggressive':
            if RubyCleaner:
                return RubyCleaner.clean(text, aggressive=True)
            return text
            
        elif format_name == 'punctuation_fixer':
            if PunctuationFixer:
                if src_text:
                    return PunctuationFixer.fix(src_text, text, target_is_cjk=True)
            return text
            
        elif format_name == 'kana_fixer':
            if KanaFixer:
                return KanaFixer.fix(text)
            return text
            
        elif format_name == 'number_fixer':
            if NumberFixer:
                if src_text:
                    return NumberFixer.fix(src_text, text)
            return text
        
        elif format_name == 'traditional_chinese':
            if opencc:
                try:
                    # Cache converter on the instance to avoid re-init
                    if not hasattr(self, '_cc_converter'):
                        self._cc_converter = opencc.OpenCC('s2tw')
                    return self._cc_converter.convert(text)
                except Exception as e:
                    print(f"[RuleProcessor] OpenCC Error: {e}")
            return text
        
        # Unknown format, return unchanged
        return text
    
    def validate_all_rules(self) -> List[Dict[str, Any]]:
        """
        Validate all regex rules and return validation results.
        
        Returns:
            List of dicts with 'index', 'pattern', 'valid', 'error' keys
        """
        results = []
        for i, rule in enumerate(self.rules):
            if rule.get('type') == 'regex':
                pattern = rule.get('pattern', '')
                is_valid, error = validate_regex(pattern)
                results.append({
                    'index': i,
                    'pattern': pattern,
                    'valid': is_valid,
                    'error': error if not is_valid else None
                })
        return results
