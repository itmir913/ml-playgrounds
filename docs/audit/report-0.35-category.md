# 0.35.0 범주 편집과 테스트 사진 감사 보고 — `eb27d8c..6ce22c4` — **CLEAN WITH C** (A 0 · B 0 · C 1)

> 감사자의 회신을 오케스트레이터가 옮겨 적었다. 요청서 `request-0.35-category.md`. 돌연변이 17, 임시 스펙 하나(지움).

**결론.** 계획 5차와 갈리는 곳 없음. 고침이 새로 연 것 못 찾음 — `removeImages`의 행동은 그대로(M15 욺), 0장 holdout은 참조를 떼므로
`requireFolderBodies`·`RELIED_ON`에 안 닿고 `.mlpx` 왕복을 스펙이 확인한다, 테스트 사진 없이 남은 provided 실험은 `reproduce-gate.ts`의
`provided && !hasTestDataset`이 막는다. **실험을 지우는 새 길은 없다.** 시간 복잡도는 늘지 않았다(모두 선형, 상수 배).

## C
- **C-1** `ImagePanel.vue`의 `useGate('categoryName', …)` — 화면이 gate에 넘기는 `mode`·`testCategories`를 무는 검사가 없다(병 2). `testCategories: []`·
  `mode: 'create'` 돌연변이가 관련 스펙 186개에서 조용. 깨지면 고아 이름으로 바꾸기에서 창 안 문장 대신 `renameCategory`의 오류 알림이 선다(파일은
  함수가 막아 안 다친다). 처방(실측): 진짜 입구로 [이름 변경] → `C` → [확정], `renameCategory` 안 불림·`role="alert"`에 `nameTakenByTest`·목록 그대로.
  이웃: `categories`도 같다(diff 전부터).

## 처리

| 지적 | 고침 | 무는 검사 |
|---|---|---|
| C-1 | 처방대로 검사를 더하고 `test-set.ts` 주석이 가리키게 했다 | `image-panel-rename-pending.spec.ts` *"고아 테스트 이름으로 바꾸기"* — 두 돌연변이 모두 욺 |

## 확인 못 한 것
`vue-tsc`(돌연변이마다) · 화면 렌더링 · provided 실험이 테스트를 일부 잃은 뒤 옛 실험 화면의 표시(결정문이 받아들인 비용) · 실기기.
