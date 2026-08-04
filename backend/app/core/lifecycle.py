"""세션 작업 디렉터리 생성/삭제 + 고아 파일 청소기.

세션 수명 = WebSocket 연결 수명. 종료 감지 경로는 네 가지다.
close 이벤트 / heartbeat 실패 / 유휴 타임아웃 / 고아 청소기(안전망).
정리는 try/finally에서 보장한다. (docs/architecture.md 2.2)
"""
