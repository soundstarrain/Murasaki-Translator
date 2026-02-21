"""Sandbox tester for Pipeline V2.

Provides an isolated environment to test a single text block
through a complete pipeline configuration (Provider -> Prompt -> Parser).
"""

from typing import Any, Dict, List, Optional
from dataclasses import dataclass
import json

from murasaki_flow_v2.registry.profile_store import ProfileStore
from murasaki_flow_v2.providers.registry import ProviderRegistry
from murasaki_flow_v2.prompts.registry import PromptRegistry
from murasaki_flow_v2.parsers.registry import ParserRegistry
from murasaki_translator.core.chunker import TextBlock


from murasaki_flow_v2.utils import processing as v2_processing

@dataclass
class SandboxResult:
    ok: bool
    source_text: str
    pre_processed: str = ""
    raw_request: str = ""
    raw_response: str = ""
    parsed_result: str = ""
    post_processed: str = ""
    pre_traces: Optional[List[Dict[str, Any]]] = None
    post_traces: Optional[List[Dict[str, Any]]] = None
    pre_rules_count: int = 0
    post_rules_count: int = 0
    error: str = ""


class SandboxTester:
    def __init__(self, store: ProfileStore):
        self.store = store
        self.providers = ProviderRegistry(store)
        self.prompts = PromptRegistry(store)
        self.parsers = ParserRegistry(store)

    def run_test(
        self,
        text: str,
        pipeline_config: Dict[str, Any],
    ) -> SandboxResult:
        """Run a single string of text through the provided pipeline config."""
        try:
            from murasaki_translator.core.text_protector import TextProtector
            from murasaki_translator.core.chunker import TextBlock
            from murasaki_flow_v2.utils import processing as v2_processing
            
            # The original code used direct registry lookups.
            # The provided diff implies a refactor to use a registry manager.
            # For this specific change, I will adapt the existing structure
            # to incorporate the traces, while keeping the original registry
            # lookup mechanism as much as possible, unless the diff explicitly
            # replaces it. The diff provided for `run_test` seems to be a
            # larger refactor than just adding traces. I will focus on the
            # trace-related changes as per the instructions, and only apply
            # the refactor if it's necessary to make the trace changes work.

            # Reverting to original registry lookup for provider, prompt, parser
            # as the instruction is about traces, not a full refactor.
            provider_ref = str(pipeline_config.get("provider") or "")
            prompt_ref = str(pipeline_config.get("prompt") or "")
            parser_ref = str(pipeline_config.get("parser") or "")

            if not provider_ref:
                return SandboxResult(ok=False, source_text=text, error="Missing provider config.")
            if not prompt_ref:
                return SandboxResult(ok=False, source_text=text, error="Missing prompt config.")
            if not parser_ref:
                return SandboxResult(ok=False, source_text=text, error="Missing parser config.")

            provider = self.providers.get_provider(provider_ref)
            prompt = self.prompts.get_prompt(prompt_ref)
            parser = self.parsers.get_parser(parser_ref)

            if not provider:
                return SandboxResult(ok=False, source_text=text, error=f"Provider '{provider_ref}' not found.")
            if not prompt:
                return SandboxResult(ok=False, source_text=text, error=f"Prompt '{prompt_ref}' not found.")
            if not parser:
                return SandboxResult(ok=False, source_text=text, error=f"Parser '{parser_ref}' not found.")

            # Processing Processor Setup
            proc_options = v2_processing.ProcessingOptions(
                rules_pre=v2_processing.load_rules(pipeline_config.get("rules_pre")),
                rules_post=v2_processing.load_rules(pipeline_config.get("rules_post")),
                glossary=v2_processing.load_glossary(pipeline_config.get("glossary")),
                source_lang="ja",
                enable_text_protect=bool(pipeline_config.get("text_protect", True))
            )
            processor = v2_processing.ProcessingProcessor(proc_options)
            protector = processor.create_protector()
            
            pre_traces: List[Dict[str, Any]] = []
            post_traces: List[Dict[str, Any]] = []

            # Step 1: Pre-process
            pre_processed = processor.apply_pre(text, traces=pre_traces)
            if protector:
                pre_processed = protector.protect(pre_processed)

            # Build messages
            from murasaki_flow_v2.prompts.builder import build_messages
            settings = pipeline_config.get("settings") or {}

            # Assume context building is simplified for a single block
            context_cfg = prompt.get("context") or {}
            source_format = str(context_cfg.get("source_format") or "auto").strip().lower()
            if source_format == "jsonl":
                # Create a mock jsonl chunk
                text_to_translate = f'{{"id": 1, "text": {json.dumps(pre_processed)}}}'
            else:
                text_to_translate = pre_processed
                
            block = TextBlock(id=1, prompt_text=text_to_translate)
            
            context = {"before": "", "after": ""}
            glossary_text = "\n".join([f"{k}: {v}" for k, v in proc_options.glossary.items()])
            
            messages = build_messages(
                prompt,
                source_text=block.prompt_text,
                context_before=context["before"],
                context_after=context["after"],
                glossary_text=glossary_text,
                line_index=None
            )

            raw_request = ""
            raw_response = ""
            import dataclasses
            try:
                # Issue request
                request = provider.build_request(messages, settings)
                try:
                    raw_request = json.dumps(dataclasses.asdict(request), ensure_ascii=False, indent=2)
                except Exception:
                    raw_request = str(request)
                    
                response = provider.send(request)
                raw_response = response.text
            except Exception as e:
                return SandboxResult(
                    ok=False, 
                    source_text=text, 
                    pre_processed=pre_processed,
                    raw_request=raw_request,
                    raw_response=raw_response, 
                    pre_traces=pre_traces,
                    pre_rules_count=len(proc_options.rules_pre),
                    post_rules_count=len(proc_options.rules_post),
                    error=f"Provider Error: {e}"
                )

            # Parse result
            parsed_result = ""
            try:
                parsed = parser.parse(raw_response)
                parsed_result = parsed.text.strip("\n")
                if source_format == "jsonl":
                    from murasaki_flow_v2.utils.line_format import parse_jsonl_entries
                    entries, ordered = parse_jsonl_entries(raw_response)
                    if entries:
                        # Join all the values instead of just taking the first one
                        parsed_result = "\n".join(str(v) for v in entries.values())
                    elif ordered:
                        parsed_result = "\n".join(str(v) for v in ordered)
            except Exception as e:
                return SandboxResult(
                    ok=False,
                    source_text=text,
                    pre_processed=pre_processed,
                    raw_request=raw_request,
                    raw_response=raw_response,
                    pre_traces=pre_traces,
                    pre_rules_count=len(proc_options.rules_pre),
                    post_rules_count=len(proc_options.rules_post),
                    error=f"Parser Error: {e}"
                )

            # Step 5: Post-process
            post_processed = ""
            try:
                post_processed = processor.apply_post(
                    parsed_result,
                    src_text=text,
                    protector=protector,
                    traces=post_traces
                )
            except Exception as e:
                return SandboxResult(
                    ok=False,
                    source_text=text,
                    pre_processed=pre_processed,
                    raw_request=raw_request,
                    raw_response=raw_response,
                    parsed_result=parsed_result,
                    pre_traces=pre_traces,
                    post_traces=post_traces,
                    pre_rules_count=len(proc_options.rules_pre),
                    post_rules_count=len(proc_options.rules_post),
                    error=f"Post-process Error: {e}"
                )

            return SandboxResult(
                ok=True,
                source_text=text,
                pre_processed=pre_processed,
                raw_request=raw_request,
                raw_response=raw_response,
                parsed_result=parsed_result,
                post_processed=post_processed,
                pre_traces=pre_traces,
                post_traces=post_traces,
                pre_rules_count=len(proc_options.rules_pre),
                post_rules_count=len(proc_options.rules_post),
            )

        except Exception as e:
            import traceback
            traceback.print_exc()
            return SandboxResult(ok=False, source_text=text, error=f"Sandbox Execution Error: {e}")
