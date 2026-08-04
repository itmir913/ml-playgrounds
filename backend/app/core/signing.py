"""HMAC 서명/검증.

datasetHash + settingsHash + metrics 에 대해 서명한다.
서명 키(SIGNING_SECRET)는 절대 클라이언트로 나가지 않는다.
서명이 보증하는 것은 "이 데이터/설정으로 서버가 실제 계산했다"까지다.
"""
