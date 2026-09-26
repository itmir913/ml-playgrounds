# 최종 승인 1 (Fable) — **조건부 승인 (A 0 · B 0 · C 2)** — 코드 소유자가 답장에서 옮김

대상 2574369..0.28.3(44커밋). 관문 전체 `npm run ci` **EXIT 0**(215파일 / 4219 통과 / 2 skip — schema-version의 skipIf(RELEASED) 정상, Errors 없음, 픽스처·로케일 계약·백엔드 ruff/mypy/pytest 38).
교차 퇴행: (b) **옛 순서(0.28.2 이전 첫 등장 `중·상·하`)로 학습한 formatVersion 2·appVersion 0.27.0 파일 → readProject(v2→v3) → 적힌 범주 순서 그대로 → loadModel → predictPage — ordinal 4모델·onehot 3모델 전부 옳게 예측**(transform이 column.categories를 그대로, 모델이 classes를 듦). (b)×62: 정렬로 재학습한 run이 NOT_REPRODUCED → underRuleChanges가 NOT_JUDGED + rulesChanged{0.27.0, [CONSTANT_COLUMN_SCALE, CATEGORY_ORDER]}; 0.28.3이면 NOT_REPRODUCED 유지; since가 태그 조상 관계와 일치(merge-base 확인). (a) 결정문 63 재마운트 × 학습 중 전환(train-project-switch)·자동 저장(router flush가 open(B) 전)·포트폴리오(update 즉시)·동작 바 변수(onBeforeUnmount 제거 뒤 새 바 publish) OK. (c) 60×55 OK.
수치(sklearn 1.9.1·numpy 2.5.3 독립 표본): 실루엣 단일점 12자리, 상수 열 5종 scale 1, 상수 정답 r2 11건, 범주 순서 16종·LabelEncoder, 혼동 행렬, 최빈값 동점 5건 — 전부 일치.
파일 포맷: FORMAT_VERSION·DB_VERSION·엔진 version 변경 0, v2 실물 왕복.
문서·주석 표본 27 + 인용 검사 이름 38 전부 실재.
돌연변이 22 — 21 욺, **M22 CONSTANT_COLUMN_SCALE `data === null` 가지 조용**.

## 조건 (C)
- C-1 `03-screens.md:440` "512(학습)" vs 결정문 59 "540(학습)" — **코드 소유자가 고침**: 문장에 조건을 넣음("540(학습, 바 119px)… 학습을 한 번 돌려 바가 147px로 자란 뒤에는 512").
- C-2 `reproduce.ts` CONSTANT_COLUMN_SCALE `data === null` 가지 무는 판 없음 → 원 수정자에게.
못 한 것: 브라우저 실물(휴대폰 동작 바), 실물 Pyodide, 이미지 재마운트 직접 몰기.
