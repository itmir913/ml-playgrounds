# `.mlproj` 포맷 명세

`CLAUDE.md` §1.3의 상세 문서. 프로젝트 파일 포맷과 무결성 서명을 건드릴 때 읽는다.

`.mlproj`는 zip 아카이브다. 확장자만 다르다.
**확장자 문자열은 상수 하나로 관리한다.** 코드에 흩뿌리지 마라 (확장자는 아직 잠정이다).

```
my-project.mlproj
├── manifest.json      프로젝트 메타데이터
├── settings.json      데이터·모델 설정
├── results.json       학습 결과 및 무결성 정보
├── model/             학습된 모델 (예측 기능용)
├── portfolio.md       학생이 작성하는 탐구 기록
└── dataset/           원본 데이터
```

> 아래 JSON은 **예시**다. 정식 타입 정의는 `frontend/src/project/schema.ts`이며,
> 그 파일이 구현된 뒤에는 그쪽이 단일 출처다. 여기 예시와 어긋나면 코드를 믿어라.

---

## 1. `dataset/` 레이아웃

| 데이터 타입 | 구조 |
|---|---|
| 표 | `dataset/data.csv` |
| 이미지 | `dataset/{라벨}/{파일}.jpg` |
| 음성 | `dataset/{라벨}/{파일}.wav` |
| 텍스트 | `dataset/data.csv` 또는 `dataset/{라벨}/` |

**이미지·음성의 포함 정책은 미확정이다 (V5 착수 전 결정 → `open-decisions.md`).**
원본을 그대로 담으면 IndexedDB 할당량과 파일 크기가 모두 감당이 안 된다.
유력한 방향은 원본을 학습 시점에만 전송하고 프로젝트 파일에는 썸네일과 해시·통계만 남기는 것인데,
이 경우 "다시 학습"이 원본 재업로드를 요구하고 **`datasetHash` 재계산이 불가능해져 무결성 검증도 무력해진다.**

---

## 2. `manifest.json`

```json
{
  "formatVersion": 1,
  "appVersion": "0.1.0",
  "projectId": "550e8400-e29b-41d4-a716-446655440000",
  "name": "붓꽃 품종 분류",
  "author": "",
  "createdAt": "2026-08-04T09:00:00Z",
  "updatedAt": "2026-08-04T10:30:00Z",
  "taskType": "classification",
  "dataType": "tabular",
  "locale": "ko"
}
```

- `formatVersion`은 정수. 스키마가 바뀌면 올리고, **마이그레이션 함수를 반드시 같은 커밋에 추가한다.**
- `author`는 **선택 입력이며 기본값은 빈 문자열**이다. 강제하지 않고 서버로 전송하지 않는다 (§1.1).

## 3. `settings.json`

```json
{
  "dataset": { "path": "dataset/data.csv", "hasHeader": true, "encoding": "utf-8" },
  "features": ["sepal_length", "sepal_width", "petal_length", "petal_width"],
  "target": "species",
  "preprocessing": {
    "missing": "drop",
    "scaling": "none",
    "categoricalEncoding": "onehot"
  },
  "split": { "method": "holdout", "testSize": 0.2, "stratify": true, "randomState": 42 },
  "algorithm": "random_forest",
  "hyperparameters": { "n_estimators": 100, "max_depth": null }
}
```

`randomState`는 **항상 저장한다.** 재현 가능성이 교육용 도구의 생명이다.

## 4. `results.json`

```json
{
  "jobId": "87fd39...",
  "trainedAt": "2026-08-04T10:29:00Z",
  "computedBy": "server",
  "engine": { "python": "3.11.9", "sklearn": "1.5.0" },
  "metrics": { "accuracy": 0.9667, "precisionMacro": 0.97, "recallMacro": 0.9667, "f1Macro": 0.9665 },
  "perClass": [{ "label": "setosa", "precision": 1.0, "recall": 1.0, "f1": 1.0, "support": 10 }],
  "confusionMatrix": { "labels": ["setosa", "versicolor", "virginica"], "matrix": [[10,0,0],[0,9,1],[0,0,10]] },
  "featureImportance": [{ "feature": "petal_length", "importance": 0.44 }],
  "integrity": {
    "algorithm": "sha256",
    "datasetHash": "…",
    "settingsHash": "…",
    "resultHash": "…",
    "signature": "…"
  }
}
```

## 5. `model/` — 학습된 모델

**결정됨 (2026-08-04):** 예측 기능(V1 범위)을 위해 학습된 모델을 프로젝트 파일에 담는다.

서버는 학습 후 직렬화된 모델을 **응답으로 내려보내고, 세션이 끝나면 버린다.**
클라이언트는 이를 `.mlproj`에 넣는다. 예측 경로는 두 가지다.

| 상황 | 모델이 어디 있는가 | 예측 방식 |
|---|---|---|
| 세션 중 (방금 학습함) | 서버 메모리에 살아 있음 | 요청만 보내면 즉시 응답 |
| 세션 밖 (저장된 파일을 다시 엶) | `.mlproj`의 `model/` | 모델을 함께 보내 새 세션을 연다 |

세션 수명은 WebSocket 연결 수명과 같다 (`architecture.md` §2.2).
연결이 끊기면 모델도 데이터도 사라진다. 서버 디스크에는 아무것도 남지 않는다.

**미해결:** 직렬화 형식. `pickle`은 역직렬화가 곧 임의 코드 실행이라 **학생이 만든 파일을
서버가 언피클하는 것은 그 자체로 원격 코드 실행 취약점이다.** 후보는 ONNX(`skl2onnx`),
또는 계수·트리 구조만 담는 자체 JSON 포맷. → `open-decisions.md`

---

## 6. `portfolio.md`

학생이 작성하는 탐구 기록. 새 프로젝트 생성 시 다음 항목이 템플릿으로 채워진다.

> 프로젝트 주제 / 시작한 이유 / 데이터 설명 / 데이터 전처리 / 모델 선택 이유 / 결과 분석 / 느낀 점

템플릿 문구는 **하드코딩하지 말고 로케일 파일에서 가져온다** (CLAUDE.md §3).

---

## 7. 무결성 — 위협 모델

**왜 필요한가:** `.mlproj`는 zip이고 수행평가 제출물이다. 학생이 압축을 풀어 `results.json`의
정확도를 고칠 수 있다. "재학습 없이 결과 확인"이 기본 동작이므로 위조 탐지가 필요하다.

**어떻게 동작하는가**

- 서버 학습 시: 서버가 `datasetHash + settingsHash + metrics`에 대해 **HMAC 서명**을 만든다.
  키는 서버 환경 변수(`SIGNING_SECRET`)이며 절대 클라이언트로 나가지 않는다.
- 교사용 화면은 서버에 검증을 요청해 **"검증됨 / 위조 의심 / 미검증"** 세 상태를 표시한다.
- 검증 API는 **상태 코드만 반환**하고 파일 내용을 서버에 저장하지 않는다.
- 브라우저 학습 결과는 `computedBy: "browser"`이고 서명이 없다 → **"미검증"**.
  이는 결함이 아니라 정직한 표시다. 교사가 필요하면 "서버에서 다시 학습"으로 검증본을 만든다.

**막는 것**

- `results.json`의 지표를 손으로 고치는 것 (metrics가 서명 대상이므로 불일치가 드러난다)
- `settings.json`을 바꿔 "다른 설정으로 학습한 것처럼" 꾸미는 것
- 다른 데이터셋의 좋은 결과를 가져다 붙이는 것 (`datasetHash` 불일치)

**막지 못하는 것 — 반드시 인지하고 UI에 과신을 유발하지 마라**

- 서명은 "이 데이터·설정으로 서버가 실제로 계산한 결과"만 보증한다.
  학생이 **데이터를 조작해 서버에 재학습시키면 정상 서명된 위조 결과**가 나온다.
- 교사 화면이 `results.json`에 적힌 `datasetHash`를 그대로 믿으면 검증은 무의미하다.
  **반드시 `.mlproj` 안의 `dataset/`에서 해시를 직접 재계산해 비교해야 한다.**
- 데이터 원본이 빠진 프로젝트 파일(이미지·음성 후보안)은 위 재계산이 불가능하다.
