# 배포 승인 2 (Opus) — 0.28.4 → f1994c3 (0.29.0 후보)

**승인** (A 0 · B 2 · C 6, 그중 C 둘은 0.28.4 이전 코드)

> **처리 (코드 소유자 세션, `5fc50f0`)** — B-1: 잰 값 표 아래에 "예측 칸의 '후' 659는 예외 전의 값, 새 값은 아직
> 안 잼(사람 확인)"을 밝혔다. B-2: `tests/step-action-bar.spec.ts` — 바를 띄워 속성이 없으면 접두 없는
> `sticky`·`stick-below-shell`이 없고 `sticky`를 주면 있는지 본다. M6(`withDefaults(…, { sticky: true })`)을 다시 심어
> 욺을 확인했다. **C 여섯은 소유자 지시대로 남긴다** — C-6(`ExportButton`·`ProjectStatus` 휴대폰 이름)은 0.28.4 이전부터의
> 접근성 결함이라 다음 주기의 입력이다. 관문 전체 초록(216파일 4,224).

대상: `git log 0.28.4..HEAD` = 4d48e1d(docs) · 76baa01(feat) · 56b0e1b(docs) · f1994c3(test/주석). 네 커밋 모두 GPG `G`, `Signed-off-by` 있음, 도구 표기 없음. 문서 커밋이 구현보다 먼저다.
worktree `agent-a959c303bb7b139e0`(처음엔 56b0e1b에 있어 f1994c3으로 detach 이동)에서 읽기·실행만 했다. 원 저장소는 건드리지 않았고, 돌연변이는 전부 심은 것만 되돌렸다(`git status` 깨끗). node_modules 정션은 떼었다(원본 온전).

## 관문

`npm run ci > ci.log 2>&1` — **EXIT 0.** vitest 215 files · 4222 passed · 2 skipped · 0 failed, fixtures:check·build·contracts·backend(ruff·mypy·pytest 38) 전부 초록. 격리 재실행이 필요한 빨강 없음.
(돌연변이 중 여러 파일을 함께 돌렸을 때 `predict-invalidation.spec.ts`가 두 번 부하로 빨갰고, 격리하면 4/4 초록 — 알려진 흔들림과 같다.)

## 정확성 (읽어서 확인)

- `StepActionBar.vue:149` `sticky`면 `'sticky stick-below-shell'`, 아니면 strip. `stick-below-shell`은 `top: var(--shell-top)`이고 `md` 미만에서 `--shell-top` = 도구 막대 높이(`base.css:63-70`)라 도구 막대 바로 아래에 선다.
- `publish()`(113–121): `sticky`면 `position === 'sticky'`, strip 표시 없음 → `cover = offsetHeight` = 바 전체(`pt-4` 포함). 붙었을 때 화면을 덮는 높이와 같다. 옳다.
- 소비자: `TabularPredictPanel.vue:706`(`under-step-bar`, 휴대폰에서도 `scrollIntoView` 목표)·`:726`. 이제 바 전체를 비켜선다. 이미지 예측에는 `under-step-bar`·`scroll-below-shell` 소비자도 `below` 슬롯도 없다. `sticky`+`below`가 와도 삼항이 strip을 버리므로 충돌 경로 없음.
- 예측 화면 아래 다른 붙박이와 겹침: `AppTable`에는 붙박이 머리글이 없고(`overflow-auto`만), 예측 폴더에 다른 `sticky`는 `md:` 전용뿐 — 휴대폰에서 바 뒤로 숨는 것 없음. 팝오버·대화상자는 `z-50`으로 바(`z-20`) 위.
- 표·값/표·파일 `v-if`/`v-else` 교체 시 높이 변수: 이전 바의 `onBeforeUnmount`가 지우고 새 바의 `onMounted`가 다시 쓴다(순서 옳음, 0.28.4 이전과 같음).
- **접근성(WCAG 2.5.3):** `aria-label` = `fromData`가 폭과 무관하게 이름. ko `무작위`는 `무작위로 가져오기`의 **앞머리**, en `Random`은 `Take a random row` 안(대소문자 무시)에 있다 — 통과. en은 앞머리가 아니라 권고 수준에서만 약하다(음성 명령 "click Random"은 부분 일치에 기댄다). 판정에 안 넣었다.
- **§3 i18n:** 새 키 하나, ko/en 둘 다, 리터럴 호출, 한 문장 한 키. `무작위`는 한자어(無作爲)라 `copy.md` §2 닫힌 목록과 무관, `가져오기`는 목록 안.
- 버전 문자열·포맷·엔진 버전 변동 없음.

## 첫 승인자(Fable)의 B가 실제로 고쳐졌나 — 내 돌연변이로 재확인

- B-1(바인딩 `:sticky` 조용): 고쳐짐 — M7이 운다(`bound sticky on the action bar`).
- B-2(`:class` 덧붙임 조용): 고쳐짐 — M5가 운다(`:class` 값 전체를 `toBe`로 견준다).
- B-3(주석 넷): `ImagePredictPanel.vue:664-665`, `TabularPredictPanel.vue:720`, `InputRow.vue:13`, `ui-rules.spec.ts:3139-3142` 전부 새 규칙을 말한다. 고쳐짐.
- C-3(03-screens "한 문장"): "두 문장"으로 고쳐짐. C-2(fallthrough `aria-label`)는 남겼다고 적혀 있고 실제로 남아 있다(아래 C-3).

## 지적

### B-1 `docs/architecture/03-screens.md:465-466` — 잰 값 표의 "예측 · 후 659"가 이 diff로 거짓이 됐다
- 무엇: 표의 "375×812 후" 줄은 **모든 화면에서 바가 안 붙던** 상태(59 결정 직후)에서 잰 값이다. 이번 예외로 예측 화면의 바는 휴대폰에서 다시 통째로 붙으므로, 예측 칸의 읽는 높이는 659가 아니라 바 높이만큼 준 값이다(`[무작위]`로 바가 한 줄이 되어 전의 518보다는 크겠지만 잰 적이 없다). 바로 아래 문단(469–477)은 실기기 확인을 적으면서 표는 그대로 두어, 표가 "잰 값"이라는 이름으로 현재 코드와 다른 수를 말한다. 이 저장소가 가장 위험하다고 적은 **유창하게 틀린 잰 값**이다(CLAUDE.md §4).
- 재현: 읽기. `TabularPredictPanel.vue:515,543`·`ImagePredictPanel.vue:670`의 `sticky` → `StepActionBar.vue:149`에서 모든 폭 `sticky`.
- 처방: 예측 칸 "후"를 다시 재서 적거나, 최소한 "659는 예외 전(2026-09-26 오전) 값 — 예외 뒤 예측은 바가 붙어 다시 재야 한다(사람 확인)"로 표에 각주를 단다. 452–456의 예외 항목도 이 표를 가리키게.

### B-2 `frontend/tests/ui-rules.spec.ts:3169-3184` — 인구조사가 템플릿 표기만 봐서, 기본값을 바꾸면 모든 화면이 휴대폰에서 다시 붙어도 조용하다
- 무엇: 검사는 `<StepActionBar … sticky>`를 쓴 **파일**을 세고, 컴포넌트의 정적 class·`:class` 문자열을 본다. 그러나 `sticky`의 **기본값**은 안 본다. `withDefaults(defineProps<…>(), { sticky: true })` 한 줄이면 학습·데이터·포트폴리오·점검 화면이 전부 휴대폰에서 통째로 붙는데(결정문 59가 막으려던 것), 템플릿 표기는 그대로라 그물이 안 문다. R28의 "그물이 일이 아니라 이름을 본다"와 같은 병.
- 재현(M6): `StepActionBar.vue:53`을 `withDefaults(defineProps<{ sticky?: boolean }>(), { sticky: true })`로 → `ui-rules.spec.ts` 264/264 **초록**, `option-cascade`·`kinds`·`shell` 46/46 초록. eslint·vue-tsc도 막을 이유가 없다.
- 처방: 결과를 보는 검사 하나 — `// @vitest-environment jsdom` 스펙에서 `StepActionBar`를 속성 없이 마운트해 루트 class 목록에 접두 없는 `sticky`·`stick-below-shell`이 **없음**을, `sticky`를 주고 마운트하면 **있음**을 단언한다(rule-coverage §4 "`StepActionBar`를 마운트하는 스펙이 없다"는 공백도 함께 닫힌다). 넣은 뒤 이 M6을 다시 심어 우는지 재라.

### C-1 `ui-rules.spec.ts:3169-3184` — 파일 단위 인구조사와 PascalCase 전용 정규식
- (a) 세는 단위가 파일이라 `TabularPredictPanel.vue`의 두 바 중 하나에서 `sticky`를 떼도 조용하다(M1b: 표·파일 바의 `sticky` 제거 → 초록). 휴대폰의 파일 예측에서만 바가 스크롤과 함께 떠난다.
- (b) `<StepActionBar\b`만 찾아서 `<step-action-bar sticky>`(script setup에서 Vue가 그대로 해석)는 안 보인다(M3 → ui-rules 264/264·eslint 초록). 저장소가 전부 PascalCase라 현실성은 낮다.
- 처방: 파일이 아니라 **여는 태그**를 세어 `{파일: 개수}`로 견준다(`TabularPredictPanel` 2, `ImagePredictPanel` 1), 정규식에 `<(?:StepActionBar|step-action-bar)\b`. B-2의 마운트 검사와 함께면 충분.

### C-2 `TabularPredictPanel.vue:523-524` — 넓은 폭의 보이는 글자를 아무것도 안 본다
- `predict-invalidation.spec.ts:67-72`의 `button()`이 `aria-label ?? text`로 바뀌어, 긴 쪽 `<span>`을 `fromDataShort`로 바꿔도(M8) 조용하다 — `fromData`는 `aria-label`에서 불리니 안 불리는 키 검사도 안 운다. 결과는 데스크톱에서 `[무작위]`만 보이는 것, 해는 작다.
- 처방: `button()`이 `aria-label`로 찾았을 때 `text()`가 그 이름을 **포함**하는지(= 2.5.3 label-in-name) 함께 단언. jsdom에서는 두 `span`이 다 텍스트로 잡히므로 `text()` ⊇ `fromData`가 성립하고, 긴 쪽을 짧은 키로 바꾸면 운다.

### C-3 `TabularPredictPanel.vue:520` — 이름을 주는 길이 둘 (Fable C-2에 동의, 남아 있음)
- `AppButton`은 `label` prop(`AppButton.vue:39,124`)으로 `aria-label`을 단다. 여기는 fallthrough `:aria-label`. 동작은 한다. 처방은 `:label="t('predict.tabular.fromData')"`.

### C-4 `docs/architecture/03-screens.md:448-450` — `--step-bar-height` 항목이 `sticky` 경우를 안 말한다
- "붙지 않으면 0, 게이지 줄만 붙으면 그 줄의 높이다" — 컴포넌트 독스트링(`StepActionBar.vue:75-76`)은 "`sticky`로 통째로 붙으면 바 전체"를 더했는데 문서는 안 더했다. 한 절 뒤 예외 항목이 있어 모순은 아니지만 둘이 갈렸다. 처방: 같은 한 구절을 더한다.

### C-5 (0.28.4 이전) 버튼 이름이 옛 이름으로 남은 자리 셋
- `docs/architecture/03-screens.md:421` 표 `랜덤으로 하나 가져오기`, `frontend/src/views/predict/InputRow.vue:10` `[랜덤으로 하나 가져오기]`, `frontend/src/ml/predict.ts:256` 같은 말. 실제 이름은 `무작위로 가져오기`(휴대폰 `무작위`). 이번 diff가 InputRow 머리말 13행을 고치면서 10행을 지나쳤다. 처방: 셋을 `무작위로 가져오기`로.

### C-6 (0.28.4 이전) `frontend/src/components/ExportButton.vue:106-109` — 휴대폰에서 [내보내기] 단추의 이름이 비었다 — **실재한다**
- 무엇: `AppButton`에 `label`이 없고, 안의 아이콘은 `aria-hidden="true"`, 글자 `<span>`은 `max-md:hidden`(= `display:none`). accname 계산은 `display:none` 내용을 빼므로 `md` 미만에서 이 단추의 접근 가능한 이름은 **빈 문자열**이다. `AppButton`은 `:aria-label="label"`(undefined면 속성 없음)뿐이고 `AppPopover`의 `#trigger`는 아무 이름도 안 더한다(`AppPopover.vue:251`). `blame`: 2026-08-05 `f70401b7`부터 이 모양.
- 같은 병의 이웃(`max-md:hidden` 전수 grep): `frontend/src/components/ProjectStatus.vue:46-53` — 맨 `<button>`에 `aria-label` 없이 `t('meta.title')`을 `max-md:hidden`으로 접는다, **같은 결함**. 나머지는 이름이 있다: `PortfolioView.vue:413`·`TemplateSourceMenu.vue:68`은 `:label`, `StepRail.vue`의 링크는 `:title`(accname 마지막 대안), `AppStatusBar.vue:307`은 다른 이름 경로.
- 등급: C. 접근성은 이 배포의 판정 기준이 아니고(키보드 계획 폐기·학운위 체크리스트에 접근성 항목 없음), 보이는 사용자에게는 아이콘으로 동작한다. 화면 낭독기 사용자는 휴대폰에서 이름 없는 단추 둘을 만난다.
- 처방: `ExportButton.vue:106` `<AppButton variant="secondary" :label="t('project.export')">`, `ProjectStatus.vue` 단추에 `:aria-label="t('meta.title')"`. 검사를 원하면 ui-rules에 "`max-md:hidden`으로 글자를 접는 단추는 `label`/`aria-label`/`title` 중 하나를 가져야 한다"를 더하고 이 둘을 심어 운다는 것을 재라.

## 돌연변이 표 (심은 것만 되돌림, 스펙 하나 또는 관련 몇 개만 실행)

| # | 심은 것 | 돌린 검사 | 울었나 |
|---|---|---|---|
| M1 | `ImagePredictPanel.vue` `sticky` 제거 | ui-rules "동작 바는 md…" | 울음 (`sticky bar outside the predict screens`) |
| M1b | `TabularPredictPanel.vue` 표·파일 바(`v-else`)만 `sticky` 제거 | ui-rules + predict 전부 | **조용** (predict-invalidation 빨강은 격리 4/4 → 부하) → C-1a |
| M2 | `TrainView.vue` `<StepActionBar sticky>` | ui-rules | 울음 |
| M3 | `TrainView.vue` `<step-action-bar sticky>`(케밥) | ui-rules 전체 + eslint | **조용** → C-1b |
| M4 | 정적 class `md:sticky` → `sticky` | ui-rules | 울음 (`the bar sticks on phones again`) |
| M5 | `:class` 배열 + `'max-md:sticky'` 덧붙임 (Fable B-2 재심기) | ui-rules | 울음 (`toBe` 불일치) — B-2 고쳐짐 |
| M6 | `withDefaults(…, { sticky: true })` | ui-rules 전체, option-cascade·kinds·shell | **조용** → B-2 |
| M7 | `ImagePredictPanel.vue` `:sticky="true"` (Fable B-1 재심기) | ui-rules | 울음 (`bound sticky on the action bar`) — B-1 고쳐짐 |
| M8 | 긴 쪽 `<span>`을 `fromDataShort`로 | predict·ui-rules·i18n·locale 16 파일 | **조용** (predict-invalidation 빨강은 격리 4/4 → 부하) → C-2 |
| M9 | `en.json` `fromDataShort` 삭제 | locales.spec.ts · `npm run contracts` | 울음 (키 집합 불일치, `missing key predict.tabular.fromDataShort`) |

## 못 본 것

- **실제 레이아웃**: 휴대폰에서 바가 붙어 보이는지, `--step-bar-height`가 실제로 바 전체로 잡혀 도착 지점이 안 가리는지, `sm`(640px) 경계에서 한 줄에 서는지는 브라우저를 안 띄워 못 봤다(규칙). 코드 소유자 실기기 확인(56b0e1b, 375 폭 한 점)에 기댄다.
- B-1의 예측 화면 읽는 높이 새 값 — 재지 않았다.
- 실제 화면 낭독기로 C-6의 빈 이름을 듣지는 않았다. accname 규칙과 코드 읽기로 판정했다.
- `ja` 로케일이 없어 세 번째 언어의 짧은 이름표는 못 봤다.
- worktree가 처음에 56b0e1b에 있었다 — f1994c3으로 옮긴 뒤 관문·돌연변이를 전부 f1994c3에서 돌렸다.
