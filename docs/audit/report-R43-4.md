# R43-4 슬라이스 감사 — `frontend/src/ml/*.ts` (기준 `64ab052`) — **FINDINGS** (B 1, C 1)

> 독립 감사자의 회신을 오케스트레이터가 옮겨 적었다. 요청서 `request-R43.md`. 돌연변이 18개 가운데 17개가 처음 짚은
> 스펙에서 울었고, M17 하나는 다른 스펙(plan-not-number·plan·experiment)에서 울었다.

## 지적과 처리

### B-1. 대체값·중심·폭이 넘쳐 NaN이 되어도 학습이 "완료"로 끝난다 → **고침**
- 재현(진짜 입구 `planRunOrThrow`→`transform`→`runExperiment`): 특성이 ±1.5e308이면 standard·minmax·robust 모두 열이
  NaN이나 0이 되고, 트리 0.25·숲 0.333·KNN 0.5·로지스틱 0.5가 `done`으로 났다. 저장된 전처리기의 `null`은 다시 열 때
  `fittedColumnSchema`가 거부한다(감사자의 추론).
- 처방: `fitPreprocessor`가 수치 대체값·중심·폭이 유한하지 않으면 새 프런트엔드 코드 `FEATURE_VALUE_TOO_LARGE`로 멈춘다
  (`docs/error-codes.md`를 먼저 고쳤다). 고치는 중에 **넘친 분산이 sklearn 상수 판정식에서 `Inf <= Inf`로 상수가 되어
  폭 1로 숨는 것**을 찾았다 — 표준화 판정에 `Number.isFinite(variance)`를 더했다.
- 검사: `tests/preprocess.spec.ts` *"넘치는 값은 FEATURE_VALUE_TOO_LARGE"* 6판(평균 합·standard 중심·standard 분산만·
  minmax 폭·robust 폭·넘치지 않는 1e150은 받는다).
- 돌연변이 4 가운데 3이 운다(대체값 검사 끔·폭 검사 끔·분산 유한 판정 끔). 중심 검사 끔은 처음에 살아남았고 오케스트레이터가
  등가라고 적었으나 **재판단이 반례를 냈다** — robust에서 값이 둘뿐이면 사분위수 셋이 모두 +Inf가 되고 폭 `Inf - Inf = NaN`을
  `|| 1`이 1로 숨겨, 넘친 것을 잡는 자리가 중심 검사 하나뿐이다(`missing: zero`·`mostFrequent`, 진짜 입구에서 `done` 0.5).
  그 판을 더해 이제 운다.

## 재판단 — **CLOSED WITH C** → 반례 판을 더해 닫음
- B-1: 원래 재현(±1.5e308, 스케일 넷)이 진짜 입구에서 모두 `FEATURE_VALUE_TOO_LARGE`로 멈춘다.
- C-1: `includes` 되돌림이 5878ms > 500으로 운다.
- 새 C(중심 검사를 무는 판 없음): *"robust의 중심만 넘친다 - NaN 폭은 1로 숨는다"*를 더했다. robust의 `|| 1`을 유한 판정으로
  바꾸는 것은 중심 검사가 이미 막으므로 하지 않았다.
- 이웃(감사자 기록, 고치지 않음): `metrics.ts`의 MAE·잔차·R² 합, `permutation-importance.ts`, `calibration.ts`의 보정 없는
  합. 특성이 전처리에서 막히므로 남는 입구는 회귀 **타깃**의 거대한 값뿐이고, 극히 드물어 C로 둔다.

### C-1. `mergeFields`의 범주 합치기가 제곱 시간이다 → **고침**
- 겹치지 않는 범주 n개씩 두 실험: 5k 80ms → 40k 4.4초(배마다 네 배). 예측 화면의 computed가 메인 스레드에서 부른다.
- 처방: 항목마다 본 범주의 `Set`을 함께 들고 견준다(감사자 실측 40k 21~57ms).
- 검사: `tests/predict.spec.ts` *"범주 40,000개를 곧 합친다"*(문턱 500ms). `includes`로 되돌리는 돌연변이가 운다.

## 기록만 한 것
- M17: `preprocess.ts` `fitPreprocessor` 머리말의 결정 53(종류를 훈련 ∪ 시험으로 정한다)은 `preprocess.spec`·
  `tabular-prep-kind.spec`이 아니라 plan-not-number·plan·experiment 중 하나가 문다. 무는 검사는 있으므로 C.
