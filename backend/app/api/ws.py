"""WebSocket - 세션의 수명을 정의하는 연결이다.

진행 단계 스트리밍:
QUEUED -> VALIDATING -> PREPROCESSING -> TRAINING -> EVALUATING -> DONE / FAILED

연결이 끊기면 세션의 데이터/모델을 전부 삭제한다. heartbeat로 half-open 연결을
감지하고, 유휴 타임아웃으로 방치된 세션을 정리한다.
"""
