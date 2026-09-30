<!-- 회신 1/2 -->

**조건부 승인.** 이번 릴리스에서 새로 생긴 회귀나 거짓 초록불은 찾지 못했습니다. 조건은 하나입니다. 결정 93의 문장("앱이 짓는 사진 링크는 사용자 글이 아니다")이 조작한 `.mlpx`에서는 맞지 않아 교사 묶음에 태그가 섭니다(B-1). 0.30.11 이전부터 있던 틈이라 회귀는 아니지만, 결정 89·93이 막겠다고 한 위협과 같은 종류입니다. 코드 소유자가 결정해야 합니다.

## 지적

**B-1 (조건부, 결정 필요)**
- **자리:** `frontend/src/project/portfolio.ts`의 `renderPortfolioMarkdown`에서 `` lines.push(`![](${path.slice(DIR.portfolio.length)})`, '') `` 줄. 교사 묶음은 `portfolio-bundle.ts`의 `entriesOf`가 이 함수를 불러 `document.md`를 새로 굽습니다.
- **주장:** 첨부 경로는 파일에서 온 문자열입니다. 읽을 때 `insideArchive`는 `..`, 역슬래시, 절대 경로만 거르고, `detachMissingAttachments`는 zip 엔트리와 짝만 봅니다. 그래서 `portfolio/attachments/` 아래에 `)`·`<`·공백이 든 이름의 엔트리를 넣고 문서가 그것을 가리키면, 그 경로가 이스케이프 없이 링크 목적지에 실립니다. 해시는 키가 없어서 우리 `writeProject`로 쓰면 무결성 판이 `UNCHANGED`입니다.
- **재현:** 임시 스펙 `_v7-attachment-link.spec.ts`(지웠습니다)로 확인했습니다.
  - 경로는 `portfolio/attachments/a.webp) <img src=x onerror=alert(1)> [c](javascript:alert(2)`로 두었습니다.
  - `writeProjectBytes` → `readProject` 결과 `integrity.status`는 `UNCHANGED`였습니다.
  - `entriesOf(...)`로 만든 `x/portfolio/document.md`를 markdown-it(`html: true`)로 그리니 `<img src=x onerror` 날태그가 섰습니다. 테스트가 통과했으니 재현된 것입니다.
- **왜 우리 몫인가:** 학생 파일 안의 `document.md`는 원래 학생이 마음대로 쓸 수 있습니다. 교사 묶음의 것은 **우리가 다시 구워 주는 글**이고(`portfolio-bundle.ts` 주석의 "우리가 지어 교사에게 주는 것"), 89의 보안 검토 A-2도 조작한 `.mlpx`의 제목을 범위에 넣었습니다.
- **처방(택1, 결정):**
  - (a) 사진 링크는 앱이 짓는 이름 모양(`nextAttachmentPath`가 만드는 모양)과 맞는 경로만 싣고, 나머지는 빼거나 글자로 싣습니다.
  - (b) 읽을 때 그 모양이 아닌 첨부 참조를 뗍니다.
  - 어느 쪽이든 93의 허브·경위 문장과 `mlpx-spec/04-portfolio.md`의 "앱이 짓는 사진 링크는 … 이 판정을 안 거친다"를 함께 고쳐야 합니다.
  - 결정 93을 보는 v6와 겹치는 자리라 오케스트라가 조율해 주세요.

**C-1 (참고, 커밋 순서)** 결정 93의 문서(허브·경위·`mlpx-spec/04-portfolio.md`)와 구현(`portfolio.ts`·`portfolio.spec.ts`)이 지금 한 작업 트리에 섞여 있습니다. 문서 먼저 규칙대로 docs 커밋을 먼저 내고 fix 커밋을 뒤에 내세요. 경로도 명시해 스테이징하세요.

## 1. 커밋·결정문 정합

- **결정과 구현의 순서:** 결정 커밋 4e649ad(89 신설, 88 개정, 81 개정, 90~92)가 구현 커밋 3131f93(89)·46773ec(88·81 개정)보다 앞입니다.
- **나머지 커밋:**
  - 43b90f5(라우터·열기 취소)는 새 결정 없이 기존 원칙(N4 B-1, R37-V)을 따른 감사 수정이고, 문제없다고 봤습니다.
  - 84dd80d는 test 커밋이지만 소스 주석 몇 개와 88 허브의 "구현이 남았다 → 채웠다"를 함께 바꿨습니다. 동작 변경은 TrainView의 예상 입력을 순수 함수로 뺀 것뿐이고 값은 같습니다.
- **판례는 추가만:** `diff 0.30.11 -- docs/cases/`에서 지워진 줄은 `rule-coverage.md`의 한 줄뿐이고, 취소선으로 닫고 "닫혔다"를 덧붙인 관례형입니다. `open-decisions.md` 경위는 추가만 했습니다. 88의 옛 "대가"는 그대로 두고 "개정" 절을 덧붙였습니다.
- **허브 형식:** 93→92→91→90→89→88이 내림차순이고, 헤딩 앞에 빈 줄이 있고, 줄마다 `**[결정]**`이 있습니다. 81·88의 `**개정 (코드 소유자):**` 줄이 경위의 "개정" 절(경위 파일 472·775줄)을 가리키고, 그 절이 실제로 있습니다.
- **결정문과 구현 대조:**
  - 81 개정: `open()`에서 첫 `await` 앞에 `cancelPending()`을 두고, 같은 프로젝트면 그 앞에서 돌아갑니다.
  - 88 개정: 표는 `targetClassCount`로 `trainIndices`에서 셉니다. 사진은 장수가 0보다 큰 범주의 이름 수입니다. 셀 수 없을 때만 혼동 행렬로 물러섭니다.
  - 89: 코드 밖 `<`를 `&lt;`로 바꿉니다. `HTML_BLOCKS`와 82의 조건 (2)가 빠졌고, 옛 이름이 남은 곳은 경위 파일뿐입니다.
  - 90·91·92: 주석만 고쳤습니다.
  - 93: 링크 목적지 앞에 `\`를 넣습니다.
  - 83·84: 이번 diff에서는 `reproduce.ts`의 주석(84의 판 비교 설명)만 바뀌었습니다.

## 2. 학생·교사 영향 동작 변경과 무는 검사

| 변경 | 결정 | 무는 검사 |
|---|---|---|
| 청크 실패·flush 대기·열기 취소 뒤 버려진 이동은 `true`로 접는다 | 감사 a3 (기존 원칙) | `route-chunk-race`("그 청크가 실패해도" 둘), `leave-unsaved`("떠나는 이동의 저장을 기다리는 사이"), `project-open-cancel`("앞으로 가기로 …") |
| `open()`의 `cancelPending` | 81 개정 | `autosave`("다른 프로젝트로 갈아 끼우면" 묶음, "같은 프로젝트를 다시 열면 …") |
| 대조 클래스 수 | 88 개정 | `reproduce-estimate`("같은 이름이 두 칸이면" 등) |
| TrainView 예상 입력을 밖으로 뺌 | 88 | `training-source`("예상 입력"), `ui-rules`("화면의 예상 입력은 부품 밖의 함수가 만든다"), `train-prep-kind`("학습 화면의 예상 몫은 …") |
| `document.md` 이스케이프 | 89·93 | `portfolio.spec`("결정 89"·"결정 93" 묶음, "판정 구역에 JS 공백 판정이 없다") |

- 81 개정에서 잠금 실패 뒤 앞 프로젝트가 남는 경우에도 편집을 잃지 않는다는 주장을 따라가 봤습니다. `'failed'`면 목록으로 가고, 그 이동의 가드 `flush()`가 `dirty`를 씁니다. 코드로는 맞지만 무는 검사는 없습니다. 주석과 경위 789줄이 "사람 확인"과 "대가"로 이미 적어 두었습니다.
- 소스 주석이 가리키는 검사 이름 28개를 grep으로 셌고, 전부 실재합니다.

## 3. 포맷·버전

- `format.ts`·`schema.ts`·`storage.ts`·`package.json`은 diff 밖입니다. `FORMAT_VERSION`·`DB_VERSION`·엔진 버전·`.mlpx` 어휘 모두 그대로입니다. `versions`·`schema-version` 스펙이 통과했습니다.
- **해시 대조:** `readProject`는 `hashableEntries`로 zip의 **날 바이트**를 해시해 `checkHashes`로 `hashes.json`과 견주고, `renderPortfolioMarkdown`을 부르지 않습니다. 그래서 옛 판의 `document.md`도 거짓 "바뀜"이 나지 않습니다. `portfolio.spec`의 "옛 방식의 document.md도 새 방식의 것도 그대로 열린다"(결정 82·89 두 갈래)가 `UNCHANGED`와 바이트 보존을 뭅니다.
- **교사 점검 묶음:** `entriesOf`는 지금 문서에서 새로 굽지만 묶음 zip에만 싣고 무결성 판정 경로와는 닿지 않습니다.

## 4. 새 스펙의 위생

- 고정 시간 대기가 없습니다. `vi.waitFor`는 조건 대기이고 가짜 타이머를 씁니다.
- `expect` 메시지는 전부 영어입니다.
- 0.30.11 이후 바뀐 파일 39개를 문자 단위로 셌고, U+00A0·U+2028·U+2029·U+3000·U+FEFF·`\v`·`\f`·CR은 모두 0개입니다.
- 곧 낡는 말은 눈에 띄는 것이 없었습니다. 날짜는 감사 번호와 함께 쓴 판례식 표기입니다.

## 5. 돌린 검사 (worktree frontend)

- 소스를 훑는 17개(ui-rules, i18n-usage, locales, limits-rules, secure-context-rules, entry-names, settings-rules, doc-refs, image-room, image-upload-zip, schema-version, terms, zip-names, versions, ci-language, claude-md, docs-structure): **17 파일 통과**, 671 통과·2 건너뜀.
- 바뀐 스펙 18개와 이웃 11개(portfolio-bundle, small-components, integrity, mlpx-roundtrip-property, format, router, route-chunk-failure, project-open-lock, project-open-exported, tabular-plan-cache, export-button): **29 파일, 1475 통과**.
- `npx vue-tsc --build`: 오류 없이 끝났습니다(exit 0).

## 뒷정리

- 임시 스펙 `frontend/tests/_v7-attachment-link.spec.ts`는 지웠습니다. `_v6-*`는 건드리지 않았습니다.
- 끝난 뒤 `git status --short`는 시작 때와 같은 다섯 파일입니다(docs 3개, `portfolio.ts`, `portfolio.spec.ts`). 추적 파일은 고치지 않았고, 커밋·add·stash·checkout·lint·ci는 하지 않았습니다.
- 다만 시작 때 diff 통계를 따로 떠 두지 않아, 끝의 줄 수가 시작과 같은지는 대조하지 못했습니다. v6가 같은 worktree에서 작업 중이면 바뀌었을 수 있습니다.

<!-- 회신 2/2 -->

**최종 판정: 승인.** 지난번 B-1(조작한 첨부 경로)은 실제 입구에서 막혔고, 릴리스 전체에서 배포를 막을 것은 남지 않았습니다.

**(1) 재현 결과**
- 임시 스펙 `_v7-attachment-link.spec.ts`로 조작한 경로 네 가지를 실제 입구에 넣었습니다. 순서는 `writeProjectBytes` → `readProject` → `entriesOf`(교사 묶음)이고, 무결성은 `UNCHANGED`로 통과시킨 상태입니다.
- 넣은 경로는 이렇습니다.
  - 지난번 재현 경로 `a.webp) <img …> [c](javascript:alert(2)`
  - `1) <img …> (.webp`
  - `1.webp) <img …> (1.webp`
  - 줄바꿈이 든 `1\n<img …>\n.jpg`
- markdown-it을 기본 렌더러와 `validateLink`를 끈 렌더러 두 가지로 돌렸습니다. 넷 모두 `<img src=x`와 `javascript:`가 나오지 않았고, 정상 경로 `2.webp`의 사진은 그대로 섰습니다(4/4 통과).
- 막는 판정은 `isAppAttachmentPath`입니다. 경로를 `attachmentPathOf`로 다시 지어 글자까지 같은지 보므로, 수로 시작하고 앱 확장자로 끝나는 변형도 걸립니다.
- 정상 사진이 빠지는지도 봤습니다. git 이력상 앱이 지은 사진 이름은 처음부터 `nextAttachmentPath`의 `수+확장자` 한 모양이고, 확장자도 `.webp`·`.jpg` 둘뿐이었습니다. 옛 파일의 정상 사진 링크가 빠질 일은 없습니다.

**(2) 문서**
- 세 곳이 서로, 그리고 코드와 맞습니다: 허브 93(38줄), `04-portfolio.md` 111줄, 판례 93 절(217·229·260·270줄).
- 판례가 가리키는 검사 이름 넷은 grep으로 모두 실재를 확인했습니다: `portfolio.spec`의 *"조작한 사진 경로"*·*"앱이 지은 모양 판정"*·*"nextAttachmentPath가 짓는 경로는 앱이 지은 모양이다"*, `portfolio-bundle.spec`의 *"조작한 사진 경로는 묶음의"*.
- `diff -- docs/cases/`에 `-` 줄은 없습니다. 추가만 했습니다.
- 바뀐 파일 여섯에 U+00A0·U+2028·U+2029·U+3000·U+FEFF·`\v`·`\f`·CR은 하나도 없습니다.

**(3) 검사**
- 소스를 훑는 17개와 portfolio·portfolio-bundle·export-button·format·storage 스펙: 22 파일, 1287 통과, 2 건너뜀.
- `npx vue-tsc --build`: exit 0.

**(4) 남은 것**
- 지난번 C-1(문서 먼저 커밋)은 말씀대로 커밋할 때 지켜 주시면 됩니다.

**뒷정리:** 임시 스펙 `_v7-attachment-link.spec.ts`는 지웠고 `_v6-*`는 건드리지 않았습니다. 시작과 끝에 뜬 `git diff --binary`의 SHA256이 같습니다(`3E8F20E1…A7B0`). `git status`도 시작과 같은 여섯 파일입니다. 추적 파일은 바꾸지 않았습니다.
