# R43-1 후속 4차 계획 재검토 — APPROVE WITH CHANGES

> 독립 재검토자의 회신을 오케스트레이터가 옮겨 적었다. 요청서 `request-R43-1-plan-4.md`. 임시 스펙 하나(지움)로 지금 코드의 `removeCategory`·
> `addCategory`·`moveImages`·`refusalFor('categoryName')`·`testZipBlockFor`를 불렀고, 계획 B는 테스트 경로만 지우는 흉내 함수로 대신했다.

**요지.** 3차 지적 1·2는 닫힌다. 3은 코드로는 닫히나 문구에 다음 행동이 없다. 4는 반만 닫힌다(술어가 `project`를 받아 gate가 못 부른다).

## 고칠 점
1. **[막힘] 술어 시그니처.** `renameCollidesWithTest(project, from, to)`는 gate(입력 `{from, value, categories}`, `locks.ts:470-474`)가 못 부른다.
   결과(boolean)를 넘기면 판정이 화면에서 조립되어 §10.2(`docs/architecture/04-capabilities.md:179-190`)를 어기고, 목록을 넘기면 시그니처가 안 맞는다.
   처방: `sectionTopBlockers` 선례처럼 **gate 입력과 같은 모양의 목록**을 받는다 — `renameCollidesWithTest({ categories, testCategories, to })`.
   `renameCategory`는 `imageCategories(project)`와 `readImages(project,'test')`의 범주로 부른다.
2. **[막힘] 이름 바꾸기 거절을 만들기 + 옮기기로 우회해 같은 합치기에 닿는다.** 고아 `test/C` → 만들기로 `C`(통과) → A의 사진을 전부 `C`로
   옮김 → 계획 B로 A 지우기 ⇒ train `["B/b1","C/a1"]`, test `["B/tb","C/tc"]`, `testZipBlockFor → null`. 옛 C 테스트 사진이 새 C의 정답으로
   채점되고 106도 통과한다(`training-source.ts:202-211`). 만들기 통과는 3차가 고른 설계라 막자는 것이 아니고, **C(결정문)에 "이름 바꾸기 거절은 한
   번의 실수로 합쳐지는 것만 막는다. 만들기와 옮기기로는 같은 결과에 닿는다"를 되살리기와 나란히 적고, 새 문구가 그 길로 보내지 않게 한다.**
3. **[작음] `nameTakenByTest` 문구에 다음 행동이 없다**(`docs/copy.md:19`). "…바꿀 수 없습니다. 다른 이름을 입력하세요."꼴. "만든 뒤 옮기라"는 쓰지 않는다.
4. **[작음] 검사의 입구.** 쿼터 거절 뒤 retag가 도는 것을 무는 검사가 없다(`image-panel-rename-pending.spec.ts`에 저장 실패 사례 없음) — 새로 둔다.
   "함수가 던지면 retag 안 함"은 gate가 먼저 막아 진짜 입구로 안 닿으니 `vi.spyOn`으로 던지게 한다. `tests/locks.spec.ts:247-250`의 표본에
   `mode`·`testCategories`. 술어를 `data/image/test-set.ts`에 두면 `locks.ts`의 import 그래프에 한 파일만 더해진다(`project/images.ts`면 다섯).

## 물음에 대한 답
1. 쿼터 거절: revision 안에서 `applied`가 서고 `write`가 던져도 retag·기준점 이동이 돈다(R38 A-1 지킴). 함수 던짐: 대입 전이라 파일 그대로, retag 안 돎,
   알림, 창 닫힘. 프로젝트가 닫혀 `resolve`가 `null`이면 revision이 안 불려 표지 거짓 — 맞다. C의 `testIndices` 주장은 grep으로 맞다(읽는 곳은 전부 표 쪽).
2. gate 입력: `{ mode: 'create' | 'rename', from, value, categories, testCategories }`. 화면이 `readImages(project.file, 'test')`로 계산한다.
3. 맞물린다 — 새 이유는 [확정] 뒤 `role="alert"` 문장으로 서고, `NAME_REFUSAL_KEYS`에 키를 안 더하면 타입이 운다. 이유는 서로 배타다.

## 확인 못 한 것
화면 렌더링 · 계획 코드가 없어 흉내로만 · NFC/NFD로 갈릴 때 gate와 함수의 판정 차이(함수 던짐에 닿을 유일한 후보) · 옛 레코드 수 · 0장 holdout의 IndexedDB 왕복.
