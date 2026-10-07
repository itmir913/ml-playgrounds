"""로케일 검사 스크립트가 실제로 위반을 잡는지 확인한다.

저장소 전체에 대한 통과 여부는 CI가 스크립트를 직접 실행해 확인한다.
여기서는 순수 함수의 판정 논리를 검사한다.
"""

import json
import shutil
from collections.abc import Callable
from pathlib import Path
from typing import Any

import check_locales
import pytest


def test_enum_members_reads_names_not_values() -> None:
    source = (
        "from enum import auto\n"
        "class ErrorCode:\n"
        "    JOB_FAILED = auto()\n"
        "    JOB_TIMEOUT = auto()\n"
        "class Stage:\n"
        "    QUEUED = auto()\n"
        "class Unrelated:\n"
        "    SOMETHING = auto()\n"
    )
    members = check_locales.enum_members(source)

    assert members["ErrorCode"] == {"JOB_FAILED", "JOB_TIMEOUT"}
    assert members["Stage"] == {"QUEUED"}
    assert "Unrelated" not in members


def test_flatten_uses_dotted_paths() -> None:
    flat = check_locales.flatten({"errors": {"JOB_FAILED": "x"}, "app": {"name": "y"}})
    assert flat == {"errors.JOB_FAILED": "x", "app.name": "y"}


def test_placeholders_are_extracted() -> None:
    assert check_locales.placeholders("최대 {limitMb}MB, 현재 {actualMb}MB") == {
        "limitMb",
        "actualMb",
    }
    assert check_locales.placeholders("변수 없음") == set()


def test_namespace_keys_strips_the_prefix() -> None:
    flat = {"errors.JOB_FAILED": "x", "stages.QUEUED": "y"}
    assert check_locales.namespace_keys(flat, "errors") == {"JOB_FAILED"}
    assert check_locales.namespace_keys(flat, "stages") == {"QUEUED"}


def test_repository_currently_passes() -> None:
    """지금 저장소 상태가 계약을 지키고 있는지."""
    assert check_locales.check() == []


# 아래 판들은 **`check()`를 부른다** (R43-6 C-1). 예전 판들은 집합 뺄셈을
# 테스트 안에서 다시 써서, `check()`의 검사 넷 중 어느 것을 뭉개도 초록이었다.
# 저장소의 `errors.py`와 로케일을 임시 폴더로 베끼고 위반 하나를 심어 부른다.


@pytest.fixture
def sandbox(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[Path, Path]:
    errors_py = tmp_path / "errors.py"
    shutil.copyfile(check_locales.ERRORS_PY, errors_py)
    locales = tmp_path / "locales"
    shutil.copytree(check_locales.LOCALES_DIR, locales)
    monkeypatch.setattr(check_locales, "ERRORS_PY", errors_py)
    monkeypatch.setattr(check_locales, "LOCALES_DIR", locales)
    assert check_locales.check() == []
    return errors_py, locales


def edit_locale(locales: Path, name: str, edit: Callable[[dict[str, Any]], None]) -> None:
    path = locales / f"{name}.json"
    tree = json.loads(path.read_text(encoding="utf-8"))
    edit(tree)
    path.write_text(json.dumps(tree, ensure_ascii=False), encoding="utf-8")


def test_missing_key_is_caught(sandbox: tuple[Path, Path]) -> None:
    """한 로케일에만 키를 더한 경우 (검사 1)."""
    _, locales = sandbox
    edit_locale(locales, "ja", lambda tree: tree["app"].update({"zzOnly": "x"}))
    assert any("missing key app.zzOnly" in problem for problem in check_locales.check())


def test_placeholder_mismatch_is_caught(sandbox: tuple[Path, Path]) -> None:
    """번역하다 보간 변수를 빠뜨린 경우 (검사 2)."""
    _, locales = sandbox
    edit_locale(
        locales, "ja", lambda tree: tree["client"].update({"FEATURE_VALUE_TOO_LARGE": "大きすぎ"})
    )
    assert any("client.FEATURE_VALUE_TOO_LARGE" in p for p in check_locales.check())


def test_plural_forms_must_share_placeholders(sandbox: tuple[Path, Path]) -> None:
    """복수형의 한 형태에서만 변수가 빠진 경우 — 합집합으로 견주면 지나간다 (R43-6 C-2)."""
    _, locales = sandbox

    def drop_count(tree: dict[str, Any]) -> None:
        image = tree["data"]["image"]
        forms = image["removeCategoryWithTestDescription"].split(" | ")
        image["removeCategoryWithTestDescription"] = " | ".join(
            [forms[0].replace("{count}", "one"), *forms[1:]]
        )

    edit_locale(locales, "en", drop_count)
    assert any("plural forms differ" in problem for problem in check_locales.check())


def test_missing_code_is_caught(sandbox: tuple[Path, Path]) -> None:
    """백엔드에 코드를 더하고 로케일을 안 고친 경우 (검사 3)."""
    errors_py, _ = sandbox
    source = errors_py.read_text(encoding="utf-8")
    errors_py.write_text(
        source.replace(
            "    JOB_FAILED = auto()\n", "    JOB_FAILED = auto()\n    ZZ_NEW = auto()\n"
        ),
        encoding="utf-8",
    )
    assert any("errors.ZZ_NEW is missing" in problem for problem in check_locales.check())


def test_stale_code_is_caught(sandbox: tuple[Path, Path]) -> None:
    """백엔드에서 코드를 지웠는데 로케일에 남은 경우 (검사 4)."""
    _, locales = sandbox
    for name in ("en", "ko", "ja"):
        edit_locale(locales, name, lambda tree: tree["errors"].update({"ZZ_OLD": "x"}))
    assert any("errors.ZZ_OLD is not in ErrorCode" in p for p in check_locales.check())
