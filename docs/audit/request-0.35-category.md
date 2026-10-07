# 0.35.0 범주 편집과 테스트 사진 — `eb27d8c..6ce22c4` 감사 요청서

> 독립 감사다. 공통 규칙은 `docs/workflow.md` §3 "감사 국면은 어떻게 도는가"·"감사가 되풀이해 잡은 병"과 §10. 등급 A/B/C, 근거는 `경로:줄`,
> 증거는 돌연변이·진짜 입구 재현. **읽기 전용이다.** 돌연변이는 원본을 고쳐 돌리고 반드시 되돌린다(끝에 `git status --short`가 깨끗해야 한다).
> 임시 스펙은 `frontend/tests/zz-audit-*.spec.ts`로 쓰고 지운다. 금지: `git commit`·`push`·`tag`·`add`·`stash`·`checkout` · `npm run lint` ·
> `npm run ci` 전체 · 하위 에이전트·클라우드. 비용을 아껴라 — 이 diff와 그 이웃만 본다.

## 배경

계획은 `request-R43-1-plan-5.md`(APPROVE, `report-R43-1-plan-5.md`의 주의 둘 포함), 결정은 `docs/open-decisions/08-implemented.md`와
`docs/cases/open-decisions.md`의 106 "개정 2". 커밋 `0820ec9`(문서), `6ce22c4`(코드). 코드 소유자의 전제: 실험 기록은 남긴다(0장 → holdout일
때도), 확인 창 문구는 정해졌다, 테스트 장수를 변경 이력에 안 더한다, 결정 106 대조는 안전망으로 남긴다. **실험 기록 삭제 경로는 매우 위험하다** —
이 diff가 실험을 지우는 길을 새로 열지 않는지 본다.

## 물음

1. 구현이 계획 5차와 갈리는 곳이 있는가(술어 하나·gate 입력·`applied` 표지·경로로 지우기·임베딩 `stillUsed`·holdout·실험 유지·문구 키와 en 복수).
2. 고침이 새로 연 것 — 진짜 입구로. 특히 `withoutEntries`로 뺀 `removeImages`의 행동이 그대로인가, `removeCategory`가 `.mlpx` 왕복·IndexedDB
   저장(`project/storage.ts`)·`requireFolderBodies`에서 막히는 상태를 만드는가, 이름 창의 gate와 `renameCategory`가 같은 입력을 보는가.
3. 단정형 주석마다 가리키는 검사가 실제로 무는가(§10). 새 검사가 조용한 돌연변이가 있는가.
4. 시간 복잡도가 늘어난 곳이 있는가.

## 보고

`A/B/C` 목록과 판정 한 줄(**CLEAN** · **CLEAN WITH C** · **FINDINGS**). 보고서 파일은 쓰지 말고 최종 메시지로. 마지막 줄에 `git status --short`.
