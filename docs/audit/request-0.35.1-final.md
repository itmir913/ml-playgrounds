# 0.35.1 최종 감사 요청서 — `0.33.0..HEAD` 전체, 중단기 전 마지막 태그

> 공통 규칙은 `docs/workflow.md` §3 "감사 국면은 어떻게 도는가"부터 "감사가 되풀이해 잡은 병"까지와 §10. **먼저 읽어라.**
> 금지: `git commit`·`push`·`tag`·`add` · `npm run lint` · `npm run ci` 전체 · `git stash` · `git checkout .`·디렉터리 단위 되돌리기 ·
> 하위 에이전트·클라우드 · 버전 올리기 제안. 보고서 파일은 쓰지 말고 최종 메시지로 돌려준다.
> 기준: `0.33.0..HEAD`(`git log --oneline 0.33.0..HEAD`, 약 100커밋·200파일). `git status --short`가 더러우면 다른 세션이다.

## 0. 왜 이 감사인가, 그리고 판정

`0.33.0`(일본어)이 마지막 안정 태그다. 그 뒤의 모든 커밋은 **한 구현자(Opus)**가 쓰고 같은 계열의 감사자가 봤다. 당신은 **독립된 최종
감사자**다 — 이 범위의 고침이 적법했는지(지적을 실제로 닫았는가, 원칙을 어기지 않았는가, 새 병을 열지 않았는가)를 본다. 이 태그 뒤로
한 달 넘게 감사도 기능 개발도 없다.

**CLEAN APPROVE** — 이 범위를 그대로 0.35.1로 태그하고 배포해도 된다. 조건은 A·B가 0이고 C는 코드를 쓰는 세션이 판단할 수 있는
것뿐인 상태다. 아니면 지적(A/B/C)과 함께 **NOT CLEAN**.

## 1. 범위와 길잡이

- 태그 사이: 0.33.1·0.33.2(판정 못 하는 CSV·개발 서버 경로·404), 0.34.x(R42 `.mlpx` 저장, R43-1·R43-2 고침, 결정 105~107), 0.35.0(결정 106
  2차 — 범주 이름 바꾸기·지우기와 테스트 사진, `nameTakenByTest`), 그 뒤 R43-3~R43-6 슬라이스 감사의 고침과 #43(탐색기 zip 이름).
- 보고서: `docs/audit/report-R42-save.md`, `report-R43-1.md`~`report-R43-6.md`, `report-0.35-category.md`, `report-43-plan.md`. 각 보고서 끝의
  재판단과 "기록만 한 것"을 읽어라 — C로 남긴 판단이 맞는지도 이 감사의 몫이다.
- 미결정으로 넘긴 것: `open-decisions.md` 108(사진 장수 상한이 사진 아닌 파일까지 센다) — 고치지 않은 것이 맞는지 판단만.

## 2. 볼 것

1. **고침이 지적을 실제로 닫았는가.** 보고서의 "무는 검사"마다 겨냥한 돌연변이를 다시 심어 본다. 구현자의 "욺" 주장을 믿지 마라.
2. **고침이 새로 연 것.** 특히 최근 것 — `ml/preprocess.ts`의 `FEATURE_VALUE_TOO_LARGE`(정상 데이터를 막는가: 큰 정수 ID 열, 1e150대 값),
   `data/image/upload.ts`·`locks.ts`의 대소문자 접기(`categoryFolderKey` — 한글·NFD·터키어 `i`, 옛 파일의 `cat`·`Cat`), `data/zip-names.ts`의
   #43 예외(UTF-8 이름을 잘못 되살리는가), `ml/engines/cart-split.ts`(원본 `ml-cart`와 비트 단위로 같은 나무인가), `ml/models/reference.ts`의 KNN,
   `views/data/ImagePanel.vue`의 `byCategory`, `.github/workflows/gate.yml`의 DCO 건너뛰기.
3. **코드 소유자의 공통 축** — ① 시간복잡도는 낮아지는 쪽으로만(새 코드에 제곱 이상이 있나, 실측으로 두 배씩) ② `.mlpx`·묶음에 deflate·워커가
   다시 들어오면 A ③ **실험 기록을 지우거나 `.mlpx` 포맷을 바꾸는 길을 새로 만들었으면 A**(전수는 GitHub #42) ④ 조용히 틀린 답.
4. `CLAUDE.md` 절대 원칙 — 컴포넌트의 자연어 리터럴, 코드에 직접 쓴 상한, 템플릿에서 조립한 잠금, 지원 언어 전용 분기, 근거 없는 단정형 주석.
5. 시간 검사(`BUDGET_MS`)가 부하에 흔들리지 않을 만큼 넉넉하고, 동시에 옛 코드에서는 넘는가.

## 3. 실행

- 스펙 단위(`cd frontend && npx vitest run tests/<파일>`), `npx vue-tsc --build`, 백엔드는 `cd backend && uv run pytest`·`uv run ruff check`·`uv run mypy app tests ../scripts/check_locales.py`.
- 임시 스펙은 `frontend/tests/zz-final-*.spec.ts`로 만들고 지운다. 돌연변이는 `git restore -- <파일>`로 되돌리고 묶음마다 `git diff --quiet -- frontend/src backend scripts`.
- **경제적으로**: 돌연변이 25개 안팎. 전부를 줄 단위로 읽지 말고 2의 자리와 보고서가 가리키는 자리를 먼저.

## 4. 제외

- 화면 생김새·문구 말투, 실기기·스크린 리더, 의존성 갱신.
- GitHub #40(웹캠)·#41(오프라인 번들)·#42(테스트 데이터를 바꿔도 실험 유지) — 별도 과제다.

## 5. 보고

판정(**CLEAN APPROVE** / **NOT CLEAN**), 지적마다 자리(`경로:줄`)·주장·재현·처방·이웃 수, 돌연변이 표 전체(운 것까지), "못 한 것". 마지막 줄에
`git status --short -- frontend backend scripts`.
