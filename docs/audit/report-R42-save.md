# R42 감사 보고 — `.mlpx` 저장은 언제든지 성공하는가 — A 0 · B 1 · C 7

> 감사자가 파일을 쓰지 못해 오케스트레이터가 회신을 옮겨 적었다. 재현 확인은 맨 아래 "오케스트레이터 재현"에 있다.

HEAD `aa513ee`. 감사자는 고치지 않았다. 돌연변이는 전부 Edit로 심고 정확히 되돌렸고, 묶음마다 `git diff --quiet -- frontend/src`가 깨끗했다. 임시 재현 스펙(`frontend/tests/zz-r42-*.spec.ts` 여섯)은 지웠다.

**한 줄 결론.** 명제는 정상 입구로는 깨지지 않았다 — 실제 학습 7종·사진 세 자리·범주 이동/이름 바꾸기/지우기·시험 사진 떼기·임베딩·포트폴리오 첨부·인적사항·IndexedDB 왕복을 진짜 입구로 지나 `writeProject`→`readProject`가 던지지 않았고 문서가 `toEqual`로 같았으며 무결성은 `UNCHANGED`였다. **깨진 것은 "언제든지"의 시간 쪽 하나(C-1, 마크다운 생성이 제곱 시간)와, 지키는 검사가 한 칸 비어 있는 자리들이다.** 돌연변이 35 중 조용한 것 9.

## B

### B-1 `runs.json`이 들여쓰기로 2.87배가 되어 무압축 그대로 나간다
- **자리** `frontend/src/project/format.ts:403-405` (`encodeJson` — `JSON.stringify(value, null, 2)`), 함께 `:464-471`(전부 STORE, 결정 68).
- **주장** 실험마다 `settings.trainIndices`/`testIndices`가 행 수만큼의 정수 배열이고, 들여쓰기 2에서 원소 하나가 한 줄(공백 10 + 숫자 + `,` + 줄바꿈)을 차지한다. 결정 68 이후 deflate가 없어 그 부풀림이 파일 크기로 바로 간다.
- **재현(Node)** `n=100000`, 80/20 분할 한 실험: `pretty 1689043 B · compact 588964 B · ratio 2.87`. 100,000행 표에서 30번 학습하면 `runs.json`만 ≈ 50.7MB(들여쓰기 없는 JSON ≈ 17.7MB).
- **왜 B인가** 들여쓰기는 주석이 고른 것이다(*"학생이 압축을 풀어 들여다보는 것은 교육적으로 좋은 일이다"*). 선택지: ① 현행 ② 수 배열만 한 줄로 ③ `runs.json`만 들여쓰기 없는 JSON. 무결성은 엔트리 바이트 해시라 새 파일부터 바뀌고 옛 파일은 그대로 읽힌다.
- **이웃** `encodeJson` 호출 5, 부풀림이 큰 것은 `runs` 하나.

## C

### C-1 `document.md` 생성이 백틱 연속 수에 대해 제곱 시간
- **자리** `frontend/src/project/portfolio.ts:658` (`trustedCodeSpans` — `runs.findIndex((other, k) => k > i && …)`가 매번 0부터 훑는다). 부르는 자리는 `useExportProject.ts`의 `identifiedExport`와 교사 묶음(`portfolio-bundle.ts`)뿐이라 [파일로 저장]을 누른 순간 선다.
- **재현(진짜 입구 `portfolioMarkdownText`, 개발 PC Node, 각 3회)** 답 하나 = `` `x` `` 짝을 줄바꿈으로 이은 한 문단: 8,000짝 61~101ms · 16,000짝 189~251ms · 32,000짝 1.1~1.3s · 64,000짝 3.6~4.6s · 128,000짝(512KB) 11.4~13.1s.
- **처방(실측)** 탐색을 `i + 1`부터 시작해 첫 같은 길이에서 멈춘다 — 같은 표가 13/28/51/106/245ms(선형), `portfolio.spec.ts` 406개 초록.
- **왜 A가 아닌가** 수만 개의 백틱이 빈 줄 없이 한 문단에 있어야 한다.
- **이웃** 1(여기뿐).

### C-2 `writeProject`의 엔트리 수 그물이 한 칸 위를 못 문다 (M1 조용)
- **자리** `format.ts:1564` `fitsInArchive(Object.keys(entries).length + 1)`. 검사 `archive-entry-limit.spec.ts`는 `=MAX`와 `MAX+수만`만 본다.
- **재현** `+ 1`을 지우면 `MAX+1`개 프로젝트가 엔트리 65535개로 써진다(결정문이 "ZIP64 표지"라 한 값).
- **처방(실측)** `archiveEntryCount === MAX_ARCHIVE_ENTRIES + 1`인 사진 프로젝트가 던지는 검사 — 원 코드 초록, M1 빨강.
- **이웃** `fitsInArchive(` 호출 5 — `writeProject`만 경계를 한쪽만 문다.

### C-3 떠나기 확인 창에서 내보내기가 실패한 경로를 아무도 안 연다 (M22 조용)
- **자리** `frontend/src/components/LeaveGuard.vue:61` `failure.value = toMessage(error)`. 결정 65에 따라 창 안의 문장이 유일한 신호다.
- **처방(실측)** `exportFile`이 거절하게 한 뒤 [파일로 저장] → `[role="alert"]`가 서고 `leave.target`이 남는지. 주의: `router`를 플러그인으로 주면 첫 이동이 프로젝트를 닫아 검사가 헛돈다 — `provide: { [routerKey]: router }`로 준다.

### C-4 담지 못한 모델의 경고가 내보내기 길에서 검사되지 않는다 (M19 조용)
- **자리** `frontend/src/composables/useExportProject.ts:55-58`. 5MB를 넘는 랜덤 포레스트(`tooLarge`)는 실재한다.
- **이웃** 같은 파일 `:46`의 `locale.value` 배선(M20)도 조용.

### C-5 파일 이름의 마지막 그물 둘이 검사 없이 서 있다 (M26·M28 조용)
- **자리** `format.ts:1659` `fitted === '' ? fallback : fitted`, `format.ts:1595` `.replace(/^\.+|\.+$/g, '')`.
- **재현** 돌연변이에서 결합 문자 폭탄이 `.mlpx`, `.secret`이 `.secret.mlpx`(맥·iOS 숨김 파일)가 된다.
- **유창한 주석** `:1594` *"윈도우는 점으로 끝나는 이름을 거부한다"* — 이 토막 뒤에는 늘 `_`나 `.mlpx`가 붙는다. 실제로 막는 것은 **앞의 점**이다.
- **처방(실측)** 표본 열 개에 `endsWith('.mlpx')`·`length > 5`·`!startsWith('.')`·`bytes ≤ 255`.

### C-6 zip 시각 당김의 경계가 안 물린다 (M29 조용)
- **자리** `format.ts:456`. 검사는 1970·2100년만.
- **처방(실측)** 1979-12-31·1980-01-01·2099-12-31·2100-01-01 왕복 — 원 코드 4/4 초록, M29에서 1979 빨강.

### C-7 쓰는 쪽의 첨부 떼기는 읽는 쪽 떼기에 가려 검사가 안 문다 (M6 조용)
- **자리** `format.ts:1339-1345`. `format.spec.ts`는 다시 연 문서를 보는데 `readProject`가 같은 떼기를 또 한다(되풀이된 병 2). 정상 경로로는 닿지 않는다.
- **처방** 쓴 zip의 `portfolio/document.json`을 직접 풀어 보는 검사.

## 돌연변이 표 (35, 조용 9)

| # | 자리 | 심은 것 | 결과 |
|---|---|---|---|
| M1 | format.ts:1564 | `+ 1` 삭제 | **조용** → C-2 |
| M2 | stores/project.ts:615 | `flush().catch` → `await flush()` | 욺 9 |
| M3 | format.ts:513-514 | `new Blob`/`settled` 순서 | 욺 1 |
| M4 | format.ts:819 | `referencedFileEntry` → `undefined` | 욺 6(픽스처 조립뿐) |
| M5a·b | format.ts:848 | 폴더 짝 판정 | 욺 1 · 3 |
| M6 | format.ts:1342 | 쓰기의 첨부 떼기 제거 | **조용** → C-7 |
| M7–M10 | format.ts:1337-1365 | `insideArchive`·거르기 제거 | 각 욺 1 |
| M11 | format.ts:1514 | `document.md` 제거 | 욺 11 |
| M12 | format.ts:528 | `catch`의 `reject` 제거 | 욺 1 |
| M13 | format.ts:494 | fflate 콜백 오류의 `reject` 제거 | **조용** (못 한 것) |
| M14–M18 | stores/project.ts · useExportProject.ts | 내보내기 상태·쥔 판·`update` | 전부 욺 |
| M19 | useExportProject.ts:55 | `> 0` → `> 1` | **조용** → C-4 |
| M20 | useExportProject.ts:46 | `locale.value` → `'ko'` | **조용** → C-4 |
| M21 | LeaveGuard.vue | `leave.stay()` 제거 | 욺 1 |
| M22 | LeaveGuard.vue:61 | 실패 문장 제거 | **조용** → C-3 |
| M23–M25 | ExportButton.vue · download.ts | 알림·URL 해제·append | 각 욺 1 |
| M26 | format.ts:1659 | 빈 이름 폴백 제거 | **조용** → C-5 |
| M27 | format.ts:1658 | 둘째 `fitStem` 제거 | 욺 1 |
| M28 | format.ts:1595 | 앞뒤 점 걷기 제거 | **조용** → C-5 |
| M29 | format.ts:456 | `< 1980` → `< 1979` | **조용** → C-6 |
| M30–M34 | format.ts · identity.ts | 첨부 자리·대조·이름·모델 사유·전처리기 | 전부 욺 |

## 명제가 서는 갈래

| 무엇을 했나 (진짜 입구) | 결과 |
|---|---|
| 이미지: 사진 추가→임베딩→범주 더하기·이름 바꾸기·옮기기·지우기→시험 사진→예측 사진→지우기 | 문서 `toEqual`, `UNCHANGED` |
| 포트폴리오 양식·답(고립 서로게이트 포함)·첨부·인적사항 | 무손실 |
| 표: 학습 7종 | 문서 `toEqual`, 모델 바이트 같음 |
| IndexedDB `saveProject`→`loadProject`→`writeProject` | `UNCHANGED` |
| 저장 거절 중·저장이 안 끝나는 중·쥔 뒤 프로젝트가 바뀜 | 쥔 판이 나간다 |
| 오프라인·워커 사망 | 내보내기 길에 동적 `import(`와 워커가 없다(코드로 셈) |
| 버튼이 사라지는 조건 | `AppToolbar.vue:54` `v-if="project.projectId !== null"` 하나 |
| `NaN`/`Infinity`가 문서로 가는 자리 | 쓰는 쪽과 `schema.ts`를 짝으로 대조해 어긋난 쌍 없음 |

알려진 예외: ① `PROJECT_FILE_TOO_MANY_ENTRIES` ② 새는 이름뿐인 폴더에 실험이 기대는 옛 레코드는 열리고 내보내기만 거부(`storage.ts:631-635`) ③ 문항 id `__proto__`(결정 49 현행 유지). **②는 `mlpx-spec/01-structure.md` "항상 성공한다"의 예외로 문서에 없다.**

## ⑤ 크기와 메모리 — 산수 (실측 안 함)

최고 메모리는 첫 내보내기 ≈2P, 두 번째부터 앞 Blob을 URL이 쥐어 ≈3P, 직후 IndexedDB 저장이 겹치면 최대 ≈4P. 앞 URL을 새 Blob을 만들기 **전에** 놓으면 한 벌이 준다(제안, 재지 않음). 상한을 다 채운 사진 프로젝트 ≈271MB(webp)/352MB(jpeg). 표는 바이트 상한이 없다.

상한을 끈 상태의 다른 실패: OOM · **4GiB를 넘으면 조용히 깨짐**(fflate 0.8.3은 ZIP64를 안 쓴다, 코드 읽기뿐) · 엔트리 이름 >65,535바이트 → 날것의 `filename too long`.

## 못 한 것
- 기준 기기·실기기 실측 없음. C-1 시간은 개발 PC Node, ⑤는 산수.
- M13 갈래의 진짜 입구를 못 찾았다(업로드는 범주 100자가 막는다).
- Win10에서 예약 이름 거절, 고립 서로게이트 범주 이름 왕복, C-3 이웃, C-4·C-7 처방 미측정.
- R41 확인: B-1·B-3·C-1·C-4는 소스로 고쳐진 것 확인. 나머지는 이번 축 밖.

## 오케스트레이터 재현 (HEAD `aa513ee`, 개발 PC)

| 지적 | 재현 | 판정 |
|---|---|---|
| B-1 | 10만 행·80/20 한 실험: 들여쓰기 1,689,026B · 들여쓰기 없는 JSON 588,955B · **2.87배** (Node) | 확인 — 결정 필요 |
| C-1 | `renderPortfolioMarkdown` 직접 호출, 1회: 8,000짝 61ms · 16,000 165ms · 32,000 564ms · 64,000 **3,570ms** | 확인 — 제곱 이상으로 는다 |
| C-2 (M1) | `+ 1` 삭제 → archive-entry-limit·format·export-button 118개 초록 | 확인 — 조용 |
| C-5 (M28) | 점 걷기 삭제 → format·export-button·mlpx-name·project-name 117개 초록 | 확인 — 조용. 주석이 가리키는 것과 실제 막는 것이 다르다는 주장도 코드로 확인(토막 뒤에 늘 `_`나 `.mlpx`) |
| C-6 (M29) | 첫 해 경계 한 칸 늦춤 → 같은 118개 초록 | 확인 — 조용 |
| C-3·C-4·C-7 | 재현 안 함 | 감사자 실측만 |

돌연변이는 심은 줄만 Edit로 되돌렸고 `git diff --quiet -- frontend/src` 깨끗, 임시 스펙은 지웠다.
