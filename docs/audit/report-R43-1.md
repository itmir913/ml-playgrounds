# R43-1 감사 보고 — `project/**`·`stores/**`·`src/*.ts` — A 1 · B 1 · C 2

> 감사자가 파일을 쓰지 못해 오케스트레이터가 회신을 옮겨 적었다. 재현과 고침은 맨 아래 "오케스트레이터 재현과 고침"에 있다.

HEAD `2f6835a`. 돌연변이는 한 곳씩 심고 그 스펙만 돌려 심은 줄만 되돌렸고, 묶음마다 `git diff --quiet -- frontend/src backend`가
깨끗했다. 임시 스펙 넷은 지웠다. 측정은 개발 PC Node.

**한 줄 결론.** `.mlpx` 내보내기에 deflate도 워커도 다시 안 들어왔다(M8로 확인, 검사가 운다). 걸린 것은 테스트 사진을 받은 뒤
범주를 고치면 채점이 조용히 틀리는 것(A-1), 교사 묶음이 이미 구운 사진을 메인 스레드에서 deflate하는 것(B-1), 범주 수에 대해
제곱인 자리 둘(C-1).

## A

### A-1 테스트 사진을 받은 뒤 범주를 고치면 완벽한 모델이 정확도 0.5로 나온다
- **자리** `frontend/src/project/images.ts:575-597` `renameCategory`(데이터 자리만 옮김) · `:605-613` `removeCategory` ·
  `:475-500` `moveImages`(새 범주로) · `:509-556` `removeImages`(데이터 자리 한 범주를 비울 때)
- **주장** 테스트 묶음은 올릴 때만 범주 집합이 같은지 검사한다(`data/image/test-set.ts`의 `testZipBlockFor`). 그 뒤 데이터 화면에서
  범주를 고치면 `dataset/test/<옛 이름>/`이 남고 `split.method`도 `provided`로 남는다. 학습은 다시 검사하지 않는다
  (`ml/training-source.ts:204-249`, `ml/images.ts:211` `imageTestDataset`). 모델이 낼 수 없는 라벨로 채점되고, 던지지 않는다.
- **재현(진짜 입구)** `addImages` → `applyTestImages`(그 시점 `ok`) → 편집 → `imageTestDataset` → `evaluate`.
  ```
  base:         train=개/고양이     test=개/고양이  uploadGateNow=ok
  rename:       train=강아지/고양이 test=개/고양이  uploadGateNow=TEST_IMAGES_CATEGORY_MISSING
  remove:       train=_unlabeled/고양이 test=개/고양이 uploadGateNow=TEST_IMAGES_CATEGORY_UNKNOWN
  moveNew:      train=개/고양이/여우 test=개/고양이 uploadGateNow=TEST_IMAGES_CATEGORY_MISSING
  removeImages: train=고양이/여우   test=개/고양이  uploadGateNow=TEST_IMAGES_CATEGORY_MISSING
  완벽한 모델(rename 뒤): {"accuracy":0.5,"f1Macro":0.333}   (rename 전: 1 / 1)
  ```
  학습 화면을 백본까지 끝까지 돌리지는 못했다(Node에서 백본 불가). `evaluate`에 넣은 값은 학습이 같은 함수로 만드는 값이다.
- **처방(결정 필요)** ① 범주 편집이 테스트 자리도 함께 옮기고, 지우기·새 범주는 테스트 묶음을 떼고 알린다 ② 학습 입구에서
  `testZipBlockFor(imageCategories, 테스트 범주)`를 다시 불러 이유와 함께 거절한다(gate 함수 하나). 실측: `renameCategory`에 테스트
  자리 옮기기 5줄을 임시로 넣자 rename 줄이 `ok`가 됐고 관련 스펙 119개 초록. 나머지 셋은 ②로만 한 번에 닫힌다.
- **이웃** 데이터 자리만 고치는 범주·사진 편집 4곳(위). `addCategory`는 빈 범주라 해가 없다.

## B

### B-1 교사 포트폴리오 묶음이 이미 구운 사진을 메인 스레드에서 deflate한다 — 150MB에 7.7초
- **자리** `frontend/src/project/portfolio-bundle.ts:184` `zipSync(files, { level: ZIP_DEFLATE_LEVEL })`, `limits.ts:209`
- **주장** 워커는 없고 동기라 끝은 난다 — 축 ②의 "다시 들어옴"은 아니다(결정 64부터 있던 자리). 다만 결정 68 2차 처방이 `.mlpx`에서
  걷어낸 사유("이미 구운 포트폴리오 첨부도 눌리고 있었다")가 이 길에 그대로 남아 있다. 첨부는 webp·jpeg라 줄지 않고 출력이 조금 커진다.
- **재현(진짜 입구 `bundleOf`, 30명, 압축 안 되는 첨부 10장씩, 1회)**

  | 학생당 | 합계 | level 6 | 출력 | level 0(처방) |
  |---|---|---|---|---|
  | 0.625MB | 18.75MB | 966ms | 18,802,812 | 145ms |
  | 1.25MB | 37.5MB | 1,445ms | 37,557,312 | 154ms |
  | 2.5MB | 75MB | 3,340ms | 75,064,812 | 352ms |
  | 5MB(`MAX_PORTFOLIO_BYTES`) | 150MB | **7,717ms** | 150,079,812 | 464ms |

  `zipSync`만 150MB: level 6 5.1~5.3s · level 0 0.39~0.40s(각 2회). 상한을 끄면 학생당 5MB 제한이 없어 더 는다.
- **처방** 묶음도 STORE(level 0). portfolio-bundle·inspect-bundle 36개 초록. **무는 검사가 어느 쪽으로도 없다** — `.mlpx`의
  "무압축으로 담는다"와 같은 모양의 검사를 묶음에도 세운다. 결정 64·68의 범위를 넓히는 일이라 B.
- **이웃** 파일을 만드는 길 셋: `.mlpx`(STORE, M8이 문다) · 묶음(여기) · `download.ts:75` 예측 CSV(압축 없음). `zipSync`/`level`
  호출은 여기 하나.

## C

### C-1 범주 수에 대해 제곱인 자리 둘
- **자리** `images.ts:441` `addImages`의 `!categories.includes(...)`(반복문 안) · `images.ts:595` `renameCategory`의 `renamed.indexOf`(filter 안)
- **실측(사진마다 다른 범주, add 1회 / rename 3회 최솟값)** 범주 1,250/2,500/5,000/10,000에서 add 8.6/9.6/49/192ms, rename
  2.3/7.4/38/159ms — 두 배마다 약 4배. 상한(5,000장)에서는 50ms 이하라 해는 작다. 상한을 끄면 계속 자란다.
- **처방(실측)** `Set` 하나 → add 9.9/12.4/21.2/44.1ms, rename 3.3/6.1/10.3/14.1ms(선형). 관련 스펙 131개 초록.
- **이웃** `roster.ts:109`·`portfolio-bundle.ts:110`의 번호 찾기도 같은 이름 N개면 N²(교실 크기라 재지 않음).

### C-2 같은 이름표 셋 이상을 묻는 검사가 없다 (M21 조용)
- **자리** `frontend/src/project/roster.ts:110` `taken.add(name)`
- **재현** 이 줄을 지워도 roster 관련 59개 초록. 그 상태에서 `rosterOf([kim.mlpx ×3])` → `kim (2).mlpx | kim (2).mlpx | kim.mlpx` —
  두 학생이 한 줄로 합쳐진다(주석이 막는다고 적은 사고).
- **처방(실측)** "같은 이름 셋이 서로 다른 이름표" 검사 — 원 코드 초록, M21 빨강. 묶음 쪽 짝(`folderNames`)은 M22가 이미 운다.

## 돌연변이 표 (33, 조용 1)

| # | 자리 | 심은 것 | 결과 |
|---|---|---|---|
| M1 | json-text.ts:22 | 수 판정을 "문자열 아님"으로 | 욺 3 |
| M2 | json-text.ts:59 | 빈 칸 `'null'`→`''` | 욺 1 |
| M3 | json-text.ts:45 | 감싼 원시값 풀기 제거 | 욺 1 |
| M4 | portfolio.ts:663 | `<= after`→`< after` | 욺 6 |
| M5 | portfolio.ts:684 | `includes('\|')` 무력화 | 욺 2 |
| M6 | portfolio.ts:683 | 줄 넘는 스팬 거절 제거 | 욺 3 |
| M7 | portfolio.ts:676 | 0부터 `findIndex`(제곱) | 욺 3(시간 초과) |
| M8 | format.ts:17 | `ZipPassThrough`→`ZipDeflate` | 욺 3 |
| M9 | portfolio-bundle.ts:110 | 대문자 견주기 제거 | 욺 3 |
| M10 | portfolio-bundle.ts:145 | `escapesArchive` 제거 | 욺 4 |
| M11 | format.ts:1566 | `+ 1` 제거 | 욺 1 |
| M12 | format.ts:458 | 첫 해 한 칸 늦춤 | 욺 1 |
| M13 | format.ts:1599 | 앞뒤 점 걷기 제거 | 욺 1 |
| M14 | format.ts:1344 | 쓰는 쪽 첨부 떼기 제거 | 욺 1 |
| M15 | images.ts:441 | 범주 중복 막기 제거 | 욺 2 |
| M16 | images.ts:595 | rename 중복 걷기 제거 | 욺 1 |
| M17 | images.ts:428 | `standsAsFolder` 제거 | 욺 1 |
| M18 | images.ts:553 | 자리 넘어 임베딩 삭제 | 욺 1 |
| M19 | images.ts:534 | 테스트 참조를 떼지 않음 | 욺 1 |
| M20 | embeddings.ts:33 | 리틀→빅엔디언 | 욺 3 |
| **M21** | **roster.ts:110** | **`taken.add` 제거** | **조용 → C-2** |
| M22 | portfolio-bundle.ts:111 | `used.add(base)` | 욺 1 |
| M23 | integrity.ts:144 | contentHash 대조 제거 | 욺 1 |
| M24 | stores/project.ts:459 | 쓴 뒤 `dirty=false` | 욺 3 |
| M25 | stores/project.ts:623 | `exportedCurrent` 무조건 참 | 욺 1 |
| M26 | tab-lock.ts:98 | id 일치 제거 | 욺 2 |
| M27 | tab-lock.ts:196 | `heldId=null` 먼저 | 욺 1 |
| M28 | storage.ts:504 | `=== 1`→`=== 0` | 욺 1 |
| M29 | images.ts:150 | 범위 순서 고정 | 욺 1 |
| M30 | images.ts:195 | `>`→`>=` | 욺 1 |
| M31 | portfolio-bundle.ts:177 | 엔트리 수 한 칸 느슨 | 욺 1 |
| M32 | facts.ts:57 | `> 0`→`>= 0` | 욺 1 |
| M33 | format.ts:944 | 한 겹 감싼 증거 제거 | 욺 9 |

R41 B-1·B-2와 R42 C-1·C-2·C-5·C-6·C-7은 고쳐진 것을 재측정으로 확인(M7·M11~M14·M26·M27이 운다).

## 시간복잡도 실측 표 (개발 PC Node)

| 자리 | 크기(두 배씩) | 시간 | 판정 |
|---|---|---|---|
| `renderPortfolioMarkdown` 백틱 짝(3회 최솟값) | 8k~128k | 15/24/47/96/237ms | 선형 |
| `addImages` 사진 n장(1회) | 625~5000 | 7.9/2.7/6.3/14.2ms | 선형 |
| `factsOf`(3회) | 〃 | 2/1.7/4.1/6.7ms | 선형 |
| `archiveEntryCount`(3회) | 〃 | 1.9/3/6.3/17ms | 선형 |
| `moveImages` 전부(3회) | 〃 | 1.6/3.8/3.8/8.7ms | 선형 |
| `removeImages` 절반(3회) | 〃 | 2.6/3.2/6.2/11.3ms | 선형 |
| `writeProject` 임베딩 포함(2회) | 〃 | 73/127/256/598ms | 선형 |
| `readProject`(2회) | 〃 | 65/112/237/530ms | 선형 |
| `readProjectMeta`(2회) | 〃 | 13/16/40/72ms | 선형 |
| 범주 c개 add/rename | 1250~10000 | C-1 표 | **제곱** |
| `bundleOf` 30명 | 18.75~150MB | 0.97/1.4/3.3/7.7s | 선형, 상수 큼(B-1) |

`jsonText`는 무작위 값 2만 개로 `JSON.parse` 결과가 `JSON.stringify(값, null, 2)`와 같은지 견줬고 어긋난 것이 없었다.

## 못 한 것
- 기준 기기·실기기 실측 없음(학교 PC에서의 B-1 시간 모름).
- A-1을 학습 화면(백본 포함) 끝까지 못 돌림 — 학습 입구가 다른 곳에서 막는지는 코드 읽기로만(`training-source.ts`에 범주 대조 없음).
  처방 ②는 재지 않음.
- 묶음 폴더 이름이 다른 학생의 파일 경로와 겹치는 경우는 추론만.
- 자동 저장마다 프로젝트 전체를 IndexedDB에 구조 복제하는 비용(사진 5,000장)은 재지 않음.
- `locks.ts`·`errors.ts`·`i18n.ts`·`schema.ts`·`migrate.ts`는 훑기만, 돌연변이 없음. 커버리지 미실행.

## 오케스트레이터 재현과 고침

| 지적 | 재현 | 고침 (결정) | 무는 검사 · 돌연변이 |
|---|---|---|---|
| A-1 | 진짜 입구(`trainingSourceOf`)로 네 편집 모두 재현. **넷째(한 범주의 사진을 다 지우기)는 화면의 범주 목록과 견주면 통과한다** — 빈 범주로 목록에 남기 때문이다(`removeImages`) | 결정 106. 학습 입구에서 **훈련 사진이 든 범주**와 다시 대조, 백본 전에 `TEST_IMAGES_*`로 거절 | `training-source.spec.ts` "결정 106" 6개. 대조 전체 제거 → 4개 욺, 훈련 사진 거르기 제거 → 1개 욺 |
| B-1 | 시간은 다시 재지 않았다(감사자 실측 인용) | 결정 107. 묶음도 `level: 0`(STORE), `ZIP_DEFLATE_LEVEL` 삭제 | `portfolio-bundle.spec.ts` "묶음은 아무것도 누르지 않는다". 수준 6 → 욺 |
| C-1 | 범주 5만 개: 옛 코드 올리기 5.4s · 이름 바꾸기 5.3s / 고친 뒤 216ms · 125ms | `Set` | `image-project.spec.ts` "범주가 많아도 곧 끝난다"(한도 2s) — 옛 코드 욺. **같은 새 범주가 한 번만 서는지 보는 검사가 없었다** — 세웠고 `listed.add` 제거에 운다 |
| C-1 이웃 | 같은 이름 2만 개: 명렬 이름표 옛 코드 116.6s, 묶음 폴더 이름 82.3s | 이름마다 다음 번호를 기억 | `roster-duplicate-names.spec.ts`·`portfolio-bundle.spec.ts`의 "곧 나온다"(한도 3s) — 옛 코드 욺 |
| C-2 | 다시 재지 않았다(감사자 실측 인용) | 검사 "같은 이름 셋은 셋 모두 다른 이름표" | **고친 뒤에는 M21 혼자는 동등 돌연변이다** — 번호 기억이 같은 이름끼리의 충돌을 따로 막는다. 둘을 함께 빼면 운다 |

남는 것: A-1 넷째 갈래의 문장은 `TEST_IMAGES_CATEGORY_UNKNOWN`("이 프로젝트에 없는 범주…")인데 화면에는 그 범주가 빈 칸으로 보인다 — 새 코드를 세울지는 코드 소유자가 정한다(결정 106 경위).
