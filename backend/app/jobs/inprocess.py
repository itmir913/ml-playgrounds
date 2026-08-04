"""V1 구현: asyncio.Queue + ProcessPoolExecutor.

시간/메모리 상한은 워커 프로세스 수준에서 강제한다(resource.setrlimit 또는
컨테이너 제한). 파이썬 코드 안의 체크만으로는 막지 못한다.
단일 백엔드 인스턴스를 전제한다. (docs/architecture.md 1.2)
"""
