"""Extract the source file from a model response. The code itself is never edited.

Rules:
- Reasoning text inside <think>...</think> is removed first (it is not part of the answer).
- Exactly one fenced code block: its content is the variant. Only the fence lines are removed.
- No fence: the whole answer is the variant if it starts like source code.
- Two or more fenced blocks, an unterminated fence, or no code: extraction fails.
"""

from __future__ import annotations

import hashlib
import re

FENCE = re.compile(r"^[ \t]*(`{3,}|~{3,})[ \t]*([A-Za-z0-9_+\-.#]*)[^\n]*$", re.M)
THINK = re.compile(r"<think>.*?</think>", re.S | re.I)
SOURCE_START = re.compile(r"^\s*(//|/\*|pragma\b|import\b|export\b|contract\b|interface\b|library\b|'use strict'|\"use strict\")")


def extract(content: str | None) -> dict:
    if not content or not content.strip():
        return {"outcome": "empty_response", "code": None}
    text = THINK.sub("", content)
    fences = list(FENCE.finditer(text))
    blocks = []
    i = 0
    while i < len(fences):
        opening = fences[i]
        # a closing fence uses the same character, at least as long, and no language tag
        closing = next((f for f in fences[i + 1:] if f.group(1)[0] == opening.group(1)[0]
                        and len(f.group(1)) >= len(opening.group(1)) and not f.group(2)), None)
        if closing is None:
            return {"outcome": "unterminated_fence", "code": None}
        blocks.append(text[opening.end() + 1:closing.start()])
        i = fences.index(closing) + 1
    if len(blocks) > 1:
        return {"outcome": "multiple_blocks", "code": None, "blocks": len(blocks)}
    if len(blocks) == 1:
        code = blocks[0]
    elif SOURCE_START.match(text):
        code = text
    else:
        return {"outcome": "no_code", "code": None}
    if not code.strip():
        return {"outcome": "no_code", "code": None}
    return {"outcome": "ok", "code": code, "sha256": hashlib.sha256(code.encode()).hexdigest()}
