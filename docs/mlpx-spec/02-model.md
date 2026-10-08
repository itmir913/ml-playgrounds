# `.mlpx` — 모델 (§5)

> `mlpx-spec.md`에서 갈라져 나온 절이다. **절 번호는 안 바뀌었다.** 전체 차례는 허브(`../mlpx-spec.md`)에 있다.
> **규칙만 적는다.** 이유와 경위는 같은 절 번호로 `docs/cases/mlpx-spec.md`에 있다.

## 5. `model/` — 형식은 가변이다

포맷 계층은 모델 안을 들여다보지 않는다. **어떻게 해석할지만 적어 둔다.**

| `format` | 대상 | 전처리 | 예측에 필요한 것 |
|---|---|---|---|
| `mlpx-tree-v1` | Decision Tree, Random Forest | 밖 | 모델 + preprocessor |
| `mlpx-tree-v2` | Decision Tree, Random Forest — 잎이 분포를 든다 (§5.3.1) | 밖 | 모델 + preprocessor |
| `mlpx-linear-v2` | Logistic Regression (§5.4.1) | 밖 | 모델 + preprocessor |
| `mlpx-naive-bayes-v1` | Naive Bayes | 밖 | 모델 + preprocessor |
| `mlpx-reference-v1` | **KNN** | 밖 | 모델 + preprocessor + **`dataset/`** |
| `mlpx-svm-v1` | **선형 SVM** | 밖 | 모델 + preprocessor |
| `mlpx-linear-regression-v1` | 선형 회귀 (§5.7) | 밖 | 모델 + preprocessor |
| `mlpx-kmeans-v1` | **K-평균** (§5.10) | 밖 | 모델 + preprocessor |
| `mlpx-neural-v1` | 다층 퍼셉트론 분류 (§5.11) | 밖 | 모델 + preprocessor |
| `mlpx-neural-regression-v1` | 다층 퍼셉트론 회귀 (§5.11) | 밖 | 모델 + preprocessor |
| `onnx-v1` | 딥러닝이 들어온 뒤 | **그래프에 포함** | 모델 하나 |

- 해석기는 등록부로 등록한다. `if format === 'onnx'` 분기를 만들지 않는다.
- **"전처리" 열을 코드가 읽는 자리가 `model.includesPreprocessing`이다.** 형식 이름을 보고 가르지 마라.
  `false`면 전처리기가 없을 때 예측할 수 없고, `true`면 혼자 선다.
- **`format` 하나가 payload 스키마 하나를 결정해야 한다.** 기준은 알고리즘 개수가 아니라 payload
  스키마가 하나인가다.
- 각 형식의 payload는 **만드는 시점에** 여기 적는다.

### 5.0 해석기가 받는 것 (2026-08-06)

| 축 | 묻는 것 | 지금 값 |
|---|---|---|
| `includesPreprocessing` | 전처리기가 필요한가 | 자체 JSON은 전부 `false`, `onnx-v1`이 첫 `true` |
| `needsTrainingRows` | **원본 훈련 행이 필요한가** | 참조형만 `true` |

- **둘 다 불리언이고, 화면은 형식 이름을 절대 보지 않는다.**

```ts
load(file: unknown, context: LoadContext): Predict
```

- `LoadContext`는 **전처리를 마친 훈련 행렬과 그 정답**이다. 호출 방법을 형식마다 나누지 않는다.
- **행을 만드는 것은 해석기가 아니라 부르는 쪽이다.**
- **행이 없으면 예측 못 하는 것이지 파일이 깨진 것이 아니다** — `client.MODEL_NEEDS_DATASET`.
- **데이터는 있는데 학습 때의 행을 못 되세우는 것은 다른 사유다** — `client.MODEL_TRAINING_DATA_CHANGED`.
  학생이 할 일이 다르다: 위는 데이터를 가진 파일로 다시 열고, 이것은 다시 학습한다.

### 5.0.1 담지 못한 모델의 사유도 원문을 남긴다 (2026-08-06)

- **`modelOmittedDetail`(선택, 문자열)을 둔다.** 기술 정보이고 `modelOmitted`의 어휘는 늘리지 않는다.

### 5.1 참조형 — 데이터를 중복 저장하지 않는다

```jsonc
// model/run-5.json
{
  "format": "mlpx-reference-v1",
  "algorithm": "knn",
  "hyperparameters": { "n_neighbors": 5, "weights": "uniform", "metric": "minkowski", "p": 2 },
  "trainIndices": [0, 3, 5, …]        // dataset/data.csv 의 행 번호
}
```

- **행 번호는 헤더를 제외하고 0부터 센다 — `hasHeader`와 무관하게 데이터 행 기준이다.**
  `ml/split.ts`가 이 번호를 만드는 유일한 자리이고, 걸러낸 뒤 다시 세지 마라.
- **모델 파일의 `trainIndices`와 실험 스냅샷의 `experiment.settings.trainIndices`는 다른 것이다.**
  하나를 다른 하나에서 유도하지 마라.

#### 이미지에서 행 번호가 가리키는 것 — `rowsHash`

- 이미지의 행 번호는 **임베딩 표의 자리**다.
- **순서는 zip 경로의 코드 단위 오름차순이다.** 로케일 비교를 쓰지 마라
  (`open-decisions.md` "이미지의 행 순서를 기기에서 떼고, 그 순서를 파일이 기억한다").
- **그 순서를 스냅샷이 `data.rowsHash`로 기억한다.** 늘 적는다 — 옛 앱의 판정과 변경 이력이 이 값을 본다.
- **분류 실험은 행마다의 열쇠를 `data.rowKeys`로 적는다** (`open-decisions.md` 111).
  - 열쇠 하나는 `sha256(범주 + "\n" + 사진 해시)`의 앞 8바이트다. 표의 행 순서대로 이어 붙인 바이트를 base64 문자열 하나로 적는다.
  - **되세울 때는 `trainIndices`가 가리키는 열쇠만 지금 사진에서 찾는다.** 찾으면 사진이 늘거나 줄어도 학습 때와 같은 행이다 —
    번호는 원래 번호를 그대로 쓴다.
  - **훈련에 쓴 사진을 지웠거나 범주를 옮겼으면 열쇠를 못 찾고, 행을 안 내준다.** 범주가 열쇠에 들어 있어서다.
    훈련에 안 쓴 사진(테스트 몫·표본 밖)은 아무도 찾지 않으므로 바뀌어도 행을 내준다.
  - 못 풀거나, 번호가 열쇠 수를 넘거나, 지금 사진에서 열쇠가 겹치면 행을 안 내준다. 문자열이 아닌 값이면 스키마가 파일을 거부한다 — `rowsHash`와 같다.
  - **변경 이력에서 비교하지 않는다**(`SNAPSHOT_NOT_COMPARED`). 열쇠가 바뀌면 `rowsHash`나 범주·장수가 반드시 바뀐다.
  - 군집에는 행이 필요한 모델이 없어 적지 않는다.
- **열쇠가 없는 실험**(이 필드가 생기기 전 파일, 옛 앱이 학습한 실험)은 장수와 `rowsHash`로 본다. `rowsHash`도 없으면 장수만 본다.
  - **장수는 그 표에 들어가는 사진만 본다.** 분류에서 라벨 없는 사진은 표에 없으므로 늘거나 줄어도 막지 않는다.
  - **표에 들 사진의 임베딩이 하나라도 없으면 행을 안 내준다.** 빠진 사진을 건너뛰고 표를 지으면 뒤의 번호가 한 칸씩 당겨진다.
- **학습 때와 백본이 다르면 행을 안 내준다.** 두 경로 모두다.
- 행을 안 내준 모델은 `client.MODEL_TRAINING_DATA_CHANGED`로 꺼진다 — 사진은 있으므로 `MODEL_NEEDS_DATASET`이 아니다.
- 두 필드 모두 선택 항목이라 `formatVersion`은 오르지 않는다(§9.2 "깨지 않는 것").

### 5.2 모르는 형식을 만나면 파일을 거부하지 않는다

- 알고리즘 추가는 **등록부 변경이지 포맷 변경이 아니다.** `formatVersion`이 오르지 않는다.

```
☑ Random Forest       정확도 96.7%   [예측 가능]
☐ 이미지 분류 모델     정확도 91.2%   ⚠ 이 버전에서는 실행할 수 없습니다
```

- `client.MODEL_FORMAT_UNSUPPORTED`. **파일은 멀쩡히 열리고 그 모델로 예측만 못 한다.**
- `algorithm` 이름과 `model.format`은 **스키마에서 검증하지 않는다.**

### 5.3 `mlpx-tree-v1` — 결정트리와 랜덤포레스트

**저장했다가 다시 읽은 모델의 예측이 원본과 하나도 다르지 않아야 한다.**

```jsonc
// model/run-3.json
{
  "format": "mlpx-tree-v1",
  "classes": ["setosa", "versicolor", "virginica"],
  "featureCount": 4,
  "trees": [
    { "nodes": [
      [ 2, 2.45,  1,  2],   // 내부 노드: [열, 임계값, 왼쪽, 오른쪽]
      [-1, 0,    -1, -1],   // 잎:        [-1, 클래스 번호, -1, -1]
      [ 3, 1.75,  3,  4],
      [-1, 1,    -1, -1],
      [-1, 2,    -1, -1]
    ] }
  ]
}
```

판정은 `row[열] < 임계값`이면 왼쪽, 아니면 오른쪽이다. 불변식을 어기면 `client.MODEL_FILE_INVALID`다.

1. **0번이 뿌리다.**
2. **자식 인덱스는 항상 자기보다 크다.**
3. **열 번호는 전처리를 마친 행렬의 열 번호다.** `featureCount`와 안 맞는 입력은 거부한다.
4. **잎의 클래스 번호는 `classes`의 인덱스다.** `classes`는 라벨을 **정렬한** 순서다.

- **나무가 여럿이면 다수결이고, 동점이면 그 표수에 먼저 도달한 나무 쪽이 이긴다.**
- **결정트리는 나무가 하나인 포레스트다.**
- 담지 않는 것: `algorithm`·`hyperparameters`, 잎의 확률 분포, 노드의 gain과 표본 수.
  **중요도는 학습 시점에 `run.featureImportance`에 남기고 모델 파일에서 유도하지 않는다.**
- **다른 엔진의 포레스트는 이 형식이 아니다.**
- **해석기는 학습 라이브러리를 import하지 않는다.**

### 5.3.1 `mlpx-tree-v2` — 잎이 분포를 든다 (2026-09-19)

```jsonc
// model/run-4.json
{
  "format": "mlpx-tree-v2",
  "classes": ["setosa", "versicolor", "virginica"],
  "featureCount": 4,
  "trees": [
    {
      // **v1과 같은 배열이다.** 잎만 뜻이 다르다 — `[-1, 분포 번호, -1, -1]`
      "nodes": [[3, 0.8000000417, 1, 2], [-1, 0, -1, -1], [-1, 1, -1, -1]],
      // 잎마다 클래스 분포. 길이는 classes의 길이이고 합이 1이다
      "leaves": [[1, 0, 0], [0, 0.5, 0.5]]
    }
  ]
}
```

- 예측은 나무마다의 **분포를 평균**해 가장 큰 것, 동점이면 정렬 순서가 앞선 클래스다
  (sklearn `RandomForestClassifier.predict`와 같다).
- 확률 평균 대 다수결은 `tests/tree-v2.spec.ts`의 손으로 만든 숲이 지킨다.
- **`formatVersion`은 안 오르고 마이그레이션도 없다.** `tests/versions.spec.ts`의 `PINNED_FORMATS`가 잠근다.
- **의사결정트리와 순수 JS 엔진은 v1 그대로다.**

불변식은 §5.3의 것에 둘이 더해진다.

5. **`leaves`의 각 줄 길이 = `classes`의 길이.**
6. **잎의 둘째 칸은 `leaves`의 인덱스다.** 범위 밖이면 거부한다.

### 5.4 `mlpx-linear-v1` — 지웠다 (2026-08-15)

- **로지스틱 회귀의 첫 형식이었고, 이제 없다.** 옛 파일은 안 열린다
  (`open-decisions.md` **"`mlpx-linear-v1`을 배포 전에 지운다"**).

### 5.4.1 `mlpx-linear-v2` — 절편이 있고, 높은 점수가 이긴다 (2026-08-10)

```jsonc
// model/run-7.json
{
  "format": "mlpx-linear-v2",
  "classes": ["setosa", "versicolor", "virginica"],
  "featureCount": 4,
  "weights": [                       // 클래스마다 한 줄. 길이는 featureCount. 원래 좌표계다
    [-0.72, -1.58,  2.79,  1.37],
    [-2.34,  3.66, -0.71,  2.03],
    [ 2.34,  1.29, -2.97, -2.19]
  ],
  "intercepts": [0.41, -1.02, 0.66]  // 클래스마다 하나. weights와 같은 순서
}
```

- `score_k = weights[k]·x + intercepts[k]`이고 예측은 **argmax**, 확률은 **softmax**다.
- **동점이면 정렬 순서가 앞선 클래스다.**
- **확률은 언제나 있다.** 로그합지수로 안정화한다.
- **이진 분류도 줄이 두 개다** — `[−w/2, +w/2]`로 나눠 저장한다.

불변식은 해석기가 강제한다. 어기면 `client.MODEL_FILE_INVALID`다.

1. **`weights`의 줄 수 = `classes`의 길이.**
2. **줄의 길이 = `featureCount`.** 안 맞는 입력은 거부한다 (§5.3과 같은 규칙).
3. **`intercepts`의 길이 = `classes`의 길이.**
4. **가중치는 원래 좌표계다.**

- **학습 쪽 예측도 이 형식의 해석기를 그대로 쓴다.**

### 5.5 `mlpx-naive-bayes-v1` — 가우시안 나이브 베이즈 (2026-08-06)

```jsonc
// model/run-9.json
{
  "format": "mlpx-naive-bayes-v1",
  "classes": ["setosa", "versicolor", "virginica"],
  "featureCount": 4,
  "logPriors": [-1.0986, -1.0986, -1.0986],   // 클래스마다. 이미 로그다
  "means":     [[5.0, 3.4, 1.5, 0.2], …],     // 클래스 × 특성
  "variances": [[0.12, 0.14, 0.03, 0.01], …]  // 평활을 **더한 뒤의** 값
}
```

- **로그 공간에서 끝까지 간다.**
- **평활을 더한 뒤의 분산을 담는다.** 재현에 필요한 값은 파일 안에 있어야 한다.
- **정규화 상수 `log(2π·분산)`을 식에서 빼면 안 된다.** `tests/models.spec.ts`가 못 박았다.

불변식 (어기면 `client.MODEL_FILE_INVALID`):

1. `logPriors`·`means`·`variances`의 줄 수가 전부 `classes`의 길이와 같다.
2. `means`와 `variances`의 줄 길이가 `featureCount`다.
3. **분산이 0 이하인 열은 점수에서 건너뛴다.**
4. **동점이면 번호가 작은 클래스가 이긴다.** 엄격한 `>`로 갱신한다.

### 5.6 `mlpx-reference-v1` — KNN (2026-08-06)

```jsonc
// model/run-11.json
{
  "format": "mlpx-reference-v1",
  "k": 5,
  "classes": ["setosa", "versicolor", "virginica"],
  "featureCount": 4,
  "trainIndices": [0, 3, 5, …]     // dataset/data.csv 의 행 번호 (§5.1)
}
```

- **이 형식만 `needsTrainingRows: true`다** (§5.0).

#### KNN은 우리가 구현한다 (2026-08-06)

- **`ml-knn` 의존성을 쓰지 않는다.** 학습할 때와 파일에서 읽었을 때가 같은 코드를 쓴다.

#### 동점 규칙 셋 — 어떤 입력에도 답이 하나로 정해진다

1. **k개 이웃을 거리순으로 고른다.** 거리가 같으면 **행 번호가 작은 쪽**이 먼저다.
2. **최다 득표 클래스가 이긴다.**
3. **득표가 같으면 정렬 순서가 앞선 클래스가 이긴다** — sklearn `KNeighborsClassifier`와 같다.
   **"정렬"은 라벨을 문자열로 본 코드 포인트 순서다** (open-decisions.md 61) — `"1" < "10" < "2"`.
   새 엔진은 라벨을 문자열로 넘겨야 한다.

- 거리는 **제곱근을 씌우지 않은 제곱 거리**로 비교한다.

#### k번째까지만 고른다 — 완전 정렬하지 않는다

- 크기 k로 제한한 최대 힙에 (거리, 행 번호)를 넣는다. **힙에 넣는 순서도 (거리, 행 번호)의 사전식 전순서다.**
- 득표 집계는 클래스마다 개수만 든다.

### 5.7 `mlpx-linear-regression-v1` — 선형 회귀 (2026-08-06)

```jsonc
// model/run-13.json
{
  "format": "mlpx-linear-regression-v1",
  "featureCount": 2,
  "coefficients": [2.0, 3.0],   // 특성마다 하나
  "intercept": 1.0
}
```

- 예측은 `Σ(특성 × 계수) + 절편`이다. **`classes`가 없다.**
- **절편을 계수 배열에 섞지 않는다.**

### 5.8 `mlpx-svm-v1` — 선형 서포트 벡터 머신 (2026-08-06)

```jsonc
// model/run-17.json
{
  "format": "mlpx-svm-v1",
  "classes": ["setosa", "versicolor", "virginica"],   // 정렬 순서
  "featureCount": 4,
  // 클래스 쌍마다 하나. a·b는 classes의 인덱스이고 **a < b다.**
  "classifiers": [
    { "a": 0, "b": 1, "weights": [0.4, -1.2, 2.0, 0.9], "intercept": -0.3 }
  ]
}
```

- 쌍마다 **양수면 `b`, 음수면 `a`에 한 표**. **동점은 결정함수 값의 합으로 가르고**, 그래도 남으면 클래스 이름 순.
- **다중 클래스는 one-vs-one이다** (`SVC`와 같다).
- **정규화(whitening)를 payload에 담지 않는다.** 가중치와 절편에 접어 넣는다. 폭이 0인 열은 1로 둔다.

### 5.9 수렴하지 못한 학습은 실패가 아니다 — `run.warning` (2026-08-06)

- 반복 예산 안에 수렴하지 못하면 **`status`는 `done`이고 `warning`을 붙인다.** 모델도 담긴다.
- 코드: `SVM_NOT_CONVERGED`(반복 예산을 다 썼다 — 최적점 보증이 아니다) · `LOGISTIC_NOT_CONVERGED`
  (`maxIter`에 닿았다, `max|기울기| ≤ tol`로 판정) 등. 전체 목록은 `frontend/src/errors.ts`의 `CLIENT_WARNING_CODES`다. SMO 정지 조건은 `open-decisions.md` #26.
- 로지스틱 경고에 학생이 할 일은 **전처리 스케일링**이다.

```jsonc
{ "id": "run-17", "status": "done", "metrics": { … },
  "warning": { "code": "SVM_NOT_CONVERGED", "params": { "iterations": 10000 } } }
```

- **자연어가 아니라 코드다** (CLAUDE.md §1.4).
- **`failure`와 합치지 않는다.**

### 5.10 `mlpx-kmeans-v1` — K-평균 (V3, 2026-08-11)

```jsonc
// model/run-21.json
{
  "format": "mlpx-kmeans-v1",
  "featureCount": 2,
  "k": 3,                          // 군집 수. centroids.length와 같아야 한다
  "centroids": [                   // centroids[c][j] = 군집 c의 특성 j
    [0.5, 0.0],
    [10.5, 10.0],
    [5.0, 5.0]
  ]
}
```

- **담기는 것은 중심점뿐이다.** `needsTrainingRows: false`.
- **돌려주는 것은 문자열이다** (`"0"`, `"1"`, …).

불변식 (`ml/models/kmeans.ts`의 `loadKMeansModel`, 어기면 `MODEL_FILE_INVALID`):

1. `featureCount`가 정수이고 0보다 크다
2. `k`가 정수이고 0보다 크다
3. `centroids.length === k`
4. 중심점마다 길이가 `featureCount`이고 값이 전부 유한하다

- **`classes`가 없다.** 번호는 이름이 아니라 자리다.
- **빈 군집은 파일에 오지 않는다.** 데이터보다 군집이 많은 요청은 `CLUSTER_TOO_FEW_ROWS`로 거부한다.

### 5.11 `mlpx-neural-v1` · `mlpx-neural-regression-v1` — 다층 퍼셉트론 (2026-09-03)

```jsonc
// model/run-31.json — 분류
{
  "format": "mlpx-neural-v1",
  "classes": ["가반", "나반"],
  "featureCount": 3,
  "weights": [                     // weights[층][들어오는 칸][나가는 칸]
    [[0.12, -0.4, ...], ...],      // 층 0: 3 x 100
    [[0.7], [-0.2], ...]           // 층 1: 100 x 1  (이진이라 출력이 한 칸)
  ],
  "intercepts": [[...100개...], [0.03]],
  "lossCurve": [0.81, 0.74, ...]   // 에폭마다의 훈련 손실
}
```

```jsonc
// model/run-32.json — 회귀. `classes`가 없고 출력이 언제나 한 칸이다
{
  "format": "mlpx-neural-regression-v1",
  "featureCount": 3,
  "weights": [ ... ],
  "intercepts": [ ... ],
  "lossCurve": [12.4, 9.8, ...]
}
```

- **층 하나가 `weights` 한 칸이다.** `weights[층][i][j]`는 `i`번째 입력에서 `j`번째 출력으로 가는 가중치다.
- 출력 칸: 분류는 **이진이면 한 칸**, 다중이면 클래스 수만큼. 회귀는 **언제나 한 칸**이고 활성이 항등이다.
- 두 형식은 **층을 흘리는 계산만 공유하고 출력 활성을 함수로 받는다** (`ml/models/neural.ts`).
- **`lossCurve`는 sklearn의 `loss_curve_`와 같은 것이다.** 모델을 못 담은 실행에는 곡선도 없다.
- **하이퍼파라미터를 안 담는다.**

불변식 (`ml/models/neural.ts`, 어기면 `MODEL_FILE_INVALID`):

1. `featureCount`가 정수이고 0보다 크다
2. `weights.length === intercepts.length` (층 수가 같다)
3. 첫 층의 들어오는 칸이 `featureCount`이고, **층마다 나가는 칸이 다음 층의 들어오는 칸이다**
4. 값이 전부 유한하다
5. 마지막 층의 나가는 칸이 — 분류면 `classes.length === 2 ? 1 : classes.length`,
   회귀면 `1`

---
