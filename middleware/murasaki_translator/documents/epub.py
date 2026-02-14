"""EPUB Document Handler - HTML-Aware Container Mapping."""

import zipfile
import re
import io
import warnings
from bs4 import BeautifulSoup, NavigableString, XMLParsedAsHTMLWarning
from typing import List, Dict, Any, Optional
from .base import BaseDocument
from murasaki_translator.core.chunker import TextBlock

# Silence XML warnings
warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

class EpubDocument(BaseDocument):
    # Atomic translatable containers
    CONTAINERS = ("p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "dt", "dd", "caption", "th")

    def __init__(self, path: str):
        super().__init__(path)

    def _get_parser(self, content: str = ""):
        """Pick the most robust parser for EPUB XHTML/XML."""
        is_xml = "<?xml" in content or "http://www.w3.org/1999/xhtml" in content
        try:
            import lxml
            return "xml" if is_xml else "lxml"
        except ImportError:
            return "xml" if is_xml else "html.parser"

    def _is_topmost_container(self, node):
        """Check if node is a target container and not nested inside another target container."""
        if node.name not in self.CONTAINERS:
            return False
        # If any parent is also in CONTAINERS, this is NOT the topmost one
        for parent in node.parents:
            if parent.name in self.CONTAINERS:
                return False
        return True

    def _cleanup_styles(self, dom):
        """Standardize styles (remove vertical writing)."""
        v_tokens = r'v-?rtl|v-?ltr|vertical-rl|vertical-lr'
        if dom.has_attr('class'):
            classes = dom.get('class', [])
            if isinstance(classes, list):
                new_classes = [c for c in classes if not re.search(v_tokens, c, re.IGNORECASE)]
                dom['class'] = new_classes if new_classes else []
            elif isinstance(classes, str):
                dom['class'] = re.sub(v_tokens, '', classes, flags=re.IGNORECASE).strip()

        if dom.has_attr('style'):
            style = dom['style']
            new_style = re.sub(r'writing-mode\s*:\s*[^;]+;?', '', style, flags=re.IGNORECASE)
            dom['style'] = new_style.strip()

    def _fix_svg_attributes(self, soup: BeautifulSoup):
        """Preserve case-sensitivity for SVG icons."""
        attr_fixes = {
            "viewbox": "viewBox", "preserveaspectratio": "preserveAspectRatio",
            "pathlength": "pathLength", "gradientunits": "gradientUnits",
            "gradienttransform": "gradientTransform", "spreadmethod": "spreadMethod",
            "maskcontentunits": "maskContentUnits", "maskunits": "maskUnits",
            "patterncontentunits": "patternContentUnits", "patternunits": "patternUnits",
            "patterntransform": "patternTransform",
        }
        for svg in soup.find_all("svg"):
            for attr_lower, attr_correct in attr_fixes.items():
                if attr_lower in svg.attrs:
                    svg.attrs[attr_correct] = svg.attrs.pop(attr_lower)
            for child in svg.find_all():
                for attr_lower, attr_correct in attr_fixes.items():
                    if attr_lower in child.attrs:
                        child.attrs[attr_correct] = child.attrs.pop(attr_lower)

    def _normalize_anchor_stream(self, text: str) -> str:
        """Normalize potentially mangled @id/@end anchors (full-width, spaces, newlines)."""
        if not text:
            return text

        def _normalize_digits(s: str) -> str:
            return s.translate(str.maketrans("０１２３４５６７８９", "0123456789"))

        # Normalize @id= and @end= tokens with tolerance for full-width and spaces.
        def _fix_id(m: re.Match) -> str:
            return f"@id={_normalize_digits(m.group(1))}@"

        def _fix_end(m: re.Match) -> str:
            return f"@end={_normalize_digits(m.group(1))}@"

        # Match both half/full-width @ and =, with optional whitespace/newlines.
        text = re.sub(
            r"[@＠]\s*[iｉIＩ]\s*[dｄDＤ]\s*[=＝]\s*([0-9０-９]+)\s*[@＠]",
            _fix_id,
            text
        )
        text = re.sub(
            r"[@＠]\s*[eｅEＥ]\s*[nｎNＮ]\s*[dｄDＤ]\s*[=＝]\s*([0-9０-９]+)\s*[@＠]",
            _fix_end,
            text
        )
        return text

    def load(self) -> List[Dict[str, Any]]:
        """Extract topmost containers while preserving inner HTML for tag protection."""
        items = []
        uid = 0
        try:
            with zipfile.ZipFile(self.path, 'r') as z:
                # Deterministic sort for zip paths
                for zip_path in sorted(z.namelist()):
                    lower_path = zip_path.lower()
                    if lower_path.endswith(('.htm', '.html', '.xhtml')):
                        try:
                            content = z.read(zip_path).decode('utf-8-sig', errors='ignore')
                            soup = BeautifulSoup(content, self._get_parser(content))
                            
                            # Preprocess Ruby (RT tags are not for translation)
                            for ruby in soup.find_all('ruby'):
                                for tag in ruby.find_all(['rt', 'rp']): tag.decompose()

                            # Extract topmost containers
                            for node in soup.find_all(self.CONTAINERS):
                                if self._is_topmost_container(node):
                                    # Use decode_contents to include internal tags (<a>, <b>, etc.)
                                    # These tags will be protected by TextProtector in main.py
                                    inner_html = node.decode_contents().strip()
                                    if inner_html:
                                        items.append({
                                            'text': f"@id={uid}@\n{inner_html}\n@end={uid}@\n",
                                            'meta': {
                                                'item_name': zip_path,
                                                'uid': uid
                                            }
                                        })
                                        uid += 1
                        except Exception as e:
                            pass  # Skip malformed files silently (logged in debug if needed)
                    elif lower_path.endswith('.ncx'):
                        try:
                            content = z.read(zip_path).decode('utf-8-sig', errors='ignore')
                            soup = BeautifulSoup(content, 'xml')
                            for node in soup.find_all('text'):
                                t = node.get_text(strip=True)
                                if t:
                                    items.append({
                                        'text': f"@id={uid}@\n{t}\n@end={uid}@\n",
                                        'meta': {'item_name': zip_path, 'uid': uid}
                                    })
                                    uid += 1
                        except: pass
        except Exception as e: print(f"[Error] load: {e}")
        return items

    def save(self, output_path: str, blocks: List[TextBlock]):
        """Point-to-Point Container Mapping."""
        id_to_text = {}
        anchor_re = re.compile(r"@id=(\d+)@([\s\S]*?)@end=\1@", re.MULTILINE)
        # NOTE: Anchors may straddle block boundaries or be slightly mangled.
        # Parse on the concatenated output to recover split @id/@end pairs.
        combined = "".join((getattr(block, 'prompt_text', '') or '') for block in blocks)
        if combined:
            normalized = self._normalize_anchor_stream(combined)
            for uid_str, tag_content in anchor_re.findall(normalized):
                try:
                    id_to_text[int(uid_str)] = tag_content.strip()
                except:
                    pass

            # Fallback: tolerate missing @end or spacing issues by segmenting on @id= markers.
            # Only fill IDs that were not captured by strict pairing.
            expected_uids = []
            for block in blocks:
                meta_list = getattr(block, 'metadata', None) or []
                if isinstance(meta_list, list):
                    for meta in meta_list:
                        if isinstance(meta, dict) and 'uid' in meta:
                            expected_uids.append(meta['uid'])
            expected_last_uid = expected_uids[-1] if expected_uids else None

            loose_re = re.compile(
                r"@id=(\d+)@([\s\S]*?)(@end=\1@|(?=@id=\d+@)|\Z)",
                re.MULTILINE
            )
            for match in loose_re.finditer(normalized):
                try:
                    uid = int(match.group(1))
                except:
                    continue
                if uid in id_to_text:
                    continue
                terminator = match.group(3) or ""
                is_end_tag = terminator.startswith("@end=")
                is_end_of_stream = (match.end() >= len(normalized))
                if is_end_of_stream and not is_end_tag and expected_last_uid is not None and uid != expected_last_uid:
                    # Avoid swallowing the tail if this isn't the final expected UID.
                    continue
                id_to_text[uid] = (match.group(2) or "").strip()

            # Final fallback: handle cases where @id is missing but @end=UID@ exists.
            if expected_uids:
                expected_uid_set = set(expected_uids)
                marker_re = re.compile(r"@(?:id|end)=(\d+)@")
                current_uid = None
                current_start = None
                cursor = 0
                for m in marker_re.finditer(normalized):
                    try:
                        uid = int(m.group(1))
                    except:
                        cursor = m.end()
                        continue
                    if uid not in expected_uid_set:
                        cursor = m.end()
                        continue

                    marker = normalized[m.start():m.end()]
                    if marker.startswith("@id="):
                        if current_uid is not None and current_uid not in id_to_text and current_start is not None:
                            seg = normalized[current_start:m.start()].strip()
                            if seg:
                                id_to_text[current_uid] = seg
                        current_uid = uid
                        current_start = m.end()
                    else:
                        if current_uid == uid and current_start is not None:
                            if uid not in id_to_text:
                                seg = normalized[current_start:m.start()].strip()
                                if seg:
                                    id_to_text[uid] = seg
                            current_uid = None
                            current_start = None
                        else:
                            if uid not in id_to_text:
                                seg = normalized[cursor:m.start()].strip()
                                if seg:
                                    id_to_text[uid] = seg
                    cursor = m.end()

                if current_uid is not None and current_uid not in id_to_text and current_start is not None:
                    seg = normalized[current_start:].strip()
                    if seg:
                        id_to_text[current_uid] = seg

        try:
            with zipfile.ZipFile(self.path, 'r') as in_zip, \
                 zipfile.ZipFile(output_path, 'w', compression=zipfile.ZIP_DEFLATED) as out_zip:
                
                # ENFORCE EPUB STANDARD: mimetype must be first and uncompressed
                if 'mimetype' in in_zip.namelist():
                    out_zip.writestr('mimetype', in_zip.read('mimetype'), compress_type=zipfile.ZIP_STORED)
                
                uid = 0
                for zip_path in sorted(in_zip.namelist()):
                    if zip_path == 'mimetype': continue
                    info = in_zip.getinfo(zip_path)
                    lower_path = zip_path.lower()
                    
                    if lower_path.endswith(('.htm', '.html', '.xhtml')):
                        raw_bytes = in_zip.read(info)
                        content = raw_bytes.decode('utf-8-sig', errors='ignore')
                        soup = BeautifulSoup(content, self._get_parser(content))
                        
                        # Match preprocessing
                        for ruby in soup.find_all('ruby'):
                            for tag in ruby.find_all(['rt', 'rp']): tag.decompose()
                        
                        # Re-traverse in SAME order
                        for node in soup.find_all(self.CONTAINERS):
                            if self._is_topmost_container(node):
                                if uid in id_to_text:
                                    # REPLACEMENT: Clear and inject translated inner HTML
                                    # Note: BeautifulSoup(text, 'html.parser') handles tag snippets correctly
                                    node.clear()
                                    new_content = BeautifulSoup(id_to_text[uid], 'html.parser')
                                    node.extend(new_content.contents)
                                uid += 1
                        
                        # Post-processing
                        for body in soup.find_all('body'): self._cleanup_styles(body)
                        for p in soup.find_all('p'): self._cleanup_styles(p)

                        if soup.head:
                            m = soup.head.find('meta', attrs={'charset': True})
                            if m: m['charset'] = 'utf-8'
                            else: soup.head.insert(0, soup.new_tag('meta', charset='utf-8'))
                        
                        self._fix_svg_attributes(soup)
                        
                        # XML COMPLIANCE
                        content_bytes = soup.encode('utf-8').lstrip()
                        if not content_bytes.startswith(b"<?xml"):
                            content_bytes = b'<?xml version="1.0" encoding="utf-8"?>\n' + content_bytes
                        out_zip.writestr(zip_path, content_bytes)
                        
                    elif lower_path.endswith('.ncx'):
                        content = in_zip.read(info).decode('utf-8-sig', errors='ignore')
                        soup = BeautifulSoup(content, 'xml')
                        for node in soup.find_all('text'):
                            if node.get_text(strip=True):
                                if uid in id_to_text:
                                    node.string = id_to_text[uid]
                                uid += 1
                        out_zip.writestr(zip_path, str(soup).encode('utf-8'))
                    else:
                        out_zip.writestr(info, in_zip.read(info))
            print("[Success] EPUB Surgery (HTML-Aware Container) complete.")
        except Exception as e:
            print(f"[Error] EPUB Surgery failed: {e}")
            raise e
