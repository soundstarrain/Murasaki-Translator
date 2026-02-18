"""Pipeline V2 entrypoint."""

from __future__ import annotations

import argparse
import os
import sys

from murasaki_flow_v2.registry.profile_store import ProfileStore
from murasaki_flow_v2.pipelines.runner import PipelineRunner


def main() -> int:
    parser = argparse.ArgumentParser(description="Murasaki Flow V2")
    parser.add_argument("--file", required=True, help="Input file path")
    parser.add_argument("--pipeline", required=True, help="Pipeline profile id or path")
    parser.add_argument("--profiles-dir", required=True, help="Base directory for profiles")
    parser.add_argument("--output", help="Custom output path")
    parser.add_argument("--rules-pre", dest="rules_pre", help="Pre-process rules (JSON)")
    parser.add_argument("--rules-post", dest="rules_post", help="Post-process rules (JSON)")
    parser.add_argument("--glossary", help="Glossary JSON file")
    parser.add_argument("--source-lang", default="ja", help="Source language for QC (e.g. ja)")
    parser.add_argument("--enable-quality", action="store_true", help="Enable V1 quality checks")
    parser.add_argument("--disable-quality", action="store_true", help="Disable V1 quality checks")
    parser.add_argument("--text-protect", action="store_true", help="Enable text protection")
    parser.add_argument("--no-text-protect", action="store_true", help="Disable text protection")
    args = parser.parse_args()

    if not os.path.exists(args.file):
        print(f"[Error] Input file not found: {args.file}")
        return 1

    store = ProfileStore(args.profiles_dir)
    pipeline_profile = store.load_profile("pipeline", args.pipeline)
    runtime_compat: dict[str, object] = {}
    if args.rules_pre:
        runtime_compat["rules_pre"] = args.rules_pre
    if args.rules_post:
        runtime_compat["rules_post"] = args.rules_post
    if args.glossary:
        runtime_compat["glossary"] = args.glossary
        pipeline_profile["glossary"] = args.glossary
    if args.source_lang:
        runtime_compat["source_lang"] = args.source_lang
    if args.enable_quality:
        runtime_compat["enable_quality"] = True
    if args.disable_quality:
        runtime_compat["enable_quality"] = False
    if args.text_protect:
        runtime_compat["text_protect"] = True
    if args.no_text_protect:
        runtime_compat["text_protect"] = False
    if runtime_compat:
        pipeline_profile["v1_compat"] = runtime_compat

    print(f"[FlowV2] Provider: {pipeline_profile.get('provider')}")
    print(f"[FlowV2] Prompt: {pipeline_profile.get('prompt')}")
    print(f"[FlowV2] Parser: {pipeline_profile.get('parser')}")
    print(f"[FlowV2] LinePolicy: {pipeline_profile.get('line_policy')}")
    print(f"[FlowV2] ChunkPolicy: {pipeline_profile.get('chunk_policy')}")

    runner = PipelineRunner(store, pipeline_profile)
    output_path = runner.run(args.file, output_path=args.output)
    print(f"[FlowV2] Output saved: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
