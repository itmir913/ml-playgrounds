#!/usr/bin/env python3
"""어댑터가 Pyodide에 먹이는 파이썬 조각을 **TS 소스에서 그대로 읽어 온다.**

**왜 읽어 오는가** (2026-09-19 R30 C-3). `pyodide-sklearn.ts`의 `dump` 문자열은
**27.3MB를 받아야만 실행된다.** vitest는 Pyodide를 못 띄우므로 그 문자열이 파이썬으로
무엇을 하는지 검사가 모르고, 픽스처를 만드는 쪽이 **같은 일을 하는 복사본**을 들고 있으면
둘이 갈려도 아무도 안 운다 - 같은 자리에서 이미 한 번 넘어졌다(갈림값 계산).

그래서 픽스처 생성기가 **어댑터의 문자열 자체를 실행한다.** 그러면

- 그 조각이 진짜 sklearn에서 도는지가 `npm run ci`의 `fixtures:check`에서 확인되고,
- 픽스처의 `dump`이 **앱이 만드는 것과 같은 코드로** 만들어진다.

**못 읽으면 선다.** 조용히 복사본으로 되돌아가면 이 파일이 있는 이유가 사라진다.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

ADAPTER = (
    Path(__file__).resolve().parent.parent
    / "frontend"
    / "src"
    / "ml"
    / "engines"
    / "pyodide-sklearn.ts"
)

#: 어댑터에 `serializer.dump`이 있어야 하는 알고리즘. **줄면 여기가 운다.**
EXPECTED = {
    "decision_tree",
    "random_forest",
    "knn",
    "logistic_regression",
    "naive_bayes",
    "svm",
    "linear_regression",
    "k_means",
}


class AdapterParseError(RuntimeError):
    """TS 소스에서 조각을 못 찾았다. **조용히 넘어가지 않는다.**"""


def _source() -> str:
    return ADAPTER.read_text(encoding="utf-8")


def tree_helper() -> str:
    """`TREE_DUMP_HELPER` 본문. 백틱 안의 파이썬 그대로다."""
    found = re.search(r"const TREE_DUMP_HELPER = `\n(.*?)`\n", _source(), re.DOTALL)
    if not found:
        raise AdapterParseError("TREE_DUMP_HELPER not found in the adapter")
    return found.group(1)


def dumps() -> dict[str, str]:
    """알고리즘 -> `_dump`에 들어갈 파이썬 식.

    `dump` 칸이 없는 알고리즘(랜덤 포레스트, 참조형)은 빠진다 - 전자는 안 담기로 한 것이고
    후자는 파이썬에게 묻지 않는다.
    """
    source = _source()

    shared = re.search(r"const LINEAR_DUMP =\s*\n?\s*'([^']*)'", source)
    if not shared:
        raise AdapterParseError("LINEAR_DUMP not found in the adapter")

    # 알고리즘 이름 -> 그 항목이 시작하는 자리. 항목은 `  이름: {` 꼴이다.
    starts = [
        (found.group(1), found.start())
        for found in re.finditer(r"^  (\w+): \{$", source, re.MULTILINE)
    ]
    if not starts:
        raise AdapterParseError("no algorithm entries found in SKLEARN_CLASSES")

    found: dict[str, str] = {}
    for index, (name, begin) in enumerate(starts):
        end = starts[index + 1][1] if index + 1 < len(starts) else len(source)
        block = source[begin:end]
        quoted = re.search(r"dump: '([^']*)'", block)
        templated = re.search(r"dump: `(.*?)`,\n", block, re.DOTALL)
        if re.search(r"dump: LINEAR_DUMP", block):
            found[name] = shared.group(1)
        elif quoted:
            found[name] = quoted.group(1)
        elif templated:
            found[name] = templated.group(1)

    missing = EXPECTED - set(found) - {"knn"}
    if missing:
        raise AdapterParseError(f"no dump found for: {', '.join(sorted(missing))}")
    return found


def dumped(algorithm: str, model: Any, classes: list[str]) -> Any:
    """어댑터의 조각을 그대로 돌려 `_dump`을 받는다. **앱이 하는 것과 같은 코드다.**

    `buildDumpCode`가 앞에 붙이는 것(`json`·`numpy as _np`·도우미)까지 같은 순서로 세운다.

    **`exec`와 `eval`을 쓴다** - 도는 것은 **우리 저장소의 파일에서 읽은 우리 코드**이고,
    그게 이 파일이 있는 이유다. 밖에서 오는 문자열이 여기 닿는 경로는 없다.
    """
    import json

    import numpy as np

    expression = dumps().get(algorithm)
    if expression is None:
        return None

    scope: dict[str, Any] = {
        "_model": model,
        "_classes": classes,
        "_np": np,
        "json": json,
    }
    exec(tree_helper(), scope)  # noqa: S102
    return json.loads(json.dumps(eval(expression, scope)))
