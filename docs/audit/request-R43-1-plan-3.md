# R43-1 후속 — 범주 편집과 테스트 사진, **3차 계획**의 재검토 요청서

> 독립 재검토다. 앞의 요청서·판정을 먼저 읽어라: `request-R43-1-plan.md` → `report-R43-1-plan.md`(1차) → `request-R43-1-plan-2.md` →
> `report-R43-1-plan-2.md`(2차, APPROVE WITH CHANGES). 공통 규칙은 `docs/workflow.md` §3 "감사 국면은 어떻게 도는가"·"감사가 되풀이해
> 잡은 병"과 §10. **읽기 전용이다.** 확인용 임시 스펙(`frontend/tests/zz-plan3-*.spec.ts`)은 돌리고 지운다. 오케스트레이터가 같은 시각에
> `frontend/src/data/**`·`router/**`·`composables/**`를 고치고 있다 — 그쪽을 건드리지 말고, 이상한 결과는 `git diff -- frontend/src`부터 보라.
> 금지: `git commit`·`push`·`tag`·`add` · `npm run lint` · `npm run ci` 전체 · `git stash` · `git checkout` · 하위 에이전트·클라우드.
> 기준 커밋 `3034735`(코드는 `b502e00`과 같다).

## 전제 (코드 소유자가 정했다 — 다시 따지지 말고, 전제가 만드는 거짓은 지적하라)

- 범주를 지울 때 실험 기록은 남긴다. 테스트가 0장이 되어 holdout으로 돌릴 때도 남긴다.
- 확인 창 문구(테스트 사진이 있을 때만): *"사진은 삭제되지 않고 [범주 없음]으로 이동합니다. 이 범주의 테스트용 사진 {count}장은 삭제되며
  되돌릴 수 없습니다. ({name})"*.
- 테스트 장수를 변경 이력의 비교 항목으로 더하지 않는다. 결정 106(학습 입구 대조)은 안전망으로 남긴다.

## 3차 계획 — 2차에서 바뀐 것만 굵게

**A. `renameCategory(project, from, to, now)` — 테스트 자리도 같은 트랜잭션에서 옮긴다.**

1. `readImages(project, 'test')`를 직접 돌아 `from` 범주 사진을 `imageEntryPath('test', hash, to, format)`로 옮긴다(`moveImages` 재사용 안 함).
2. **겹침 판정은 이름 바꾸기에서만 한다** (2차 지적 1). 이름 창 gate의 입력(`locks.ts`의 `CategoryNameInput`)에 `testCategories`를 더하고,
   `categoryNameReasons`는 `from !== ''`(바꾸기)일 때만 `to`가 테스트 범주에 있는지도 본다 — 있으면 기존 `nameTaken`. **만들기(`from === ''`)는
   테스트 범주를 안 본다** — 고아 `test/C`를 되살리는 유일한 길이고, 업로드·붙여넣기로 C를 올리는 것도 같은 뜻이다. 검사는 둘 다 문다
   (바꾸기 거절 · 만들기 통과).
3. **함수는 던진다** (2차 지적 2·물음 2). `to`가 테스트 자리에만 있는 이름이면 `renameCategory`가 영어 `Error`를 던진다(우리 버그라는 뜻,
   `LOCK_GATE_UNKNOWN`과 같은 선례).
4. **`commitName`은 저장이 실패하면 뒤처리를 안 한다** (2차 지적 2). `ImagePanel.vue`의 `save`가 성공 여부를 돌려주고(`boolean`), 실패면
   `retagPending`·기준점 이동·창 닫기를 건너뛴다. 이름 창은 열린 채로 남는다.

**B. `removeCategory(project, name, now)` — 그 범주의 테스트 사진을 지우고, 0장이 되면 holdout으로.**

1. 훈련 사진은 지금처럼 `_unlabeled`로.
2. **테스트 사진은 `removeImages`를 부르지 않고 경로로 지운다** (2차 지적 4) — `readImages(project, 'test')` 중 `category === name`인 엔트리의
   경로만 지운다. 임베딩은 그 해시가 어느 자리에도 남지 않을 때만 지운다(`removeImages`의 `stillUsed` 규칙과 같은 판정).
3. 테스트가 0장이 되면 테스트 참조를 떼고 `split.method`를 `holdout`으로. 실험은 안 지운다.
4. 확인 창의 장수는 테스트 자리를 범주별로 세는 순수 함수(화면 밖, vitest)로 낸다. **새 로케일 키는 en에 복수 규칙(`|`)을 두고 부르는 쪽은
   `t(key, { count, name }, count)`** (2차 지적 4). ko·en·ja.

**C. 문서** (2차 지적 3). 결정 106을 개정한다 — 위 A·B, *"범주 삭제에서 '라벨만 뗀다, 되돌릴 수 있다'는 테스트 사진에는 성립하지 않는다"*,
그리고 **provided 점수와 holdout 점수가 한 실험 목록에 나란히 설 수 있다**(변경 이력은 바로 앞 실험과의 `split.method`만 말한다). 같은 커밋에서
`images.ts`의 `clearTestImages` 머리말과 `storage.ts`의 `RELIED_ON` 주석의 단정을 그 예외로 바로잡는다. **계획 C의 "106이 막는다"는 업로드·
붙여넣기로 고아 테스트 이름과 합쳐지는 길에는 거짓이다** — 그 길은 "만들기"와 같은 뜻의 되살리기로 적는다.

**D. 범위 밖으로 따로 적는 것.** 점검의 사진 provided 실험에 `NO_TEST_DATASET`이 늘 뜨는 기존 거짓(2차 물음 3)은 이 계획에 넣지 않는다 —
R43-5(화면 슬라이스) 지적으로 넘긴다.

## 물음

1. 3차 계획이 2차 지적 1~4를 닫는가. 새로 여는 것을 진짜 입구로 보여라.
2. A-2의 gate 입력 변경이 `useGate`·`refusalFor`·`locks.ts`의 등록부 검사(`locks-*.spec.ts` 등)와 맞물리는가.
3. A-4에서 이름 창이 열린 채 남을 때, 저장 실패 알림과 창이 겹치는 문제(결정 65 "모달 창 안의 거절" — 알림은 모달 뒤에 덮인다)는 없는가.

## 보고

판정 하나 — **APPROVE** · **APPROVE WITH CHANGES**(번호로) · **REJECT**. 근거마다 `경로:줄`. 보고서 파일은 쓰지 말고 최종 메시지로.
마지막 줄에 `git status --short -- frontend`.
