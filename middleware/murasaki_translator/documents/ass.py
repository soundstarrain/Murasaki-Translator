"""ASS/SSA Document Handler - Wraps ASS content into pseudo-SRT format for stable translation."""

import re
from typing import List, Dict, Any, Tuple
from .base import BaseDocument
from murasaki_translator.core.chunker import TextBlock

class AssDocument(BaseDocument):
    def __init__(self, path: str):
        super().__init__(path)
        self.headers = [] # Stores [Script Info], [V4+ Styles] etc.
        self.events_header = None # "Format: Layer, Start, End..."
        self.event_templates = [] # Stores (prefix, original_text) for reconstruction
        self.total_event_count = 0

    def _ass_time_to_srt(self, ass_time: str) -> str:
        """Converts ASS timestamp (H:MM:SS.cs) to SRT timestamp (HH:MM:SS,ms)."""
        try:
            parts = ass_time.strip().split('.')
            main_time = parts[0]
            cs = parts[1] if len(parts) > 1 else "00"
            
            hms = main_time.split(':')
            if len(hms) == 3:
                h, m, s = hms
                h = h.zfill(2)
            else:
                return "00:00:00,000"
            
            ms = cs.ljust(2, '0') + '0'
            return f"{h}:{m}:{s},{ms}"
        except:
            return "00:00:00,000"

    def load(self) -> List[Dict[str, Any]]:
        with open(self.path, 'r', encoding='utf-8-sig') as f:
            lines = f.readlines()

        items = []
        is_events = False
        event_idx = 1
        
        for line in lines:
            line = line.strip()
            # Safety check for BOM if utf-8-sig somehow missed or double encoding
            if line.startswith('\ufeff'):
                line = line[1:]
            
            if not line:
                self.headers.append(line)
                continue
                
            if line.startswith('[Events]'):
                is_events = True
                self.headers.append(line)
                continue
            
            if is_events:
                if line.startswith('Format:'):
                    self.events_header = line
                    self.headers.append(line)
                    continue
                elif line.startswith('Dialogue:'):
                    # Parse Dialogue line
                    # Format: Dialogue: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
                    # Standard ASS V4+ always has 9 commas before the Text field.
                    parts = line.split(',', 9) 
                    if len(parts) < 10:
                        self.headers.append(line)
                        continue
                        
                    start_time = parts[1].strip()
                    end_time = parts[2].strip()
                    style_name = parts[3].strip()
                    actor_name = parts[4].strip()
                    raw_text = parts[9]
                    
                    # Pre-cleaning: Remove Karaoke tags to prevent semantic fragmentation and translation failure
                    # Matches {\k10}, {\K20}, {\kf30}, {\ko40} etc.
                    # We remove the entire tag block if it matches, effectively merging the text.
                    raw_text = re.sub(r'\{\\[kK][fo]?\d+\}', '', raw_text)
                    
                    srt_start = self._ass_time_to_srt(start_time)
                    srt_end = self._ass_time_to_srt(end_time)
                    
                    # Context Injection: Add Speaker/Style info to guide the model
                    # Format: [Speaker: Name] (Style: Style)\nOriginal Text
                    context_prefix = ""
                    if actor_name:
                        context_prefix += f"[{actor_name}]"
                    if style_name and style_name.lower() != 'default':
                        context_prefix += f"({style_name})"
                    
                    if context_prefix:
                         final_prompt_text = f"{context_prefix}\n{raw_text}"
                    else:
                         final_prompt_text = raw_text

                    # Construct Pseudo-SRT Block with explicit index
                    pseudo_srt_block = f"{event_idx}\n{srt_start} --> {srt_end}\n{final_prompt_text}\n\n"
                    
                    # Store template: (prefix_part, original_text)
                    # prefix_part includes "Dialogue: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,"
                    # Note: parts[0] is "Dialogue: Layer"
                    prefix = ",".join(parts[:9]) + ","
                    self.event_templates.append(prefix)
                    
                    items.append({
                        'text': pseudo_srt_block, 
                        'meta': 'ass_structural'
                    })
                    event_idx += 1
                else:
                    self.headers.append(line)
            else:
                self.headers.append(line)
        
        self.total_event_count = event_idx - 1
        return items

    def save(self, output_path: str, blocks: List[TextBlock]):
        """
        Reconstructs the ASS file by processing ALL blocks as a continuous stream of SRT units.
        Uses explicit index matching to map translations back to ASS templates.
        """
        
        # 1. Consolidate all translation output into one giant text stream
        full_translation_stream = "\n".join([b.prompt_text for b in blocks])
        
        # 2. Robust Regex to extract SRT units
        # Matches: Index \n Time --> Time \n Content
        # Uses Lookahead (?=...) to stop at the next Index block or End of String
        pattern = re.compile(
            r'(?P<idx>\d+)\s*\n'
            r'(?:[\d:,]+\s*-->\s*[\d:,]+)\s*\n'
            r'(?P<content>.*?)'
            r'(?=\n+\s*\d+\s*\n[\d:,]+\s*-->|\Z)',
            re.DOTALL | re.MULTILINE
        )
        
        translated_map = {}
        
        for match in pattern.finditer(full_translation_stream):
            try:
                idx = int(match.group('idx'))
                content = match.group('content').strip()
                translated_map[idx] = content
            except:
                continue
                
        # 3. Reconstruct events line by line
        event_lines = []
        for i, prefix in enumerate(self.event_templates):
            current_idx = i + 1
            
            if current_idx in translated_map:
                trans_text = translated_map[current_idx]
            else:
                # Fallback: If translation missing, use empty string or placeholder
                # To be safe, we might leave it empty or output a warning
                trans_text = "" 
                
            # Cleanups
            
            # 0. Strip Context lines (Metadata) that we injected
            # Matches optional [Name] and (Style) at the very start of the text
            # We use non-greedy matching.
            # Handles cases like: "[A]\nText", "[A](B)\nText", "(B)\nText"
            trans_text = re.sub(r'^(?:\[.*?\])?(?:\(.*?\))?\s*\n?', '', trans_text).strip()

            # 1. Remove potential hallucinations like "\N\N52\N" inside the text
            #    (Though regex content extraction usually avoids the next index, internal numbers might stay)
            # 2. Fix newlines to \N
            trans_text = trans_text.replace('\n', r'\N')
            
            # 3. Deduplicate \N\N (Model often outputs excess newlines)
            while r'\N\N' in trans_text:
                trans_text = trans_text.replace(r'\N\N', r'\N')
                
            # 4. Construct final line
            # prefix already contains "Dialogue: ..."
            full_line = f"{prefix}{trans_text}"
            event_lines.append(full_line)

        # 4. Write to file
        with open(output_path, 'w', encoding='utf-8-sig') as f:
            # Write headers
            for h in self.headers:
                f.write(h + '\n')
            
            # Write events
            for ev in event_lines:
                f.write(ev + '\n')
