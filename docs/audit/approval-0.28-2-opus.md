# 최종 승인 2 (Opus, 독립) — **조건부 승인 (A 0 · B 1 · C 1)** — 코드 소유자가 답장에서 옮김

대상 2574369..main(115d0d7, 46커밋). 관문 `npm run ci` EXIT 0(215파일 4220 통과 2 skip, Errors 없음, 전 단계 초록).
진짜 흐름(App.vue + 진짜 라우터, jsdom): 표 프로젝트 만들기→CSV→전처리(범주 열 `중·상·하`, 36.6 상수 열)→분류·트리+KNN 학습→결과→예측→포트폴리오→exportFile→점검 무결성·대조 — appVersion 0.28.3, 범주 `['상','중','하']`, 무결성 통과, **두 run 모두 재현됨(NOT_JUDGED 없음)**. 사진 프로젝트 16장→학습→예측→내보내기→점검: 무결성 통과, 대조는 IMAGE_NOT_OPEN으로 잠김(설계대로) — 여기서 B-1.
CLAUDE.md 전수(추가 줄 grep): 임의 Tailwind·text-sm 이하·any·async @click 0, 한글 추가 줄은 주석뿐, 상한 리터럴 없음(NUMPY_PAIRWISE_BLOCK은 알고리즘 상수), 새 잠금 없음(COMPARING_OTHER는 동시 실행 잠금의 이유), 버전은 package.json만. 커밋 46 전부 G + Signed-off-by, 도구 표기 0, 태그 넷 Good signature, 규칙 표 since 조상 관계 전부 맞음. 문서 57~63·§8.2·§8.13.1·§10.2·§10.6 코드와 같음. 돌연변이 17 전부 욺.

## B-1 `.mlpx` 내보내기가 특정 이진 엔트리에서 열리지 않는 zip을 만든다 (오늘 만든 것 아님, 원래 있던 것)
`frontend/src/project/format.ts` `zipToBlob`(`Zip` + `AsyncZipDeflate`, level 6), fflate 0.8.3 — **스트리밍 Deflate/ZipDeflate/AsyncZipDeflate가 무효한 deflate 스트림을 냄**(node `zlib.inflateRawSync` "invalid distance too far back", 같은 데이터를 `deflateSync`로는 정상). 1280-float 벡터 하나를 엔트리로(임베딩 모양), 0 비율별 실패: 0% 0/200, 10% 1/200, 30% 15/200, 50% 41/200. 사진 흐름에서 실제로 readProject → PROJECT_FILE_NOT_ZIP, 점검 화면 "이 파일은 프로젝트 파일이 아닙니다". 도달 미증명: 실제 MobileNetV2 가중치로 합성 이미지 340장(0이 30~45%) 0/340, 표 CSV 셋 0/25씩, JSON 0/100 → B. 근거: 내보내기는 무조건 성공해야 한다(§1.1·§1.3).
처방 후보: 엔트리마다 `deflateSync` 또는 `zipSync` / blob 뒤 한 번 풀어 보는 왕복 확인 + 실패 알림 / fflate 상위 판 확인. 무는 검사: 희소 float 엔트리 writeProject → readProject 왕복.
## C-1 사진 프로젝트 대조 판이 "사진 프로젝트는 아직 대조할 수 없습니다"와 "정본 데이터가 파일에 없어서…"를 함께 — `ml/reproduce.ts` fileBlockers, IMAGE_NOT_OPEN이면 NO_DATASET 빼기(원래 문구).
못 한 것: 실브라우저 fflate(워커 경로)·실제 사진 임베딩 재현, 휴대폰 동작 바 모양, 옛 실물 파일 끝까지.
