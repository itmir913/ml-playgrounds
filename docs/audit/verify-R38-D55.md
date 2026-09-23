# R38-D55 재확인 요청서 — 회신 두 개를 닫은 고침을 다시 본다

> **이 요청서는 배포 문이다.** 코드 소유자가 정했다 — *"Fable이 승인해야만 태깅, 버전업, 배포
> 가능하다."* 그래서 회신 끝에 **판정 한 줄**을 달라(§6). 회신은 `docs/audit/report-R38-D55-verify.md`.
>
> 앞 회신은 둘이다 — `report-R38-D55.md`(결정문 55, **A 1 · B 6 · C 9**)와
> `report-R38-verify-2.md`(R38 재확인, **B 2 · C 1**). 이번 고침은 둘을 한꺼번에 닫는다.
>
> 공통 규칙은 `docs/workflow.md` §3의 **"감사 국면은 어떻게 도는가"**부터 **"감사가 되풀이해
> 잡은 병"**까지다. 금지 목록(커밋·`push`·`tag`·`add` · `npm run lint` · `git stash`·
> `git checkout .`·디렉터리 단위 되돌리기 · 하위 에이전트·클라우드 · 버전 올리기 제안)과 등급,
> 돌연변이 절차, 보고서 서식이 거기 있다. **감사자는 고치지 않는다** — 임시 스펙은 심어도 되고
> 끝나면 지워라.
>
> **체급이 Fable인 이유.** 앞 라운드와 같다 — 학습에 넘기는 것(층화 뽑기)을 다시 바꿨고,
> 이번에는 **`.mlpx`의 `formatVersion`이 올랐다.** 학생 파일의 호환이 걸린 자리다.
>
> `git status --short`가 더러운 것은 정상이다 — 병렬 세션이 같이 돈다.

## 0. 코드 소유자가 정한 것

- **`formatVersion`을 3으로 올린다** (2026-09-23). B-1이 옛 판(0.26.6)을 실제로 돌려 잡음 표
  정확도 1.0을 쟀고, 소유자가 그것을 보고 정했다. 명세는 `mlpx-spec.md` §9.3 — 어휘도 구조도 안
  바뀌고 **뜻**만 바뀌어서 마이그레이션은 항등이다.
- 나머지 결정은 내가 결정문 55의 원칙("끄지 않고 잠근다")을 적용해 내렸다. 소유자가 원칙을
  **전수로** 적용하라고 했으므로(*"어떤 옵션을 킬 경우 다른 설정에 영향을 미치는 모든 경우를
  잡아야 한다"*) 따로 묻지 않았다. **내 적용이 원칙과 맞는지가 §2의 첫 물음이다.**

## 1. 대상

| 커밋 | 무엇 |
|---|---|
| `82bd63c` | 문서 — 결정문 55 보강(A-1·B-6·표의 6~8·반쪽 넷·인코딩 판정·sklearn·재실행 문장), 53 각주 둘(R38-V2 B-1·C-1), `mlpx-spec` §9.3, `architecture.md` §8.9.1.1(히스토그램), 에러 코드, `02-tabular.md`의 "마지막 방어선" |
| `a31b0d2` | 코드와 그물 전부 |

지적마다의 처리. **"그물"은 그 고침을 무는 검사이고, 전부 돌연변이로 울렸다**(§4).

| 지적 | 처리 | 자리 | 그물 |
|---|---|---|---|
| **D55 A-1** `provided`에서 층화 뽑기가 꺼짐 | `stratifyBlockFor`가 뽑기 사유 다음에 `holdout`이 아니면 `null` — 네 처방 P1 그대로. `shareStratifyBlock`의 같은 가드는 지웠다(한 자리) | `ml/selection.ts` | `plan.spec` *"따로 받은 테스트 데이터면 1개뿐인 범주도 층화 뽑기에 남는다"*(씨앗 40개) · `selection.spec` *"…뽑을 때의 사유만 센다"* |
| **D55 B-1** 옛 판이 타깃을 특성으로 | `FORMAT_VERSION` 3, `MIGRATIONS[2]` 항등, 정본 `v3.json`=`v3.released.json`=v2의 내용, 지문 한 줄 | `project/schema.ts` · `migrate.ts` | `migrate.spec` *"문서가 글자 하나 안 바뀌고 번호만 3이 된다"* · `schema-structure.spec` B(아래 §2-7) |
| **D55 B-2** 체크리스트가 잠긴 줄을 셈 | `factsOf`가 `trainableSelections`로 센다(유형이 없으면 목록 그대로) | `stores/project.ts` | `option-cascade` *"…체크리스트가 모델을 안 고른 것으로 센다"* |
| **D55 B-3** 잠긴 줄의 손잡이 열림 | 입력에 `:readonly="reasons.length > 0"` — 값은 보이고 지우지 않는다 | `ChosenModels.vue` | `option-cascade` *"잠긴 줄에는 예상 시간이 없고 손잡이는 읽기만 된다"* |
| **D55 B-4** 히스토그램 자동이 학생의 수를 덮음 | 학생이 [적용]한 수를 `chosen`에 따로 든다. 자동을 끄면 그 수로 돌아온다(고른 적 없으면 결정문 45 그대로) | `HistogramChart.vue` | `chart-handles` *"자동을 켰다 끄면 학생이 고른 구간 수로 돌아온다"* + 짝 |
| **D55 B-5** 예측 필터가 전부 켬으로 | `carriedFilter` — 없어진 것만 떨구고 새것만 켠다. **프로젝트가 바뀌면 처음부터**(열쇠에 `projectId`) | `ml/predict.ts` · 두 예측 판 | `predict.spec` 셋 · `predict-invalidation` *"끈 알고리즘은 꺼진 채이고 새 실험은 켜진다"* |
| **D55 B-6** `provided`+뽑기에서 체크박스 숨음 | 그 갈래에서 체크박스가 **뽑기 카드의 요약 안에** 선다. ①이면 옆 카드, 뽑기가 없으면 안 그린다 | `TabularPrepPanel.vue` | `option-cascade` *"…뽑기가 켜져 있을 때만 체크박스가 하나 선다"* |
| **D55 C-1** "마지막 방어선" 주석 | *"오늘은 안 닿는다 — 계획을 안 거치는 호출이 생기면 방어선"*으로 | `split.ts` · `sample.ts` · `plan.ts` · `02-tabular.md` | 주석 |
| **D55 C-2·C-3** sklearn · 재실행 문장 | 결정문 55에 sklearn이 던지는 입력과 "일부러 갈라선다"를 적음. 재실행은 "기록된 분할을 그대로 쓴다"로 | `open-decisions.md` 55 | 문서 |
| **D55 C-4** 특성 요약 *"5개 중 4개"* | `featuresInUse`로 센다 | `TabularPrepPanel.vue` | `option-cascade` *"…특성 요약이 뺄셈을 시키지 않는다"* |
| **D55 C-5** `plan.ts`가 없는 검사를 가리킴 | `option-cascade.spec`의 실제 이름으로 | `plan.ts` | — |
| **D55 C-6** 인코딩 끈 문자 열 | **안 잠근다고 판정했다** — 잠그면 인코딩을 먼저 켜야 그 열을 고를 수 있다(고르는 순서 강제, 「고르는 자리는 잠그지 않는다」). 결정문 55에 적었다 | 문서 | — |
| **D55 C-7** 조용한 11 | 아래 §4 — N10은 가지를 지웠다 | — | 새 스펙 둘 + 기존 여섯 |
| **D55 C-8** 일괄 예측 쪽 번호 | 파일·판 크기가 같으면 그 쪽에 남는다(끝 쪽으로 클램프) | `BatchPredict.vue` | `batch-predict-page` *"모델만 바뀌면 그 쪽에 남고, 파일이 바뀌면 첫 쪽이다"* |
| **D55 C-9** ①이 테스트 파일 초안을 버림 | 안 버린다 | `TabularPrepPanel.vue` | `option-cascade` *"①을 골랐다 ②로 돌아오면 읽어 둔 테스트 파일이 그대로다"* |
| **V2-B1** 쓸 행 0개에 타깃 빨강 | 계획이 종류를 보기 **전에** `SPLIT_TOO_FEW_ROWS(actualRows 0, minRows provided면 1)`로 선다. `targetKind`를 안 싣는다 | `plan.ts` | `tabular-prep-kind` *"쓸 수 있는 행이 0개면 숫자뿐인 타깃 줄이 조용하고 계획은 행 수로 선다"* |
| **V2-B2** 사진 칸 `@click` 끊겨도 초록 | 스펙이 `ImageGrid`의 사진 단추를 `trigger('click', { shiftKey })`로 누른다. `panel.toggle` 0건 | `image-panel-rename-pending.spec` | VS1·VS2 운다 |
| **V2-C1** 테스트 표 타깃 문구 | 새 코드 `TEST_DATASET_TARGET_NOT_NUMERIC`(ko/en). 정본의 `targetKind`는 그대로라 타깃 줄은 조용 | `errors.ts` · `plan.ts` · 로케일 | `plan-not-number` *"테스트 표의 타깃이 글자면 테스트 표의 이름으로 말한다"* |
| **V9** 시간 초과로만 욺 | `answered()`가 [가져오기] 뒤 칸이 채워졌는지 **먼저** 단언 | `predict-invalidation.spec` | V9가 수십 ms에 운다 |

## 2. 적대적으로 볼 것 — 내가 가장 의심하는 순서

1. **원칙 적용이 맞는가.** 결정문 55 표의 6~8(히스토그램·예측 필터·쪽 번호)과 반쪽 넷을 내가
   원칙으로 판정했다. 특히 **C-6을 "연쇄 아님"으로 둔 판정**이 원칙과 충돌하는지 — 55의 표는
   *"B를 잠그고 이유를 말한다"*인데 나는 「고르는 자리는 잠그지 않는다」(2026-09-03 소유자)를
   들어 안 잠갔다. 두 원칙이 이 자리에서 부딪히는가, 아니면 내 판정이 둘을 다 지키는가.
2. **A-1의 이웃.** `provided`에서 이제 판정은 뽑기 사유와 유형 사유만 낸다. `provided`인데
   **테스트 파일이 아직 없는** 상태(라디오만 ②, `manualTestChoice`)는 설정이 `holdout`이라 나눌
   때의 사유가 **다시 선다** — 그때 체크박스는 뽑기 카드에 선다(B-6의 `testChoice`가 수동 값을
   본다). 그 순간 체크박스가 말하는 이유가 참인가. 이미지의 `provided`는 뽑기 손잡이가 없어
   오늘 안 닿는다고 봤다 — 손으로 고친 `nSamples`가 든 이미지 파일로 재라.
3. **B-6의 위치.** 같은 `split.stratify`가 갈래에 따라 **다른 카드**에 선다(①이면 테스트 데이터
   카드, ②+뽑기면 뽑기 카드). 한 순간에 둘이 동시에 서는 길이 있는가(두 칸이 한 값을 가지면
   안 된다). `onStratify`의 DOM 되돌리기는 두 자리 다 같은 함수다.
4. **B-5의 열쇠.** `carriedFilter`의 "새로 생긴 것"은 **직전 선택지에 없던 값**이다. 실험을
   지웠다가 같은 id가 다시 생기는 길이 있는가(실험 id의 출처를 확인하라). 프로젝트 전환은
   `projectId`로 가른다 — 같은 프로젝트를 닫았다 다시 열면(판이 남아 있는 채) 어떻게 되는가.
5. **C-8.** 쪽을 지키는 열쇠는 `predictDataset.hash | pageSize`다. 파일을 **같은 바이트로** 다시
   붙이면 같은 쪽에 남는다 — 그것이 옳은가. 모델을 줄여 `totalPages`가 줄어드는 길은 없다고
   봤다(행 수가 쪽을 정한다) — 맞는가.
6. **V2-B1.** `provided`에서 `minRows: 1`이고 문장은 *"…훈련 데이터와 테스트 데이터로 분할할 수
   없습니다"*다 — `split.ts`의 `providedSplit`이 이미 같은 코드·같은 인자로 던지던 문장이라
   새로 만든 거짓은 아니라고 봤다. **그 문장이 `provided`에서 참인가**는 따로 판정해 달라.
   그리고 이제 `targetKind`가 안 실려 타깃 줄이 **파일 전체의 종류**로 돌아간다 — 타깃이
   **전부 빈** 열이면 파일 전체로도 범주라 여전히 빨강이다(회신 표의 둘째 줄). 남겨도 되는가.
7. **`formatVersion` 3.**
   - `schema-structure.spec`의 B(*"직전 정본과의 사이에 깨는 변경이 하나는 있다"*)를 **풀었다** —
     `RAISED_FOR_MEANING = { 3: … }`에 적힌 버전은 반대로 **깨는 변경이 0개임을 단언**한다. 이
     풀림이 다음 버전에 새는가.
   - **옛 판이 새 파일을 실제로 거부하는가** — 네가 앞 라운드에 띄운 0.26.6 트리로 v3 파일을
     열어 `PROJECT_FILE_VERSION_TOO_NEW`가 서는지 재 달라. 이것이 이 올림의 **유일한 효과**다.
   - 새 판이 v2 파일(옛 판이 쓴 것)을 열고 저장하면 v3이 된다 — 그 파일을 옛 판이 다시 못 연다.
     학교 PC(새 판)와 집 PC(배포 전 탭)가 섞이는 교실에서 그 비용이 결정문대로인가.
   - IndexedDB에 든 프로젝트(`loadProject`)도 같은 체인을 지나는가 — 파일만 보지 마라
     (「포맷 2가 나갔다」의 교훈: **떨어뜨리는 자리가 파일과 저장소 둘이었다**).
8. **새 스펙의 굵기.** `option-cascade-train.spec`은 워커 보고를 붙잡아 하나씩 흘린다. 보고를
   **모아서** 흘리는 경로(한 틱에 둘)에서도 자리 짝짓기가 맞는가. 그리고 이 스펙이 교정
   보고를 `drain()`으로 먼저 다 흘리는데, 교정이 학습 **도중** 끝나는 길은 안 지난다.

## 3. 다시 심을 것

§4의 25개를 **네 러너로** 다시 심어라 — 내 러너가 욺을 잘못 셀 수 있다(돌연변이 러너가 스폰
실패를 욺으로 센 적이 있다). 그리고 **앞 회신 §4.1의 M1~M17과 N 계열 중 운 것**이 이번 고침
뒤에도 우는지 — 특히 `shareStratifyBlock`의 가드를 옮겼으므로 **M11·M12·N4·N5**.

## 4. 내가 심은 돌연변이 25 — 전부 운다

러너는 파일을 통째로 읽어 두고 `finally`에서 되쓴다. 전후 `git diff`의 해시가 같다.

| # | 자리 | 바꾼 것 | 운 검사 |
|---|---|---|---|
| A1 | `selection.ts` | `provided` 가드 삭제 | `plan` 1 · `selection` 2 |
| B6 | `TabularPrepPanel.vue` | `stratifyOnSampleCard` → `false` | `option-cascade` |
| C4 | 같은 파일 | 요약을 목록 길이로 | `option-cascade` |
| C9 | 같은 파일 | ①에서 초안 비움 | `option-cascade` |
| B2 | `stores/project.ts` | 목록 길이로 셈 | `option-cascade` |
| B3 | `ChosenModels.vue` | `readonly` 삭제 | `option-cascade` |
| B4 | `HistogramChart.vue` | `chosen` 안 적음 | `chart-handles` |
| B5t | `TabularPredictPanel.vue` | 감시자를 `defaultFilter`로 | `predict-invalidation` |
| C8 | `BatchPredict.vue` | 늘 첫 쪽 | `batch-predict-page` |
| V2B1 | `plan.ts` | 0행 가드 끔 | `tabular-prep-kind` |
| V2C1 | `plan.ts` | 옛 코드로 | `plan-not-number` |
| N6 | `TrainView.vue` | `every` → `some` | `option-cascade-train` |
| N18 | `TrainView.vue` | 상태를 자리 그대로 | `option-cascade-train` |
| N19 | `TrainView.vue` | 시각을 자리 그대로 | `option-cascade-train` |
| N7 | `ChosenModels.vue` | 잠긴 줄에도 예상 | `option-cascade` |
| N12 | `TrainView.vue` | 예상 폭이 타깃을 안 뺌 | `option-cascade`(`vm.featureWidth` — 읽기만) |
| N1 | `plan.ts` | 군집에서도 거름 | `option-cascade`(계획을 지나는 판) |
| N2 | `training-source.ts` | 이미지면 안 거름 | `training-source` |
| N11 | `ImagePrepPanel.vue` | 판정에 고정 분할 | `image-prep-stratify` |
| N22 | 같은 파일 | 안 잠금 | `image-prep-stratify` |
| N14 | `selection.ts` | 등록부 밖도 거름 | `option-cascade` |
| VS1 | `ImageGrid.vue` | shift 버림 | `image-panel-rename-pending` |
| VS2 | 같은 자리 | `@click` 빈 함수 | 같은 스펙 2 |
| V9 | `TabularPredictPanel.vue` | [가져오기] 빈 함수 | `predict-invalidation` 3(수십 ms) |
| F3 | `migrate.ts` | v2→v3이 설정을 고침 | `migrate` |

**N10은 심을 자리가 없다** — 산점도 색 열의 되돌림 가지를 지웠다(닿지 않는 코드, 네 판정).
그 자리에 *"왜 가르지 않는가"*를 주석으로 적었다. **N12는 화면의 안쪽 값을 읽는다** — 예상 시간
문자열로는 4열과 7열이 같은 반올림에 떨어질 수 있어서다. 그것이 약한 그물인지 판정해 달라.

## 5. 못 한 것 · 사람 확인

- **브라우저로 안 봤다.** B-6의 체크박스가 뽑기 카드 안에서 어떻게 보이는지, 잠긴 줄의
  `readonly` 칸이 잠겨 보이는지(회색이 아니라 대비 그대로다 — §8.9.1.1의 판단을 따랐다),
  히스토그램 칸이 자동을 끌 때 학생의 수로 바뀌는 모양. **코드 소유자가 눈으로 본다.**
- **`readonly` 숫자 칸의 화살표·휠** — 브라우저가 안 움직인다고 알고 있다. 재지 않았다.
- 옛 판이 v3을 거부하는 것은 **코드로만** 봤다(`migrate.ts`의 `version > FORMAT_VERSION`).
  §2-7에서 재 달라.

## 6. 판정

회신 끝에 **한 줄**로 답하라 — **태깅·버전업·배포를 해도 되는가.** 되면 *"승인"*, 안 되면
막는 지적의 번호. A가 남으면 승인이 아니다. B는 이유를 달아 승인과 함께 둘 수 있다.

## 7. 규모

관문 `npm run ci` — **201파일 · 4,017 통과 · 2 건너뜀 · 125.5초, `build`까지 초록**
(`a31b0d2`). 건너뜀이 3에서 2로 준 것은 `schema-structure.spec`의 B가 v3에서 깨어났기 때문이다.
