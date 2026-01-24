"""Rule Processor - Applies pre/post-processing rules (replace, regex, format).

This module provides text transformation capabilities with support for:
- Simple string replacement
- Regular expression substitution (with validation and safety checks)
- Predefined format transformers
"""

import re
from typing import List, Dict, Any, Optional, Tuple


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

    def process(self, text: str) -> str:
        """
        Apply all active rules to input text.
        
        Args:
            text: Input text to process
            
        Returns:
            Processed text with all active rules applied
        """
        if not text:
            return text

        current_text = text
        
        for rule in self.rules:
            if not rule.get('active', True):
                continue

            r_type = rule.get('type')
            pattern = rule.get('pattern', '')
            replacement = rule.get('replacement', '')
            
            try:
                if r_type == 'replace':
                    # Simple string replace
                    if pattern:
                        current_text = current_text.replace(pattern, replacement)
                
                elif r_type == 'regex':
                    # Regex replace with validation
                    if pattern:
                        compiled = self._validate_and_compile(pattern)
                        if compiled:
                            current_text = compiled.sub(replacement, current_text)
                        
                elif r_type == 'format':
                    current_text = self._apply_format(pattern, current_text)
                            
            except Exception as e:
                print(f"[RuleProcessor] Error processing rule {rule.get('type', 'unknown')}: {e}")
                # Continue to next rule instead of crashing
                continue
                
        return current_text

    def _apply_format(self, format_name: str, text: str) -> str:
        """
        Apply a predefined format transformation.
        
        Args:
            format_name: Name of the format to apply
            text: Input text
            
        Returns:
            Formatted text
        """
        if format_name == 'clean_empty':
            # Remove empty lines
            lines = [line for line in text.splitlines() if line.strip()]
            return "\n".join(lines)
            
        elif format_name == 'smart_quotes':
            # Normalize fancy quotes to standard ASCII
            table = {
                '"': '"', '"': '"', 
                ''': "'", ''': "'"
            }
            for k, v in table.items():
                text = text.replace(k, v)
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
            # Force single newline between paragraphs (compact)
            lines = [line.strip() for line in text.splitlines() if line.strip()]
            return "\n".join(lines)
            
        elif format_name == 'ensure_double_newline':
            # Force double newline between paragraphs (light novel style)
            lines = [line.strip() for line in text.splitlines() if line.strip()]
            return "\n\n".join(lines)
        
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
