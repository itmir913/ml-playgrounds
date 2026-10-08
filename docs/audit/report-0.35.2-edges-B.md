# 0.35.2 경계 감사 B — 앱 밖으로 나가는 사용자 글 — `a180e38` — A 0 · B 1 · C 6

> 감사자(Fable)의 회신을 오케스트레이터가 옮겨 적었다. 요청서 `request-0.35.2-edges-B.md`. 돌연변이 31개(판정 구역 24 + 입구 3 +
> 처방 확인 4). 기준선: `portfolio`·`portfolio-bundle`·`export-button` 3스펙 451개, `vue-tsc --build` 초록. 재판단은 오케스트레이터가
> 원 저장소에서 재현한 뒤 적었다.

## 지적과 재판단

| 지적 | 자리 | 주장 | 재판단 |
|---|---|---|---|
| **B-1** | `data/serialize.ts`의 `toCanonicalCsv`(부르는 곳 넷) | CSV의 수식 머리(`=`·`+`·`-`·`@`·탭)를 가리는 판정이 없다 | 결정이 걸린다. **`open-decisions.md` 110**으로 올렸다(추천: 관행과 무결성대로 두고 교사에게 알린다) |
| **C-1** | `portfolio.ts`의 `WEB_ADDRESS` | `//`를 떼어도(M01) 안 운다 — 맨 `http:` 주소가 가리는 모양에 없다 | **고침** `08eecbf` — `DISGUISES`에 *"스킴만 http"*. M01에서 7개가 운다 |
| **C-2** | `portfolio.spec.ts`의 *"세 칸까지 들여쓴 #도 막는다"* | 들여쓴 줄이 첫 줄이라 `trim()`이 먼저 지운다 — `{0,2}`로 좁혀도(M20) 안 운다 | **고침** `08eecbf` — 둘째 줄로 옮겼다. M20에서 운다 |
| **C-3** | `portfolio.ts`의 고아 답 `escapeAnswer` | 지워도(M24) 안 운다 — 사용자 글 자리 목록에 이전 문항의 답이 없다 | **고침** `08eecbf` — `PLACES`에 *"이전 문항의 답"*. M24에서 31개가 운다 |
| **C-4** | `portfolio.ts`의 `BLANK` | 닫는 울타리 뒤 공백을 안 닫는 것으로 세도(M11) 안 운다 | **고침** `08eecbf` — 스페이스·탭·섞임 셋, 뒤에 글을 둔다. M11에서 셋이 운다 |
| **C-5** | `portfolio.ts`의 `fenceIndent` | 들여쓴 울타리는 `fenceUncertain`이 먼저 감싸 줄 규칙에 0열만 온다 — 주석과 검사 이름이 안 도는 기전을 말한다 | 코드로 확인했다(`NESTED_FENCE`가 한 칸이라도 들여쓴 울타리를 잡는다). **고침** `08eecbf` — `fenceIndent`를 지우고 주석과 검사 이름을 고쳤다. `FENCE`의 들여쓰기 묶음은 CommonMark 정의 그대로 두었다 |
| **C-6** | `data/image/test-set.ts`의 `renameCollidesWithTest` | 대소문자를 안 접어 고아 `test/c`가 있을 때 `C`로 바꾸는 것을 받는다 — 앱 안은 학습 입구가 막지만 내려받은 zip을 윈도에 풀면 한 폴더에 앉는다 | **고침** `2b82876` — `categoryFolderKey`로 견준다(R43-5 B-1이 정한 폴더 열쇠). 옛 비교로 되돌리면 새 검사가 운다. 감사자가 꼽은 다른 글자 비교 자리(`testZipBlockFor`·`moveImages`·`addCategory`)는 올리기와 이름 창이 먼저 접어 거절하므로 대소문자 변종을 못 만난다는 감사자 판단을 따랐다 |

## 본 것 — 지적 없음 (감사자)

- **규정 서랍** — `public/legal/index.html`의 스크립트를 임시 jsdom 스펙으로 돌렸다(`?lang=`·`navigator.languages`·프로토타입
  이름·대문자·해시·중복). 학생·교사가 다치는 결함을 못 찾았다. 서 있는 검사는 여전히 없다.
- **앱 밖 산출물의 사용자 글 전수** — 입구 셋(`.mlpx`·일괄 예측 CSV·교사 묶음), 자리 아홉. CSV 본문(B-1) 말고는 판정을 거친다.

## 돌연변이 표 (감사자, 스펙 = portfolio·portfolio-bundle·export-button)

| id | 자리 | 결과 |
|---|---|---|
| M01 | `WEB_ADDRESS` `//` 제거 | **안 욺** → C-1 |
| M02~M08 | 링크 목적지·`escapeLinks`·`escapeOutsideCode`·`trustedCodeSpans`·`backtickRuns` | 전부 욺(1~11) |
| M09 | `FENCE` `{0,4}` | **안 욺** → C-5(동치) |
| M10 | `SETEXT_UNDERLINE` 두 글자 이상 | 욺 1 |
| M11 | `BLANK` 빈 줄만 | **안 욺** → C-4 |
| M12~M19 | 첨부 경로·`oneLine`·닫는 울타리 조건·`NESTED_FENCE`·`wrapInFence`·문항 제목 | 전부 욺(1~28) |
| M20 | `LINE_LEADING_HASH` `{0,2}` | **안 욺** → C-2 |
| M21·M22 | 머리글 따로 escape·`<` 줄머리만 | 욺 1·47 |
| M23 | 닫는 줄의 `fenceIndent` 제거 | vitest **안 욺**, `vue-tsc` TS6133 → C-5 |
| M24 | 고아 답 `escapeAnswer` 제거 | **안 욺** → C-3 |
| M25~M27 | `FORBIDDEN_IN_NAME`·`..` 걷기·`escapesArchive` | 욺 2·3·4 |

## 못 한 것 (감사자)

- B-1의 처방 실측(결정 전). 엑셀의 실제 경고는 실기기로 안 봤다.
- 묶음 폴더 이름의 윈도 금지 문자·예약 이름(리눅스·맥에서 지은 `a:b.mlpx`·`CON.mlpx`) — `portfolio-bundle.ts`의 `folderFor`가
  `FORBIDDEN_IN_NAME`을 안 쓴다(코드로 읽음). **확정 불가**, C 후보. 교사 자신의 파일 이름이고 리눅스·맥에서만 생긴다.
- `.mlpx` 범주 폴더 이름의 돌연변이는 세 스펙 밖이라 안 돌렸다.
