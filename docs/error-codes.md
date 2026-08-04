# 에러 코드 레퍼런스

> **단일 출처는 `backend/app/errors.py`의 `StrEnum`이다.** 이 문서는 사람이 읽기 위한 사본이다.
> 어긋나면 코드를 믿어라. 장기적으로는 `errors.py`에서 자동 생성하는 것을 목표로 한다.
>
> 새 코드를 추가하면 **같은 커밋에서** `errors.py`, `frontend/src/locales/en.json`,
> `ko.json`, 이 문서를 함께 갱신한다.

명명 규칙: `{도메인}_{문제}` 대문자 스네이크.

---

## 초기 코드 목록 (`errors.py` 구현 시 그대로 옮긴다)

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

**무결성**
```
INTEGRITY_VERIFIED, INTEGRITY_MISMATCH, INTEGRITY_UNSIGNED
```

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

`params`의 키는 로케일 파일의 보간 변수와 1:1로 맞춘다.

```
errors.DATASET_TOO_LARGE = "데이터 파일이 너무 큽니다. (최대 {limitMb}MB, 현재 {actualMb}MB)"
```

## WebSocket 단계 코드

```
QUEUED → VALIDATING → PREPROCESSING → TRAINING → EVALUATING → DONE
                                                            ↘ FAILED
```

로케일 키는 `stages.*`.
