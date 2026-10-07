# R43 감사 요청서 — 전체 범위 적대적 감사 (슬라이스별 순차)

> 공통 규칙은 `docs/workflow.md` §3의 **"감사 국면은 어떻게 도는가"**부터 **"감사가 되풀이해 잡은 병"**까지와
> §10이다. **먼저 읽어라.** 금지 목록(커밋·`push`·`tag`·`add` · `npm run lint` · `npm run ci` 전체 · `git stash`·
> `git checkout .`·디렉터리 단위 되돌리기 · 하위 에이전트·클라우드 · 버전 올리기 제안)과 등급(A/B/C), 돌연변이 절차,
> 보고서 서식이 거기 있다.
>
> 기준 커밋: `2f6835a` (R42 고침 직후). 앞 라운드: `report-R41-*.md`, `report-R42-save.md`.
> `git status --short`가 더러운 것은 정상이다 — 병렬 세션이 같이 돈다.
> **보고서 파일은 쓰지 마라** — 하네스가 하위 에이전트의 파일 쓰기를 막는다. 보고서 본문 전체를 최종 메시지로 돌려준다.

## 0. 모든 슬라이스에 공통인 축 (코드 소유자 지시)

1. **시간복잡도는 낮아지는 쪽으로만 간다.** 입력 크기(행·열·사진·실험·답의 길이·백틱·엔트리 수)에 대해 제곱 이상이
   되는 자리를 찾아라 — 반복문 안의 `findIndex`·`indexOf`·`includes`·`filter`, 펼쳐 베끼기(`[...a, x]`, `{...o}`)를
   반복문 안에서 누적, 문자열 `+=` 누적, 정렬 안의 탐색. **실측으로 두 배씩 키워 기울기를 보이고**, 학생이 낼 수 있는
   크기(`limits.ts`의 상한)에서 몇 초인지 적는다. R42 C-1(`portfolio.ts trustedCodeSpans`)이 이 모양이었다.
2. **`.mlpx` 내보내기에 압축(deflate)이나 워커가 다시 들어오면 A다.** 결정 68 2차 처방("`.mlpx`는 아무것도 누르지
   않는다") — 그 회귀로 실제 저장이 실패했다. 내보내기·포트폴리오 묶음·명렬 등 **파일을 만드는 모든 길**을 본다.
3. **"조용히 틀린 답"** — 던지지 않고 다른 값을 내는 자리가 던지는 자리보다 나쁘다.

## 1. 슬라이스 (한 라운드에 하나)

| 라운드 | 소유 경로 | 규모 |
|---|---|---|
| R43-1 | `frontend/src/project/**`, `frontend/src/stores/**`, `frontend/src/*.ts` | 약 14,600줄 |
| R43-2 | `frontend/src/data/**`, `frontend/src/composables/**`, `frontend/src/router/**` | 약 8,000줄 |
| R43-3 | `frontend/src/ml/engines/**`, `frontend/src/ml/worker/**`, `frontend/src/ml/embed/**`, `frontend/src/ml/models/**` | `ml/`의 절반 |
| R43-4 | `frontend/src/ml/*.ts` (위 하위 폴더 밖) | `ml/`의 나머지 |
| R43-5 | `frontend/src/views/**`, `frontend/src/components/**` | 약 24,000줄 |
| R43-6 | `backend/**`, `frontend/scripts/**`, `frontend/public/**`, `.github/workflows/**`, 로케일 계약 | 나머지 |

밖은 **읽기만** 한다. 경계를 넘는 결함은 지적하되 그 슬라이스의 몫으로 적는다.

## 2. 슬라이스마다 할 일

1. **안 본 자리부터.** `docs/roadmap.md` "감사가 안 본 채로 남은 경계"와 앞 라운드의 "못 한 것"을 먼저 읽고, 그
   슬라이스에 걸리는 것을 먼저 친다.
2. **진짜 입구로 재현한다.** 픽스처로 상태를 미리 조립하지 마라(되풀이된 병 3).
3. **돌연변이 20~30.** 조건 경계·그물·주석이 "무는 검사"라고 가리키는 줄을 우선한다. 묶음 사이마다
   `git diff --quiet -- frontend/src backend`.
4. 실행은 스펙 단위(`cd frontend && npx vitest run tests/<파일>`)와 `npx vue-tsc --build`, 백엔드는
   `cd backend && uv run pytest`·`uv run ruff check`·`uv run mypy`만.
5. 임시 재현 스펙은 `frontend/tests/zz-r43-*.spec.ts`로 만들고 끝나면 지운다.
   **`rejects`로 큰 결과를 단언하지 마라** — 실패 메시지가 큰 객체를 펴다 워커가 죽는다(R42 고침에서 밟았다).

## 3. 제외할 것

- 화면의 생김새·문구 말투, 실기기·스크린 리더 — 코드 소유자가 본다.
- 이미 닫힌 지적(R41·R42)을 다시 내지 마라 — 고쳐졌는지 확인만.
- 의존성 갱신 제안.

## 4. 보고

`docs/workflow.md` §3 "보고서에 반드시 있어야 하는 것"대로 — 지적마다 자리(`경로:줄`)·주장·재현·처방·이웃 수, 돌연변이
표 전체, "못 한 것". 실측 없이 A를 매기지 않는다. 마지막 줄에 `git status --short -- frontend backend`.
