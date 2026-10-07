# R43-2 감사 보고 — `data/**`·`composables/**`·`router/**` — A 2 · B 1 · C 7

> 감사자의 회신을 오케스트레이터가 옮겨 적었다. 재현과 고침은 맨 아래 "오케스트레이터 재현과 고침"에 있다.

HEAD `b502e00`. 돌연변이는 한 곳씩 심고 그 스펙만 돌려 되돌렸고 묶음마다 `git diff --quiet`가 깨끗했다. 임시 스펙 일곱은 지웠다.
측정은 개발 PC Node v24.15.0 · vitest 5.0.2, numpy 비교는 numpy 2.5.1.

**한 줄 결론.** 축 ②는 깨끗하다 — 파일을 만드는 길은 `.mlpx`의 `ZipPassThrough`와 묶음의 `level: 0`뿐이다.

## A

### A-1 범위 안의 xlsx 한 장이 탭을 메모리 부족으로 죽인다
- **자리** `frontend/src/data/xlsx.ts:159` `cells.push(cellToString(row.getCell(column).value))`, 폭은 `:138-147`(값이 든 가장 오른쪽 열).
- **주장** ExcelJS의 `row.getCell(n)`은 없는 칸에 Cell 객체를 새로 만든다 — 행 × 폭만큼 객체가 선다. 열 상한 안이어도 같고, 상한
  판정(`table.ts:212` `checkLimits`)은 그 뒤에 돈다.
- **재현(진짜 입구 `openTable`→`importTable`, 2열 × R행에 `(2, W)` 칸 하나)** 625×2000(11.8KB) 490ms · 1250×2000 1.14s · 2500×2000
  1.72s · 2500×900 1.14s · 5000×1001(49KB) 1.95s · **10000×900(상한 안, 90KB) `JavaScript heap out of memory`**(`--pool=forks`, 힙 2.35GB).
  [확정]에서 메인 스레드로 돈다 — 미리보기(21행)는 멀쩡하다.
- **처방(실측)** `row.values`(희소 배열)를 한 번 읽어 `values[column]` — 같은 10000×900이 814ms, xlsx·table 관련 145개 초록. 따로,
  `checkLimits`의 열 판정을 채우기 **앞**으로.
- **이웃** `getCell(` 1곳. CSV 쪽은 C-3.

### A-2 히스토그램이 구간 경계의 값을 왼쪽 구간에 센다 — numpy와 갈리고 주석은 같다고 말한다
- **자리** `frontend/src/data/stats.ts:216` `Math.floor(((value - low) / range) * count)`. 유창하게 틀린 주석 `:215`·`:104`.
- **주장** numpy는 몫으로 구간을 고른 뒤 실제 경계와 견줘 ±1을 바로잡는다. 우리는 안 해서 경계에 앉은 값이 `k − ε` 때문에 k−1로 간다.
- **재현(numpy 2.5.1)** `np.histogram(arange(0,23), bins=22)` → 마지막 구간 2, 나머지 1 / 우리: 구간14=2·구간15=0.
  `arange(0,45), bins=22` → 우리: 구간14=3·구간15=1. 전수: 정수 데이터 25.9만 설정 중 1,063개(0.41%), **구간 폭이 정수인 설정만 4.08%**.
- **처방(실측)** 구한 index에서 `value < edges[index]`면 −1, `value >= edges[index+1]`면 +1(마지막 구간 제외). histogram 쓰는 316개 초록.
  경계를 numpy linspace처럼 만드는 것은 재지 않음.

## B

### B-1 탐색기로 압축한 사진 zip의 첫 업로드에서 범주 이름이 조용히 깨진다 (결정 필요)
- **자리** `frontend/src/data/zip-names.ts:210` `if (utf8) return utf8`(규칙 1 "UTF-8로 전부 읽히면 그것이다").
- **주장** R41 B-4는 대조 이름이 있을 때만 닫았다. 첫 업로드는 `expect`가 비어 규칙 2가 안 선다. CP949 바이트가 그대로 유효한
  UTF-8인 이름은 규칙 1에서 끝난다. 흔한 낱말 59개 중 `치타·화창·치킨·책·표` 5개.
- **재현(`readImageZip`, `locale:'ko', expect:[]`)** `{치킨/1.png, 치킨/2.png}` → `[{ġŲ: 2}]`; `{치킨/…, pizza/…}` → `ġŲ`; 대조군
  `{치킨/…, 피자/…}` → 정상. 굽기 전 요약에 보이므로 아주 조용하지는 않다.
- **왜 B인가** 규칙 1의 순서를 바꾸는 결정이다. 대가: 한국어 화면에서 플래그 없는 진짜 UTF-8 `café`가 CP949로도 한글로 풀린다.
- **이웃** `decodeZipNames` 호출 2곳 — 걸리는 것은 사진 업로드뿐.

## C

- **C-1** `router/index.ts:266-269` — 겹친 이동에서 취소된 이동의 `afterEach`가 수위선(`toastWatermark`)을 지워, 이긴 이동의 잠긴 단계
  알림이 걷힌다(순서를 강제해 재현: 홈 → A `/inspect` → B `/project/:id/predict` → A 청크 → B 청크 ⇒ 화면 `results`, caution `[]`).
  처방(실측): 취소된 이동은 수위선을 건드리지 않는다 — 관련 67개 초록.
- **C-2** `tests/router.spec.ts:220`이 수위선 가드(M1)를 더는 안 문다(`e2dbb49` 뒤 저장 실패 알림은 새 id로 다시 밀린다). 처방(실측):
  결과가 아닌 단계에서 잠긴 예측으로 가 caution이 남는지 보는 검사 — 원 코드 초록, M1 빨강.
- **C-3** `csv.ts:57` `padGrid`가 `checkLimits`보다 앞 — 100,000행 × 2000폭(402KB) 2.6s. 처방: A-1과 같이 폭부터 재고 상한을 본다.
- **C-4** `data/chart-config.ts:776` 범례 거르기의 `findIndex`가 데이터셋 수에 제곱 — 32,000갈래 2.4s. 처방(실측): 이름 → 첫 index 맵을
  한 번 만든다(7ms, 91개 초록). 이웃 `ml/cluster-chart.ts:461`(R43-4 몫).
- **C-5** `router/index.ts:267`을 `dismissUpTo(0)`으로 바꿔도 27파일 209개 초록(M7) — 떠나는 화면의 알림 걷기를 무는 검사가 없다.
- **C-6** `router/index.ts:144`(받은 직후의 차례 검사)를 지워도 55개 초록(M3) — [저장하지 않고 이동] 길(`leave.consume`)에서만 일하는데
  거기에 검사가 없다. M3에서 버려진 이동의 `close()`가 머문 프로젝트를 닫는다(임시 스펙으로 재현, `leave.ask/allow`로 상태를 만듦).
- **C-7** (a) `xlsx.ts:335-336` ClientError 되던지기는 죽은 코드이고 주석이 유창하게 틀렸다(M20 등가). (b) `image/upload.ts:258`
  길이 0 엔트리 거르기에 검사 없음(M28). (c) `router/index.ts:218`을 `return true`로 바꿔도 조용(M5b).

## R41·R42 확인
R41 B-4 고쳐짐(M23 욺). R42 C-4 고쳐짐(M35·M36 욺).

## 돌연변이 36 — 운 것 28 · 조용 8 (등가 2)

조용: M1(수위선 가드) · M3(받은 뒤 차례 검사) · M5b(취소 → `true`) · M6(등가) · M7(`dismissUpTo(0)`) · M20(등가) · M25(NFC, 사실상 등가) ·
M28(길이 0 엔트리). 나머지(csv·encoding·table·serialize·xlsx·zip-names·archive-entries·grid·columns·scatter-thin·useWork·steps·
useExportProject·stats 끝 경계)는 모두 욺.

## 시간복잡도 실측 (개발 PC Node, 각 1회)

| 자리 | 입력 | 기울기 |
|---|---|---|
| CSV `padGrid`→`checkLimits` | 1250~10000행 × 2000폭: 30/59/106/238ms · 100,000×2000: 2,625ms | 행 × 폭 (C-3) |
| ExcelJS `getCell` | 625~2500 × 2000: 490/1139/1720ms · 10,000×900: 힙 부족 | 행 × 폭 (A-1) |
| 범례 `findIndex` | 2k~32k 갈래: 18/72/215/418/2412ms | 제곱 (C-4) |
| `scatterSeries`+`scatterLayers` | 같은 입력: 9/15/31/71/161ms | 선형 |

## 못 한 것
기준 기기·실브라우저 측정 없음(A-1 경계는 Node 힙 기준) · A-2 경계의 ULP 맞춤 · B-1 처방 · C-1은 손잡이 모의 청크 · C-4의 Chart.js 자체
비용 · C-6을 LeaveGuard 실제 단추로 · 돌연변이마다 `vue-tsc` · `useTraining`의 `onPreparing` 병렬 index · 훑기만 한 파일들
(`kinds.ts`·`category-axis.ts`·`image/sketch.ts`·`bake.ts`·`formats.ts`·`useFormat` 등) · 단일 범주 폴더 안 하위 폴더 zip · 커버리지.

## 오케스트레이터 재현과 고침

| 지적 | 고침 | 무는 검사 · 돌연변이(고친 뒤 다시 심어 확인) |
|---|---|---|
| A-1 | `row.values`(희소 배열)로 칸을 읽는다 — `getCell`을 안 부른다. 병합 칸도 첫 칸 값(ExcelJS `row.js`의 `get values`) | `xlsx.spec.ts` "먼 열에 값 하나만 있는 긴 시트도 곧 읽는다"(2,000행 × 900열, `Row.prototype.getCell` 감시). 옛 줄을 심으면 욺 — 그 상태로 17초 |
| A-2 | numpy처럼 경계는 `low + i * step`, 몫으로 고른 구간을 실제 경계와 견줘 ±1 | `stats.spec.ts` "numpy.histogram과 같은 수를 센다" — numpy 2.5.1 출력(개수·경계 ULP) 여섯 표본. 보정 제거 → 욺, 옛 경계 식 → 욺 |
| B-1 | 별도 과제(코드 소유자) — [itmir913/ml-playgrounds#43](https://github.com/itmir913/ml-playgrounds/issues/43) | — |
| C-1 | `afterEach`가 취소된 이동이면 수위선을 안 건드린다 | `route-watermark.spec.ts` "겹친 이동에서 잠긴 단계 알림이 남는다"(청크 손잡이로 순서 강제). 거르기 제거 → 욺 |
| C-2 | 검사 | 같은 파일 "데이터 단계에서 잠긴 예측으로 가도 이유가 남는다". 수위선 가드 제거(M1) → 욺 |
| C-3 | `padGrid`가 열 상한을 넘는 폭이면 채우지 않고, `checkLimits`는 가장 넓은 행을 센다. 상한을 끄면 `Infinity`라 늘 채운다 | `table.spec.ts` "열 상한을 넘는 표는 채우기 전에 거절한다"·"상한을 끄면 넓은 표도 채워서 받는다". 거르기 제거 → 욺, 스위치 대신 고정 1000 → 욺 |
| C-4 | 이름 → 첫 자리를 데이터셋 배열마다 한 번(`WeakMap`) | `chart-config.spec.ts` "갈래가 많아도 범례 거르기가 곧 끝난다"(32,000갈래, 한도 1초). 옛 `findIndex` → 2.9초로 욺 |
| C-5 | 검사 | `route-watermark.spec.ts` "떠나는 화면의 오류 알림은 이동이 끝나면 걷힌다". `dismissUpTo(0)`(M7) → 욺 |
| C-6 | 검사 | `route-leave-race.spec.ts`(허락한 이동이 청크를 기다리는 사이 같은 프로젝트의 다른 단계로). 첫 차례 검사 제거(M3) → 욺 |
| C-7(a) | 주석을 사실대로(오늘은 죽은 방어, 사람 확인) | — |
| C-7(b) | 검사 | `image-upload-zip.spec.ts` "길이 0인 파일은 사진으로 세지 않는다". 거르기 무력화(M28) → 욺 |
| C-7(c) | 검사 | `project-open-cancel.spec.ts` "다른 곳이 닫아 열기가 취소되면 그 이동은 단계 화면에 서지 않는다". `return true`(M5b) → 욺 |

고치며 밟은 것: 검사가 `rejects`·큰 입력으로 옛 코드를 실제로 돌리면 메모리 부족으로 워커가 죽어 "운 것"인지 가릴 수 없다 — C-3은 시간 대신 읽기 입구의
모양(짧은 행이 짧은 채로 온다)을 보도록 바꿨다.

**R43-1 후속 범주 계획은 5차 재검토에서 APPROVE**(`report-R43-1-plan-5.md`) — 버그픽스 태그 뒤에 구현한다(코드 소유자).
