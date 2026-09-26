# R39a 감사 회신 (코드 소유자가 옮겨 적음) — A 2 · B 3 · C 3

뿌리 둘: **같은 판정을 화면마다 다른 축으로 다시 한다**(R38이 전처리 판만 고쳤고 학습 화면은 남았다) · **gate가 컴포넌트 안에 있어** 동작이 거절하는 조건과 버튼 잠금 조건이 갈리는데 관문이 그 차이를 못 본다.

## A
### A-1. R38 A-2·V-A1 고침이 학습 화면으로 안 번졌다
- 자리: `views/TrainView.vue:342-350`(`targetIssue`), `views/train/TabularTrainContext.vue:28-40`(`usableFeatures`), 이웃 `TrainView.vue:282-289`(`featureWidth`).
- 세 자리가 파일 **전체** 행 종류(`summarizeColumns`)로 판정. 전처리 판은 계획(`planRun`) 종류로 덮게 고쳐졌다(`TabularPrepPanel.vue:176-186` `plannedColumns`).
- 재현(진짜 CSV 입구 + 진짜 라우터): `scoreCsv(true)`·회귀·`drop`(새 프로젝트 기본) → `planRun().ok === true`인데 학습 화면에 "타깃 열에는 숫자가 아닌 값" 빨강. `surveyCsv(true)`·인코딩 `none` → 전처리 판 `usableFeatures=2`, 학습 머리 "학습에 쓰는 특성 1개". 처음부터 학습 화면으로 띄워도 같은 틀린 값 — 갱신 누락이 아니라 축이 다름(병 6). 픽스처는 `tests/tabular-prep-kind.spec.ts`에 있음.
- 처방(잼): `plannedColumns` 덮기를 `ml/` 순수 함수로 빼서 세 자리가 공유. `targetIssue`를 `planRun().targetKind ?? summary.kind`로 → 빨강 사라짐, train-walk·option-cascade-train 초록. `TabularTrainContext`에 같은 덮기 → 2. 실제 고침은 `readTestDataset(file)`을 넘겨야 함. 계획은 한 번 짓고 셋이 나눠 쓰게(전처리기 적합 비용).
- 이웃: `summarizeColumns` 소비자 6곳 중 이 병 3곳. `views/inspect/ReproducePanel.vue:213`도 같은 병(예상 폭만, 다른 라운드 몫).
- 무는 검사 없음. `tabular-prep-kind.spec.ts`의 두 입력을 학습 화면에 태우면 세울 수 있음.

### A-2. 점검 화면: 요약 훑기 중 줄 둘을 연달아 누르면 "읽는 중"에 갇힌다 (감사자: B로 내려도 반박 안 함)
- 자리: `composables/useRoster.ts:206-218`(`open`의 `unshift`), `:163`(`run`의 앉히기), 화면 가드 `views/InspectView.vue:233`.
- 훑기가 파일 하나 읽는 중에 c→d 누르면 큐 `[d, c, …]` → d가 먼저 앉고 c가 나중에 앉음 → 화면은 d, 명렬은 c → `viewing` 영원히 null.
- 재현: 컴포저블 `opened.item.label` 기대 `d.mlpx` 실측 `c.mlpx`; 화면(`inspect-open-race` 하니스, 모든 읽기 끝난 뒤) `{summary:false, reading:true, hasC:false}`. 기존 `inspect-open-race.spec.ts`는 빈 큐만 봄 — 결함은 폴더 고른 직후 교사가 줄을 누르기 시작할 때.
- 처방(잼): `let wanted`를 `open()`에서 갱신, `run()`은 `job.item.label === wanted`일 때만 앉힘 → 탐침 둘과 관련 7파일 68개 초록. 이웃 1.

## B
### B-1. 같은 학습 화면 인스턴스에서 프로젝트를 갈아타면 A의 실험이 B에 앉는다
- 자리: `TrainView.vue:604-607`(`applyExperiment`), `:583`(임베딩), `:681`(떠나기 가드만). `App.vue:59` `<RouterView />` 키 없음.
- `/project/A/train` → `/project/B/train`은 같은 라우트 레코드라 화면 재사용, `onBeforeRouteLeave` 안 돎, `alive`는 언마운트에서만 내려감. 예측 판 둘은 `project.projectId`를 봐서 처리하는데 학습 화면만 없음.
- 재현: A에서 학습 시작 → 해시로 B → B에 [멈추기] 남고 done 후 B `experiments.length === 1`. 주소창·뒤로 가기 여러 칸일 때만.
- 처방(잼): 시작한 `projectId`를 붙들고 `await` 뒤마다 비교 → B 실험 0. [멈추기]가 남으므로 `watch(projectId)`에서 `cancel()`까지. 전역 `beforeEach`가 `beforeRouteUpdate`보다 먼저 스토어를 바꾸므로 컴포넌트 가드 처방은 안 됨.
- 이웃: 소유 경로 2곳. 소유 밖 `await project.save(` 8곳 미확인 — **수정자가 확인하라.**

### B-2. 유형 없이 모델이 담긴 파일에서 [학습하기]가 켜진 채 아무 일도 안 한다
- 자리: `TrainView.vue:519-524`(`trainBlock`) 대 `:536`(`startTraining` 조기 반환).
- 재현: `manifest.taskType`만 뺀 파일 → 버튼 켜짐, 누르면 워커 0·알림 0. 스키마에 유형·모델 교차 제약 없음.
- 처방(잼): `trainBlock` 첫 줄 `if (project.taskType === undefined) return 'train.noTaskTypeReason'`(있는 키) → 잠김, 관련 4파일 20개 초록.

### B-3. §10의 트립와이어 약속이 거짓이다 — **코드 소유자 판단: ①로 간다**(CLAUDE.md §2 "잠기는 것에는 gate 함수가 하나 있고 이유 목록을 반환한다"의 적용이라 새 결정이 아님)
- 자리: `docs/architecture/04-capabilities.md` §10.2, `TrainView.vue:519`.
- 문서: "세어 보니 [학습하기] 조건은 하나뿐 … 두 번째 조건이 생기는 날 gate를 만들고 그날을 §10.3 검사가 알려 준다". 결정문 55 뒤 `trainBlock`은 조건 둘(B-2 넣으면 셋), 컴포넌트 안 computed 조기 반환.
- M2: computed에 이유 없는 `|| failure.value !== null` → ui-rules 조용(규칙이 computed를 설계상 허용), 행동 검사 3만 욺.
- ① `trainGate`를 `ml/`(또는 적절한 순수 모듈) 순수 함수로, 이유 목록 반환, §10.2 갱신 — mount 없이 조건별 검사.

## C
- C-1 `stores/toasts.ts` `push` 중복 제거 × `router/index.ts` 수위선: 같은 저장 실패 알림이 둘째 이동에서 걷힘 `{afterFirst:1, afterSecond:0}`. 처방(잼): 중복이면 옛 것 빼고 새 id로 다시 밂, toasts·router 22 초록, `push` 반환값 소비 0.
- C-2 무는 검사 없는 gate·표시: M3 `ModelAxes.vue:226` [추가] `:disabled="false"` 7파일 439 조용(처방 탐침: 이미 담긴 쌍이면 잠기고 이유를 말하는지 ModelAxes 단독 mount → M3에서 욺) · M21 결과 첫 줄 자동 펼침 `immediate` 제거 조용 · M28 홈 잠긴 단계 [이동] `v-if="true"` 조용 · M22·M30·M31·M33 조용.
- C-3 `TrainView.vue:292-297` `provided`에서도 예상 시간이 `usable × (1 − testSize)`로 시험 몫을 뺌(M30 조용). 첫 예상 과소, 배수 보정이 흡수.

## 돌연변이 33 — 욺 21 · 조용 12
조용: M2(ui-rules만 조용, 행동 3 욺), M3, M20·M27(사실상 같은 동작), M21, M22(mount 검사 0), M28, M30, M31, M33 외. 욺: M1 M4–M13 M15 M17–M19 M23–M26 M29.

## gate 전수(소유 경로 16자리)
이유와 함께 gate에서 나오는 자리 4(`trainBlock`, `modelAxes().blocked`, `chosenModelBlocks`, `stepBlockers`) — 그중 컴포넌트 밖 순수 함수가 아닌 것은 `trainBlock` 하나. computed 조합 1(`WelcomeView.canCreate`, 대화상자 국소 조건 §10.3 허용). 나머지 진행 잠금·쪽 넘기기. **결정문 55 옵션 연쇄는 학습·결과 화면에 남은 것 없음.**

## 못 한 것
실험 삭제는 저장소에 없음(grep 0) → 삭제 뒤 선택 상태 입구 없음 · B-1 소유 밖 이웃 8곳 · `PortfolioView` 언마운트 직전 `nextTick(watchSections)` 리스너 잔류 의심(미측정).

## 조용했던 자리
라우터 가드(잠긴 단계 해시 직접 이동 → 가장 가까운 열린 단계) · ResultsView·ExperimentDetail 선택 watch · 결과 패널은 실험 스냅숏 설정 사용 · ModelAxes 유형 전환(유지하고 이유와 함께 잠금) · useWork·useObjectUrls·usePasteImages·useTraining 해제 · stores/project open·close·resolve, WelcomeView 두 탭 잠금 소비자 · 소유 경로 `@click` async 0.
