"""로케일 검사 스크립트가 실제로 위반을 잡는지 확인한다.

저장소 전체에 대한 통과 여부는 CI가 스크립트를 직접 실행해 확인한다.
여기서는 순수 함수의 판정 논리를 검사한다.
"""

import check_locales


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


def test_placeholder_mismatch_would_be_caught() -> None:
    """번역하다 보간 변수를 빠뜨리는 실수를 잡는지."""
    english = "limit {limitMb}MB"
    korean = "최대 용량 초과"
    assert check_locales.placeholders(english) != check_locales.placeholders(korean)


def test_missing_code_would_be_caught() -> None:
    """백엔드에 코드를 추가하고 로케일을 안 고친 경우를 잡는지."""
    backend_codes = {"JOB_FAILED", "JOB_TIMEOUT"}
    locale_codes = check_locales.namespace_keys({"errors.JOB_FAILED": "x"}, "errors")
    assert backend_codes - locale_codes == {"JOB_TIMEOUT"}


def test_stale_code_would_be_caught() -> None:
    """백엔드에서 코드를 지웠는데 로케일에 남은 경우를 잡는지."""
    backend_codes = {"JOB_FAILED"}
    locale_codes = check_locales.namespace_keys(
        {"errors.JOB_FAILED": "x", "errors.OLD_CODE": "y"}, "errors"
    )
    assert locale_codes - backend_codes == {"OLD_CODE"}
