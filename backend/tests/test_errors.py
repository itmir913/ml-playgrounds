"""에러 코드 계약 테스트.

이름과 값이 항상 같아야 하고, 모든 코드에 HTTP 상태가 있어야 하며,
직렬화 결과는 code와 params 두 키만 가져야 한다.
"""

import re

import pytest

from app.errors import (
    HTTP_STATUS,
    AppError,
    ErrorCode,
    IntegrityStatus,
    Stage,
)

CODE_PATTERN = re.compile(r"^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$")


@pytest.mark.parametrize("enum_type", [ErrorCode, Stage, IntegrityStatus])
def test_member_name_equals_value(enum_type: type[ErrorCode | Stage | IntegrityStatus]) -> None:
    for member in enum_type:
        assert member.value == member.name


@pytest.mark.parametrize("enum_type", [ErrorCode, Stage, IntegrityStatus])
def test_member_names_are_upper_snake_case(
    enum_type: type[ErrorCode | Stage | IntegrityStatus],
) -> None:
    for member in enum_type:
        assert CODE_PATTERN.match(member.name), member.name


def test_every_error_code_has_an_http_status() -> None:
    missing = [code.name for code in ErrorCode if code not in HTTP_STATUS]
    assert not missing, missing


def test_http_status_has_no_unknown_codes() -> None:
    assert set(HTTP_STATUS) == set(ErrorCode)


def test_error_codes_are_client_or_server_errors() -> None:
    for code, status in HTTP_STATUS.items():
        assert 400 <= status < 600, (code.name, status)


def test_app_error_payload_shape() -> None:
    error = AppError(ErrorCode.DATASET_TOO_LARGE, limitMb=50, actualMb=83)

    assert error.status_code == 413
    assert error.to_payload() == {
        "error": {
            "code": "DATASET_TOO_LARGE",
            "params": {"limitMb": 50, "actualMb": 83},
        }
    }


def test_app_error_without_params_still_has_params_key() -> None:
    """프런트엔드가 항상 같은 모양을 기대할 수 있어야 한다."""
    payload = AppError(ErrorCode.SERVER_BUSY).to_payload()
    assert payload == {"error": {"code": "SERVER_BUSY", "params": {}}}


def test_app_error_is_usable_as_string_code() -> None:
    """StrEnum이므로 비교와 직렬화가 문자열처럼 동작해야 한다."""
    assert ErrorCode.JOB_TIMEOUT == "JOB_TIMEOUT"
    assert f"{ErrorCode.JOB_TIMEOUT}" == "JOB_TIMEOUT"


def test_stage_covers_the_documented_flow() -> None:
    expected = {
        "QUEUED",
        "VALIDATING",
        "PREPROCESSING",
        "TRAINING",
        "EVALUATING",
        "DONE",
        "FAILED",
    }
    assert {stage.name for stage in Stage} == expected


def test_integrity_status_is_separate_from_error_codes() -> None:
    """검증 결과는 에러가 아니라 상태다. 두 열거형의 이름이 섞이면 안 된다."""
    assert {status.name for status in IntegrityStatus} == {"VERIFIED", "MISMATCH", "UNSIGNED"}
    assert not {status.name for status in IntegrityStatus} & {code.name for code in ErrorCode}
