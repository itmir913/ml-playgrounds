# R41-ml 감사 회신 (코드 소유자가 옮겨 적음) — A 1 · B 3 · C 9

방법: 돌연변이 49 + sklearn 1.9.1·numpy 2.5.3 실제 대조 + 고침 재검증. `0.27.0..HEAD` ml 코드 변경 0줄이라 재검증 대상은 591dc74(52)·efd21e9(53)·c357240(55)·a31b0d2(R38-D55 A-1).
뿌리: **"sklearn과 같다"고 적힌 자리를 경계 입력에서 sklearn과 맞대 본 검사가 없었다**(실루엣·상수 열 표준화·범주 순서). **52·53·55·D55 A-1 고침에서 퇴행 없음** — 해당 돌연변이 13개 전부 욺.

## A-1. 실루엣이 단일점 군집 하나마다 1/n씩 부푼다 (코드 소유자가 sklearn으로 재현: 0.4256012204685211)
- 자리 `ml/metrics.ts:321-322` `if (myCluster.length <= 1) { ai = 0 }`; 주석 `:216-219`("sklearn과 같은 예외 처리 … a(i)=0, s(i)는 b(i)에만 의존") 거짓; 주석 `:288-290`("k≥n이면 b(i)=0 — sklearn도 0") 거짓 — sklearn은 k=n이면 던짐(`Number of labels is 3. Valid values are 2 to n_samples - 1`).
- sklearn `silhouette_samples`는 크기 1 군집의 점에 s=0. 우리는 s=1. 표본 경로도 같음.
- 재현: 두 무리(15+15)+이상치 2, KMeans(random_state=42), 같은 라벨을 `CLUSTER_EVALUATOR`에: k=3(16,15,1) sklearn 0.60674 우리 0.63799; k=4(15,15,1,1) 0.63651 vs 0.69901; k=5 0.45823 vs 0.52073; k=6 0.29160 vs 0.35410; k=7 0.30445 vs 0.39820. 최소 입력 `X=[[0,0],[0,1],[5,5],[5,6]]` 라벨 `[0,1,2,2]` → sklearn 0.4256, 우리 0.9256.
- A 이유: 군집 수업 핵심이 k 비교(`metrics.ts:424`), 이상치가 있으면 k를 올릴수록 단일점 군집이 생겨 우리 값만 부풂. sklearn(Pyodide) 엔진도 지표는 우리 `evaluateCluster`(`experiment.ts:675`)라 같이 틀림.
- 처방(잼): `:321` 가지를 `continue`(s=0, 분모 `counted` 그대로) → 여섯 k 모두 sklearn과 1e-14 안, 7파일 187 초록. 주석 둘 고침.
- 무는 검사 없음(M01 전체 스위트에서도 조용, `:322` 한 번도 실행 안 됨). 세울 것: 최소 입력 기대값 `0.4256012204685211` 판 + `scripts/generate_sklearn_fixtures.py`에 `silhouette_score`(현재 0건).

## B-1. 소수 상수 열 표준화 척도가 1e-15로 남는다 (sklearn은 1)
- `ml/preprocess.ts:210-214` `spread: Math.sqrt(variance) || 1`. 36.6×10 → 우리 spread 7.1e-15, sklearn `_is_constant_feature`로 `scale_=1.0`. 36.7 변환: sklearn 0.09999999999999432, 우리 **14,073,748,835,532**. 0.1×3/×7/×30도 1.4e-17~4.2e-17. 정수 상수·평균이 정확히 떨어지는 경우만 멀쩡. 기존 판 `preprocess.spec.ts:294`는 정수 5만.
- 처방(잼, sklearn `_data.py:97`과 같은 식):
  ```ts
  const n = values.length
  const constant = variance <= n * Number.EPSILON * variance + (n * center * Number.EPSILON) ** 2
  return { center, spread: constant ? 1 : Math.sqrt(variance) }
  ```
  36.7 → 0.09999999999999432 비트 일치, 420 초록(= 무검사, M48 조용). 검사: 36.6×10 적합 → 36.7 변환 sklearn 대조 판. 이웃 minmax·robust는 멀쩡.

## B-2. 범주 순서가 훈련 몫 등장 순서 (sklearn은 정렬) — **결정 필요**
- `preprocess.ts:398` `categories = [...new Set(present)]`. `['중','상','하','상']` sklearn `['상','중','하']`, 우리 `['중','상','하']` → 순서 인코딩 `[0,1,2,1]` 다름. 훈련 몫 행 순서에서 나와 **씨앗만 바꿔도 코드가 바뀔 수 있음**. M43(정렬로)에 11개(4파일)가 욺 — 테스트가 등장 순서를 의도적으로 못 박음(`preprocess.spec.ts:311`)인데 근거 결정문은 docs에 없음.
- ① sklearn처럼 정렬(결정문 52와 같은 비용: 옛 파일 재실행 대조 "다름" 가능) — 권고 ② 현행+결정문에 갈라섬 명시.

## B-3. 실루엣이 표본이어도 화면이 말하지 않는다 — 결정은 있고 코드 없음
- `metrics.ts:240-241` 주석 "화면도 이 함수를 부른다", 결정문 "실루엣 계수는 표본으로 낸다"의 "표본이라는 사실을 화면이 밝힌다". `grep silhouetteSampleSize src` → metrics.ts 밖 0. ko.json "표본" 0건. 켜지는 규모: 8특성 8,838행 초과, 사진(1280차원) 약 700장 초과.
- 처방: 결과 화면 지표 설명 옆에서 `silhouetteSampleSize(n, featureNames.length) < n`이면 표본임을 밝힘. 검사: 부르는 쪽이 import하는지.

## C
| # | 자리 | 내용 | 권고 |
|---|---|---|---|
| C-1 | `metrics.ts:158` | 상수 타깃 r2: 순차 합 vs numpy 쌍별 합 — `[0.1]×10`에서 1행 빗나가면 우리 −5.19e30, sklearn 0.0 | 결정 필요, 도달성 낮음 |
| C-2 | `metrics.ts:158` §6 r2 Infinity | ~1e-160 → 우리 `JOB_FAILED`, sklearn −inf | 멀쩡으로 닫음 |
| C-3 | `preprocess.ts:594` §6 `?? 0` | 부르는 11곳 모두 앞에서 막힘 | 멀쩡(도달 불가) |
| C-4 | `metrics.ts:341-344` §6 filled 가드 | 주석 옳음, M34·M35 욺 | 멀쩡 |
| C-5 | `plan.ts:377-379` | M03(provided에서 테스트 행 번호를 종류 판정에 섞음) 조용 | 판 추가 |
| C-6 | `plan.ts:236` | M12(provided 0행 minRows 1→2) 조용, 문구 파라미터만 | 판 추가 |
| C-7 | `sample.ts:123` | M26(되받기 동점 뒤 라벨 이김) 조용 | 판 추가 |
| C-8 | `metrics.ts:63`·`:307`·`neural.ts:672` | M32(혼동행렬 라벨 정렬 제거)·M33(실루엣 표본 씨앗 0 고정)·M41(에폭 섞기 randomState 제거) 조용 — **"randomState를 항상 쓴다"를 무는 판 없음** | 씨앗 두 개로 결과가 갈리는지 판 |
| C-9 | `selection.ts:698`(55 설계) | holdout에서 값 1개뿐 라벨로 층화가 막히면 뽑기 층화까지 꺼짐 — 퇴행 아님(55 전엔 거부) | 결정 필요, 안 잼 |

이웃 관찰: `views/train/TabularTrainContext.vue:32` `summarizeColumns` 기준 — R39a A-1과 같음.

## 돌연변이 49 — 욺 38 · 조용 11(등가 M40 포함)
조용: M01(A-1), M03, M12, M21(동작상), M26, M32, M33, M40(등가), M41, M48(B-1 처방). M08은 전체에서 욺.

## 못 한 것
B-1 교실 피해를 예측 끝까지 안 몲 · C-9 빠짐 비율 · 워커 경계 전수 재세기(R36이 함) · 등록부 전수 부분만(Pyodide 실학습은 가짜만) · 전체 스위트 재확인은 M01·M08·M21만(한 번 11분+) · 기준 상태 `backbones.spec` 2건 빨강(자산 미설치 추정).

## 조용했던 자리
52 최빈값 동점(아스트랄 문자 `😀` vs `ｚ` 하나 — R30 UTF-16 정렬 이웃) · 53 · 55 · D55 A-1 · train_test_split 층화 7 경계 입력 sklearn 일치(sklearn이 던지는 입력에서 우리는 층화 무시 — 55 의도) · f1 macro 세 경우 · randomState(분할·뽑기·k-means++·숲 씨앗·SVM; `Math.random`은 `predict.ts:352`·`palette.ts`만) · 병렬=직렬(M39 욺).
