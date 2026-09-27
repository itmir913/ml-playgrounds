# `.mlpx` — 구조와 설정 (§0~§4)

> `mlpx-spec.md`에서 갈라져 나온 절이다. **절 번호는 안 바뀌었다.** 전체 차례는 허브(`../mlpx-spec.md`)에 있다.
> **규칙만 적는다.** 이유와 경위는 같은 절 번호로 `docs/cases/mlpx-spec.md`에 있다.

## 0. 이 도구가 무엇인가

> **학생이 데이터를 올려 여러 기계학습 모델을 만들어보고, 결과를 비교하고,
> 새 값으로 시험해보는 플레이그라운드.**

- 모델을 만들고 결과를 보는 것이 본체이고, 글은 부가다. 글쓰기를 강제하는 방향은 배제한다.

```
① 데이터 종류 선택        프로젝트를 만들 때 고른다        (학생이 고른다)
② 데이터 업로드          그 종류의 것만 받는다
③ 과제 유형 선택          분류 / 회귀 / 군집               (학생이 고른다)
④ 선택 가능한 모델 결정    ① ✕ ③ ✕ 실행 가능 위치
⑤ 공통 조건 설정 + 모델 여러 개 체크
⑥ [학습하기] 한 번           브라우저에서 될 것은 로컬, 나머지는 서버로
⑦ 비교표                 같은 분할로 학습됐으므로 공정한 비교
⑧ 예측 시험              저장된 모델 여러 개에 같은 값을 동시 입력. 항상 브라우저
⑨ 저장                   .mlpx 하나
```

- **예측의 산출물은 파일에 기록하지 않는다.** 재현되기 때문이다.
- **학생이 올린 데이터는 언제나 파일 안에 있다** — 학습·채점·예측용 모두. 학생이 예측 결과를
  CSV로 내려받는 것은 이 규칙과 무관하다 (`open-decisions.md` "일괄 예측은 `행 × 모델` 매트릭스다").

### 0.1 선택 가능한 모델은 세 축으로 결정된다

| 축 | 어디서 오나 | 효과 |
|---|---|---|
| `dataTypes` | **프로젝트를 만들 때 정해진다** | 표 프로젝트면 표 데이터용만 |
| `taskTypes` | **학생이 고른다** | 분류를 고르면 분류 모델만 |
| `locations` | 서버 연결 상태 | 서버가 없으면 브라우저에서 되는 것만 |

- **과제 유형을 자동으로 판정하지 않고, 기본값도 두지 않는다.** `manifest.taskType`은 선택 항목이다.
  실험 스냅샷의 `settings.taskType`은 필수다.
- 유형은 열 선택보다 뒤에 오고, 화면에서는 학습에 있다 (`architecture.md` §8.2).
- **성립하지 않는 조합은 거부한다.** 회귀는 타깃이 수치가 아니면 시작하지 않는다(`TARGET_NOT_NUMERIC`).
  거부는 판정이 아니다 — 학생이 고른 것을 바꾸지 않는다.
- `if dataType === 'image'` 같은 분기를 만들지 않는다. **비활성화하되 숨기지 않고** 이유를 함께
  보여준다. 이유의 우선순위는 데이터 타입 > 과제 유형 > 실행 위치다.

### 0.2 학습과 실행은 부담이 다르다

```
학습   브라우저가 기본, 서버는 예외      무겁다
실행   항상 브라우저 (순수 JS)          가볍다. 서버 불필요
검증   브라우저 (해시 + 재실행)          서버 불필요
```

- 서버에서 학습한 모델이라도 **실행은 브라우저에서 한다.**
- **서버가 있어야만 되는 일은 두지 않는다** (CLAUDE.md §1.1).

### 0.3 서버로 가는 것

```
보낸다:  데이터셋 + 공통 설정 + 알고리즘/하이퍼파라미터 + 분할 인덱스
받는다:  지표 + 모델
```

- **`manifest`는 절대 보내지 않는다** (§7).
- **분할 인덱스를 클라이언트가 계산해서 함께 보낸다.**
- 진행 표시는 **모델 단위**다. 보고는 모델마다 **시작할 때 하나, 끝날 때 하나**이고, 시작 보고에는
  그 모델의 실행 방법을 싣는다.
- **백분율은 아무도 만들지 않는다.** 세는 쪽은 클라이언트 하나다.

---

## 1. 파일 구조

`.mlpx`는 zip 아카이브다. 확장자만 다르다.

```
10203_홍길동_붓꽃품종분류.mlpx
├── manifest.json      누가 · 언제 · 무엇을
├── settings.json      현재 편집 중인 설정
├── runs.json          학습 실험과 결과들
├── hashes.json        엔트리별 해시와 contentHash (§7.2.1). 옛 파일에는 없다
├── portfolio/
│   ├── document.json  "나의 AI 모델 정리" 원본
│   └── document.md    사람이 읽는 렌더링
├── model/
│   ├── preprocessor-experiment-2.json
│   ├── run-1.json
│   └── run-2.json
├── embeddings/        이미지 프로젝트에만 있다. 파생물이라 없어도 열린다 (§1.3)
│   └── mobilenet-v2-r2/
│       └── 3f9a….bin
└── dataset/
    └── data.csv       원본 그대로 (해시 재계산 때문에 손대지 않는다)
```

- 포트폴리오 첨부는 `portfolio/attachments/` 아래로 간다. **zip 레이아웃은 v1에서 동결이다** (§9).
- **없으면 열 수 없는 것은 JSON 넷뿐이다**(`manifest`·`settings`·`runs`·`portfolio/document`).
  `portfolio/document.md`·`model/`·`hashes.json`은 없어도 열린다.
- **`dataset/`도 없을 수 있다 — 아직 표를 올리지 않은 프로젝트다.**

> **`settings.data.dataset`과 `dataset/`의 본체는 함께 있고 함께 없다.**

- 참조만 있고 본체가 없으면 `PROJECT_FILE_ENTRY_MISSING`. 본체만 있는 고아는 저장할 때 버린다.
- **모르는 엔트리는 저장할 때 버린다.**

### 1.1 `dataset/` 레이아웃

- **표 데이터의 `data.csv`는 언제나 UTF-8 CSV(BOM 포함)다.** 가져오기 시점에 한 번 정규화하고,
  확정된 뒤로는 누구도 손대지 않는다.
- **구분자는 `,`이고 읽는 쪽은 추정하지 않는다.** `data.csv`·`test.csv`·`predict.csv` 전부 같다.

| 데이터 타입 | 구조 |
|---|---|
| 표 | `dataset/data.csv` |
| 이미지 | `dataset/data/{범주}/{해시}.webp` (V4, 아래 §1.2) |
| 음성 | `dataset/data/{범주}/{해시}.wav` (V8, 미정) |
| 텍스트 | `dataset/data.csv` 또는 `dataset/data/{범주}/` (V9, 미정) |

**학생이 올리는 표는 셋까지다. 이름은 역할로 짓는다.**

| 경로 | 무엇 | 타깃 열 | 없을 수 있나 |
|---|---|---|---|
| `dataset/data.csv` | **훈련 데이터** | 있다 | 표를 아직 안 올렸으면 없다 |
| `dataset/test.csv` | **테스트 데이터** — 점수를 매기는 데 쓴다 | **필수** | 있다 (`split.method`가 `holdout`이면 없다) |
| `dataset/predict.csv` | **예측 데이터** — 답을 모르는 새 줄들 | **없다** | 있다 |

- `predict.csv`만 **올린 열을 전부 담는다** (`open-decisions.md` "검사는 특성 열, 저장은 올린 열 전부").
- 셋 다 같은 길로 정규화되고 `hashes.json`에 각자 항목을 갖는다. `settings.data`의 `dataset`·
  `testDataset`·`predictDataset`이 각각을 가리키며 **본체와 참조는 함께 있고 함께 없다.**

### 1.2 이미지의 `dataset/` — 정본만 담고, 라벨은 구조가 갖는다 (V4, 2026-08-12)

근거는 `open-decisions.md` #4.

```
dataset/
├── data/                     훈련 데이터
│   ├── _unlabeled/           라벨 없음. 예약된 이름이다
│   │   └── 3f9a….webp
│   ├── 개/
│   │   └── 7c21….webp
│   └── 고양이/
│       └── b0e4….webp
├── test/                     테스트 데이터 (split.method가 provided일 때만)
│   ├── 개/
│   └── 고양이/
└── predict/                  예측 데이터. 라벨이 없으므로 한 겹이다
    └── e55d….webp
```

1. **담기는 것은 정본뿐이다.** 업로드 시점에 224×224로 굽고 원본은 안 담는다.
2. **파일 이름은 정본 바이트의 SHA-256(소문자 16진수 64자)이고 확장자는 구운 형식이 정한다** —
   `.webp`가 기본, WebP를 못 굽는 브라우저에서만 `.jpg`. 한 프로젝트에 두 확장자가 섞일 수 있다.
3. **범주는 디렉터리 이름이다. 매핑 테이블을 두지 않는다.**
4. **`_unlabeled/`는 예약된 이름이다.** 학생 범주 이름은 `_`로 시작할 수 없고, 이 이름은 번역하지 않는다.

- `hashes.json`은 이미지 한 장마다 항목을 갖는다. 사진을 옮기면 경로와 해시 항목이 따라 움직인다.
- 음성·텍스트의 포함 정책은 미확정이다 (V8·V9).

### 1.3 `embeddings/` — 백본이 뽑아 둔 숫자 (V4, 2026-08-12)

**임베딩을 파일에 담는다** (`open-decisions.md` "이미지 학습의 모양").

```
embeddings/
└── mobilenet-v2-r2/       백본 id가 디렉터리 이름이다
    ├── 3f9a….bin
    └── 7c21….bin
```

1. **이름은 그 사진의 해시다.** 사진을 옮겨도 임베딩은 안 움직이고, 사진을 지우면 짝도 지운다.
2. **백본 id가 한 겹 위에 있다.** 경로가 곧 출처다.
   - **가중치가 그대로여도 우리 쪽 계약이 바뀌면 id를 개정한다** — 접미사 `-rN`.
   - 디렉터리를 거르는 접두사는 반드시 `embeddings/{id}/`로 **끝에 슬래시가 붙는다.**
   - **등록부에 없는 백본 id의 임베딩은 저장할 때 안 담는다.**
3. **내용은 리틀엔디언 float32 벡터 하나다.** 길이는 등록부의 `embeddingDim`이 말한다. 안 맞으면
   그 사진만 없는 것으로 본다.
4. **`hashes.json`이 항목을 갖는다.**

- **모아서 한 파일에 담지 않는다.**
- **파생물이라 없어도 열린다.** 일부만 있어도 정상이고 없는 것만 다시 뽑는다.
- **뽑는 때는 학습을 누를 때, 없는 것만.**

---

## 2. `manifest.json`

```jsonc
{
  "formatVersion": 3,
  "appVersion": "0.0.0",
  "projectId": "550e8400-e29b-41d4-a716-446655440000",
  "name": "붓꽃 품종 분류",
  "createdAt": "2026-08-04T09:00:00Z",
  "updatedAt": "2026-08-04T10:30:00Z",

  "student": { "studentId": "10203", "name": "홍길동" },   // 선택. 서버로 안 감

  "kind": "machineLearning",
  "taskType": "classification",   // 선택. 아직 안 골랐으면 없다 (§0.1)
  "dataType": "tabular",
  "locale": "ko"
}
```

- **`kind`는 이 프로젝트가 어떤 종류의 포트폴리오인가다.** `taskType`·`dataType`보다 위의 축이다.
  확장자와 어긋나면 `kind`가 이긴다. **어휘가 아니라 등록부 축이라**(§10의 예외) `formatVersion`이
  오르지 않는다. 없으면 `machineLearning`으로 본다. 둘째 종류를 위한 장치는 `open-decisions.md` #20 —
  **그때까지 만들지 않는다.**
- **`locale`은 `portfolio/document.md`의 *머리글*이 렌더링된 언어다.** 내보낼 때마다 갱신한다.
  문항 쪽 언어는 `portfolio.template.locale`이 갖는다 (§8.5).
- **파일을 열 때 앱 언어를 바꾸는 데 쓰지 않는다.**

---

## 3. `settings.json` — 현재 편집 상태

화면에서 만지고 있는 값이다. 학습 시점의 값은 각 실험이 따로 들고 있다.

**두 부분이다 — 공통과 `data`(데이터 종류별)** (`open-decisions.md` "설정 스키마를 데이터 종류별로 가른다").

| | |
|---|---|
| 공통 | `split` · `nSamples` · `runtime` · `selectedAlgorithms` · `hyperparameters` |
| `data` (종류별) | 표: `dataset` · `testDataset` · `predictDataset` · `features` · `target` · `preprocessing` |

- **`data`의 스키마는 등록부가 주고, 종류마다 반드시 있어야 한다.**
- `data.dataset`은 **선택 항목이다.** 나머지 값은 그때도 기본값이 있다.

```jsonc
{
  "data": {                      // 종류별. 아래는 dataType이 "tabular"일 때
    "dataset": {                 // 선택. 표를 올리기 전에는 없다
      "path": "dataset/data.csv",
      "originalFileName": "iris_data_final(1).csv",
      "hasHeader": true,
      "encoding": "utf-8",       // 정본. 언제나 utf-8이다
      "sourceEncoding": "cp949"  // 올라온 파일이 무엇이었는지. 화면 표시용. 엑셀에는 없다
    },
    "features": ["sepal_length", "sepal_width", "petal_length", "petal_width"],
    "target": "species",        // 군집화에는 없다. 과제 유형에 따라 선택 항목
    "preprocessing": { "missing": "drop", "scaling": "standard", "categoricalEncoding": "onehot" }
  },
  "split": { "method": "holdout", "testSize": 0.2, "stratify": true, "randomState": 42 },
  "nSamples": 3000,             // 선택. 없으면 쓸 수 있는 행을 전부 쓴다

  "runtime": "mljs",            // 실험 기본 실행 방법
  "selectedAlgorithms": [
    { "algorithm": "decision_tree" },                     // 기본을 따른다
    { "algorithm": "svm", "runtime": "server-sklearn" }   // 이 모델만 학교 서버로
  ],
  "hyperparameters": {          // 알고리즘 -> 실행 방법 -> 값
    "decision_tree": { "mljs": { "maxDepth": 5 }, "server-sklearn": { "max_depth": null } },
    "svm": { "server-sklearn": { "C": 1.0 } }
  }
}
```

- **`nSamples`는 쓸 수 있는 행 중 몇 개를 뽑아 쓸지다** (`open-decisions.md` #22). `usableRows`로 거른
  다음 분할 전에 뽑는다. **없으면 전부 쓴다.**
- **뽑히지 않은 행의 목록은 적지 않는다.** 씨앗은 `split.randomState`, 층화는 `split.stratify`를 따른다.
- **`split.method`가 `provided`이면 뽑기는 훈련 데이터에만 걸린다** (`open-decisions.md` #30).
- **설정은 학생이 켠 것을 그대로 든다 — 지금 적용되지 않는 것도** (`open-decisions.md` 55).
  `features`에 `target`이 있을 수 있고 `selectedAlgorithms`에 안 맞는 모델이 있을 수 있다. **학습이
  무시하고, 실험 스냅샷(§4)에는 쓴 것만 남는다.** 이 파일을 읽는 다른 도구는 살아 있는 설정의
  `features`에서 타깃을 빼야 한다. 그래서 `formatVersion`이 3이다 (§9.3).
- **실행 방법은 실험 기본을 두고 모델마다 덮어쓴다.** 같은 알고리즘이 두 번 들어갈 수 있다.
  `run.engine`을 기록하고 비교표가 표시한다.
- **하이퍼파라미터의 키는 (알고리즘, 실행 방법)이다.**
- 하이퍼파라미터는 **기본값으로 일괄 학습**하고 고급 설정은 접어 둔다. **엔진에 먹인 값은 전부
  기록한다**(`run.hyperparameters`).
- **기록하는 것은 "엔진에 먹인 인자"이지 "엔진이 내부에서 파생한 수치"가 아니다.** `gamma: 'scale'`은
  그대로 적고, 엔진이 모르는 키도 그대로 기록한다.
- **확정은 학습보다 앞이다.** `fit` 전에 기본값을 채워 run에 적는다. 기본값의 출처는 **엔진 하나뿐**이다.
- `randomState`는 여기 넣지 않는다. 출처는 `split.randomState` 하나이고, 항상 저장한다.

---

## 4. `runs.json` — 실험과 결과

[학습하기]를 한 번 누르면 **실험 하나**가 생기고, 체크한 모델 수만큼 `runs`가 들어간다.
같은 실험은 같은 데이터·전처리·분할을 쓴다.

> **이것을 `batch`라 부르지 마라.** 이름은 MLflow를 따라 `experiment`다.

```jsonc
{
  "experiments": [
    {
      "id": "experiment-2",
      "startedAt": "2026-08-04T10:30:00Z",
      "changed": ["preprocessing.scaling"],      // 직전 실험 대비

      "settings": {                              // 학습 시점 스냅샷
        "taskType": "classification",            // manifest가 아니라 여기를 믿는다
        "runtime": "mljs",                       // 이 실험의 기본
        "selectedAlgorithms": [                  // **요청**한 것. runtime이 항상 채워진다
          { "algorithm": "logistic_regression", "runtime": "mljs" },
          { "algorithm": "svm", "runtime": "server-sklearn" }
        ],
        "data": {                                // 종류별. §3의 settings.data와 같은 등록부
          "features": ["sepal_length", "…"],
          "target": "species",
          "preprocessing": { … }
        },
        "split": { "method": "holdout", "testSize": 0.2, "stratify": true, "randomState": 42 },
        "nSamples": 3000,                        // 선택. §3과 같은 뜻
        "trainIndices": [0, 3, 5, …],            // 환경 무관하게 같은 분할을 보장
        "testIndices": [1, 2, 4, …]
      },

      "preprocessor": {                          // 학습된 전처리 파라미터
        "format": "mlpx-preprocess-v1",
        "path": "model/preprocessor-experiment-2.json"
      },

      "runs": [
        {
          "id": "run-3",
          "algorithm": "logistic_regression",
          "hyperparameters": { "C": 1.0, "max_iter": 100 },
          "computedBy": "browser",
          "trainedAt": "2026-08-04T10:30:04Z",
          "status": "done",                      // done | failed

          "metrics": { "accuracy": 0.9333, "f1Macro": 0.9310 },
          "perClass": [ … ],
          "confusionMatrix": { … },
          "featureImportance": [ … ],
          "engine": { "kind": "…", "version": "…" },  // 재실행 대조는 엔진을 넘지 않는다

          "model": {                             // 없으면 modelOmitted가 이유를 말한다
            "format": "mlpx-linear-v2",
            "path": "model/run-3.json",
            "includesPreprocessing": false,
            "sizeBytes": 1284
          }
        }
      ]
    }
  ]
}
```

- **혼동 행렬은 행이 실제, 열이 예측이다** (sklearn 관례). `matrix[i][j]`는 "실제 `labels[i]`인데
  `labels[j]`로 예측한 개수"이고, 행의 합이 그 클래스의 support다.
- **`perClass`는 범주마다 `label` · `precision` · `recall` · `specificity` · `f1` · `support`를 갖는다.**
  옛 파일에 `specificity`가 없으면 **화면은 그 칸을 비워 둔다** — 0으로 채우지 마라.
- **지표는 반올림하지 않고 그대로 적는다.** 자릿수는 화면이 줄인다. **NaN·Infinity가 나오면 그 run은
  실패여야 한다.**

### 4.1 실험 안에서 일부만 실패할 수 있다

**실험 하나가 통째로 실패하는 일은 없다.**

```jsonc
{ "id": "run-4", "algorithm": "svm", "status": "failed",
  "failure": { "code": "JOB_TIMEOUT", "params": { "limitSeconds": 120 } } }
```

- 실패한 run은 지표도 모델도 없고 **사유는 반드시 있다**(스키마가 강제).
- **스냅샷의 `selectedAlgorithms`는 "요청"이고 각 run의 `computedBy`·`engine`은 "결과"다.** 둘이 다를
  수 있고, 스냅샷에는 `runtime`이 항상 채워져 있다.
- **"최종 모델"을 하나 고르는 개념은 두지 않는다.**

### 4.2 모델 보관 규칙 — 크기 예산

실험 단위가 아니라 **모델 하나하나의 크기**로 정한다. 값은 `limits.ts`에 있다.

```
1. 최신 실험의 모델을 먼저 담는다
2. 남은 예산으로 과거 실험의 모델을 최신순으로 채운다
3. 개별 상한을 넘는 모델은 담지 않는다 (경고 후 지표만)
```

- **전처리기는 그 실험 모델 전체의 전제다.** 못 담으면 그 실험의 모델을 통째로 빼고, 담긴 모델이
  없으면 전처리기도 뺀다.
- **저장은 항상 성공한다.** 예산을 넘으면 모델을 빼지, 저장을 실패시키지 않는다.
- **뺐으면 뺐다고 적는다 — `run.modelOmitted`.** 어휘는 `schema.ts`가 출처다.

| 사유 | 학생이 할 수 있는 일 |
|---|---|
| 합계 예산 초과 | **다시 학습한다.** 최신 실험부터 채우므로 담긴다. 또는 이 프로젝트의 옛 실험을 지운다 |
| 개별 상한 초과 | **다시 학습해도 소용없다.** 나무 개수를 줄이는 등 모델 자체를 작게 만들어야 한다 |
| 직렬화기 없음 | 지금은 없다 |

#### 개별 상한은 **만들기 전에도** 걸린다 (2026-09-19)

- **직렬화기가 옮기기 전에 크기의 하한을 세어 보고, 하한이 이미 개별 상한을 넘으면 아무것도 안 만든다.**
  사유 어휘는 그대로 `tooLarge`다.
- 하한은 `limits.ts`의 `TREE_V2_MIN_BYTES_*`로 센다. **추정이 아니라 하한이다.**

### 4.3 데이터셋을 바꾸면 기존 실험을 지운다

- **데이터셋 교체 시 경고하고 기존 실험을 전부 삭제한다.** 참조형 모델(KNN·SVM)이 행 번호를 가리키기 때문이다.
- IndexedDB 저장은 이 교체를 **한 트랜잭션에서** 처리한다.

---

