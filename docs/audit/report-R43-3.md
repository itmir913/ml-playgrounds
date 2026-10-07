# R43-3 감사 보고 — `ml/engines`·`ml/worker`·`ml/embed`·`ml/models` (기준 `03738a6`) — **CLEAN WITH C** (A 0 · B 0 · C 4)

> 감사자의 회신을 오케스트레이터가 옮겨 적었다. 요청서 `request-R43.md`의 R43-3. 돌연변이 29개. **코드 소유자가 이번 마감에서 C는 고치지
> 않고 기록만 남기기로 했다**(2026-10-07). 다음 국면이 이 목록에서 시작한다.

축 2(`.mlpx` 압축·워커 회귀)는 깨끗하다 — 슬라이스에 `fflate`·deflate·파일을 만드는 길이 없다. 축 3(조용히 틀린 답)은 실측으로 잡힌 것이 없다.

## C

- **C-1 분할 탐색이 동점 후보에서 제곱이다** — `ml/engines/cart-split.ts:147-172`(후보 수집)·`:184-202`(2단계 재계산), 머리 주석 `:11-12`의
  "O(n log n)"이 틀렸다. 같은 값 구간 안에서 라벨이 바뀔 때마다 `value`가 같은 후보가 다시 생기고 2단계에서 후보마다 `libraryGini`가 O(n)을 돈다.
  원-핫·0/1·범주 코드 열이 정확히 이 모양이다. 답은 같고 시간만 다르다. 실측(Node, 0/1 6열, 라벨 잡음 30%): 포레스트 20k 3.4s · 40k 12.2s ·
  80k **63.4s**(두 배에 약 5배). 예상 시간 표(`limits.ts`)는 연속값 표에서 잰 것이라 이 모양을 과소 예측한다. 처방(실측): 열마다 직전 후보의
  `value`를 기억해 같으면 건너뛴다(원본도 "엄격히 클 때만 바꾼다"라 뒤의 중복은 못 이긴다) — 80k 포레스트 4.8s, 관련 스펙 56개 초록, 답 비트 동일.
  무는 검사 "0/1 열 40k의 `fastBestSplit`이 곧 끝난다"(0.9s → 30ms)를 세우고 주석을 고친다. 이웃 0.
- **C-2 KNN이 질의마다 n짜리 `Map`을 짓고(`ml/models/reference.ts:150-153`), 불러오기가 행마다 `classes.includes`(`:205`)다.** (a) 예측 1,000건
  20k 3.4s · 40k 6.8s → 밖으로 올리면 0.78s · 1.17s. (b) 고유 라벨 n개(ID 열을 타깃으로): 10k 255ms → 80k **13.9s** → `Set`이면 78ms. 덧붙임:
  `:205` 가드를 통째로 지워도 361개가 조용하다(M8) — 고칠 때 "classes에 없는 훈련 라벨이면 `MODEL_FILE_INVALID`" 검사를 함께 세운다.
- **C-3 임베딩 워커가 `ClientError`를 그대로 넘기는 줄(`ml/embed/handler.ts:49`)을 무는 검사가 없다**(병 2). `IMAGE_CANONICAL_SIZE_MISMATCH`가
  `BACKBONE_UNAVAILABLE`로 바뀌어도 55개가 조용하다(M24). 처방(실측): 가짜 러너가 그 코드를 던질 때 마지막 메시지가 `{type:'failed', code, params}`인지.
- **C-4 KNN·포레스트 계산 워커의 "씨앗 전 스텝은 던진다" 그물이 물리지 않는다** — `ml/worker/knn-compute.ts:80`, `forest-compute.ts:163`.
  형제 `neural-compute`는 `neural-parallel.spec.ts:186`이 문다. 지금 풀은 늘 씨앗을 먼저 보내 닿지 않는 그물이다. 처방: 같은 검사 둘.

## 돌연변이 (29)

욺 24 — `cart-split` 경계·대역 5, `reference` 동점 2, `tree` 3, linear argmax, naive-bayes 분산, kmeans, 풀 배분·일꾼 수·KNN 나눔·접는 순서 둘,
`plainTree`, 씨앗 사슬, pixels 채널, client `partial`, `neural-compute` 그물. **안 욺** — M8(C-2), M20·M27(C-4), M24(C-3). 등가·죽은 가드라 지적
안 함 — M26(주석이 밝힌 죽은 가드), M28(`labelCodec.decode` 범위 밖, 주석이 밝힌 방어선), M29(지니 분류만 지음).

## 못 한 것

돌연변이마다 `vue-tsc` · 커버리지 · 실브라우저·기준 기기(전부 Node 1회, 포레스트 100k는 외삽) · C-1의 풀 경로(Node에 `Worker` 없음) ·
`pyodide-*`·`engines/neural`·`logistic`·`svm-smo`·`mljs-kmeans` 수치 본문·`embed/client`·`runner`는 훑기만. 추론으로만 남긴 것: `mljs-kmeans`
초기화의 부동소수 누적, KNN 병렬 경로에서 질의 행 길이가 어긋나면 NaN으로 조용히 답함(지금 입구에서 그 길을 못 찾음).
