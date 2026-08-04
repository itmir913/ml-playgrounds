"""JobQueue 프로토콜과 공용 타입.

구현 교체(InProcessQueue -> CeleryQueue)가 코드 전체에 파급되면 안 된다.
큐 라우팅 축은 작업 크기(small/large)와 데이터 타입(tabular/image/audio/text)이다.
"""
