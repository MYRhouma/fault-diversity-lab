"""Extraction rules: exactly one fenced block, unfenced source, and the failure cases."""

from fdlab.extract import extract
from fdlab.generate import extract_code


def test_one_fenced_block_is_the_variant():
    ex = extract("Here it is:\n```solidity\npragma solidity ^0.8.0;\ncontract C {}\n```\nDone.")
    assert ex["outcome"] == "ok"
    assert ex["code"] == "pragma solidity ^0.8.0;\ncontract C {}\n"
    assert len(ex["sha256"]) == 64


def test_think_block_is_removed_first():
    ex = extract("<think>maybe ```two``` blocks</think>\n```\ncontract C {}\n```")
    assert ex["outcome"] == "ok" and ex["code"] == "contract C {}\n"


def test_longer_fence_can_hold_a_shorter_one():
    ex = extract("````solidity\n/// ```example```\ncontract C {}\n````")
    assert ex["outcome"] == "ok" and "```example```" in ex["code"]


def test_unfenced_source_is_accepted_only_when_it_looks_like_code():
    assert extract("// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;")["outcome"] == "ok"
    assert extract("I cannot help with that.")["outcome"] == "no_code"


def test_failures():
    assert extract(None)["outcome"] == "empty_response"
    assert extract("   \n")["outcome"] == "empty_response"
    assert extract("```\ncontract A {}\n```\n```\ncontract B {}\n```") == {"outcome": "multiple_blocks", "code": None,
                                                                          "blocks": 2}
    assert extract("```solidity\ncontract A {}\n")["outcome"] == "unterminated_fence"
    assert extract("```\n\n```")["outcome"] == "no_code"


def test_unfenced_java_and_content_parts():
    ex = extract_code("package demo;\n\npublic class A {}\n")
    assert ex["outcome"] == "ok" and ex["unfenced"]
    ex = extract_code([{"type": "text", "text": "```java\nclass A {}\n"}, {"type": "text", "text": "```"}])
    assert ex["outcome"] == "ok" and ex["code"] == "class A {}\n"
