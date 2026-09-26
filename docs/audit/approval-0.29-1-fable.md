# 배포 승인 1 (Fable) — 0.28.4 → 56b0e1b (0.29.0 후보)

**승인** (A 0 · B 3 · C 3)

> **처리 (코드 소유자 세션, `f1994c3`)** — B-1·B-2: `:class` 값 **전체**를 삼항과 견주고, `<StepActionBar>` 여는 태그를
> `ATTRS`로 전수 훑어 바인딩(`:sticky`·`v-bind:sticky`)은 표기부터 막는다. M2·M6을 다시 심어 둘 다 욺을 확인했다.
> B-3: 주석 넷을 "예측 화면이라 모든 폭에서 — 결정문 59의 예외"로. C-1: 예외 문장을 문단 끝으로, `publish()`
> 독스트링에 `sticky`면 바 전체. C-3: `03-screens.md` "한 문장" → "두 문장"; 결정문 59의 **제목은 안 바꿨다**(절 제목은
> 주소다, CLAUDE.md §4 — 본문에 예외가 있다). C-2는 남긴다. 범위 밖 `ExportButton` 휴대폰 이름은 최종 승인 2(Opus)에
> 확인을 맡겼다. 관문: 전체에서 predict-invalidation "필터를 바꾸면" 하나가 부하 빨강 → 격리 4/4 초록 + 남은 단계 초록.

대상: `git log 0.28.4..HEAD` = 4d48e1d(docs) · 76baa01(feat) · 56b0e1b(docs). 세 커밋 모두 GPG 서명 `G`, `Signed-off-by` 있음, 도구 표기 없음.
worktree `agent-aa0683a47b53594b4`에서 읽기·실행만 했다. 원 저장소는 건드리지 않았고(`git status` 깨끗, `?? .claude/worktrees/`만), 돌연변이는 전부 심은 것만 되돌려 worktree도 깨끗하다.

## 관문

`npm run ci > ci.log 2>&1` — **exit 0.** vitest 4222 passed · 2 skipped · 0 failed (169.6s), 로케일 계약 통과, 백엔드 ruff·mypy·pytest 38 통과. 격리 재실행이 필요한 빨강은 없었다.

## 정확성 (읽어서 확인)

- `StepActionBar.vue:147` `sticky`면 `'sticky stick-below-shell'`, 아니면 `{ 'stick-step-bar-strip': $slots.below }`. `publish()`(111–119)는 `position === 'sticky'`·`--step-bar-strip`을 읽으므로 `sticky`일 때 strip 표시가 없어 `cover = offsetHeight` — **바 전체 높이**가 `--step-bar-height`로 나간다. 옳다.
- 그 값을 받는 예측 화면의 자리: `TabularPredictPanel.vue:706`(`under-step-bar md:stick-under-step-bar`)·`:726`(`under-step-bar`). 휴대폰에서 이제 바 전체를 비켜선다. 이미지 예측에는 `under-step-bar`·`scroll-below-shell` 소비자가 없고 `below` 슬롯도 없다(`#below`는 `TrainView.vue:878`뿐). `sticky`와 `below`가 함께 와도 삼항이 strip 클래스를 버리므로 충돌 경로가 없다.
- `sticky` 붙는 자리는 `stick-below-shell`(`top: var(--shell-top)`)이라 `md` 미만에서 도구 막대 아래에 선다. 0.28.4 이전(`da1ca00` 전)의 "통째로 붙던" 모양을 예측 화면에만 되돌린 것이다.
- **접근성(WCAG 2.5.3):** 이름은 `aria-label` = `fromData`로 폭과 무관하게 고정. ko `무작위` ⊂ `무작위로 가져오기`, en `Random` ⊂ `Take a random row`(대소문자 무시) — 보이는 글자가 이름에 들어 있다. 통과.
- **§3 i18n:** `fromDataShort` ko/en 둘 다 있고, 한 문장 한 키, 리터럴 `t('predict.tabular.fromDataShort')`로 불린다. `무작위`는 한자어(無作爲), `copy.md` §2 닫힌 목록 위반 없음(`가져오기`는 0.28.4 이전부터 있던 말).
- 버전 문자열·`FORMAT_VERSION`·엔진 버전 변동 없음(`versions.spec.ts` 초록).

## 지적

### B-1 `frontend/tests/ui-rules.spec.ts:3165` — `sticky` 인구조사가 표기 하나만 본다
- 무엇: `/<StepActionBar\b[^>]*\ssticky\b/`는 불리언 축약 속성만 잡는다. `:sticky="true"`·`v-bind:sticky`는 `\s` 뒤가 `:`라 안 잡힌다.
- 재현: `TrainView.vue:796`을 `<StepActionBar :sticky="true">`로 → 스펙 **초록** (돌연변이 M2). `<StepActionBar sticky>`는 운다(M1).
- 처방: 예외는 정적이어야 하므로 **바인딩 형태 자체를 금지**하는 편이 맞다 — `src/`에서 `/<StepActionBar\b[^>]*(?::|v-bind:)sticky\b/`가 하나라도 있으면 실패, 그리고 인구조사 정규식을 `\s(?::|v-bind:)?sticky\b`로 넓힌다. 그물이 일이 아니라 이름을 보는 병(R28)의 재발이다.

### B-2 `frontend/tests/ui-rules.spec.ts:3158` — `:class` 검사가 부분 문자열이라 덧붙이면 조용하다
- 무엇: `toMatch(/sticky\s*\?\s*'sticky stick-below-shell'…/)`는 삼항이 **어딘가에 있는지**만 본다. 정적 `class`는 접두를 전수 검사(3152–3156)하는데 `:class`는 그렇지 않다.
- 재현: `:class="[sticky ? … : { … }, 'max-md:sticky']"` → 스펙 **초록** (M6). 이 상태면 모든 화면이 휴대폰에서 다시 붙는다 — 결정문 59가 막으려던 바로 그것.
- 처방: 정적 `class`와 같은 방식으로 `:class="…"` 값을 뽑아 **전체가 삼항과 같은지**(`toBe`/앵커 정규식 `^sticky \? … \}$`)를 보라. 또는 `:class` 값에서 `sticky|stick-below-shell` 토큰을 전부 뽑아 삼항의 참 가지 밖에 있으면 실패.

### B-3 단정형 주석이 이 diff로 틀려졌다 (CLAUDE.md §4)
- `frontend/src/views/predict/ImagePredictPanel.vue:664–665` "(`md` 이상에서) 위에 붙인다" — 5줄 아래에서 `sticky`를 줬다.
- `frontend/src/views/predict/TabularPredictPanel.vue:720` "(`md` 이상에서) 붙박이 바가 덮고 있어" — 이제 모든 폭에서 덮는다.
- `frontend/src/views/predict/InputRow.vue:13` "동작 바(`md` 이상에서 화면 위에 붙는다)".
- `frontend/tests/ui-rules.spec.ts:3139–3141` "모든 화면에 같은 규칙이라 컴포넌트 하나와 유틸리티 하나를 본다" — 같은 검사가 이제 `views/` 전부를 훑어 예외를 센다.
- 처방: 넷 다 "예측 화면은 모든 폭에서, 나머지는 `md` 이상에서"로 고치고 `open-decisions.md` 59의 예외를 가리켜라. 코드 변경 없음, 검사 무관.

### C-1 `frontend/src/components/StepActionBar.vue:17` 머리말 문단 흐름
- "`md` 미만에서는 붙지 않고… 59). 예측 화면만 예외라 `sticky`를 받아 통째로 붙는다. 붙박이가 지키려던 것은…" — 끼워 넣은 문장이 앞뒤(게이지 줄 설명) 사이를 끊고 한 줄이 길다. 예외 문장은 문단 끝으로. `publish()` 독스트링(73–77)도 `sticky` 경우("붙었으니 바 전체")를 한 줄 더하면 "CSS가 정한 결과를 읽는다"와 같이 읽힌다.

### C-2 `frontend/src/views/predict/TabularPredictPanel.vue:520` — 이름을 주는 길이 둘이 됐다
- `AppButton`은 `label` prop이 `:aria-label`을 단다(`AppButton.vue:39,124`; `PortfolioView.vue:413`이 그렇게 쓴다). 여기는 fallthrough `:aria-label`로 줬다. Vue가 fallthrough를 루트 props 뒤에 합치므로 동작은 하고(M7이 울어 실제로 단추에 실림을 확인) 다만 같은 부품에 두 길이다. 처방: `:label="t('predict.tabular.fromData')"`로, 그리고 `label` 독스트링 "아이콘만 있는 버튼에 준다"를 "보이는 글자가 이름과 다를 때"로 넓혀라.

### C-3 문서 — 결정문 59와 §8.13.1은 모순 없이 읽히나 근거 문장이 남았다
- `docs/open-decisions.md:326–335` 결정 문단 + 예외 문단: 예외가 명시돼 있어 모순은 아니다. 제목(324)만 "`md` 아래에서 풀고 학습 게이지만 붙인다"라 예외를 안 담는다.
- `docs/architecture/03-screens.md:441` "모든 화면에 같은 규칙이라 교사가 한 문장으로 설명할 수 있고" — 452의 예외 항목과 한 목록 안에 있어 "한 문장" 근거가 이제 거짓이다. "학습·데이터·포트폴리오·점검은 같은 규칙이고 예측만 예외"로 고쳐라. 나머지(`rule-coverage.md:71`, §7.x, §8.9.1 실기기 문장)는 잰 범위·기기·날짜를 문장에 넣고 있어 좋다.

## 돌연변이 표 (스펙 하나만 격리 실행, 심은 것만 되돌림)

| # | 심은 것 | 검사 | 울었나 |
|---|---|---|---|
| M1 | `TrainView.vue` `<StepActionBar sticky>` | ui-rules "동작 바는 md 이상에서만…" | 울음 (`sticky bar outside the predict screens`) |
| M2 | `TrainView.vue` `<StepActionBar :sticky="true">` | 같은 스펙 | **조용** → B-1 |
| M3 | `ImagePredictPanel.vue` `sticky` 제거 | 같은 스펙 | 울음 |
| M4 | `StepActionBar.vue` 정적 class `md:sticky`→`sticky` | 같은 스펙 | 울음 (`the bar sticks on phones again`) |
| M5 | `:class` 거짓 가지 `{}`(게이지 줄 경로 삭제) | 같은 스펙 | 울음 (`the gauge row no longer sticks on phones`) |
| M6 | `:class` 배열로 바꾸고 `'max-md:sticky'` 덧붙임 | 같은 스펙 | **조용** → B-2 |
| M7 | `TabularPredictPanel.vue` `:aria-label` 제거 | predict-invalidation.spec.ts | 울음 (3건 `fromData: expected undefined`) |
| M8 | `en.json` `fromDataShort` 삭제 | `check_locales.py` | 울음 (`missing key predict.tabular.fromDataShort`) |
| M9 | `fromDataShort` 호출을 `fromData`로 | locales.spec.ts | 울음 (`아무 데서도 안 불리는 키가 없다`) |

## 못 본 것

- **실제 레이아웃** — 휴대폰에서 바가 붙어 보이는지, `--step-bar-height`가 실제로 바 전체 높이로 잡히는지, 도착 지점이 안 가리는지는 jsdom이 못 보고 나는 브라우저를 안 띄웠다(규칙). 코드 소유자의 iPhone 11 Pro 실기기 확인(56b0e1b)에 기댄다. 문서가 "그 기기·그 날의 것"이라 못 박은 점은 적절하다.
- fallthrough `aria-label`이 `AppButton`의 `:aria-label="label"`(undefined)보다 우선하는 것은 Vue 합치기 규칙과 M7 결과로 확인했지 별도 검사는 없다.
- `sm` 경계(640px)에서 바가 실제로 한 줄에 서는지 — 실측은 375px 한 점뿐이다.
- `ja` 로케일은 아직 없어 세 번째 언어에서의 짧은 이름표는 못 봤다.
- 범위 밖이라 안 셌다: `ExportButton.vue:106–109`는 `max-md:hidden`으로 글자를 접는데 `label`이 없어 휴대폰에서 아이콘 단추의 이름이 비는 것으로 보인다 — 0.28.4 이전에 승인된 코드라 이번 판정에 넣지 않았다.
