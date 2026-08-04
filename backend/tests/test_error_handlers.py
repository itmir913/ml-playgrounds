"""예외 경로가 자연어를 흘리지 않는지 검사한다.

FastAPI/Starlette 기본 핸들러는 "Not Found", "Field required" 같은 영어 문장을
응답에 담는다. 모든 경로가 코드와 파라미터만 반환해야 한다 (CLAUDE.md 1.4).
"""

import re
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.api.handlers import register_exception_handlers
from app.errors import AppError, ErrorCode
from app.main import create_app

CODE_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]*$")


class _Payload(BaseModel):
    rows: int


def _build_app() -> FastAPI:
    application = create_app()

    @application.get("/boom/app-error")
    def _app_error() -> None:
        raise AppError(ErrorCode.DATASET_TOO_MANY_ROWS, limitRows=200000, actualRows=999999)

    @application.get("/boom/unexpected")
    def _unexpected() -> None:
        raise RuntimeError("this sentence must never reach the client")

    @application.post("/boom/validation")
    def _validation(payload: _Payload) -> dict[str, int]:
        return {"rows": payload.rows}

    register_exception_handlers(application)
    return application


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(_build_app(), raise_server_exceptions=False) as test_client:
        yield test_client


def _assert_error_shape(body: Any) -> dict[str, Any]:
    """응답이 {"error": {"code", "params"}} 정확히 그 모양인지 확인한다."""
    assert set(body) == {"error"}
    error: dict[str, Any] = body["error"]
    assert set(error) == {"code", "params"}
    assert CODE_PATTERN.match(error["code"]), error["code"]
    assert isinstance(error["params"], dict)
    return error


def test_app_error_is_serialised_with_params(client: TestClient) -> None:
    response = client.get("/boom/app-error")

    assert response.status_code == 413
    error = _assert_error_shape(response.json())
    assert error["code"] == "DATASET_TOO_MANY_ROWS"
    assert error["params"] == {"limitRows": 200000, "actualRows": 999999}


def test_unknown_route_returns_a_code_not_a_sentence(client: TestClient) -> None:
    response = client.get("/no-such-route")

    assert response.status_code == 404
    error = _assert_error_shape(response.json())
    assert error["code"] == "ROUTE_NOT_FOUND"
    assert "detail" not in response.text


def test_wrong_method_returns_a_code(client: TestClient) -> None:
    response = client.post("/health")

    assert response.status_code == 405
    assert _assert_error_shape(response.json())["code"] == "METHOD_NOT_ALLOWED"


def test_validation_error_reports_fields_only(client: TestClient) -> None:
    response = client.post("/boom/validation", json={"rows": "not-a-number"})

    assert response.status_code == 422
    error = _assert_error_shape(response.json())
    assert error["code"] == "REQUEST_INVALID"
    assert error["params"] == {"fields": ["body.rows"]}


def test_unhandled_exception_hides_its_message(client: TestClient) -> None:
    response = client.get("/boom/unexpected")

    assert response.status_code == 500
    assert _assert_error_shape(response.json())["code"] == "SERVER_INTERNAL_ERROR"
    assert "this sentence must never reach the client" not in response.text


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/no-such-route"),
        ("post", "/health"),
        ("get", "/boom/app-error"),
        ("get", "/boom/unexpected"),
    ],
)
def test_no_error_response_contains_a_sentence(client: TestClient, method: str, path: str) -> None:
    """문장 판별 휴리스틱: 코드가 아닌 값에 공백으로 이어진 단어가 있으면 의심한다."""
    response = getattr(client, method)(path)
    error = _assert_error_shape(response.json())

    for value in error["params"].values():
        candidates = value if isinstance(value, list) else [value]
        for candidate in candidates:
            assert not (isinstance(candidate, str) and " " in candidate), candidate
