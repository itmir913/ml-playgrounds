#!/usr/bin/env python3
"""로케일 파일과 백엔드 코드 사이의 계약을 검사한다.

CLAUDE.md 3의 "CI로 강제한다"에 해당하는 검사다. 사람이 규칙을 지키길 기대하지 않는다.

검사 항목
1. en.json과 ko.json의 키 집합이 완전히 같은가
2. 같은 키의 보간 변수({limitMb} 등)가 두 파일에서 같은가
3. errors.py의 ErrorCode / Stage가 로케일 파일에 빠짐없이 있는가
4. 반대로, 로케일 파일에 백엔드에 없는 코드가 남아 있지 않은가

의존성 없이 표준 라이브러리만 쓴다. errors.py는 import하지 않고 ast로 읽는다.
백엔드 가상환경 없이도, 프런트엔드만 만지는 사람도 돌릴 수 있어야 하기 때문이다.

사용법:  python scripts/check_locales.py
"""

from __future__ import annotations

import ast
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ERRORS_PY = ROOT / "backend" / "app" / "errors.py"
LOCALES_DIR = ROOT / "frontend" / "src" / "locales"

#: 백엔드 열거형 이름 -> 로케일 네임스페이스
#:
#: 무결성 확인 어휘(fileHash.* / reproduction.*)는 여기 없다. 확인이 전부 브라우저에서
#: 끝나므로 단일 출처가 frontend/src/errors.ts 이고, 그쪽 일치는 tests/locales.spec.ts가
#: 강제한다. 백엔드에 없는 것을 백엔드 기준으로 검사하면 항상 실패한다.
NAMESPACES = {
    "ErrorCode": "errors",
    "Stage": "stages",
}

PLACEHOLDER = re.compile(r"\{(\w+)\}")


def enum_members(source: str) -> dict[str, set[str]]:
    """errors.py에서 열거형 멤버 이름을 뽑는다.

    값이 아니라 이름만 본다. errors.py가 이름과 값을 같게 만들도록 강제하고 있고,
    그 규칙 자체는 백엔드 테스트가 검사한다.
    """
    tree = ast.parse(source)
    found: dict[str, set[str]] = {}
    for node in tree.body:
        if not isinstance(node, ast.ClassDef) or node.name not in NAMESPACES:
            continue
        names: set[str] = set()
        for statement in node.body:
            if isinstance(statement, ast.Assign):
                for target in statement.targets:
                    if isinstance(target, ast.Name):
                        names.add(target.id)
        found[node.name] = names
    return found


def flatten(tree: object, prefix: str = "") -> dict[str, str]:
    """중첩된 JSON을 점 표기 키로 편다."""
    flat: dict[str, str] = {}
    if not isinstance(tree, dict):
        return flat
    for key, value in tree.items():
        path = f"{prefix}.{key}" if prefix else str(key)
        if isinstance(value, str):
            flat[path] = value
        else:
            flat.update(flatten(value, path))
    return flat


def placeholders(message: str) -> set[str]:
    return set(PLACEHOLDER.findall(message))


def namespace_keys(flat: dict[str, str], namespace: str) -> set[str]:
    prefix = f"{namespace}."
    return {key[len(prefix) :] for key in flat if key.startswith(prefix)}


def check() -> list[str]:
    """위반 목록을 돌려준다. 비어 있으면 통과."""
    problems: list[str] = []

    locales = {
        path.stem: flatten(json.loads(path.read_text(encoding="utf-8")))
        for path in sorted(LOCALES_DIR.glob("*.json"))
    }
    if len(locales) < 2:
        return [f"로케일 파일이 부족하다: {sorted(locales)}"]

    # 1. 키 집합 일치
    reference_name, reference = next(iter(locales.items()))
    for name, flat in locales.items():
        if name == reference_name:
            continue
        for key in sorted(set(reference) - set(flat)):
            problems.append(f"{name}.json: missing key {key}")
        for key in sorted(set(flat) - set(reference)):
            problems.append(f"{reference_name}.json: missing key {key}")

    # 2. 보간 변수 일치
    for name, flat in locales.items():
        if name == reference_name:
            continue
        for key in sorted(set(reference) & set(flat)):
            expected = placeholders(reference[key])
            actual = placeholders(flat[key])
            if expected != actual:
                problems.append(
                    f"{key}: placeholders differ "
                    f"({reference_name}={sorted(expected)}, {name}={sorted(actual)})"
                )

    # 3, 4. 백엔드 코드 <-> 로케일 키 양방향 일치
    members = enum_members(ERRORS_PY.read_text(encoding="utf-8"))
    for enum_name, namespace in NAMESPACES.items():
        expected_codes = members.get(enum_name)
        if expected_codes is None:
            problems.append(f"errors.py: {enum_name} not found")
            continue
        for name, flat in locales.items():
            actual_codes = namespace_keys(flat, namespace)
            for code in sorted(expected_codes - actual_codes):
                problems.append(f"{name}.json: {namespace}.{code} is missing ({enum_name})")
            for code in sorted(actual_codes - expected_codes):
                problems.append(f"{name}.json: {namespace}.{code} is not in {enum_name}")

    return problems


def main() -> int:
    problems = check()
    if problems:
        print(f"Locale contract check failed ({len(problems)} problems)", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1
    print("Locale contract check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
