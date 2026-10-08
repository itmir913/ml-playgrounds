# 이미지 KNN 사진 추가 — 구현 감사 요청서

> 독립 검토다. 공통 규칙은 `docs/workflow.md` §3 "감사 국면은 어떻게 도는가"·"요청서는 무엇을 담는가"·"보고서에 반드시 있어야 하는 것"·"감사가 되풀이해 잡은 병"과 §10.
> **읽기 전용이다** — 소스를 고치지 마라(돌연변이·임시 스펙은 심고 정확히 되돌리는 것까지만).
> 금지: `git commit`·`push`·`tag`·`add` · `npm run lint` · `npm run ci` 전체 · `git stash` · `git checkout .` · 디렉터리 단위 되돌리기 · 하위 에이전트·클라우드 · 버전 올리기 제안.
> **범위: `git diff f971d76..HEAD`** — 커밋 둘(`7e39f27` 1단계, `8950d40` 2단계). 관문(`npm run ci`)은 2단계 커밋 직전 트리에서 초록이었다.
> **판정을 맨 위에 적어라: `APPROVE` 또는 `REQUEST CHANGES`.**

## 무엇을 고쳤나

**교실 증상:** 사진 KNN을 학습한 뒤 사진을 더 올리면 예측이 "이 파일에는 데이터가 없습니다"로 꺼졌다.

- **1단계 (`7e39f27`, 포맷 그대로)** — 못 세운 행을 `MODEL_TRAINING_DATA_CHANGED`로 말한다(`imageLoadContext`). 분류의 라벨 없는 사진
  장수를 대조하지 않는다. 표에 들 사진의 임베딩이 빠졌거나 백본이 다르면 행을 안 낸다.
- **2단계 (`8950d40`)** — 분류 실험의 스냅샷에 행마다의 열쇠(`rowKeys`)를 적고, 되세울 때 `trainIndices`의 열쇠만 지금 사진에서
  찾는다. 결정과 근거는 `docs/open-decisions/08-implemented.md` 111, `docs/cases/open-decisions.md` 111, `docs/mlpx-spec/02-model.md`
  §5.1, `docs/cases/mlpx-spec.md` §5.1 "행마다의 열쇠". 계획은 `docs/audit/request-knn-rowkeys-plan.md`(2판 APPROVE).

## 코드 소유자가 정한 것 — 구현이 이대로인지 확인하라

1. 훈련에 쓴 사진을 지우거나 범주를 옮기면 예측을 거부한다.
2. 훈련에 안 쓴 사진(테스트 몫·표본 밖)은 바뀌어도 예측한다.
3. 열쇠는 분류 실험에만, 표 전체를 적는다.
4. **과거 `.mlpx` 호환성이 깨지면 안 된다** — 과거 파일 열기 성공, 과거 파일에서 예측 가능. 포맷 버전은 되도록 안 올린다(이번에 안 올렸다).
   **이 축을 가장 세게 깨 봐라.** 같은 v4의 옛 앱(1단계 전 `f971d76`)이 새 파일을 여는 것도 포함한다.
5. 새 에러 문구(`client.MODEL_TRAINING_DATA_CHANGED`, ko/en/ja)는 초안이고 소유자 확인 대상이다 — 뜻이 세 로켈에서 같은지, 백본 불일치·임베딩
   누락에도 거짓이 아닌지만 보라.

## 겨냥할 곳

- `frontend/src/ml/images.ts` — `rowKeyOf`·`rowKeysOf`·`readRowKeys`·`imageTrainingRows`·`trainingRowsByKeys`·`imageLoadContext`
- `frontend/src/ml/training-source.ts` — 이미지 어댑터가 스냅샷에 열쇠를 얹는 자리, `rowHashes` 이름 바꾸기
- `frontend/src/project/schema.ts` — `imageSnapshotSchema.rowKeys`, `SNAPSHOT_NOT_COMPARED`
- `frontend/src/views/predict/ImagePredictPanel.vue` — 실험마다 행 캐시와 `imageLoadContext`
- `frontend/src/errors.ts`, `frontend/src/locales/*.json`, `docs/error-codes.md`
- 검사: `frontend/tests/image-row-keys.spec.ts`(새), `image-training.spec.ts`, `experiment.spec.ts`, `training-source.spec.ts`, `fixtures/schema/v4.json`

## 의심할 것

- 열쇠 경로와 옛 경로의 갈림(`snapshot.rowKeys !== undefined`)이 맞는가 — 옛 앱이 학습한 실험·군집·과거 파일이 옛 경로로 가는가.
- 결과 동일성 — 사진을 더해도 답이 같다는 검사(`image-row-keys.spec.ts`)가 정말 그것을 재는가(병 2·3·4).
- 깨진 열쇠·겹친 열쇠·길이 가드가 각각 무는가. 내가 돌린 돌연변이 표는 아래에 있다 — 다시 재지 말고 **안 잰 것**을 찾아라.
- 주석의 단정이 맞는가(병 1). 특히 `SNAPSHOT_NOT_COMPARED` 주석의 증명, `rowKeysOf`의 비용 문장, `readRowKeys`의 예외 처리.
- 1단계와 2단계가 서로 어긋나는가(같은 판정을 두 곳에서, 병 6).
- 예측 화면에서 열쇠를 짓는 비용(사진 수만큼 sha256)이 실험마다 한 번인가.

## 내가 돌린 돌연변이 (2단계, `tests/image-row-keys.spec.ts` · `experiment.spec.ts`)

| 심은 것 | 결과 |
|---|---|
| 열쇠 경로 끄기 (`if (false)`) | 8 실패 |
| 겹친 열쇠를 고르기 | 1 실패 |
| 길이 가드 지우기 | 1 실패 |
| 원래 번호 대신 위치 번호 | 3 실패 |
| 덩어리 없이 통째로 펼치기 | 2 실패 |
| 열쇠에서 범주 빼기 | 3 실패 |
| 군집에도 열쇠 적기 | 1 실패 |
| `SNAPSHOT_NOT_COMPARED` 비우기 | 1 실패 (`experiment.spec.ts`) |

1단계 가드 넷(백본·임베딩 누락·라벨 없는 장수·`imageLoadContext`)은 `image-training.spec.ts`에서 각각 1 실패로 확인했다.

## 제외할 것

- 표(tabular) 프로젝트, 결과 화면의 군집 패널, 재실행 대조(`ml/reproduce*.ts`) — 계획에서 뺐다.
- Safari·저사양 PC 실측 — 할 수 없다. "못 한 것"에 적어라.

## 감사가 되풀이해 잡은 병

1. 유창하게 틀린 주석. 2. 조각마다 초록인데 잇는 검사가 없다. 3. 픽스처가 상태를 미리 주면 그 경로를 안 지나간다 — **진짜 입구로 재현하라.**
4. `toContain`은 자리를 안 본다. 5. `looseObject`가 오타를 숨긴다. 6. 같은 판정을 두 곳에서 계산하거나, 한 벌을 서로 다른 축으로 좁히는 것.
7. 부동소수의 정확 비교와 덧셈 순서. 8. 실측 문장이 표본보다 넓은 것.

`git status --short`에 이 요청서가 미커밋으로 보이는 것은 정상이다.
