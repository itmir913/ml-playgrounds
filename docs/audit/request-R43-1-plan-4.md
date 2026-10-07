# R43-1 후속 — 범주 편집과 테스트 사진, **4차 계획**의 재검토 요청서

> 독립 재검토다. 앞의 요청서·판정을 차례로 읽어라: `request-R43-1-plan.md` → `report-R43-1-plan.md` → `-plan-2` 둘 → `-plan-3` 둘.
> 공통 규칙은 `docs/workflow.md` §3 "감사 국면은 어떻게 도는가"·"감사가 되풀이해 잡은 병"과 §10. **읽기 전용이다.** 임시 스펙
> (`frontend/tests/zz-plan4-*.spec.ts`)은 돌리고 지운다. 오케스트레이터가 같은 시각에 `frontend/src/data/**`·`router/**`·`composables/**`·
> `data/chart-config.ts`를 고치고 있다 — 그쪽을 건드리지 말고, 이상한 결과는 `git diff -- frontend/src`부터 보라.
> 금지: `git commit`·`push`·`tag`·`add` · `npm run lint` · `npm run ci` 전체 · `git stash` · `git checkout` · 하위 에이전트·클라우드.

## 전제 (코드 소유자가 정했다)

- 범주를 지울 때 실험 기록은 남긴다. 테스트가 0장이 되어 holdout으로 돌릴 때도 남긴다.
- 확인 창 문구(테스트 사진이 있을 때만): *"사진은 삭제되지 않고 [범주 없음]으로 이동합니다. 이 범주의 테스트용 사진 {count}장은 삭제되며
  되돌릴 수 없습니다. ({name})"*.
- 테스트 장수를 변경 이력 비교 항목으로 더하지 않는다. 결정 106(학습 입구 대조)은 안전망으로 남긴다.

## 4차 계획 — 3차에서 바뀐 것만 굵게

**A. `renameCategory(project, from, to, now)` — 테스트 자리도 같은 트랜잭션에서 옮긴다.**

1. `readImages(project, 'test')`를 직접 돌아 `from` 범주 사진을 `imageEntryPath('test', hash, to, format)`로 옮긴다.
2. **판정은 술어 하나다** (3차 지적 4). `project/images.ts`에 순수 함수 `renameCollidesWithTest(project, from, to): boolean`을 둔다 — `to`가 지금
   범주(`imageCategories`)에는 없고 테스트 자리의 범주에는 있으면 참. **gate(`locks.ts`의 `categoryNameReasons`)와 `renameCategory`가 둘 다 이것을
   부른다.** gate 입력(`CategoryNameInput`)에는 **화면이 든 `mode`**와 이 술어의 결과(또는 술어에 필요한 테스트 범주 목록)를 넘긴다 — `from === ''`로
   모드를 추론하지 않는다. `tests/locks.spec.ts`의 `CASES.categoryName` 표본도 새 필드를 갖는다.
3. **이유 코드를 따로 둔다** (3차 지적 3). `nameTaken`이 아니라 새 이유 **`nameTakenByTest`**, 문구(ko 초안 — 코드 소유자 확인 대기):
   *"테스트용 사진에 같은 이름의 범주가 남아 있어 이 이름으로 바꿀 수 없습니다."* 만들기 모드에서는 이 이유가 서지 않는다(고아 테스트 폴더를 되살리는
   유일한 길이다). 이 이유는 [확정]을 누를 때 창 안에서 말한다(`shownNameRefusal`의 기존 길 — 결정 65 "모달 창 안의 거절").
4. 술어가 참인데 `renameCategory`에 오면 영어 `Error`를 던진다(우리 버그 — `LOCK_GATE_UNKNOWN`과 같은 선례).
5. **`commitName`의 뒤처리는 적용 여부로 가른다** (3차 지적 1). revision 함수 안에서 `renameCategory`가 **돌아온 뒤** 표지(`applied = true`)를 세우고,
   `retagPending`·기준점 이동은 그 표지가 섰을 때만 한다 — `bake`의 `seated`와 같은 모양. 쿼터 거절은 적용된 뒤의 실패라 retag가 돈다(R38 A-1을
   지킨다). 함수가 던진 경우만 retag가 안 돈다.
6. **이름 창은 지금처럼 닫는다** (3차 지적 2의 (가)). 실패 알림이 모달 뒤에 덮이지 않게 하고, 쿼터 거절 뒤 창 안에 거짓 `nameTaken`이 서는 일을 없앤다.

**B. `removeCategory`** — 3차와 같다(훈련 사진은 `_unlabeled`, 테스트 사진은 경로로 지우고 임베딩은 `stillUsed` 판정, 0장이면 holdout·실험 유지,
범주별 테스트 장수는 화면 밖 순수 함수, 새 키는 en 복수 규칙과 `t(key, {count, name}, count)`). `commitRemoveCategory`는 지금처럼 늘 retag한다.

**C. 문서** — 3차와 같다. 결정 106 개정에 A·B, 테스트 사진에는 "라벨만 뗀다"가 성립하지 않는다는 것, provided·holdout 점수가 한 목록에 설 수 있다는 것,
업로드·붙여넣기로 고아 테스트 이름과 합쳐지는 되살리기, **테스트 사진 이름 바꾸기가 테스트 자리의 경로 정렬 순서를 바꾼다는 것**(훈련 자리 이름 바꾸기와
같은 성질 — 옛 실험의 `testIndices`를 사진 위에서 다시 읽는 곳이 없음을 확인해 적는다). `clearTestImages` 머리말과 `RELIED_ON` 주석을 바로잡는다.

**D. 범위 밖** — 점검의 사진 provided 실험에 `NO_TEST_DATASET`이 늘 뜨는 기존 거짓은 R43-5로 넘긴다.

## 물음

1. 4차 계획이 3차 지적 1~4를 닫는가. 새로 여는 것을 진짜 입구로 보여라 — 특히 A-5에서 쿼터 거절과 함수 던짐을 둘 다 따라가라.
2. A-2의 gate 입력에 무엇을 넘겨야 `locks.ts`가 프로젝트를 몰라도 되는가(지금 입력은 `{from, value, categories}`다).
3. A-3의 새 이유가 이름 창의 문장 체계(`nameTaken`은 늘 서는 문장, 나머지는 [확정] 뒤 문장 — `ImagePanel.vue`의 `shownNameRefusal`)와 맞물리는가.

## 보고

판정 하나 — **APPROVE** · **APPROVE WITH CHANGES**(번호로) · **REJECT**. 근거마다 `경로:줄`. 보고서 파일은 쓰지 말고 최종 메시지로.
마지막 줄에 `git status --short -- frontend`.
