"""
修复 i18n.ts:
1. 行尾 \r\r\n -> \n，去除多余空行
2. concurrencyAutoTestHint 行末缺少逗号
"""
import re
from pathlib import Path

fp = Path(r"e:\project\llmGUI\GUI\src\renderer\src\lib\i18n.ts")
raw = fp.read_bytes()

crlf2 = raw.count(b'\r\r\n')
crlf1 = raw.count(b'\r\n')
print(f"原始大小: {len(raw)} bytes")
print(f"双回车换行: {crlf2} 处")
print(f"单回车换行: {crlf1} 处")

# 1) 统一行尾
text = raw.replace(b'\r\r\n', b'\n').replace(b'\r\n', b'\n').replace(b'\r', b'\n').decode('utf-8')

# 2) 压缩连续空行: 最多保留 1 个空行
text = re.sub(r'\n{3,}', '\n\n', text)

# 3) 修复 concurrencyAutoTestHint 缺少逗号
text = re.sub(
    r'(concurrencyAutoTestHint:\s*"[^"]*")\s*\n',
    r'\1,\n',
    text
)
# 也处理 unicode 转义版本
text = re.sub(
    r"(concurrencyAutoTestHint:\s*\".*?[^,])\s*\n(\s*concurrency)",
    r"\1,\n\2",
    text
)

result = text.encode('utf-8')
print(f"修复后大小: {len(result)} bytes")
print(f"修复后行数: {text.count(chr(10)) + 1}")

fp.write_bytes(result)
print("done")
