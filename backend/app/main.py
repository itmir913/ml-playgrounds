"""FastAPI 애플리케이션 진입점.

라우터 등록, 예외 핸들러 연결, 세션 청소기 기동을 담당한다.
비즈니스 로직은 여기 두지 않는다.
"""

from fastapi import FastAPI

from app.api.handlers import register_exception_handlers


def create_app() -> FastAPI:
    """앱을 조립한다. 테스트가 매번 깨끗한 인스턴스를 만들 수 있게 팩토리로 둔다.

    **자동 생성 문서는 셋 다 끈다** (2026-09-26 R41 B-5). FastAPI는 라우트의 docstring을
    `/openapi.json`의 `description`에 값으로 실어 내보내고 `/docs`·`/redoc`이 그것을
    그린다 — 한국어 설명과 `"Successful Response"`가 응답이 된다(CLAUDE.md 1.4).
    백엔드 구현(4단계)에서 다시 본다. 검사: tests/test_no_schema_endpoints.py.
    """
    application = FastAPI(
        title="ML Playgrounds",
        version="0.0.0",
        openapi_url=None,
        docs_url=None,
        redoc_url=None,
    )
    register_exception_handlers(application)

    @application.get("/health")
    def health() -> dict[str, str]:
        """가동 확인용.

        백엔드는 사람이 읽는 문장을 반환하지 않는다 (CLAUDE.md 1.4).
        여기서 나가는 "OK"도 문장이 아니라 상태 코드다.
        """
        return {"status": "OK"}

    return application


app = create_app()
