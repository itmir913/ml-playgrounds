# R43-6 슬라이스 감사 — backend · frontend/scripts · frontend/public · .github/workflows · 로케일 계약 (기준 `a81ccf9`) — **CLEAN WITH C** (C 4)

> 독립 감사자의 회신을 오케스트레이터가 옮겨 적었다. 요청서 `request-R43.md`. 돌연변이 22개 — 안 운 것은 C-1의 넷(M1~M4),
> C-2의 M10, 결정성만 걸린 M7(`fields` 정렬), 등가 M16(node http가 HEAD 몸을 버림). 백엔드는 0.33.0 이후 바뀌지 않았고
> pytest·ruff·mypy 기준선이 초록이다. 축 2(`.mlpx` 압축·워커 회귀)는 이 슬라이스에 자리가 없다. `Deploy frontend`는 받은 ref를
> 그대로 관문에 돌리고 같은 `dist/`를 올린다.

## 지적과 처리 (넷 다 고침)

### C-1. `check_locales.py`의 판정을 위반 입력으로 부르는 테스트가 없다
- 위반 판 셋이 `check()`를 안 부르고 집합 뺄셈을 다시 써서, 검사 넷 중 어느 것을 뭉개도 pytest가 초록이었다. 백엔드 `ErrorCode`와
  로케일의 양방향 일치는 이 스크립트 하나만 본다.
- 고침: `test_check_locales.py`가 `errors.py`와 로케일을 임시 폴더로 베끼고(`monkeypatch`) 위반 하나를 심어 `check()`를 부른다 —
  키 누락·보간 변수·복수형·코드 누락·잔재 코드 다섯 판. 돌연변이 5(검사 1~4와 아래 2b를 끔) 모두 욺.

### C-2. 복수형의 형태마다 보간 변수가 같은지 보지 않는다
- 합집합으로 견주어 한 형태에서만 `{count}`·`{name}`이 빠져도 지나갔다(M10).
- 고침: `check_locales.py`에 검사 2b — ` | `로 가른 형태마다 자리표시자 집합이 같다. 지금 en의 복수형은 모두 맞다.
  `locales.spec.ts` 쪽에는 더하지 않았다 — CI가 스크립트를 돌리고 pytest가 문다.

### C-3. Dependabot 건너뛰기를 작성자 이메일 위장으로 통과할 수 있다는 의심
- 서명 검증은 커미터 쪽을 묶으므로 작성자 이메일만 봇으로 적고 제 키로 서명한 커밋도 verified가 될 수 있다(감사자의 지식, 실측 못 함).
- 고침: `gate.yml` DCO 잡이 **PR을 연 계정이 `dependabot[bot]`일 때만** 봇 커밋을 건너뛴다(`pull_request.user.login`은 기여자가
  고를 수 없다). 봇 PR에 사람이 얹은 커밋은 여전히 검사한다. 무는 검사는 없다 — 실제 봇 PR이 다음에 올 때 `skip … (dependabot)`이
  그대로 찍히는지 본다.

### C-4. 앱 밖 두 페이지가 `?lang=constructor`를 지원 언어로 받는다
- `404.html`·`legal/index.html`의 `messages[x]` 판정이 상속 속성을 참으로 받아 제목이 `undefined`가 되었다.
- 고침: 두 페이지에 `has(code)`(`hasOwnProperty`)를 두고 세 판정이 그것을 부른다. `not-found-page.spec.ts`의 언어 표에
  `?lang=constructor`·`?lang=__proto__` 줄을 더했고 `has`를 `messages[code]`로 되돌리는 돌연변이가 운다. 규정 서랍은 스크립트를
  돌리는 검사가 없어 같은 판정을 코드로만 맞췄다.

## 기록만 한 것
- `deploy.yml`은 ref가 태그인지 막지 않는다(`--ref main`도 빌드해 내보낸다). 문서 §4의 규칙이고, 관문에 넣을지는 결정이 걸린다.
- `github-pages` 환경의 보호 설정은 원격 설정이라 보지 못했다.
- 머지 커밋 건너뛰기(`parents > 1`)는 기여자가 브랜치에 만든 머지 커밋도 건너뛴다 — 0.33.0 이전부터의 동작.
