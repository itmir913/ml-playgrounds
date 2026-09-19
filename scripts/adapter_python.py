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
#
# **`knn`은 없다** — 참조형이 담는 것은 배운 값이 아니라 **본 행**이라 파이썬에게 물을 것이
# 없다 (`mlpx-spec.md` §5.6). 한때 이 집합에 넣고 아래에서 다시 뺐는데, 그러면 *"있어야
# 한다"*는 선언과 실제가 어긋난다 (2026-09-19 R31 C-3).
EXPECTED = {
    "decision_tree",
    "random_forest",
    "logistic_regression",
    "naive_bayes",
    "svm",
    "linear_regression",
    "k_means",
}


#: 어댑터에 `serializer.size`가 있어야 하는 알고리즘. **줄면 여기가 운다.**
#
# **랜덤 포레스트 하나다** - 크기의 하한을 셀 수 있는 형식이 `mlpx-tree-v2`뿐이고,
# 그 칸을 잃으면 113MB짜리 숲이 다시 통째로 만들어진다. **둘째가 생기면 여기 적어라**
# (2026-09-19 R33 C-2): 안 적으면 그 칸이 뒤에 사라져도 아무 소리가 안 난다.
EXPECTED_SIZES = {"random_forest"}


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


def _blocks() -> list[tuple[str, str]]:
    """알고리즘 이름과 그 항목의 소스. 항목은 `  이름: {` 꼴로 시작한다.

    **쪼개는 자리가 하나다** (2026-09-19 R32 C-2). 한때 `dumps()`와 `sizes()`가 똑같은 네
    줄을 각자 들고 있었고, **한 곳만 고치면 아무도 안 우는 모양**이었다.
    """
    source = _source()
    starts = [
        (found.group(1), found.start())
        for found in re.finditer(r"^  (\w+): \{$", source, re.MULTILINE)
    ]
    if not starts:
        raise AdapterParseError("no algorithm entries found in SKLEARN_CLASSES")
    return [
        (name, source[begin : starts[index + 1][1] if index + 1 < len(starts) else len(source)])
        for index, (name, begin) in enumerate(starts)
    ]


def _serializer(block: str) -> str:
    """항목에서 **`serializer` 객체 안만** 잘라 낸다. 없으면 빈 문자열.

    **자리를 깊이로만 잡으면 안 닫힌다** (2026-09-19 R34 C-1). 한때 `^ {6}`으로 잡았는데,
    그건 *"6칸짜리 아무 `dump:`"*를 보는 것이라 **`serializer`와 같은 깊이의 형제**가
    6칸짜리 동명 속성을 먼저 들고 오면 그것을 가져갔다. **깊이는 자리가 아니다.**

    그래서 먼저 `serializer: {`부터 그 짝인 4칸짜리 `},`까지를 잘라 내고, 그 안에서만
    찾는다. **형제는 이 slice에 아예 안 들어온다.**
    """
    opened = re.search(r"^    serializer: \{$", block, re.MULTILINE)
    if not opened:
        return ""
    rest = block[opened.end() :]
    closed = re.search(r"^    \},?$", rest, re.MULTILINE)
    return rest[: closed.start()] if closed else rest


def _property(name: str, block: str) -> str | None:
    """`serializer` 안에서 `이름: '식'` 또는 `이름: \\`식\\``을 꺼낸다. 없으면 `None`.

    **속성 자리로 앵커한다** (2026-09-19 R32 C-2). 줄머리와 들여쓰기를 요구하므로

        fixed: ["algorithm='brute'"], // 한때 dump: '{"rows": …}' 였다

    같은 **꼬리 주석이 원천적으로 안 걸린다.** 한때는 주석 줄을 지워서 막았는데, 그건
    **줄머리 주석만** 지웠고 위 모양이 그대로 이겼다.

    **주석을 더 지우는 쪽으로 안 간다.** 파이썬 조각 안의 `//`는 나눗셈이라, 문자열
    안까지 훑어 지우면 **조각을 망가뜨리는 쪽이 더 위험하다.**
    """
    inside = _serializer(block)
    quoted = re.search(rf"^      {name}: '([^']*)'", inside, re.MULTILINE)
    if quoted:
        return quoted.group(1)
    templated = re.search(rf"^      {name}: `(.*?)`,\n", inside, re.MULTILINE | re.DOTALL)
    return templated.group(1) if templated else None


def dumps() -> dict[str, str]:
    """알고리즘 -> `_dump`에 들어갈 파이썬 식.

    **빠지는 것은 참조형(KNN) 하나다** - 담는 것이 배운 값이 아니라 본 행이라 파이썬에게
    물을 것이 없다. 랜덤 포레스트도 한때 빠져 있었는데 `mlpx-tree-v2`로 열렸다.
    """
    shared = re.search(r"const LINEAR_DUMP =\s*\n?\s*'([^']*)'", _source())
    if not shared:
        raise AdapterParseError("LINEAR_DUMP not found in the adapter")

    found: dict[str, str] = {}
    for name, block in _blocks():
        # **이 갈래도 `serializer` 안만 본다** (2026-09-19 R34 C-1). 한때 여기만 `^ +`라
        # 형제의 `dump: LINEAR_DUMP`가 이겼다 — 고친 자리의 이웃을 안 훑은 것이다.
        if re.search(r"^      dump: LINEAR_DUMP", _serializer(block), re.MULTILINE):
            found[name] = shared.group(1)
            continue
        expression = _property("dump", block)
        if expression is not None:
            found[name] = expression

    missing = EXPECTED - set(found)
    if missing:
        raise AdapterParseError(f"no dump found for: {', '.join(sorted(missing))}")
    return found


def sizes() -> dict[str, str]:
    """알고리즘 -> `_size`에 들어갈 파이썬 식. **있는 칸만 돌려준다.**

    **`dump`과 같은 이유로 여기 있다.** 이 식도 27.3MB를 받아야만 도는 자리에 있고,
    터지면 `serialize`의 `try`가 삼켜 **모델이 조용히 안 담긴다** - 랜덤 포레스트 전부가
    그렇게 된다. 그래서 픽스처 생성기가 실물 sklearn 모델에 이 식을 직접 먹인다.

    **보는 모양이 `dump`과 같다** (2026-09-19 R32 C-6). 한때 백틱만 봐서, 누가 한 줄짜리
    작은따옴표로 쓰면 **아무 소리 없이 빠졌다.**
    """
    found: dict[str, str] = {}
    for name, block in _blocks():
        expression = _property("size", block)
        if expression is not None:
            found[name] = expression
    missing = EXPECTED_SIZES - set(found)
    if missing:
        raise AdapterParseError(f"no size found for: {', '.join(sorted(missing))}")
    return found


def sized(algorithm: str, model: Any) -> Any:
    """어댑터의 크기 식을 그대로 돌려 `{"nodes": …, "leaves": …}`를 받는다."""
    import json

    import numpy as np

    expression = sizes().get(algorithm)
    if expression is None:
        return None

    scope: dict[str, Any] = {"_model": model, "_np": np, "json": json}
    return json.loads(json.dumps(eval(expression, scope)))  # noqa: S307


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
