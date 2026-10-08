# 0.35.2 경계 감사 고침 라운드 — `a180e38..8762be8` 과 A가 못 본 창

> 공통 규칙은 `docs/workflow.md` §3 "감사 국면은 어떻게 도는가"부터 "감사가 되풀이해 잡은 병"까지와 §10. **먼저 읽어라.**
> 금지: `git commit`·`push`·`tag`·`add` · 영구 수정 · `npm run lint` · `npm run ci` 전체 · `npm install`·`npm ci` · `git stash` ·
> `git checkout .`·디렉터리 단위 되돌리기 · 하위 에이전트·클라우드 · 버전 올리기 제안 · 브라우저 자동화. 보고서 파일은 쓰지 말고 최종 메시지로 돌려준다.
> 기준: `8762be8`. 같은 시각에 코드를 쓰는 세션이 원 저장소에서 다음 고침을 쓴다 — 기계 부하로 시간 초과가 나면 종류부터 가른다(§3).

## 0. 어디서 도는가 — 반드시 지킨다

- 작업 트리는 **`C:\Users\user\Documents\PycharmProjects\mlp-audit-a`** 하나다. 원 저장소는 읽기만 한다.
- **모든 git 명령은 `git -C C:\Users\user\Documents\PycharmProjects\mlp-audit-a ...`.** 첫 확인으로 `log -1 --format=%h`가 `8762be8`인지 적는다.
- `frontend\node_modules`는 원 저장소로 가는 **정션**이다. 건드리지 마라.
- 임시 스펙은 `frontend/tests/zz-fix-*.spec.ts`, 되돌리기는 `git -C <위 경로> restore -- <파일>`, 묶음마다 `diff --quiet -- frontend/src`.
- 보조 스크립트는 `C:\Users\user\AppData\Local\Temp\claude\fixaudit\` 같은 **새 디렉터리**에 둔다(지난 라운드에 스크래치패드 이름이 겹쳤다).

## 1. 무엇을 고쳤나 — 감사 A·B의 보고에서

| 커밋 | 지적 | 고침 |
|---|---|---|
| `3c2fdc9` | A A-1 — 중복 이동이 가드 차례를 못 올려 버려진 이동이 프로젝트를 닫거나 연다 | `router/index.ts`의 `afterEach`에서 중복(DUPLICATED)이면 `navigations += 1`. 검사 `route-duplicate-race.spec.ts` |
| `4e92313` | A C-1 — 수위선을 청크 받기 전에 잡는 것을 안 문다 | `route-watermark.spec.ts`에 검사 하나 |
| `08eecbf` | B C-1~C-5 — `document.md` 판정 구역의 빈 검사와 죽은 `fenceIndent` | `portfolio.spec.ts` 검사 넷, `portfolio.ts`에서 `fenceIndent` 삭제 |
| `8762be8` | A C-3 — 결과 화면의 `selected` 감시를 안 문다 | `results-screen.spec.ts`에 검사 하나, `ResultsView.vue` 머리말 |

결정이 걸린 둘(A B-1 "끝나지 못한 이동도 알림을 걷는다", B B-1 "CSV 수식 머리")은 코드 소유자 몫이라 안 고쳤다 — 이 라운드 밖이다.

## 2. 볼 것

1. **고침이 지적을 닫았는가, 새로 연 것은 없는가.** 특히 A-1의 처방 — `afterEach`의 중복 판정이 **앞 이동의 가드가 차례를 보기 전에** 도는가
   (vue-router가 중복 실패의 `afterEach`를 프라미스 사슬로 부른다 — 앞 이동의 `loadRouteLocation`이 이미 풀려 있으면 순서가 어떻게 되나).
   중복 이동이 진행 중인 이동 없이 일어날 때 차례를 올리는 것이 해가 없는가. 리다이렉트와 겹칠 때.
2. **A가 못 본 창** — 중복 이동이 앞 이동의 `project.open()`(IndexedDB 읽기) **도중**에 오는 경우. `router/index.ts:220`의
   `outcome === 'cancelled'` 갈래는 열기의 세대 번호가 올라야 서는데, 중복 이동은 `close()`도 다음 `open()`도 안 부른다.
   스토어가 열린 채 목록 화면이 서는지 `project-open-cancel.spec.ts`의 저장소 손잡이 방식으로 재라.
3. 여유가 되면 A가 못 본 나머지 — `InspectView.vue:89`·`ClusterNeighbors.vue:177`·`ImagePanel.vue:141`·`HistogramChart.vue:108`의
   고른 id가 그 대상이 지워지거나 바뀔 때 따라가는가(진짜 입구로).

## 3. 규모

돌연변이 15개 안팎. 1 → 2 → 3. 약 60분.

## 4. 제외

- 화면 생김새·문구, 실기기, 의존성 갱신, GitHub #40·#41·#42, 위 결정 둘.

## 5. 보고

판정(**CLEAN** / **NOT CLEAN**), 지적마다 등급·자리(`경로:줄`)·주장·재현·처방(임시로 넣어 원래 돌연변이가 우는지까지)·이웃 수.
돌연변이 표 전체, "못 한 것", "확정 불가". 마지막 줄에 `git -C <위 경로> status --short`.
