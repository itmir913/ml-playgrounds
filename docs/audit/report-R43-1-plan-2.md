# R43-1 후속 고친 계획 재검토 — APPROVE WITH CHANGES

> 독립 재검토자의 회신을 오케스트레이터가 옮겨 적었다. 요청서 `request-R43-1-plan-2.md`. 기준 `b502e00`.
> 임시 스펙 하나로 `writeProject`→`readProject`, `saveProject`→`loadProject`, `refusalFor`, `reproduceBlockers`, `removeImages`를 불러 확인했고 지웠다.

**요지.** 1차 지적 2·3·4는 닫힌다. 1차 지적 1은 아래 1·2가 붙어야 닫힌다. 1이 없으면 A-2가 새 덫을 연다.

## 고칠 점

1. **A-2가 범주 만들기도 막는다.** 만들기와 이름 바꾸기가 같은 판정을 쓰고 입력 `{from, value, categories}`에 모드가 없다
   (`locks.ts:634-640`, `ImagePanel.vue:555-559`·`:600-604`). 목록에 테스트 범주를 더하면 C 만들기가 `nameTaken`으로 막히는데(시험 확인),
   고아 `test/C`는 화면 어디에도 안 보인다(`.mlpx` 왕복 뒤에도 목록 `[A,B]`, 테스트 `[A,B,C]`) — "이미 있는 이름"은 거짓이고 R12 A-2의
   덫과 같다(`ImagePrepPanel.vue:110-114`). C를 다시 만드는 것이 옛 상태를 되살리는 유일한 길이다. 처방: 테스트 범주와의 겹침은 **이름
   바꾸기에서만**(`from !== ''`) 보고, 바꾸기는 거절·만들기는 통과를 둘 다 검사로 문다.
2. **거절한 뒤에도 화면이 성공한 것처럼 뒤처리한다.** `save`가 예외를 삼키므로(`ImagePanel.vue:480-491`) `commitName`은 성공 여부와
   상관없이 `retagPending(from, to)`·기준점 이동·창 닫기를 한다(`:606-614`). `renameCategory`가 그대로 돌려주면 판에 선 묶음만 `to`로 바뀌고,
   그 묶음을 구우면 `addImages`가 훈련 범주 `to`를 세워(`images.ts:440-448`) A-2가 막으려던 합치기가 이 길로 일어난다. 처방: **던진다**, 그리고
   `commitName`은 저장이 실패하면 뒤처리를 안 한다.
3. **결정문(106 개정)이 R11 B-5의 단정을 바로잡아야 한다.** provided 점수와 holdout 점수가 한 실험 목록에 나란히 서는 문이 하나 더 생긴다 —
   `clearTestImages` 머리말(`images.ts:324-327`)과 `RELIED_ON` 주석(`storage.ts:524-544`)이 막는다고 적은 상태다. 전제이므로 막자는 것이
   아니라 두 단정을 함께 고친다.
4. **작은 것 둘.** B-4의 새 키는 `{count}`를 담으므로 en에 복수 규칙(`|`, `docs/i18n.md:40`), 부르는 쪽은 `t(key, {count, name}, count)`.
   B-2의 `removeImages(…, 'test')`는 자리 안에서도 해시로 지운다 — 손으로 고친 파일에 같은 해시가 `test/A`·`test/B`에 함께 있으면 A를 지울 때
   B 것까지 지운다(시험 확인). 테스트 범주로 거른 경로만 지우거나 결정문에 적는다.

## 물음에 대한 답

1. 지적 1은 A-2로 닫히되 1·2가 조건. 지적 2는 B-3, 3은 문구와 B-5, 4는 A-1 자체 순회와 B-4 세는 함수로 닫힌다. **남는 것:** 업로드·붙여넣기로
   C 폴더를 올리면(`ImagePanel.vue:433`) 판정 없이 고아 `test/C`와 합쳐지고 106도 통과 — "만들기"와 같은 뜻이라 1의 처방과 맞지만, 계획 C의
   "106이 막는다"는 이 경우 거짓이다.
2. A-2는 **던진다**. 우리 버그라는 뜻이므로 `ClientError`보다 `refusalFor`의 `LOCK_GATE_UNKNOWN`(`locks.ts:684-686`)처럼 영어 `Error`.
3. B-3 뒤: `.mlpx` 왕복 통과(실험 방식 `provided`, 파일 holdout, 참조 없음 — `requireFolderBodies` 안 걸림). IndexedDB 열림, 뗀 자리 알림 없음.
   `withFolderCategories`는 테스트 폴더와 상호작용 없음. 비교표(`ExperimentList.vue:17,80`)는 대표 점수를 방식 표시 없이 나란히 세우고, 변경
   이력은 바로 앞 실험과의 `split.method`만 말한다 — 문서에 적는다. **점검: 사진 provided 실험에 지금도 `NO_TEST_DATASET`이 `IMAGE_NOT_OPEN`과
   함께 뜬다**(테스트 사진이 있어도 — `hasTestDataset`이 CSV 전용 `readTestDataset`에서 온다: `InspectView.vue:250`, `dataset.ts:82-85`,
   `ReproducePanel.vue:180`, `reproduce-gate.ts:94`). 계획과 무관한 기존 거짓이다.
4. 테스트 자리를 직접 바꾸는 편집은 `applyTestImages`·`clearTestImages` 둘(계획 뒤 `renameCategory`·`removeCategory`가 더해짐). 훈련 범주만 바꿔
   관계를 흔드는 곳은 1차의 여섯에 붙여넣기(`usePasteImages` → `addImages`)가 더해진다.

## 확인 못 한 것
화면 렌더링 · `commitName` 뒤처리 어긋남은 코드로만 확정 · 계획 자체는 코드가 없어 바깥에서 흉내 낸 `planRemove`로만 · 고아 테스트 폴더가 있는 옛 레코드의 수.
