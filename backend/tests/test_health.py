"""가동 확인 엔드포인트 테스트.

이 저장소의 백엔드는 테스트를 먼저 쓴다. 첫 테스트가 여기서 시작한다.
"""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_returns_ok() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "OK"}
