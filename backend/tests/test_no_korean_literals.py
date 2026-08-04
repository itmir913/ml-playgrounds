"""backend/app 의 문자열 리터럴에 한글이 없는지 검사한다.

백엔드는 사람이 읽는 문장을 반환하지 않는다 (CLAUDE.md 1.4).
주석과 docstring은 예외다. 막으려는 것은 UI로 새어 나가는 문자열이지
개발자용 설명이 아니다 (docs/open-decisions.md).

구현 노트: 주석은 애초에 AST에 없으므로 자동으로 제외된다.
docstring과 모듈 수준 설명 문자열은 "값으로 쓰이지 않는 문장 표현식"이므로
ast.Expr 아래의 문자열을 통째로 제외한다.
"""

import ast
import re
import textwrap
from pathlib import Path

HANGUL = re.compile(r"[가-힣ㄱ-ㅎㅏ-ㅣ]")
APP_DIR = Path(__file__).resolve().parents[1] / "app"


def _standalone_string_ids(tree: ast.Module) -> set[int]:
    """값으로 쓰이지 않는 문자열(=설명문)의 노드 식별자를 모은다."""
    ids: set[int] = set()
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Expr)
            and isinstance(node.value, ast.Constant)
            and isinstance(node.value.value, str)
        ):
            ids.add(id(node.value))
    return ids


def find_korean_literals(source: str) -> list[tuple[int, str]]:
    """(줄 번호, 리터럴) 목록을 반환한다. 위반이 없으면 빈 목록."""
    tree = ast.parse(source)
    exempt = _standalone_string_ids(tree)
    found: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Constant) or not isinstance(node.value, str):
            continue
        if id(node) in exempt:
            continue
        if HANGUL.search(node.value):
            found.append((node.lineno, node.value))
    return found


def test_app_sources_have_no_korean_string_literals() -> None:
    violations: list[str] = []
    for path in sorted(APP_DIR.rglob("*.py")):
        for lineno, literal in find_korean_literals(path.read_text(encoding="utf-8")):
            violations.append(f"{path.relative_to(APP_DIR.parent)}:{lineno} -> {literal!r}")
    assert not violations, "\n".join(violations)


def test_detects_korean_in_a_returned_string() -> None:
    source = 'def f() -> str:\n    """설명."""\n    return "데이터가 너무 큽니다"\n'
    assert find_korean_literals(source) == [(3, "데이터가 너무 큽니다")]


def test_ignores_comments_and_docstrings() -> None:
    source = textwrap.dedent(
        '''
        """모듈 설명."""

        X = 1
        """변수에 붙인 설명."""

        # 주석은 애초에 AST에 없다
        def f() -> None:
            """함수 설명."""
        '''
    )
    assert find_korean_literals(source) == []


def test_detects_korean_inside_f_string() -> None:
    source = 'def f(n: int) -> str:\n    return f"행 {n}개가 너무 많습니다"\n'
    assert find_korean_literals(source) != []
