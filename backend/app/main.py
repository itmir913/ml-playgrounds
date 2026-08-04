"""FastAPI 애플리케이션 진입점.

라우터 등록, AppError 예외 핸들러 연결, 세션 청소기 기동을 담당한다.
비즈니스 로직은 여기 두지 않는다.
"""

from fastapi import FastAPI

app = FastAPI(title="ML Playgrounds", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    """가동 확인용.

    백엔드는 사람이 읽는 문장을 반환하지 않는다 (CLAUDE.md 1.4).
    여기서 나가는 "OK"도 문장이 아니라 상태 코드다.
    """
    return {"status": "OK"}
