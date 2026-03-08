"""ASS/SSA Document Handler - Wraps ASS content into pseudo-SRT format for stable translation."""

import re
from typing import List, Dict, Any, Tuple
from .base import BaseDocument
from murasaki_translator.core.chunker import TextBlock

class AssDocument(BaseDocument):
    def __init__(self, path: str):
        super().__init__(path)
        self.headers = [] # Stores [Script Info], [V4+ Styles] etc.
        self.events_header: str | None = None # "Format: Layer, Start, End..."
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
                    
                    # Context Injection: Add Speaker/Style info INLINE to guide the model
                    # Format: [Speaker](Style) Original Text (Single line to maintain line count stability)
                    context_prefix = ""
                    
                    # 1. Actor: Only inject if not already in text and not trivial
                    if actor_name and actor_name not in raw_text:
                        context_prefix += f"[{actor_name}]"

                    # 2. Style: Only inject if meaningful (not numeric ID, not Default)
                    # Skip 'Default', '01_jpn', 'Subtitle', etc. 
                    # Heuristic: If style starts with digit, or is just 'Default'
                    is_meaningful_style = (
                        style_name and 
                        style_name.lower() != 'default' and 
                        not re.match(r'^\d', style_name) and  # Skip "01_jpn" etc.
                        style_name not in raw_text # Skip if already in text
                    )
                    
                    if is_meaningful_style:
                        context_prefix += f"({style_name})"
                    
                    if context_prefix:
                         final_prompt_text = f"{context_prefix} {raw_text}"  # INLINE, not newline
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
        Reconstructs the ASS file by mapping sorted blocks directly to event templates.
        This avoids fragile regex parsing and ensures 1-to-1 alignment.
        """
        
        # 1. Map blocks by ID (or index if direct mapping)
        # blocks are sorted in main.py, but let's be safe.
        # However, checking lengths is the primary safeguard.
        
    def save(self, output_path: str, blocks: List[TextBlock]):
        """
        Reconstructs the ASS file by concatenating all block content and splitting into 
        individual units. This handles the 'Grouped Block' architecture where one TextBlock
        contains multiple translation units.
        """
        
        # 1. Collect all content from blocks (priority: dst > prompt_text)
        full_stream = ""
        for b in blocks:
            # Rebuild flow uses .dst, translation flow uses .prompt_text
            content = getattr(b, 'dst', '') or b.prompt_text
            if content:
                full_stream += content + "\n\n"
        
        # 2. Normalize and Split into individual units using the header pattern as delimiter
        # Models often use \N or \n for pseudo-SRT delimiters
        full_stream = full_stream.replace('\\N', '\n').replace('\\n', '\n')
        
        # Robust pattern for ID and Timecodes
        header_pattern = re.compile(r'(?:^|\n)\s*\d+\s*\n\s*\d{2}:\d{2}:\d{2}[,.]\d{1,3}\s*[-=>]+\s*\d{2}:\d{2}:\d{2}[,.]\d{1,3}.*?(?:\n|$)', re.MULTILINE)
        
        segments = header_pattern.split(full_stream)
        
        translated_units = []
        if len(segments) > 1:
            # Filter: usually segment 0 is empty (garbage before the first header).
            # We take segments 1 to N as our individual units.
            for seg in segments[1:]:
                # Note: We take the whole segment. If it has hallucinations of another header, 
                # they will be processed as separate segments by the split if the regex matches.
                translated_units.append(seg.strip())
        else:
            # Fallback if no headers found: split by double newline as a hint
            translated_units = [s.strip() for s in full_stream.split('\n\n') if s.strip()]

        # 3. Map individual units back to templates
        if len(translated_units) != len(self.event_templates):
            print(f"[AssDocument] Warning: Extracted {len(translated_units)} units but have {len(self.event_templates)} templates.")

        event_lines = []
        for i, prefix in enumerate(self.event_templates):
            if i < len(translated_units):
                trans_text = translated_units[i]
            else:
                trans_text = ""
                
            # Cleanups
            
            # 0. Strip Context metadata (Speaker/Style) that we injected inline
            # Matches: [Name](Style) or [Name] or (Style) at the start of the text
            # Enhanced to support Full-width brackets 【】（）
            trans_text = re.sub(r'^(?:\[.*?\]|【.*?】)?(?:[\(（].*?[\)）])?\s*', '', trans_text).strip()

            # 1. Remove residual artifacts like loose \N\N
            # 2. Fix newlines to \N (Standard ASS line break)
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
