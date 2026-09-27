# 결정됨 — 첫 얼개 (2026-08-04)

> `open-decisions.md`의 **결정됨**이다. 색인은 그 허브에 있다.
>
> **통독하지 마라.** 다른 문서나 코드가 제목으로 가리킬 때 그 항목만 편다.
> **제목은 주소다 — 한 번 적은 제목을 바꾸지 마라.**

> **상태와 요지만 적는다.** 결정문마다 `[미정]`·`[결정]` 한 줄과 요지 두 줄 이하만 두고, 무엇을 재고 무엇을 기각했는지는 같은 제목 아래 `docs/cases/open-decisions.md`에 있다.

### 모바일에서도 동작한다 (2026-08-04)

**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.
**학생이 쓰는 기기는 학교 PC만이 아니다.**

### 모델 직렬화는 자체 JSON, ONNX는 이미지 단계부터 (2026-08-04) — #2 마무리

**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.
**이미 `mlpx-spec.md` §5에 표로 정해져 있었다.**

### 브라우저 학습 엔진은 둘 다 간다 (2026-08-04) — #3 마무리

**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.
**순수 JS(ml.js 계열)가 기본이고, scikit-learn(Pyodide)은 학생이 명시적으로 켜는 선택지다.**

### 성능이 낮다는 이유로 알고리즘을 빼지 않는다 (2026-08-04)

**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.
순수 JS 구현이 sklearn보다

### 무거운 엔진은 상태 점검에서 학생이 켠다 (2026-08-04)

**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.
**페이지를 열자마자 자동으로 받지 않는다.**

### 학습은 언제나 백그라운드다 — 화면이 멈추면 안 된다 (2026-08-04)

**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.
**실행 방법이 무엇이든 학생에게 "멈췄다"는 느낌을 주지 않는다.**

### 실행 방법은 (위치 × 엔진)이 아니라 하나의 목록이다 (2026-08-04)

**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.
백엔드가 붙으면 결정트리 하나에 실행 방법이 셋이 된다

### 공식 배포에는 서버가 없다 (2026-08-04)

**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.
**공개 배포는 GitHub Pages 정적 페이지 하나뿐이다.**

### 무결성은 해시와 재실행 대조로 한다 — 서명은 만들지 않는다 (2026-08-04)

**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.
**HMAC 서명·전자서명을 넣지 않는다.**

### 해시는 `hashes.json` 별도 엔트리에 둔다 (2026-08-04)

**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.
자기 자신을 해싱 대상에서 빼야 하므로 별도 엔트리다.

### 재실행 대조는 엔진을 넘지 않는다 (2026-08-04)

**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.
각 run에 **엔진 종류와 버전을 기록**하고, 대조는 그 run을 만든 엔진으로만 한다.

### 정본 데이터셋은 언제나 UTF-8 CSV다 (2026-08-04)

**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.
**업로드 형식과 인코딩은 import 시점에 딱 한 번 정규화되고, 그 뒤로는 아무도 모른다.**

### 표 파일 파서는 라이브러리에 맡긴다 (2026-08-04) — #14 마무리

**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.
직접 구현하지 않는다.

### 파싱은 두 단계이고 파일은 한 번만 읽는다 (2026-08-04)

**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.
`openTable()`이 파일을 한 번 열어 핸들을 주고, 미리보기와 본 파싱이 그 핸들을 공유한다.

### 인코딩 판정과 지원 목록 (2026-08-04) — #15 마무리

**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.
`SOURCE_ENCODINGS`(`data/encoding.ts`)가 유일한 출처다: `utf-8`, `cp949`, `utf-16le`, `utf-16be`.

### 인코딩은 자동으로 판정한다 (2026-08-04)

**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.
**한국 윈도우의 엑셀에서 "CSV로 저장"하면 UTF-8이 아니라 CP949다.**

### 상위 버전 파일은 거부한다 (2026-08-04)

**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.
신버전이 만든 `.mlpx`를 구버전 앱이 열지 못하게 막는다.

### 상한값은 상수 한 곳에서만 (2026-08-04)

**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.
프런트엔드의 크기·개수 상한은 `frontend/src/limits.ts`가 유일한 출처다.

### IndexedDB 여유 공간 사전 검사 (2026-08-04)

**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.
데이터셋을 쓰기 전에 `navigator.storage.estimate()`로 확인하고 부족하면 `STORAGE_QUOTA_EXCEEDED`로 거부한다.

### 백엔드 코드의 한국어 (2026-08-04)

**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.
**주석과 docstring은 한국어로 써도 된다.**

### 예측 기능의 모델 보관 (2026-08-04)

**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.
서버가 학습 후 직렬화된 모델을 클라이언트로 내려보내고, 클라이언트가 `.mlpx`에 담는다.

### 문서 언어 (2026-08-04)

**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.
`docs/`와 `CLAUDE.md`는 한국어.

### 파일 확장자: `.mlpx` (2026-08-04)

**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.
`.docx` / `.pptx` / `.hwpx` 계열로 읽히고 **그 포맷들도 실제로 zip**이라 이름이 구조와 일치한다.

### zip 라이브러리: fflate (2026-08-04)

**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.
gzip 기준 약 8KB로 가장 가볍고 빠르다.

### 런타임 검증: zod (2026-08-04)

**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.
`.mlpx`는 외부에서 들어오는 파일이다.

### Python 하한 3.12 (2026-08-04)

**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.
numpy 2.x 스텁이 `type` 문 등 3.12 문법을 쓴다.

### IntegrityStatus를 ErrorCode에서 분리 (2026-08-04)

**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.
"검증됨"은 실패가 아니라 상태다.
