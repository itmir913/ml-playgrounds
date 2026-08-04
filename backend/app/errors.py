"""백엔드가 반환하는 모든 코드의 단일 출처, 그리고 AppError 예외.

백엔드는 사람이 읽는 문장을 반환하지 않는다 (CLAUDE.md 1.4).
여기 정의된 이름이 프런트엔드 로케일 파일의 키와 1:1로 대응한다.

코드를 추가하면 **같은 커밋에서** 다음을 함께 갱신한다.
- frontend/src/locales/en.json
- frontend/src/locales/ko.json
- docs/error-codes.md

이 모듈은 의도적으로 FastAPI에 의존하지 않는다. 검사 스크립트가 외부 의존성 없이
파싱할 수 있어야 하기 때문이다. 직렬화와 예외 핸들러는 app/api/handlers.py에 있다.
"""

from enum import StrEnum, auto
from http import HTTPStatus

type ParamValue = str | int | float | bool | list[str] | None
"""로케일 문자열에 보간되는 값. JSON으로 직렬화 가능해야 한다.

여기 들어가는 것은 숫자와 사용자 데이터(컬럼명, 클래스 라벨)뿐이다.
번역 대상 문장을 params에 담지 마라.
"""


class _NameValueEnum(StrEnum):
    """멤버 이름을 그대로 값으로 쓰는 StrEnum.

    StrEnum의 기본 auto()는 이름을 소문자로 바꾼다. 코드는 대문자 스네이크로
    유지해야 하므로 재정의한다. 이렇게 하면 이름과 값이 어긋날 수 없다.
    """

    @staticmethod
    def _generate_next_value_(
        name: str,
        start: int,
        count: int,
        last_values: list[str],
    ) -> str:
        return name


class ErrorCode(_NameValueEnum):
    """실패를 알리는 코드. 명명 규칙은 {도메인}_{문제}."""

    # 요청 자체가 잘못된 경우
    REQUEST_INVALID = auto()
    ROUTE_NOT_FOUND = auto()
    METHOD_NOT_ALLOWED = auto()

    # 데이터셋
    DATASET_TOO_LARGE = auto()
    DATASET_EMPTY = auto()
    DATASET_PARSE_FAILED = auto()
    DATASET_ENCODING_UNSUPPORTED = auto()
    DATASET_TOO_MANY_ROWS = auto()
    DATASET_TOO_MANY_COLUMNS = auto()

    # 설정
    COLUMN_NOT_FOUND = auto()
    TARGET_NOT_SELECTED = auto()
    TARGET_SINGLE_CLASS = auto()
    TARGET_TOO_MANY_CLASSES = auto()
    FEATURE_NOT_SELECTED = auto()
    FEATURE_ALL_MISSING = auto()
    ALGORITHM_UNSUPPORTED = auto()
    HYPERPARAM_OUT_OF_RANGE = auto()
    SPLIT_INVALID = auto()
    # 분할 인덱스는 클라이언트가 계산해 함께 보낸다 (mlpx-spec.md 0.3).
    # 받은 번호가 데이터셋 범위를 벗어나면 거부한다 - 조용히 넘기면 없는 행을
    # 채워 넣고 학습이 그대로 진행되어 "조용히 틀린 결과"가 된다.
    SPLIT_INDEX_OUT_OF_RANGE = auto()

    # 작업
    JOB_NOT_FOUND = auto()
    JOB_TIMEOUT = auto()
    JOB_MEMORY_EXCEEDED = auto()
    JOB_CANCELLED = auto()
    JOB_FAILED = auto()

    # 서버
    SERVER_DISK_INSUFFICIENT = auto()
    SERVER_BUSY = auto()
    SERVER_INTERNAL_ERROR = auto()

    # 세션 (수명 = WebSocket 연결 수명, docs/architecture.md 2.2)
    SESSION_NOT_FOUND = auto()
    SESSION_EXPIRED = auto()
    SESSION_LIMIT_REACHED = auto()


class Stage(_NameValueEnum):
    """WebSocket 진행 단계.

    QUEUED -> VALIDATING -> PREPROCESSING -> TRAINING -> EVALUATING -> DONE
                                                                    -> FAILED
    """

    QUEUED = auto()
    VALIDATING = auto()
    PREPROCESSING = auto()
    TRAINING = auto()
    EVALUATING = auto()
    DONE = auto()
    FAILED = auto()


# 무결성 확인 어휘는 여기 없다.
#
# 서명을 만들지 않기로 하면서(open-decisions.md "무결성은 해시와 재실행 대조로 한다")
# 확인이 전부 브라우저에서 끝나게 됐다. 백엔드는 관여하지 않으므로 어휘도 백엔드에 두지
# 않는다. 단일 출처는 frontend/src/errors.ts 이고 로케일 네임스페이스는
# fileHash.* / reproduction.* 다.


HTTP_STATUS: dict[ErrorCode, int] = {
    ErrorCode.REQUEST_INVALID: HTTPStatus.UNPROCESSABLE_ENTITY,
    ErrorCode.ROUTE_NOT_FOUND: HTTPStatus.NOT_FOUND,
    ErrorCode.METHOD_NOT_ALLOWED: HTTPStatus.METHOD_NOT_ALLOWED,
    ErrorCode.DATASET_TOO_LARGE: HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
    ErrorCode.DATASET_EMPTY: HTTPStatus.BAD_REQUEST,
    ErrorCode.DATASET_PARSE_FAILED: HTTPStatus.BAD_REQUEST,
    ErrorCode.DATASET_ENCODING_UNSUPPORTED: HTTPStatus.BAD_REQUEST,
    ErrorCode.DATASET_TOO_MANY_ROWS: HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
    ErrorCode.DATASET_TOO_MANY_COLUMNS: HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
    ErrorCode.COLUMN_NOT_FOUND: HTTPStatus.BAD_REQUEST,
    ErrorCode.TARGET_NOT_SELECTED: HTTPStatus.BAD_REQUEST,
    ErrorCode.TARGET_SINGLE_CLASS: HTTPStatus.BAD_REQUEST,
    ErrorCode.TARGET_TOO_MANY_CLASSES: HTTPStatus.BAD_REQUEST,
    ErrorCode.FEATURE_NOT_SELECTED: HTTPStatus.BAD_REQUEST,
    ErrorCode.FEATURE_ALL_MISSING: HTTPStatus.BAD_REQUEST,
    ErrorCode.ALGORITHM_UNSUPPORTED: HTTPStatus.BAD_REQUEST,
    ErrorCode.HYPERPARAM_OUT_OF_RANGE: HTTPStatus.BAD_REQUEST,
    ErrorCode.SPLIT_INVALID: HTTPStatus.BAD_REQUEST,
    ErrorCode.SPLIT_INDEX_OUT_OF_RANGE: HTTPStatus.BAD_REQUEST,
    ErrorCode.JOB_NOT_FOUND: HTTPStatus.NOT_FOUND,
    ErrorCode.JOB_TIMEOUT: HTTPStatus.GATEWAY_TIMEOUT,
    ErrorCode.JOB_MEMORY_EXCEEDED: HTTPStatus.INTERNAL_SERVER_ERROR,
    ErrorCode.JOB_CANCELLED: HTTPStatus.CONFLICT,
    ErrorCode.JOB_FAILED: HTTPStatus.INTERNAL_SERVER_ERROR,
    ErrorCode.SERVER_DISK_INSUFFICIENT: HTTPStatus.INSUFFICIENT_STORAGE,
    ErrorCode.SERVER_BUSY: HTTPStatus.SERVICE_UNAVAILABLE,
    ErrorCode.SERVER_INTERNAL_ERROR: HTTPStatus.INTERNAL_SERVER_ERROR,
    ErrorCode.SESSION_NOT_FOUND: HTTPStatus.NOT_FOUND,
    ErrorCode.SESSION_EXPIRED: HTTPStatus.GONE,
    ErrorCode.SESSION_LIMIT_REACHED: HTTPStatus.SERVICE_UNAVAILABLE,
}
"""코드별 HTTP 상태. 모든 ErrorCode가 여기 있어야 한다 (테스트로 강제한다)."""


class AppError(Exception):
    """백엔드의 유일한 애플리케이션 예외.

    사용 예: raise AppError(ErrorCode.DATASET_TOO_LARGE, limitMb=50, actualMb=83)

    params의 키는 로케일 파일의 보간 변수와 정확히 같아야 한다.
    프런트엔드가 그대로 t(key, params)에 넘기기 때문이다.
    """

    def __init__(self, code: ErrorCode, **params: ParamValue) -> None:
        super().__init__(code.value)
        self.code = code
        self.params: dict[str, ParamValue] = dict(params)

    @property
    def status_code(self) -> int:
        return HTTP_STATUS[self.code]

    def to_payload(self) -> dict[str, object]:
        """CLAUDE.md 3의 응답 형식으로 직렬화한다."""
        return {"error": {"code": self.code.value, "params": self.params}}

    def __repr__(self) -> str:
        return f"AppError({self.code.value}, {self.params!r})"
