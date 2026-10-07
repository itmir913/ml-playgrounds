# R43-1 후속 — 범주 편집과 테스트 사진, **5차 계획**의 재검토 요청서

> 독립 재검토다. 앞의 요청서·판정 여덟(`request-R43-1-plan*.md`, `report-R43-1-plan*.md`)을 차례로 읽어라. 공통 규칙은 `docs/workflow.md` §3과 §10.
> **읽기 전용이다.** 임시 스펙(`frontend/tests/zz-plan5-*.spec.ts`)은 돌리고 지운다. 오케스트레이터가 같은 시각에 `frontend/src/data/**`·`router/**`·
> `composables/**`·`data/chart-config.ts`·`data/stats.ts`를 고치고 있다 — 그쪽을 건드리지 말고, 이상한 결과는 `git diff -- frontend/src`부터 보라.
> 금지: `git commit`·`push`·`tag`·`add` · `npm run lint` · `npm run ci` 전체 · `git stash` · `git checkout` · 하위 에이전트·클라우드.

## 전제 (코드 소유자) — 4차와 같다

실험 기록은 남긴다(0장 → holdout일 때도). 확인 창 문구는 정해졌다. 테스트 장수를 변경 이력에 안 더한다. 결정 106은 안전망으로 남긴다.

## 5차 계획 — 4차에서 바뀐 것만 굵게

**A. 이름 바꾸기**
1. 테스트 자리도 같은 트랜잭션에서 옮긴다(직접 순회).
2. **술어는 목록을 받는다** (4차 지적 1). `data/image/test-set.ts`에
   `renameCollidesWithTest({ categories, testCategories, to }): boolean` — `to`가 `categories`에 없고 `testCategories`에 있으면 참. gate
   `categoryNameReasons`(`locks.ts`)는 입력 `{ mode, from, value, categories, testCategories }`에서 `mode === 'rename'`일 때 trim한 `value`로
   이것을 부른다. `renameCategory`는 `imageCategories(project)`와 `readImages(project, 'test')`의 범주로 같은 술어를 부른다. 화면(`ImagePanel.vue`)은
   `testCategories`를 `readImages(project.file, 'test')`로 계산해 넘긴다(`categories`와 같은 층). `tests/locks.spec.ts`의 표본에 두 필드.
3. 새 이유 **`nameTakenByTest`**, 문구(ko 초안, 코드 소유자 확인 대기): *"테스트용 사진에 같은 이름의 범주가 남아 있어 이 이름으로 바꿀 수 없습니다.
   다른 이름을 입력하세요."* (4차 지적 3). [확정] 뒤 창 안의 `role="alert"` 문장으로 선다.
4. 술어가 참인데 `renameCategory`에 오면 영어 `Error`를 던진다.
5. `commitName`의 뒤처리(retag·기준점)는 revision 안에서 `renameCategory`가 돌아온 뒤 선 표지(`applied`)로 가른다. 창은 지금처럼 닫는다.

**B. 범주 지우기** — 4차와 같다.

**C. 문서** — 4차에 **더해** (4차 지적 2): *"이름 바꾸기 거절은 한 번의 실수로 합쳐지는 것만 막는다. 만들기와 옮기기(또는 업로드·붙여넣기)로 고아 테스트
이름을 되살리면 그 테스트 사진이 새 범주의 정답으로 채점된다 — 학생이 그 이름을 일부러 다시 쓴 것으로 본다."* 새 문구는 그 길로 보내지 않는다.

**검사** (4차 지적 4) — ① 바꾸기 거절·만들기 통과(gate와 함수 둘 다) ② **쿼터 거절 뒤에도 판의 묶음이 새 이름을 따른다**(저장 실패 사례를
`image-panel-rename-pending.spec.ts`에 더한다, 표지를 "저장 성공"으로 잘못 구현하면 운다) ③ 함수가 던지면 retag가 안 돈다(`vi.spyOn`으로 던지게
한다) ④ B의 테스트 사진 삭제·0장 holdout·실험 유지 ⑤ 결정 106 대조가 그대로 문다. 각 검사는 고치기 전 코드에서 우는 것까지 본다.

## 물음

1. 5차 계획이 4차 지적 1~4를 닫는가. 새로 여는 것을 진짜 입구로 보여라.
2. 4차가 못 본 것 — 이름이 NFC/NFD로 갈릴 때 gate와 `renameCategory`의 판정이 갈리는 길이 있는가(범주 이름 정규화: `data/file-name-rules.ts`·`isValidCategoryName`).
3. 이 계획에 아직 막혀야 할 것이 남았는가. 없으면 **APPROVE**를 내라.

## 보고

판정 하나 — **APPROVE** · **APPROVE WITH CHANGES**(번호로) · **REJECT**. 근거마다 `경로:줄`. 보고서 파일은 쓰지 말고 최종 메시지로.
마지막 줄에 `git status --short -- frontend`.
