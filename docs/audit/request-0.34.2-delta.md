# 0.34.2 diff 감사 요청서 — `0.34.1..HEAD` 전체, 버그픽스 태그 전

> 공통 규칙은 `docs/workflow.md` §3 "감사 국면은 어떻게 도는가"부터 "감사가 되풀이해 잡은 병"까지와 §10. **먼저 읽어라.**
> 금지: `git commit`·`push`·`tag`·`add` · `npm run lint` · `npm run ci` 전체 · `git stash` · `git checkout .`·디렉터리 단위 되돌리기 ·
> 하위 에이전트·클라우드 · 버전 올리기 제안. 보고서 파일은 쓰지 말고 최종 메시지로 돌려준다.
> 기준: `0.34.1..HEAD`(`git log --oneline 0.34.1..HEAD`). `git status --short`가 더러우면 다른 세션이다.

## 0. 이 감사가 내는 판정

**CLEAN** — 이 범위를 그대로 버그픽스 태그(0.34.2)로 고정해도 된다. 아니면 지적(A/B/C)과 함께 **NOT CLEAN**. CLEAN의 조건은 A·B가 0이고 C는
코드를 쓰는 세션이 판단할 수 있는 것뿐인 상태다.

## 1. 범위

`0.34.1..HEAD`의 커밋 전부 — R42(`.mlpx` 저장), R43-1(project·stores), R43-2(data·composables·router)의 고침과 결정 105·106·107, `workflow.md`
§1의 계획 감사 권장. 보고서: `docs/audit/report-R42-save.md`, `report-R43-1.md`, `report-R43-2.md`(각 끝에 "오케스트레이터 재현과 고침").

## 2. 볼 것

1. **고침이 지적을 실제로 닫았는가.** 보고서의 지적마다 고친 자리를 열고, 그 표의 "무는 검사"가 정말 무는지 겨냥한 돌연변이를 다시 심어 본다. 오케스트레이터의
   "욺" 주장을 믿지 마라.
2. **고침이 새로 연 것.** 특히 — `project/json-text.ts`(결정 105)가 `JSON.stringify(값, null, 2)`와 갈리는 입력, `ml/training-source.ts`의 결정 106 대조가
   정상 프로젝트를 잘못 막는 경우(군집·holdout·범주에 사진 없는 빈 범주·라벨 없는 사진), `data/grid.ts`·`data/table.ts`의 열 상한 판정 변경이 미리보기·정본 읽기·
   상한 해제에 주는 영향, `router/index.ts`의 `afterEach` 취소 거르기가 중단(ABORTED)·중복 이동에서 수위선을 남겨 두는 일, `data/stats.ts`의 경계 보정이
   음수·아주 큰 값·`range`가 아주 작은 값에서 범위 밖 index를 내는 일, `data/chart-config.ts`의 `WeakMap` 캐시가 데이터셋 배열을 제자리에서 바꾸는 Chart.js
   갱신에서 낡은 값을 주는 일, `project/images.ts`·`roster.ts`·`portfolio-bundle.ts`의 번호·Set 바꿈이 순서나 이름을 바꾸는 일.
3. **코드 소유자의 공통 축** — ① 시간복잡도는 낮아지는 쪽으로만(새 코드에 제곱 이상이 있나) ② `.mlpx`·묶음에 deflate·워커가 다시 들어오면 A ③ **실험 기록을
   지우는 길을 새로 만들었으면 A**(전수는 GitHub #42에 있다 — 이 범위가 그 목록에 하나라도 더했나).
4. 시간 검사(`BUDGET_MS`)가 부하에 흔들리지 않을 만큼 넉넉하고, 동시에 옛 코드에서는 넘는가.

## 3. 제외

- R43-1 후속 범주 계획(이름 바꾸기·지우기와 테스트 사진) — 승인됐지만 **아직 구현하지 않았고** 이 태그 뒤에 한다.
- GitHub #41(오프라인 번들), #42(테스트 데이터를 바꿔도 실험 유지), #43(탐색기 zip 이름) — 별도 과제다.
- R43-3~R43-6 슬라이스(ml·views·backend) 전체 감사 — 이 범위가 건드린 줄만 본다.
- 화면 생김새·문구 말투, 의존성 갱신.

## 4. 보고

판정(CLEAN / NOT CLEAN), 지적마다 자리(`경로:줄`)·주장·재현·처방·이웃 수, 돌연변이 표 전체(운 것까지), "못 한 것". 마지막 줄에
`git status --short -- frontend backend`.
