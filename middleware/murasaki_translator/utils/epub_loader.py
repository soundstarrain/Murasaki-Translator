"""EPUB Loader - Extracts text from EPUB files with Ruby text handling."""

import os
import warnings
import logging

try:
    import ebooklib
    from ebooklib import epub
    from bs4 import BeautifulSoup
    HAS_EPUB_DEPS = True
except ImportError:
    HAS_EPUB_DEPS = False

# Suppress ebooklib warnings
warnings.filterwarnings('ignore')

logger = logging.getLogger(__name__)

def extract_text_from_epub(epub_path: str) -> list[str]:
    """
    Extracts text from EPUB chapters and returns a list of lines.
    Handles Ruby text (removes furigana) and merges broken lines within paragraphs.
    """
    if not HAS_EPUB_DEPS:
        raise ImportError("Missing dependencies for EPUB support. Please install: pip install EbookLib beautifulsoup4")

    if not os.path.exists(epub_path):
        raise FileNotFoundError(f"EPUB file not found: {epub_path}")

    logger.info(f"Loading EPUB: {epub_path}")
    book = epub.read_epub(epub_path)
    
    all_lines = []

    for item in book.get_items():
        if item.get_type() == ebooklib.ITEM_DOCUMENT:
            # Use BeautifulSoup to parse HTML
            try:
                soup = BeautifulSoup(item.get_content(), 'html.parser')
            except Exception as e:
                logger.warning(f"Failed to parse item {item.get_name()}: {e}")
                continue
            
            # 1. Remove Ruby text (Furigana)
            for ruby in soup.find_all('ruby'):
                for tag in ruby.find_all(['rt', 'rp']):
                    tag.decompose()

            # 2. Extract text
            blocks = soup.find_all(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
            
            if blocks:
                # Add chapter separator
                # all_lines.append(f"===== {item.get_name()} =====\n")
                
                buffer = ""
                for block in blocks:
                    text = block.get_text(strip=True)
                    if not text:
                        continue
                        
                    clean_text = text.replace('\n', '')
                    
                    # Headers: Flush buffer and write immediately
                    if block.name.startswith('h'):
                        if buffer:
                            all_lines.append(buffer + "\n")
                            buffer = ""
                        all_lines.append(clean_text + "\n")
                        continue

                    # Paragraphs: Buffer logic for sentence merging
                    if buffer:
                        terminators = ('。', '」', '』', '！', '？', '…', '—', '.', '!', '?', '"', ')', '）', '}', ']')
                        if buffer.endswith(terminators):
                            all_lines.append(buffer + "\n")
                            buffer = clean_text
                        else:
                            buffer += clean_text
                    else:
                        buffer = clean_text
                
                if buffer:
                    all_lines.append(buffer + "\n")
            else:
                # Fallback
                text = soup.get_text(separator='\n')
                lines = [line.strip() for line in text.splitlines() if line.strip()]
                for line in lines:
                    all_lines.append(line + "\n")

    return all_lines
