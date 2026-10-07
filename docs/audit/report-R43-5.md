# R43-5 슬라이스 감사 — `frontend/src/views/**`, `frontend/src/components/**` (기준 `d9ae5b0`) — **FINDINGS** (B 2, C 3)

> 독립 감사자의 회신을 오케스트레이터가 옮겨 적었다. 요청서 `request-R43.md`. 돌연변이 23개 — 18 울고 5 삶(C-1·C-2의 둘,
> M11 등가에 가까움, M18a 스펙을 잘못 고름 → M18b 욺, M19 jsdom의 `<dialog>`가 `close` 사건을 안 올려 재현 못 함).
> A 없음. 축 2(`.mlpx` 압축·워커 회귀)는 views·components에 자리가 없다.

## 지적과 처리

### B-1. 대소문자만 다른 범주 이름을 겹침으로 안 막는다 → **고침**
- 결정문 "범주 이름 규칙"은 *"대소문자만 다른 것도 중복이다"*인데 지키는 코드가 없었다. 진짜 입구(ImagePanel [새 범주]
  `Cat`, 바꾸기 `dog`→`CAT`)로 `cat`·`Cat`이 함께 섰고, 윈도우에서 풀면 한 폴더가 되어 다시 올릴 때 라벨이 합쳐진다.
- 처방: `data/image/canonical.ts`에 `categoryFolderKey`(대문자 — `portfolio-bundle.ts` `folderNames`와 같은 NTFS 근거)를 두고,
  이름 창의 gate(`locks.ts`)가 자기 이름을 뺀 범주와 열쇠로 견준다(자기 이름의 대소문자만 바꾸는 것은 받는다). 업로드의
  `requireValidCategories`(zip·폴더)도 열쇠가 겹치면 뒤엣것의 이름으로 `IMAGE_CATEGORY_NAME_INVALID`를 낸다.
- 검사: `category-test-photos.spec.ts` *"대소문자만 다른 이름도 nameTaken이다"*, `image-upload-zip.spec.ts` *"대소문자만 다른
  폴더는 뒤엣것의 이름을 대며 거부한다"*. 돌연변이 3(열쇠 대신 날글자·자기 빼기 없음·업로드 겹침 검사 끔) 모두 욺.
- 남긴 이웃: `project/images.ts`의 `addCategory`·`renameCategory`·`moveImages`는 날글자로 견준다 — 화면의 입구는 gate가 막는다.
  이미 `cat`·`Cat`을 함께 가진 옛 파일은 건드리지 않는다(기록을 바꾸지 않는다).

### B-2. 폴더 고르기가 사진 아닌 파일까지 장수로 센다 → **결정 108(미정)으로 기록**
- 사진 3000장 + `labels/*.txt` 3000개가 `IMAGE_TOO_MANY_PHOTOS`(incoming 6000)로 거절된다. `upload.ts`의 *"여기서 사진인지는
  안 가린다"* 설계와 맞서는 결정이라 코드 소유자가 정한다 — `docs/open-decisions.md` 108.

### C-1. 지우기 확인 창의 테스트 사진 문장 경계 1 → **고침**
- `image-panel-rename-pending.spec.ts`에 테스트 사진 1장인 범주를 더했다. `count > 0` → `> 1` 돌연변이가 운다.

### C-2. "[추가]가 도는 동안" 검사가 [취소] 갈래를 물지 않는다 → **고침**
- `Esc`와 [취소] 각각의 뒤에서 확인 창이 안 섰는지 본다. `requestClose`의 `if (adding.value) return` 삭제가 운다.

### C-3. `ImagePanel`이 렌더마다 범주 수 × 사진 수만큼 거른다 → **고침**
- `byCategory` computed가 사진을 한 번 돌아 묶고, `entriesOf`는 그 `Map`에서 꺼낸다(빈 범주는 고정 빈 배열). 실제 수업
  규모에서는 5ms 안팎이라 무는 시간 검사는 두지 않았다.

## 재판단 1 — **REOPEN (B-1만)** → 고침
- 이름 창은 막혔으나 **업로드가 이미 있는 범주와 견주지 않았다**: `cat`이 있는 데이터 화면에 폴더 `set/Cat/b.png`를 올리면
  범주가 `["cat","Cat","dog"]`이 되었다. 처음 잠정 범위("gate가 입구를 막는다")는 이름 창에만 맞았다.
- 처방: `ImageLabels`의 `inferred`에 `known`(이미 있는 범주)을 두고, `requireValidCategories`가 열쇠는 있는데 철자가 없는 폴더를
  거절한다(접어 넣지 않는다 — 다듬어 받지 않는 기존 원칙). 같은 철자는 그 범주에 더하는 것이라 받고, 옛 파일이 `cat`·`Cat`을
  함께 가졌으면 둘 다 받는다. 데이터 화면이 zip·폴더 둘 다에 `known: categories`를 넘긴다.
- 검사: `image-source-menu.spec.ts` *"이미 있는 범주와 대소문자만 다른 폴더는 받지 않는다"*(진짜 입구: 메뉴 → [폴더 선택]).
  돌연변이 3(화면이 `known`을 안 넘김·열쇠 대조 끔·철자 예외 끔) 모두 욺.
- C-1·C-2·C-3·B-2는 재판단에서 닫혔다.
- 남은 C: `renameCollidesWithTest`(`data/image/test-set.ts`)는 날글자로 견준다 — 테스트 자리에만 `cat`이 남았을 때 `dog`→`CAT`은
  통과하지만 학습 입구의 범주 대조가 큰 소리로 막는다.

## 재판단 2 — **CLOSED WITH C**
- 진짜 입구로 폴더(`set/Cat/b.png`)와 zip(`Cat/b.png`) 둘 다 `IMAGE_CATEGORY_NAME_INVALID {name:"Cat"}`, 범주 그대로. 같은 철자는 받는다.
- 남은 C는 위 `renameCollidesWithTest` 하나.

## 기록만 한 것
- M19(`SketchDialog` `bounced` 가드)는 jsdom이 `close` 사건을 안 올려 재현 못 함 — 브라우저 확인 몫.
- `commitRemoveCategory`에 `applied` 같은 표식이 없다 — `removeCategory`가 버그 외에는 던지지 않아 지적 아님.
