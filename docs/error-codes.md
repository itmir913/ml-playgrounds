# 코드 레퍼런스

> **단일 출처는 `backend/app/errors.py`다.** 이 문서는 사람이 읽기 위한 사본이다.
> 어긋나면 코드를 믿어라.
>
> `scripts/check_locales.py`가 `errors.py`와 로케일 파일의 **양방향 일치**를 강제한다.
> 코드를 추가하거나 지우면 **같은 커밋에서** `en.json`, `ko.json`, 이 문서를 함께 갱신한다.

명명 규칙: `{도메인}_{문제}` 대문자 스네이크. 이름과 값은 항상 같다(백엔드 테스트가 강제).

---

## ErrorCode — 실패 (로케일 `errors.*`)

**요청**
```
REQUEST_INVALID, ROUTE_NOT_FOUND, METHOD_NOT_ALLOWED
```

**데이터셋**
```
DATASET_TOO_LARGE, DATASET_EMPTY, DATASET_PARSE_FAILED,
DATASET_ENCODING_UNSUPPORTED, DATASET_TOO_MANY_ROWS, DATASET_TOO_MANY_COLUMNS
```

**설정**
```
COLUMN_NOT_FOUND, TARGET_NOT_SELECTED, TARGET_SINGLE_CLASS,
TARGET_TOO_MANY_CLASSES, FEATURE_NOT_SELECTED, FEATURE_ALL_MISSING,
ALGORITHM_UNSUPPORTED, HYPERPARAM_OUT_OF_RANGE, SPLIT_INVALID
```

**작업**
```
JOB_NOT_FOUND, JOB_TIMEOUT, JOB_MEMORY_EXCEEDED, JOB_CANCELLED, JOB_FAILED
```

**서버**
```
SERVER_DISK_INSUFFICIENT, SERVER_BUSY, SERVER_INTERNAL_ERROR
```

**세션** (수명 = WebSocket 연결 수명, `architecture.md` §2.2)
```
SESSION_NOT_FOUND, SESSION_EXPIRED, SESSION_LIMIT_REACHED
```

모든 `ErrorCode`에는 HTTP 상태가 하나씩 대응한다(`errors.py`의 `HTTP_STATUS`).
누락되면 테스트가 실패한다.

---

## 에러가 아닌 코드

같은 규칙(코드만 반환하고 번역은 프런트엔드)을 따르지만 실패가 아니므로 `ErrorCode`가 아니다.

**Stage — 진행 단계** (로케일 `stages.*`)
```
QUEUED → VALIDATING → PREPROCESSING → TRAINING → EVALUATING → DONE
                                                            ↘ FAILED
```

**IntegrityStatus — 무결성 검증 결과** (로케일 `integrity.*`)
```
VERIFIED, MISMATCH, UNSIGNED
```

검증 요청 자체는 성공했고 결과가 셋 중 하나일 뿐이므로 에러가 아니다.

---

## 프런트엔드 전용 코드 (로케일 `client.*`)

서버가 꺼져 있을 때는 서버가 코드를 줄 수 없다. 프로젝트 파일을 여는 것도 브라우저에서
끝나는 일이다. 이런 코드의 단일 출처는 `frontend/src/errors.ts`의 `CLIENT_ERROR_CODES`이고,
로케일의 `client.*`와 양방향으로 일치해야 한다(`tests/locales.spec.ts`가 강제).

**실행 위치**
```
SERVER_UNAVAILABLE, ALGORITHM_NOT_AVAILABLE_HERE, DATASET_TOO_LARGE_FOR_BROWSER
```

**프로젝트 파일 열기**
```
PROJECT_FILE_NOT_ZIP, PROJECT_FILE_ENTRY_MISSING, PROJECT_FILE_INVALID,
PROJECT_FILE_VERSION_TOO_NEW, PROJECT_FILE_VERSION_UNSUPPORTED
```

**모델 실행 / 저장소**
```
MODEL_FORMAT_UNSUPPORTED, STORAGE_QUOTA_EXCEEDED
```

`MODEL_FORMAT_UNSUPPORTED`는 파일 열기 실패와 성격이 다르다. **파일은 멀쩡히 열리고
그 모델로 예측만 못 한다.** → `mlpx-spec.md`

**`errors.*`에 섞지 마라.** CI가 `errors.*`와 `ErrorCode`의 양방향 일치를 강제하므로
백엔드에 없는 코드를 `errors.*`에 넣으면 실패한다.

---

## 응답 형식

```json
{
  "error": {
    "code": "DATASET_TOO_LARGE",
    "params": { "limitMb": 50, "actualMb": 83 }
  }
}
```

- `params`의 키는 로케일 파일의 보간 변수와 1:1로 맞춘다.
  두 로케일의 보간 변수가 다르면 CI가 잡는다.
- `params`에 담기는 것은 숫자와 **사용자 데이터**(컬럼명, 클래스 라벨)뿐이다.
  번역 대상 문장을 담지 마라.
- 실패든 성공이든 응답 모양은 항상 같다. `params`가 없어도 빈 객체로 나간다.

```
errors.DATASET_TOO_LARGE = "데이터 파일이 너무 큽니다. (최대 {limitMb}MB, 현재 {actualMb}MB)"
```

WebSocket 진행 이벤트도 같은 원칙을 따른다.

```json
{ "jobId": "87fd39", "stage": "TRAINING", "progress": 0.42 }
```
