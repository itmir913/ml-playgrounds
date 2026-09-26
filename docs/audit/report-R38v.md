# R38v 감사 회신 (코드 소유자가 옮겨 적음) — A 0 · B 2 · C 3 (**라운드가 잘렸다**)

main f05a48c. 권한 분류기가 감사자의 worktree 소스 수정과 스펙 실행("Modify Shared Resources")을 거절 → **돌연변이 0, 처방 미측정.** 아래는 임시 탐침 스펙 실측(지움) 또는 코드 읽기.
뿌리: **같은 라우트 레코드 안에서 프로젝트를 옮기면 각 화면이 들고 있던 미확정 초안(일괄 묶음·확인 대기 테스트 사진·올린 표)과 진행 중 백그라운드 작업이 다음 프로젝트로 넘어간다.** 오늘의 `claim()`은 굽기·임베딩 뒤 창만 본다. 선례: 표 예측 `TabularPredictPanel.vue:266` `watch(() => project.projectId, clear)` — 다른 화면으로 안 번짐. 닿는 길: 앱 안 링크는 없고 뒤로 가기 목록 길게 누르기·주소창(R39a B-1과 같은 부류라 B).

## B-1 초안이 프로젝트 전환을 건너 다른 프로젝트에 쓰인다 (다섯 자리, 셋 실측) — **코드 소유자 결정: 프로젝트마다 화면을 새로 띄운다(`App.vue` RouterView에 프로젝트 id key)**
실측(스토어에 B를 앉혀 전환, `image-prep-fail.spec.ts` 방식):
- (a) `ImagePrepPanel.vue:344-381` `readTest` — claim은 `takeTest`(`:267`) 안, 읽기는 `if (!alive()) return`(`:374`)만. 테스트 zip 드롭(arrayBuffer 붙잡음) → B(실험 없음, 같은 범주) → 풀기 → 굽기 → **B가 A의 테스트 사진 2장**, `preprocess.testImagesAdded` 토스트, B 분할 provided. `:261-266` 주석이 굽기 창만 덮는데 더 큰 보장처럼 읽힘.
- (b) 같은 판 `pendingTest`(`:160`)·`testAttaching`(실험 있음, 확인 창) — A에서 드롭 → 확인 대화상자 → B → [추가하기] → **B 테스트 사진 2장, B 실험 1→0.**
- (c) `manualTestChoice`(`:139`) — A에서 ② → B 라디오가 ②, 드롭 존 열림(무해).
- (d) `ImagePanel.vue:105` `pending` — A에서 "강아지" 묶음 → B(사과·배) → 판에 그대로, `bake()` → **B 범주 `["사과","배","강아지"]` 사진 6.** `readPicked`(`:220-271`) claim 없음, zip 읽기가 전환을 건너면 묶음이 B 판에 섬. bake 주석(`:317-322`) 의도와 반대(전환이 굽기 전이면).
- (e) `TabularPanel.vue:83` `opened` — A에서 `fromA.csv` → B → 판에 그대로, `apply()` → **B 정본이 fromA.csv**, B에 실험 있으면 확인 뒤 삭제.
코드 읽기만: `TabularPrepPanel.vue:466` `openedTest`·`:469` `testAttaching`(A 테스트 표가 B에, B 실험 삭제), `BatchPredict.vue:91` `opened`(예측 데이터가 B에, 점수 무관).
처방 (1) 판마다 projectId watch + readTest·readPicked claim — 오늘만 두 번 빠뜨림 (2) **`App.vue` `<RouterView :key="$route.params.projectId">`** — 프로젝트마다 재마운트 → alive 내려가고 진행 작업 취소·지역 상태 초기화, B-2·C-1~C-3도 풀림(권고, 채택됨). 무는 검사 없음 — `image-prep-fail`·`image-panel-drop`·`tabular-panel-overlap`에 "읽는 중 전환"·"초안 선 채 전환" 판.
## B-2 이미지 예측 답 루프 하니스가 여전히 없다 (R38 "못 한 것") — `ImagePredictPanel.vue:452-521`(오늘 `:443`·`:519`의 `|| !ours()` 포함). `tests/image-predict*.spec.ts`에 answers|perRun|probabilities|predicted 0건. 임베딩 전환 검사는 `:432`만(addEmbeddings가 무조건 저장). `:443`·`:519`·쪽 바뀔 때 자동 재실행·상한 스위치 뒤 쪽 재배치를 아무 스펙도 안 지남(추론). 처방: 모델 있는 이미지 프로젝트(벡터·전처리기)를 앉혀 `run()`을 답까지 모는 하니스(R38 C-5 재개).
## C-1 A의 백그라운드 작업이 B 화면을 잠갔다가 말없이 사라짐(코드 읽기) — 이미지 판 셋은 취소 안 하고 결과만 버림: ImagePanel `shownBatch` 진행·[취소], ImagePrepPanel busy, ImagePredictPanel predicting→photosLocked(`:608`), 백본 12.4MB 받기 포함. key로 사라짐.
## C-2 ImagePredictPanel answers·predicted·page가 전환을 건넘(표 예측은 `:266`에서 비움) — key로 사라짐.
## C-3 ImagePanel selected·anchor가 전환을 건넘(같은 사진 해시면 "N장 선택"이 B에) — key로 사라짐.

## 돌연변이 0 (계획만): ImagePanel `:352`·`:372` `|| !ours()`·clearIfHeld · ImagePredictPanel ours `:294`·`:323`·`:432`·`:443`·`:519` · ImagePrepPanel `:295` · TabularPrepPanel runPlan→planRun·plannedColumnList 인자 순서·fittedColumns undefined · ChartDialog scrollIntoView · 레이아웃 클래스 되돌리기 · R38-verify-2의 조용 30.
## 조용했던 자리: TabularPrepPanel 계획 캐시(taskType 같은 칸, plannedColumns/fittedKinds 옛 인라인과 등가, planRun 읽는 설정 넷+표 둘, 상한 스위치 무관, 공유 계획 제자리 변경 0) · ChartDialog.pickTool · 레이아웃 커밋(클래스만, 주석 사람 확인) · 정본 CSV 콤마(dataset.ts 셋 다 parseCanonicalCsv, 업로드는 추정) · zip 이름(8da2fb8 교환 인정) · jsdom 머리 줄 · 오늘 주석(ImagePrepPanel:261-266만 과장).
