# 0.35.2 경계 감사 C — 범주를 고친 뒤의 화면 · 범주와 묶음의 폴더 이름 — `e78cbd1` — A 0 · B 0 · C 3

> 감사자(Fable)의 회신을 오케스트레이터가 옮겨 적었다. 요청서 `request-0.35.2-edges-C.md`. 돌연변이 21개(V 12 · S 7 · 처방 2). 기준선
> 10스펙 667개·`vue-tsc --build` 초록. 재판단은 오케스트레이터가 원 저장소에서 재현한 뒤 적었다.

## 지적과 재판단

| 지적 | 자리 | 주장 | 재판단 |
|---|---|---|---|
| **C-1** | `project/portfolio-bundle.ts`의 `folderFor` | 교사 묶음의 폴더 이름이 운영체제 규칙을 안 거친다. 감사자가 묶음 일곱 벌을 실제로 풀었다 — 윈도 `Expand-Archive`는 `a:b`·`q?` 같은 이름 하나가 든 묶음을 **통째로 안 풀었고**, 파이썬 `zipfile`·bsdtar는 말없이 글자를 바꿔 `q?`+`q*`, `dot.`+`dot` 같은 두 학생을 한 폴더로 합쳐 뒤엣것이 덮었다 | 감사자는 C로 매겼지만 한 학생의 파일 이름이 서른 명 묶음 전체를 막는다. 결정이 걸리지 않는다 — `data/file-name-rules.ts`가 이미 "반출 경로는 고쳐서 내보낸다"를 규칙으로 둔다. **고침** `d1be26a` — 조각마다 금지 문자·제어 문자를 걷고 앞의 점과 끝의 점·공백을 떼고 예약 이름을 피한다. 걷는 방식은 `.mlpx` 이름(`sanitizeSegment`)과 같되 **공백은 남긴다**. 오케스트레이터가 그런 이름표 여덟을 담은 묶음을 `Expand-Archive`로 풀어 여덟 폴더가 모두 서는 것을 확인했다 |
| **C-2** | `views/train/ImageTrainContext.vue`의 범주 수 | 머리말은 "학습에 들어갈 사진 수와 범주 수"인데 범주는 빈 범주까지 든 `imageCategories`를 센다 — 빈 범주를 만들면 머리는 N, 학습은 N-1. 이 머리를 띄우는 스펙이 없다(S5 안 욺) | 규칙과 코드가 어긋난 것이라 결정이 걸리지 않는다. **고침** `0b20ee9` — `labeledCategoryCount`를 센다. `image-train-context.spec.ts`가 옛 코드에서 "3개"로 운다. 이웃 `ImagePrepContext.vue`는 머리말이 "사진이 몇 장이고 범주가 몇 개인가"라 화면 목록을 세는 것이 맞다 — 고치지 않았다 |
| **C-3** | `project/images.ts`의 `addImages` 범주 이름 가드 | 사진은 판정 전에 범주 폴더에 앉고 `imageCategories`는 폴더가 이기므로, 이 가드는 목록 순서만 바꾸고 아무것도 못 막는다(V12 안 욺). 실제 거절은 올리기와 이름 창이 앞에서 한다 | **기록만 했다.** 학생이 다치는 길이 없고(입구 둘이 V10·V11로 문다), 가드를 지울지 앉히기를 막을지는 설계를 고치는 일이다. 다음에 `addImages`를 만질 때 볼 자리로 남긴다 |

## 본 것 — 지적 없음 (감사자)

- **범주를 고친 뒤의 화면** — `App.vue`의 `<RouterView :key>`, `KeepAlive` 없음. 화면은 바뀔 때마다 다시 마운트되고, 화면을 넘어 사는 상태에
  범주 이름을 쥔 것이 없다. 범주 편집의 입구는 `ImagePanel.vue` 하나이고 그 화면의 파생 상태(판의 묶음·gate의 테스트 범주·shift 기준점·확인 창 장수·
  만들기/바꾸기)는 전부 문다(S1~S4·S7).
- **`isValidCategoryName`** — 갈래 여덟이 전부 `image.spec.ts`에 물리고, 입구 둘(이름 창·올리기)도 문다.

## 돌연변이 표 (감사자)

| id | 자리 | 결과 |
|---|---|---|
| V1~V8 | `canonical.ts`의 `isValidCategoryName` 갈래 여덟 | 전부 운다 |
| V9 | `file-name-rules.ts` `"`·`<`·`>` 제거 | 운다(`format.spec`만) |
| V10 | `locks.ts` 이름 창 gate | 운다 |
| V11 | `upload.ts` 올리기 | 운다 |
| V12 | `images.ts`의 `addImages` 가드 | **안 운다** → C-3 |
| S1~S4 | `ImagePanel.vue` 파생 상태 | 전부 운다 |
| S5 | `ImageTrainContext.vue` 범주 수 +1 | **안 운다** → C-2 |
| S6 | `ImagePrepPanel.vue` `testScoredBy` | 운다 |
| S7 | `locks.ts` 만들기도 `nameTakenByTest` | 운다 |
| P1·P1b | 묶음 폴더 처방 | P1은 `dot.`·`x `가 남아 불완전, P1b는 세 도구 모두 풀림 |

## 못 한 것 · 확정 불가 (감사자)

- 이름을 바꾼 뒤 학습 화면의 [학습하기]까지 누르는 화면 단위 스펙은 세우지 않았다(파일 단위 `training-source.spec`의 "결정 106"만 있다).
- 윈도 탐색기·7-Zip·반디집으로 풀기는 GUI라 안 했다 — `Expand-Archive`·`zipfile`·bsdtar 셋만 쟀다.
- 같은 프로젝트를 두 탭에서 고치는 경우 — **확정 불가**, 범위 밖(두 탭 잠금이 막는 설계)으로 보인다.
- `nul.txt`가 옛 윈도에서도 폴더가 되는지 — **확정 불가**. 고침은 보수적으로 `nul_.txt`로 피한다.
