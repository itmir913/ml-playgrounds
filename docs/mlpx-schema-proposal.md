# `.mlpx` 스키마 (개정 3판 · 확정안)

> 승인되면 `mlpx-spec.md`로 흡수되고 이 파일은 삭제된다.

---

## 0. 이 도구가 무엇인가

> **학생이 웹에서 데이터를 올려 여러 기계학습 모델을 만들어보고, 결과를 비교하고,
> 새 값으로 시험해보는 플레이그라운드.**
> 여기에 동기와 소감을 덧붙이면 결과적으로 교사가 채점에도 쓸 수 있는 정리물이 된다.

모델을 만들고 결과를 보는 것이 본체이고, 글은 부가다.
글쓰기를 강제하는 방향(체크리스트, 긴 서술 문항)은 배제한다.

---

## 1. 워크플로우

```
① 데이터 업로드              CSV / 엑셀 → (V5) 이미지셋, 음성
        ↓
② 데이터 타입 판정            tabular / image / audio / text
        ↓
③ 선택 가능한 모델이 결정됨    데이터 타입 ✕ 과제 유형 ✕ 실행 가능 위치
        ↓
④ 공통 조건 설정 + 모델 여러 개 체크
        ↓
⑤ [학습] 한 번               브라우저에서 될 것은 로컬, 나머지는 서버로
        ↓
⑥ 비교표                     같은 분할로 학습됐으므로 공정한 비교
        ↓
⑦ 예측 시험                  저장된 모델 여러 개에 같은 값을 동시 입력. 항상 브라우저
        ↓
⑧ 저장                       .mlpx 하나
```

### 1.1 선택 가능한 모델은 두 축으로 결정된다

알고리즘 등록부가 각 항목마다 선언한다.

```jsonc
{
  "id": "random_forest",
  "dataTypes": ["tabular"],
  "taskTypes": ["classification", "regression"],
  "locations": ["browser", "server"],
  "modelFormat": "mlpx-tree-v1"
}
```

| 축 | 효과 |
|---|---|
| `dataTypes` | CSV를 올리면 표 데이터용만, 이미지셋을 올리면 이미지용만 열린다 |
| `locations` + 서버 상태 | 서버가 없으면 브라우저에서 되는 것만 활성화된다 |

`if dataType === 'image'` 같은 분기를 만들지 않는다. 등록부에 항목을 추가하면 화면이 따라온다.

**서버에 연결되지 않아도 수업은 계속된다.** 브라우저에서 되는 모델만 켜지고,
꺼진 것에는 **왜 못 쓰는지 이유가 함께 표시된다**(`client.SERVER_UNAVAILABLE`).

### 1.2 학습과 실행은 부담이 다르다

```
학습   브라우저(Pyodide) 또는 서버      무겁다
실행   항상 브라우저 (순수 JS)          가볍다. 서버 불필요
서명   서버만                          무결성
```

예측은 밀리초 단위다. 서버에서 학습한 모델이라도 **실행은 브라우저에서 한다.**
그래서 파일만 있으면 서버 없이도 시연이 된다.

### 1.3 서버로 가는 것

```
보낸다:  데이터셋 + 공통 설정 + 알고리즘/하이퍼파라미터 + 분할 인덱스
받는다:  지표 + 모델 + 서명
```

**`manifest`는 절대 보내지 않는다.** 학번·이름이 서버로 갈 경로 자체를 만들지 않는다(§7).

**분할 인덱스를 클라이언트가 계산해서 함께 보낸다.** 브라우저와 서버가 각자 분할을 계산하면
sklearn 버전 차이로 테스트셋이 갈릴 수 있고, 그러면 같은 묶음인데 비교가 무의미해진다.

---

## 2. 파일 구조

```
10203_홍길동_붓꽃품종분류.mlpx
├── manifest.json      누가 · 언제 · 무엇을
├── settings.json      현재 편집 중인 설정
├── runs.json          학습 묶음과 결과들
├── portfolio.json     "나의 AI 모델 정리" 원본
├── portfolio.md       사람이 읽는 렌더링
├── model/
│   ├── preprocessor-batch-2.json
│   ├── run-1.json
│   └── run-2.json
└── dataset/
    └── data.csv       원본 그대로 (해시 재계산 때문에 손대지 않는다)
```

---

## 3. `manifest.json`

```jsonc
{
  "formatVersion": 1,
  "appVersion": "0.1.0",
  "projectId": "550e8400-e29b-41d4-a716-446655440000",
  "name": "붓꽃 품종 분류",
  "createdAt": "2026-08-04T09:00:00Z",
  "updatedAt": "2026-08-04T10:30:00Z",

  "student": { "studentId": "10203", "name": "홍길동" },   // 선택. 서버로 안 감

  "derivedFrom": {                  // 남의 파일에서 시작했을 때만
    "projectId": "…",
    "at": "…",
    "hadResults": false,
    "hadPortfolio": false
  },

  "taskType": "classification",
  "dataType": "tabular",
  "locale": "ko"
}
```

---

## 4. `settings.json` — 현재 편집 상태

화면에서 만지고 있는 값이다. 학습 시점의 값은 각 묶음이 따로 들고 있다.

```jsonc
{
  "dataset": {
    "path": "dataset/data.csv",
    "originalFileName": "iris_data_final(1).csv",
    "hasHeader": true,
    "encoding": "utf-8"
  },
  "features": ["sepal_length", "sepal_width", "petal_length", "petal_width"],
  "target": "species",
  "preprocessing": { "missing": "drop", "scaling": "standard", "categoricalEncoding": "onehot" },
  "split": { "method": "holdout", "testSize": 0.2, "stratify": true, "randomState": 42 },
  "selectedAlgorithms": ["decision_tree", "svm", "logistic_regression"],
  "hyperparameters": { "decision_tree": { "max_depth": null }, "svm": { "C": 1.0 } }
}
```

하이퍼파라미터는 **기본값으로 일괄 학습**하고, 고급 설정은 접어 둔다.
학생이 안 건드려도 **실제 쓰인 값은 전부 기록**한다. 그래야 재현된다.

`randomState`는 항상 저장한다.

---

## 5. `runs.json` — 묶음과 결과

[학습]을 한 번 누르면 **묶음 하나**가 생기고, 체크한 모델 수만큼 `runs`가 들어간다.
같은 묶음은 같은 데이터·전처리·분할을 쓰므로 **공정한 비교가 구조적으로 보장된다.**

```jsonc
{
  "batches": [
    {
      "id": "batch-2",
      "startedAt": "2026-08-04T10:30:00Z",
      "changed": ["preprocessing.scaling"],      // 직전 묶음 대비

      "settings": {                              // 묶음 전체 공통 (학습 시점 스냅샷)
        "features": ["sepal_length", "…"],
        "target": "species",
        "preprocessing": { … },
        "split": { "testSize": 0.2, "stratify": true, "randomState": 42 },
        "trainIndices": [0, 3, 5, …],            // 환경 무관하게 같은 분할을 보장
        "testIndices": [1, 2, 4, …]
      },

      "preprocessor": {                          // 학습된 전처리 파라미터
        "format": "mlpx-preprocess-v1",
        "path": "model/preprocessor-batch-2.json"
      },

      "runs": [
        {
          "id": "run-3",
          "algorithm": "logistic_regression",
          "hyperparameters": { "C": 1.0, "max_iter": 100 },
          "computedBy": "browser",
          "trainedAt": "2026-08-04T10:30:04Z",

          "metrics": { "accuracy": 0.9333, "f1Macro": 0.9310 },
          "perClass": [ … ],
          "confusionMatrix": { … },
          "featureImportance": [ … ],
          "integrity": { … },                    // 서버 학습일 때만

          "model": {                             // 없으면 지표만 남은 것
            "format": "mlpx-linear-v1",
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

**"최종 모델"을 하나 고르는 개념은 두지 않는다.** 모델들을 나란히 보는 것 자체가 결과물이고,
하나를 고르라고 하면 "정확도 높은 게 정답"이라는 인상을 준다.

### 5.1 모델 보관 규칙 — 크기 예산

묶음 단위가 아니라 **모델 하나하나의 크기**로 정한다.

```
1. 최신 묶음의 모델을 먼저 담는다
2. 남은 예산으로 과거 묶음의 모델을 최신순으로 채운다
3. 개별 상한을 넘는 모델은 담지 않는다 (경고 후 지표만)
```

| 알고리즘 | 대략 크기 | 결과 |
|---|---|---|
| Logistic Regression, Naive Bayes | 1KB 안팎 | **여러 회차가 남는다** |
| Decision Tree | 수 KB | 여러 회차 |
| KNN, SVM | 수 KB (참조형) | 여러 회차 |
| Random Forest | 수백 KB ~ 수 MB | **최근 것만** |

그래서 학생은 **과거 버전으로도 시험할 수 있고**, 버전별로 여러 개를 골라 동시에 입력할 수 있다.
계수 몇 개짜리 모델을 굳이 버릴 이유가 없다.

**저장은 항상 성공한다.** 예산을 넘으면 모델을 빼지, 저장을 실패시키지 않는다.

### 5.2 데이터셋을 바꾸면 기존 묶음을 지운다

참조형 모델(KNN·SVM)은 `dataset/data.csv`의 **행 번호**를 가리킨다.
데이터를 새로 올리면 그 번호가 다른 것을 가리키게 되어 **조용히 틀린 예측**을 한다.
지표도 다른 데이터 기준이라 비교가 성립하지 않는다.

**데이터셋 교체 시 경고하고 기존 묶음을 전부 삭제한다.**

---

## 6. `model/` — 형식은 가변이다

포맷 계층은 모델 안을 들여다보지 않는다. **어떻게 해석할지만 적어 둔다.**

| `format` | 대상 | 전처리 | 예측에 필요한 것 |
|---|---|---|---|
| `mlpx-tree-v1` | Decision Tree, Random Forest | 밖 | 모델 + preprocessor |
| `mlpx-linear-v1` | Logistic Regression, Naive Bayes | 밖 | 모델 + preprocessor |
| `mlpx-reference-v1` | **KNN, SVM** | 밖 | 모델 + preprocessor + **`dataset/`** |
| `onnx-v1` | V5 이후 딥러닝 | **그래프에 포함** | 모델 하나 |

해석기는 알고리즘 등록부와 같은 방식으로 등록한다. `if format === 'onnx'` 분기를 만들지 않는다.

### 6.1 참조형 — 데이터를 중복 저장하지 않는다

KNN의 모델은 사실상 학습 데이터 전체다. 그런데 그 데이터는 **이미 `dataset/`에 있다.**

```jsonc
// model/run-5.json
{
  "format": "mlpx-reference-v1",
  "algorithm": "knn",
  "hyperparameters": { "n_neighbors": 5, "weights": "uniform", "metric": "minkowski", "p": 2 },
  "trainIndices": [0, 3, 5, …]        // dataset/data.csv 의 행 번호
}
```

SVM도 같다. 서포트 벡터는 학습 데이터의 부분집합이므로 행 번호 + 계수만 담는다.
덕분에 **가장 큰 모델은 KNN이 아니라 Random Forest**가 된다.

### 6.2 모르는 형식을 만나면 파일을 거부하지 않는다

V5에서 만든 파일을 구버전 앱으로 열면 ONNX 모델이 들어 있다.
**파일은 멀쩡히 열리고, 그 모델로 예측만 못 한다.**

```
☑ Random Forest       정확도 96.7%   [예측 가능]
☐ 이미지 분류 모델     정확도 91.2%   ⚠ 이 버전에서는 실행할 수 없습니다
```

`client.MODEL_FORMAT_UNSUPPORTED`. 파일 열기 실패(`PROJECT_FILE_*`)와 성격이 다르다.

---

## 7. 인적사항과 표절 흔적

### 7.1 원칙과 충돌하지 않는다

CLAUDE.md §1.1은 "**서버는** 인적사항을 받지 않는다"이지 "파일에 없다"가 아니다.
학번·이름은 `.mlpx` 안에만 존재하고 서버로 가는 경로를 **구조적으로 막는다.**

1. 학습·예측·검증 요청 타입에 `manifest`를 넣을 수 없게 한다
2. 전송 페이로드에 인적사항 키가 있으면 실패하는 테스트를 둔다
3. `privacy.md`에 "`.mlpx` 파일 자체는 개인정보를 담는다"를 명시한다

### 7.2 둘 다 선택 입력

| | 형식 | 필수 |
|---|---|---|
| `studentId` | 자유 문자열 1~20자 | 아니오 |
| `name` | 텍스트 1~30자 | 아니오 |

숫자 강제는 없다. `1-2-03`, `2026-0101` 같은 학번 체계가 실재한다.

**`required`로 만들지 않는 이유**: 안 쓸 학생은 `0000`을 넣는다.
강제는 입력을 만들지 품질을 만들지 않는다. 반면 교사 시연·독학·동아리에서
"student ID"를 요구받는 건 확실한 장벽이다.

**대신 파일명이 검사 수단이다.**

```
있음 →  10203_홍길동_붓꽃품종분류.mlpx
없음 →  붓꽃품종분류.mlpx
```

학생이 저장 시점에 스스로 알아채고, 교사는 수거 폴더만 봐도 찾아낸다.
`required`는 `0000`을 못 걸러내지만 이건 걸러진다.

### 7.3 표절은 이렇게 드러난다

파일을 열 때 두 갈래를 고른다.

| 고른 것 | `projectId` | `derivedFrom` |
|---|---|---|
| 이어서 작업 (기본) | 유지 | 없음 |
| 이걸 바탕으로 새로 시작 | 새로 발급 | 기록 |

- **학생이 집에서 이어서 함** → 유지. 흔적 없음. 정상
- **교사가 나눠준 빈 파일에서 시작** → `hadResults: false`. 30명이 같은 부모를 가리키고
  그 부모는 비어 있었다 → **정상 배포로 판별**
- **B가 A의 완성본을 복사** → "이어서"면 `projectId` 중복, "새로"면 `hadResults: true`.
  zip을 풀어 `projectId`를 고치면 **서명이 깨진다**(서명 대상에 `projectId` 포함)

세 번째 단서는 `trainedAt` 타임스탬프다. 사람이 자판을 두드린 간격이 초 단위까지
두 번 일치할 확률은 없다.

**한계**: B가 A의 데이터·설정만 받아 처음부터 자기가 돌리면 못 잡는다.
그리고 그건 표절인지 자체가 애매하다. **도구는 신호를 보여주고 판단은 교사가 한다.**

---

## 8. 포트폴리오 — "나의 AI 모델 정리"

열면 이미 채워져 있다.

```
내가 만든 것      붓꽃 품종 분류 · 분류 · 모델 3개
사용한 데이터     iris_data.csv · 150행 5열 · 결측치 0개
가장 좋았던 것    Random Forest 96.7%
가장 중요했던 것  petal_length (44%)
```

학생이 쓰는 것은 5개 빈칸: 동기 / 입출력 설명 / 모델 선택 이유 / 결과 해석 / 소감.
**자기점검 체크리스트는 넣지 않는다.**

```jsonc
// 내장 템플릿
{ "template": { "id": "default-v1" }, "answers": { "motivation": "…" } }

// 교사가 자기 문항을 쓸 때
{ "template": { "id": "custom",
    "sections": [ { "id": "q1", "title": "해결하려는 문제를 정의하시오" } ] },
  "answers": { "q1": "…" } }
```

내장은 로케일 키(`titleKey`), 커스텀은 파일 안 문구(`title`).
i18n 원칙은 내장에만 적용되고 커스텀은 애초에 번역 대상이 아니다.

`.json`이 원본인 이유는 채점 편의가 아니라 **템플릿이 가변이기 때문**이다.
`.md`는 도구 없이 파일만 받은 사람이 읽게 하는 용도다(§1.3).

---

## 9. 마이그레이션

```ts
const MIGRATIONS: Record<number, (p: unknown) => unknown> = { 1: (p) => p }
```

1. **하위 버전은 조용히 올려서 연다.**
2. **상위 버전은 거부한다** — `PROJECT_FILE_VERSION_TOO_NEW`.
   학교 PC와 집 PC의 앱 버전이 다를 때 조용히 깨지는 것보다 낫다.
3. 마이그레이션 함수는 **순수 함수**. 파일 I/O 없이 객체만 변환한다.
4. 버전을 올리는 커밋에 마이그레이션 함수와 테스트가 함께 온다. **CI로 강제한다.**

---

## 10. zod 검증

**`passthrough`를 쓴다.** zod 기본값 `strip`은 구버전 앱이 신버전 파일을 열었다 저장하면
새 필드를 **소리 없이 지운다.**

- **필수** — 없거나 타입이 틀리면 실패. `formatVersion`, `projectId`, `taskType`
- **선택** — 없으면 기본값. `student`, `derivedFrom`, `batches`
- **사용자 데이터** — 컬럼명·클래스 라벨은 **어떤 문자열이든 받는다.**
  한글·공백·특수문자가 오는 건 정상이다. 여기에 검증을 걸면 멀쩡한 데이터가 거부된다.

파일 파싱은 **관대하게**, 폼 입력은 **엄격하게**. 같은 규칙을 두 곳에 똑같이 적용하지 않는다.

---

## 11. 남은 미결정

| # | 항목 | 상태 |
|---|---|---|
| 14 | **엑셀 파일 읽기** | CSV는 Papa Parse 제안. 엑셀은 SheetJS가 필요한데 npm 버전에 CVE가 남아 있다 |
| 2 | 모델 직렬화 | **V1~V4는 자체 JSON 확정.** V5 딥러닝은 ONNX 재검토 |
| — | 여러 프로젝트 비교 화면 | V2. 스키마만 지금 준비 |
