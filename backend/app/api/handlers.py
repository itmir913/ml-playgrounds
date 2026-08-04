"""예외 -> CLAUDE.md 3의 응답 형식 직렬화.

FastAPI와 Starlette의 기본 핸들러는 "Not Found", "Field required" 같은 영어 문장을
그대로 응답 본문에 담는다. 이는 CLAUDE.md 1.4 위반이므로 전부 갈아끼운다.
이 파일이 없으면 백엔드는 조용히 자연어를 내보낸다.
"""

import logging
from http import HTTPStatus

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.errors import AppError, ErrorCode

logger = logging.getLogger(__name__)

_STATUS_TO_CODE: dict[int, ErrorCode] = {
    HTTPStatus.NOT_FOUND: ErrorCode.ROUTE_NOT_FOUND,
    HTTPStatus.METHOD_NOT_ALLOWED: ErrorCode.METHOD_NOT_ALLOWED,
    HTTPStatus.UNPROCESSABLE_ENTITY: ErrorCode.REQUEST_INVALID,
    HTTPStatus.SERVICE_UNAVAILABLE: ErrorCode.SERVER_BUSY,
}


def _response(error: AppError) -> JSONResponse:
    return JSONResponse(status_code=error.status_code, content=error.to_payload())


def _field_path(location: tuple[int | str, ...]) -> str:
    """검증 실패 위치를 점 표기 경로로 만든다.

    여기 담기는 것은 우리가 정한 필드 이름이지 번역 대상 문장이 아니다.
    """
    return ".".join(str(part) for part in location)


async def handle_app_error(_request: Request, exc: Exception) -> JSONResponse:
    """의도적으로 발생시킨 애플리케이션 오류."""
    if not isinstance(exc, AppError):
        raise exc
    return _response(exc)


async def handle_validation_error(_request: Request, exc: Exception) -> JSONResponse:
    """Pydantic 검증 실패. 어떤 필드가 문제인지만 알려준다."""
    if not isinstance(exc, RequestValidationError):
        raise exc
    fields = sorted({_field_path(item["loc"]) for item in exc.errors()})
    return _response(AppError(ErrorCode.REQUEST_INVALID, fields=fields))


async def handle_http_exception(_request: Request, exc: Exception) -> JSONResponse:
    """Starlette가 던지는 404/405 등. 기본 응답의 detail 문자열을 버린다."""
    if not isinstance(exc, StarletteHTTPException):
        raise exc
    code = _STATUS_TO_CODE.get(exc.status_code)
    if code is None:
        # 매핑되지 않은 상태 코드는 서버 잘못으로 간주하고 원문을 밖으로 내지 않는다.
        logger.warning("unmapped_http_exception status=%s", exc.status_code)
        code = ErrorCode.SERVER_INTERNAL_ERROR
    return _response(AppError(code))


async def handle_unexpected(_request: Request, exc: Exception) -> JSONResponse:
    """처리되지 않은 예외. 내용은 서버 로그에만 남기고 클라이언트는 코드만 받는다."""
    logger.exception("unhandled_exception", exc_info=exc)
    return _response(AppError(ErrorCode.SERVER_INTERNAL_ERROR))


def register_exception_handlers(app: FastAPI) -> None:
    """모든 예외 경로를 구조화된 응답으로 고정한다."""
    app.add_exception_handler(AppError, handle_app_error)
    app.add_exception_handler(RequestValidationError, handle_validation_error)
    app.add_exception_handler(StarletteHTTPException, handle_http_exception)
    app.add_exception_handler(Exception, handle_unexpected)
