"""자동 생성 문서(OpenAPI·Swagger UI·ReDoc)가 켜져 있지 않은지 검사한다.

FastAPI는 기본으로 `/openapi.json`·`/docs`·`/redoc`을 띄우고, 라우트 함수의 **docstring을
그 응답의 `description`에 값으로 싣는다.** 그러면 한국어 개발자 설명과 `"Successful
Response"` 같은 영어 문장이 응답으로 나간다 — 백엔드는 사람이 읽는 문장을 반환하지
않는다(CLAUDE.md 1.4). 그래서 셋 다 끈다 (2026-09-26 R41 B-5, `app/main.py`).

`test_no_korean_literals.py`가 docstring을 검사에서 빼는 근거가 이 파일이다 — 여기가
초록인 동안에만 docstring이 응답으로 안 나간다.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

GENERATED_DOC_PATHS = ["/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc"]


@pytest.mark.parametrize("path", GENERATED_DOC_PATHS)
def test_generated_docs_are_not_served(path: str) -> None:
    response = TestClient(create_app()).get(path)
    assert response.status_code == 404, path


def test_app_does_not_build_a_schema_url() -> None:
    application = create_app()
    assert application.openapi_url is None
    assert application.docs_url is None
    assert application.redoc_url is None
