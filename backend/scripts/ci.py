#!/usr/bin/env python3
"""백엔드 관문. **CI가 부르는 것은 이 파일 하나다.**

풀어 쓴 단계 목록을 `.github/workflows/ci.yml`에 두고 있었는데, 그러면 검사를 하나
더한 사람이 그 파일을 안 고쳤을 때 **관문에서만 조용히 빠진다.** 프런트엔드가 실제로
그렇게 당했다(`package.json`의 `ci` 스크립트 주석). 관문의 정의는 한 군데여야 한다.

사람도 같은 것을 부른다:  uv run python scripts/ci.py

**출력은 영어다.** 이 저장소의 주석과 문서는 한국어지만 CI 로그는 누가 읽을지 정해져
있지 않다 — 화면 문구를 처음부터 i18n으로 세운 것과 같은 이유다.
"""

from __future__ import annotations

import subprocess
import sys

#: 순서대로 돈다. 하나라도 실패하면 거기서 멈춘다 - 뒤엣것은 어차피 다시 돌려야 한다.
CHECKS: list[tuple[str, list[str]]] = [
    ("lint", ["ruff", "check", "."]),
    ("format", ["ruff", "format", "--check", "."]),
    ("types", ["mypy", "."]),
    ("tests", ["pytest"]),
]


def main() -> int:
    for name, command in CHECKS:
        print(f"\n== {name}: {' '.join(command)}", flush=True)
        result = subprocess.run(command, check=False)
        if result.returncode != 0:
            print(f"\nFAILED: {name} (exit {result.returncode})", file=sys.stderr)
            return result.returncode

    print("\nAll backend checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
