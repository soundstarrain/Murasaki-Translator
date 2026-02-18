# Line alignment utilities for Pipeline V2.

from __future__ import annotations

from typing import List


def align_lines(src: List[str], dst: List[str]) -> List[str]:
    if not src:
        return list(dst)
    if not dst:
        return [""] * len(src)

    result: List[str] = []
    dst_index = 0
    dst_len = len(dst)

    for line in src:
        if line.strip() == "":
            if dst_index < dst_len and dst[dst_index].strip() == "":
                dst_index += 1
            result.append("")
            continue
        if dst_index < dst_len:
            result.append(dst[dst_index])
            dst_index += 1
        else:
            result.append("")

    # 当 dst 还有剩余行时，将多余内容合并到最后一个非空结果行
    if dst_index < dst_len and result:
        remaining = dst[dst_index:]
        # 找到最后一个有内容的结果行，将剩余行合并进去
        for i in range(len(result) - 1, -1, -1):
            if result[i].strip():
                result[i] = result[i] + "\n" + "\n".join(remaining)
                break

    return result
