# R41-project 감사 회신 (코드 소유자가 옮겨 적음) — A 0 · B 8 · C 8

HEAD `2574369`. 방법: 실물 `.mlpx` 왕복(진짜 입구 `readProject`/`writeProject`/`loadProject`) · 순서 강제 두 탭 경합(fake-indexeddb, 가짜 BroadcastChannel 셋) · v1→v2→v3 사다리(옛 앱이 봉인한 `hashes.json` 유지).
뿌리 한 줄: **"증명"·정답·주석이 우연히 안전한 표본에 기대 있다** — ASCII 경로가 인코딩 증명이 되고, 프로젝트를 바꾸는 탭이 쥔 것에 대답을 멈추고, papaparse가 우리 CSV를 다시 읽을 때 구분자를 추측하고, 검사 표본(`개`/`고양이`, 999)이 안 깨지는 자리에 있다.

## B
- **B-1** `project/tab-lock.ts:199` — BroadcastChannel 경로에서 P→Q 전환 중 `await acquireNew(id)` **전에** `heldId = null`. Q가 다른 탭 C 것이라 전환이 거절되면 A는 `heldId=P`로 되돌리지만, 그 창 안에서 P를 물은 B는 이미 `true`를 받음 → 두 탭이 P를 씀(R27 A-2 시나리오). `:190` 주석 "같은 한 줄"은 Web Locks에만 참(유창하게 틀린 주석). 재현 T3: C가 q-2, A가 p-1 → `tabA.acquireTabLock('q-2')` 직후 `tabB.acquireTabLock('p-1')` → `{switched:false, bGot:true}`. 비보안 컨텍스트(자가호스팅 http)·세 탭·한 왕복 창에서만. 처방(잼): `heldId = null` 줄 삭제, `releaseHeld = null`은 유지 → T3 통과, tab-lock·r37-tab-lock·project-open-lock·project-open-cancel 36개 초록. 이웃: `heldId = null` 3곳, 나머지 둘(`:224`, `releaseTabLock`)은 해제 뜻이라 맞음. 검사: T3를 `tab-lock.spec.ts` BroadcastChannel 절로.
- **B-2** `tab-lock.ts:98` `&& message.id === heldId`를 지워도(M20) 락 스펙 셋 24개 초록. 조건이 없으면 P를 쥔 탭이 모든 요청에 답해 비보안 경로에서 다른 프로젝트를 못 엶. 처방: 코드는 맞음, T1(A가 p-1, B가 q-2 요청 → true)을 `tab-lock.spec.ts`에.
- **B-3** `data/csv.ts:24` delimiter 미지정, 호출 `project/dataset.ts:49,69,89`. `data/serialize.ts:16` "읽는 쪽도 이 값을 안다" 거짓, `serialize.ts:88-89` 무손실 왕복 주장. 정본 CSV는 `,`로 쓰고 `,`·`"`·개행만 따옴표 → 다시 읽을 때 papaparse가 `, \t | ;` 중 추측. 재현(진짜 입구) C2: `색(r;g;b),이름\n"255;0;0",빨강\n…` 업로드 → `importTable` 격자는 맞음, `imported.bytes` 재파싱 → `[["색(r","g","b),이름"],["255","0","0,빨강"],…]`. (코드 소유자가 papaparse로 직접 재현함.) 조용히 틀린 표, 이미 내보낸 파일도 해당. 처방(잼): `parseCsvText`에 `delimiter` 인자, 정본 읽기 셋이 `CANONICAL_DELIMITER` 전달 → C1·C2 통과, csv·serialize·table·table-thousands 80개 초록. 쓰기 쪽을 고치는 것(`;|\t`도 따옴표)으로는 이미 나간 파일을 못 구함. 이웃: 정본 읽기 3, `table.ts:105`는 업로드라 추측이 맞음. 검사: C1을 `serialize.spec.ts`로.
- **B-4** `data/zip-names.ts:170-179`(호출 `project/format.ts:851`) — 기대 이름 목록이 `hashes.json`의 모든 경로(`manifest.json` 포함)라 ASCII 이름이 어느 인코딩으로도 같게 읽혀 첫 후보(UTF-8)가 "증명"됨. CP949 바이트가 유효한 UTF-8인 한글 음절 164개(선행 C2–C8·후행 A1–BF; 치 타 화 창 호 표 크 키 체 짜). `:169` "증명이 순서를 이긴다" 불성립. 재현 P6: 범주 `치타`·`화창`, 탐색기 재압축 모양 → `dataset/data/ġŸ/…`, `ȭâ/…`, 무결성 MODIFIED. 기존 표본 `개`/`고양이`는 우연히 안전. 처방(잼): 기대 목록에서 순수 ASCII 이름 제외 → P6 통과, zip-names·image-format·image-upload-zip 70개 초록. 이웃: 기대 목록 호출 2 — 업로드 쪽 `data/image/upload.ts:161` 직접 호출로 재현(`['cat','짜짝']` → `["cat/1.png","¥¦/a.png"]`), 같은 한 줄로 닫힘. 검사: P6→`image-format.spec.ts`, P7→`zip-names.spec.ts`.
- **B-5 (결정 필요)** `backend/app/main.py:14` docs/openapi URL 기본값 → `GET /openapi.json`이 `/health`의 한국어 docstring(`가동 확인용.\n\n백엔드는 사람이 읽는 문장을…`)과 `"Successful Response"`를 반환, `/docs` 200. CLAUDE.md §1.4 위반. `tests/test_no_korean_literals.py:4-8`이 docstring을 "값으로 안 쓰임"이라 빼는데 FastAPI는 값으로 씀. 선택지 ① docs·redoc·openapi URL 끔(권고, 4단계에서 재검토) ② 두되 description 비움 ③ 환경 변수로 dev만. 검사: `test_no_error_response_contains_a_sentence` 모양으로. 백엔드 pytest 33 통과.
- **B-6** 한국어가 변수를 거쳐 throw 메시지에: `data/image/bake.ts:49`(`'(빈 타입)'`) → `:58` throw → `failureDetail` → 영어 UI 토스트에 노출. `i18n.ts:75-76` 메시지를 변수로 조립 후 테스트 모드에서 `throw new Error(message)` → CI 출력에 한국어. `tests/ci-language.spec.ts:14`가 `src`는 `i18n-usage.spec.ts`가 덮는다고 주장 — 이 둘엔 거짓. 주석 밖 따옴표 리터럴 스캔: src 전체에서 한글 리터럴 **정확히 이 2개**. 처방: 둘 다 영어로 + "src/**/*.ts 따옴표 리터럴 한글 0" 검사로 넓힘(넓힌 검사는 돌연변이로 안 재봄).
- **B-7** `project/images.ts:189`, `tests/limits-rules.spec.ts:98-101` — 상한 해제가 사진 상한을 실제로 푸는지 행동 검사 없음. M29(`Math.min(maxImageCount(), 5000)`)가 163개(limits-rules 포함) 조용. 표 행 대응 M30은 욺. 검사: L1(해제 → `imageOverflow(null/project, MAX_IMAGE_COUNT+1)` null, 켜짐 → not null) 깨끗한 코드 통과·M29에서 욺 → `limits-switch.spec`에.
- **B-8 (결정 필요)** v1 이미지 프로젝트의 학습 모델이 마이그레이션에 살아남는데 스냅숏이 새 백본(`mobilenet-v2-r2`)으로 다시 붙음(P2: 옛 봉인 UNCHANGED로 열림, 설정·실험 스냅숏이 r2로, 옛 임베딩 버림, `model/r1.json` 유지, 저장·재열기 무손실). 비참조 모델(로지스틱·트리·신경망·SVM·NB)이 옛 범위 벡터로 학습하고 새 범위로 예측. KNN은 현재 벡터로 재구성이라 안전. §9.1은 지표만 말함. 괴리 크기는 못 잼(백본 Node 불가). 선택지 ① 현행+문서화(권고, v1 이미지 파일이 적음) ② v1→v2에서 이미지 run의 모델 떼기(생략 어휘 결정 필요).

## C
- C-1 `format.ts:433-435` fflate가 버퍼를 재사용할 수 있다는 주석 — fflate 0.8.3 `Zip`(`esm/browser.js:2063-2140`)은 항상 새 배열, M15 조용. `.slice()` 제거 또는 "사람 확인" 표시.
- C-2 `data/table.ts:170-172` "xlsx 경로는 소스로만 확인" — 낡음, `xlsx.spec.ts:181,258`이 둘 다 덮음.
- C-3 `limits-switch.ts:11` "여기 사는 상한 7" — `open()` 8개. `:139-143` 문서 주석이 엉뚱한 함수 위.
- C-4 limits.ts 밖 매직 넘버: zip `level: 6` 두 곳(`format.ts:445`, `portfolio-bundle.ts:135`), `useFormat.ts` 자릿수 3·4·12(같은 척도 주장이 산문뿐), `svm-smo.ts:72` `maxIterations: 10000`·`logistic.ts:256` `60`(ml 슬라이스 판단).
- C-5 (결정 필요) copy.md §2 닫힌 목록 밖 버튼 이름: `보기`(`train.seeResults`, `portfolio.preview`, `predict.tabular.showFeatures`), `쓰기`(`portfolio.write`). 목록에 더하거나 한자어로.
- C-6 v1→v2 실험 스냅숏 재라벨을 직접 호출(`migrate.spec`)만 뭄(M8), 진짜 입구 `image-format.spec`은 설정만.
- C-7 상위 버전 경계를 `format.spec`만 뭄, `migrate.spec`은 999만(M9).
- C-8 상한 재고: 상수 137(계획 133), 전부 src 소비자 ≥1, 소비자 ≥2가 29, 검사에서 이름 안 불리는 80, `.vue`만 소비하는 7(`IMAGE_GRID_PAGE_SIZE`, `CLUSTER_REPRESENTATIVE_COUNT`, `SCROLL_TOP_DURATION_MS`, `HISTOGRAM_BIN_LIMIT`, `CLUSTER_MEMBER_PAGE_SIZE`, `CLUSTER_NEIGHBOR_ROW_COUNT`, `LOSS_CURVE_TICK_COUNT`).

## 돌연변이 30 — 조용 셋: M15(zipToBlob chunk slice 제거 → C-1), M20(tab-lock id 일치 제거 → B-2), M29(images 리터럴 5000 → B-7). 나머지 27 욺(M8은 migrate.spec만, M9는 format.spec만, M28은 limits-rules 이름 규칙만).

## 못 한 것
실브라우저 `downloadBlob` revoke 타이밍(결정 48이 iPad 실측), 워커 차단 시 fflate 폴백, 실제 BroadcastChannel·IndexedDB 타이밍 · B-8 괴리 크기 · B-4 업로드 쪽은 `decodeZipNames` 직접 호출로만 · B-6 넓힌 검사 돌연변이 미측정 · 커버리지 미실행 · i18n 규칙 4는 받침 조사만 훑음.

## 조용했던 자리
사다리 P1–P5(v3 사진 왕복 무손실, v1 이미지·v1/v2 표 시험·예측 데이터 포함 옛 봉인으로 열리고 왕복, 상위 버전 TOO_NEW, 한 바이트 변조 MODIFIED) · 결정문 50 재검증(S1–S3, M1–M3) · 결정문 51(M4) · 내보내기 실패 경로(flush·markExported 둘 다 잡힘) · 사파리 `.mlpx.zip`(명렬·포트폴리오 묶음·점검) · 천 단위·큰 수·xlsx 폴백 순서·행 상한 · 로케일 en/ko 850키 대칭 · 백엔드 pytest 33.
