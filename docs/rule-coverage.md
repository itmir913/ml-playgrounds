# 규약을 무엇이 지키는가

`CLAUDE.md`의 규칙 하나하나에 대해 **누가 그것을 지키는지**를 적는다. 셋으로 가른다.
칸마다 그 검사가 **왜·언제** 섰는지는 `docs/cases/rule-coverage.md`에 있다.

| 구분 | 뜻 |
|---|---|
| **검사** | 어기면 `npm run ci`가 빨개진다 |
| **타입** | 어기면 컴파일이 깨진다 |
| **사람** | **아무것도 안 막는다.** 기억하는 수밖에 없다 |

- **검사가 무엇을 주장하는지 여기 옮겨 적지 마라.** 스펙 파일이 유일한 출처다. 여기 적는 것은
  **어느 파일이 그것을 맡는가**까지다.
- **칸을 채울 때는 무엇을 못 보는지를 같이 적는다.** 이 표가 틀리는 모양은 한 가지다 — 칸이
  말하는 범위가 실물보다 넓다.
- **칸 하나를 고치기 전에 그 검사를 실제로 망가뜨려 우는지 보라.**

---

## 검사가 막는다

| 규약 | 어디서 |
|---|---|
| §1.2 브라우저가 저장소다 | `storage.spec.ts` · `autosave.spec.ts` |
| §1.3 `.mlpx` 왕복 무손실 · 마이그레이션 | `format.spec.ts` · `migrate.spec.ts` · `lifecycle.spec.ts` |
| §1.5 상한 초과 시 올바른 에러 코드 | `table.spec.ts` · `storage.spec.ts` · `format.spec.ts` |
| §2 알고리즘 선택에 `if/elif` 금지 | `algorithms.spec.ts` |
| §2 "X는 Y에서만"은 X의 등록부에 | `algorithms.spec.ts` · `metric-panels.spec.ts` · `kinds.spec.ts` |
| §2 잠금은 gate 함수 하나, 이유 목록 반환 | `selection.spec.ts` · `ui-rules.spec.ts` · `steps.spec.ts` |
| §2 **잠금은 등록부 하나가 허락한다** (`open-decisions.md` 65, `architecture.md` §10.7) | `ui-rules.spec.ts` · `locks.ts` · `locks.spec.ts` · `tests/setup/lock-net.ts` · `lock-net.spec.ts` · `watch-writes.spec.ts` |
| §2 `randomState`를 항상 **저장하고 분할·뽑기에 쓴다** | `split.spec.ts` · `experiment.spec.ts` · `sample.spec.ts` |
| §2 `fit` 입력의 씨앗이 **라이브러리까지 닿는가** | `experiment.spec.ts` · `mljs-kmeans.spec.ts` · `svm.spec.ts` · `mljs.ts` |
| §2 **대조가 파일에 적힌 씨앗으로 도는가** | `reproduce.spec.ts` · `reproduce.ts` |
| §1.4 백엔드는 코드와 파라미터만 | `test_no_korean_literals.py` |
| §3 규칙 2 컴포넌트 안의 자연어 리터럴 | `i18n-usage.spec.ts` |
| §3 규칙 3·4 한 문장은 한 키 · 사용자 데이터는 괄호로 | `i18n-usage.spec.ts` · `locales.spec.ts` |
| §3 규칙 5 동작의 이름은 한자어 — `tests/fixtures/retired-words.ts`의 `allowedIn`이 `data.image.sketch.*`·`data.image.source.sketch`에서 `그림`·`그리다`를 안 본다(그리기 입력 방식, #38). 그 키들 안의 다른 물러난 말은 그대로 본다 | `locales.spec.ts` |
| **데이터 이름이 하나인가** (`terms.md` 머리말) — `backend/`·`frontend/scripts/`·`frontend/tools/`·README·CONTRIBUTING은 못 본다 | `terms.spec.ts` |
| §3 지원 언어마다 내장 양식 파일이 있는가 | `portfolio-preset.spec.ts` |
| §3 **번역된 문장을 언어의 공백으로 잇는가**(`i18n.md` 규칙 6) — `formatSentences` 자체와, 차트 판·차트 대화상자가 글자 그대로의 `join(' ')`를 안 쓰는지까지 본다. 그 밖의 자리와 다른 모양으로 공백을 끼워 잇는 것은 못 본다(aria id·class·학번과 이름과 모양이 같다) | `create.spec.ts` · `i18n-usage.spec.ts` |
| §3 **일본어 화면의 줄바꿈과 글꼴**(`i18n.md` 규칙 9의 예외, `architecture.md` §8.5) — CSS 블록의 모양과 언어별 글꼴 표, 고를 때만 부르는 것까지 본다. 실제로 어디서 끊기고 어떤 자형으로 그려지는지는 사람 확인이다(`acceptance.md` §2.4) | `font-stack.spec.ts` · `i18n.spec.ts` |
| §3 **끊는 자리 문자는 이스케이프로 적고, 잠김 이유는 끊을 자리 사이가 짧다**(`i18n.md` 규칙 9) — 대시보드의 좁은 칸에 서는 잠김 이유만 글자 칸으로 잰다(넣을 수 있는 할 일 이름을 넣은 문장까지). 다른 좁은 칸(레일·탭·배지)의 문장은 못 본다 | `locales.spec.ts` |
| §4 `any` 금지 | ESLint `@typescript-eslint/no-explicit-any` |
| CLAUDE.md의 줄 수 상한과 날짜 금지 | `claude-md.spec.ts` |
| §1.3 확장자 문자열은 상수 하나 — 조각내 이어 붙인 것은 못 본다 | `mlpx-extension.spec.ts` |
| §4 CI가 뱉는 글자는 영어다 | `ci-language.spec.ts` |
| 가운뎃점 규칙 (`copy.md`) | `middle-dot.spec.ts` |
| §3 지원 언어마다 **바깥에 내놓는 처리방침**이 있는가 | `legal.spec.ts` |
| §3 **없는 주소의 안내**(`public/404.html`)가 지원 언어마다 있고 그 언어의 글자인가 — 실제 브라우저의 이동과 번쩍임은 사람 확인이다(`acceptance.md` §1.1) | `not-found-page.spec.ts` |
| 주석이 가리키는 **심볼**이 거기 있는가 | `doc-refs.spec.ts` |
| §1.5 제출을 막을 만큼 커지면 알리는가 | `file-size.spec.ts` |
| §0 첫 화면에 **무거운 모듈이 정적 임포트로 닿지 않는가**, 첫 화면 조각은 정적인가(`architecture.md` §7.4.1) — 소스의 정적 그래프를 TS AST로 본다. 빌드 도구가 실제로 나누는 조각과 글꼴은 못 본다 | `entry-chunks.spec.ts` |
| 압축 파일 확장자를 손으로 안 적는가 | `image-upload-zip.spec.ts` |
| src가 **워커를 쓰는 fflate API**(`unzip`·`zip`·`inflate`·`Async*` 등)를 들이지 않는가 — `import { … } from 'fflate'`의 이름만 본다. 네임스페이스 import(`import * as`)와 동적 `import()`는 못 본다 | `image-upload-zip.spec.ts` · `format.spec.ts` |
| 압축 파일 엔트리 이름의 부스러기·표기 규칙이 **사진 업로드와 `.mlpx` 읽기에서 한 벌**인가 | `archive-entries.spec.ts` |
| `.mlpx`의 **푸는 자리 밖으로 새는 이름**을 대조 뒤에 버리는가(읽기·저장소·내보내기) | `image-format.spec.ts` · `storage.spec.ts` · `portfolio-bundle.spec.ts` |
| 테스트용 사진을 관용적으로 받지 않는가 | `image-test-set.spec.ts` |
| 인코딩을 안 적은 압축 파일의 이름을 되살리는가 | `zip-names.spec.ts` |
| CSV를 받는 화면이 지금 UI 언어로 인코딩을 판정하는가 | `csv-encoding-screens.spec.ts` |
| 다시 압축한 `.mlpx`도 열리는가 | `image-format.spec.ts` · `zip-names.spec.ts` |
| §4 Tailwind 임의 값 금지 | `ui-rules.spec.ts` |
| **두 판이 제 폭을 받는가** | 사람 확인 (jsdom에는 배치가 없다) |
| §4 가장 작은 글자가 `text-base` | `ui-rules.spec.ts` |
| §4 오래 걸리는 버튼은 `action` | `ui-rules.spec.ts` |
| §4 화면 규칙 나머지 | `ui-rules.spec.ts` · `tests/fixtures/source.ts` |
| §2 앱 밖으로 나가는 주소는 **절대 주소**이고, 규정 경로는 **전부 상대 경로**다 | `links.spec.ts` · `links.ts` · `legal.ts` |
| §4 소스를 글자로 훑는 규칙은 **prettier가 편 모양의 표본을 갖는다** | `ui-rules.spec.ts` |
| §4 여는 태그를 자를 때 **따옴표 안의 `>`를 태그 끝으로 안 읽는다** | `ui-rules.spec.ts` |
| §4 소스에 **날것 bidi·C1 문자가 없다**(Trojan Source) — `src`·`tests`의 코드·로케일·스타일만 본다. 문서(`docs/`)와 폭 없는 공백(U+200B)은 못 본다 | `source-characters.spec.ts` |
| §4 확인 모달이 걸린 라디오는 **그룹째 되돌린다** | `ui-rules.spec.ts` · `radio-guard.spec.ts` |
| §4 배색이 바뀌면 그림이 **토큰을 다시 읽는다** | `cluster-scatter.spec.ts` · `chart-tokens.spec.ts` · `ui-rules.spec.ts` |
| §4 붙박이 바는 **떠날 때 자기 높이를 치운다** | `shell.spec.ts` · `step-action-bar.spec.ts` |
| §4 폭에 따라 글자를 숨기는 손잡이(버튼·링크)는 **이름을 따로 가진다** | `ui-rules.spec.ts` |
| §4 휴대폰에서 동작 바는 **예측 화면만 통째로 붙고** 나머지는 게이지 줄만 붙는다 (`open-decisions.md` 59) | `ui-rules.spec.ts` · `step-action-bar.spec.ts` |
| §4 아이콘 세트를 **화면이 직접 들여오지 않는다** | `ui-rules.spec.ts` · `icons.ts` · `icons.spec.ts` |
| §1.5 상한은 `limits.ts`가 유일한 출처 | `limits-rules.spec.ts` |
| §4 버전은 지시 없이 안 움직인다 | `versions.spec.ts` · `schema-version.spec.ts` |
| §4 **구조 변경이 버전을 동반하는가** | `schema-structure.spec.ts` · `tests/fixtures/schema/v*.released.json` |
| §1.5 상한마다 **누가 정했는지**가 달려 있는가 | `limits-rules.spec.ts` |
| §1.5 **끌 수 있는 상한을 스위치를 거쳐 읽는가** | `limits-rules.spec.ts` · `limits.ts` · `ml/algorithms.ts` · `ml/backend.ts` |
| §1.5 **행 수를 상한과 견주는 자리가 하나인가** | `limits-rules.spec.ts` · `data/xlsx.ts` |
| **스택을 태우는 것** | `spread-rules.spec.ts` · `plan.ts` |
| **하니스가 앱과 같은 절차로 재는가** | `bench-rules.spec.ts` |
| **보조기술이 상태와 답을 듣는가** | `status-bar-limits.spec.ts` |
| **상한 해제가 학생에게서 워커까지 가는가** | `limits-switch.spec.ts` · `experiment.spec.ts` · `runtime-options.spec.ts` |
| **읽는 중에 고른 선택이 이기는가** | `limits-switch.spec.ts` |
| **재는 도구에 그 칸이 있는가** | `bench-rules.spec.ts` |
| 백본에 넣는 화소 범위가 그래프의 계약과 맞는가 | `backbones.spec.ts` |
| 받는 스크립트와 백본 등록부가 같은 id를 말하는가 | `backbones.spec.ts` |
| §4 DOM 필요한 스펙은 스스로 밝힌다 | `ui-rules.spec.ts` |
| §4 나눠 주는 남의 코드에 고지가 따라가는가 | `notices.spec.ts` · `scripts/notices.ts` |
| §4 **실려 나가는 라이선스가 우리 것과 맞는가** | `notices.ts` |
| §4 무결성 해시 · 재실행 대조 | `integrity.spec.ts` · `reproduce.spec.ts` · `lifecycle.spec.ts` |
| 엔진 수치 정확성 | `sklearn-parity.spec.ts` |
| 에러 코드가 `error-codes.md`에 있는가 | `locales.spec.ts` |
| **고지 수집이 실패하면 빌드가 서는가** | `scripts/notices.ts` · `vite.config.ts` |
| **화면이 든 숫자가 제 이름 옆에 앉는가** | `prep-summary.spec.ts` · `selection.spec.ts` |
| **꺼진 카드가 자기 상한을 싣는가** | `selection.spec.ts` · `backend.ts` |
| **파리티 픽스처가 그 식의 모든 항을 가르는가** | `selection.spec.ts` |
| **범주 목록을 화면이 한 출처에서 읽는가** | `ui-rules.spec.ts` |
| **굽기 전 자리 판정이 실제로 도는가** | `image-room.spec.ts` |
| **공백만 든 칸이 결측인가** | `preprocess.spec.ts` |
| **객체로 오는 엑셀 셀 네 갈래** | `xlsx.spec.ts` |
| §1.4 **기술 정보 통로에 우리 문장을 싣지 않는가** | `i18n-usage.spec.ts` · `errors.ts` · `i18n.ts` · `data/image/bake.ts` |
| **저장이 거절됐을 때 화면과 dirty가 어떻게 되는가** | `autosave.spec.ts` |
| **미리보기 N행이 남긴 행인가** | `xlsx.spec.ts` · `preview.spec.ts` |
| **표 파서의 시도 순서** | `xlsx.spec.ts` |
| **층화가 라벨을 위치로 읽는가** | `split.spec.ts` |
| **군집 요약표의 머리 문장** | `clusters.spec.ts` · `ml/clusters.ts` |
| **새 확인 대화상자가 생겼는가** | `ui-rules.spec.ts` |
| §4 import 빠진 컴포넌트가 평문이 되는 것 | ESLint `vue/no-undef-components` |
| 긴 계산이 "누른 순간의 파일"에 쓰는가 | `ui-rules.spec.ts` |
| 화면이 자기 바쁨과 자기 손잡이 칸을 드는가 | `ui-rules.spec.ts` · `useWork.spec.ts` |
| 종류를 모르는 동안 화면이 **종류별 문구를 부르는가** | `kind-guards.spec.ts` · `kinds.spec.ts` |
| 일을 드는 화면이 **떠날 때 끝났다고 표시하는가** | `ui-rules.spec.ts` · `inspect-open-race.spec.ts` |
| **명렬의 읽기 큐가 기다리는 손을 놓아 주는가** | `roster-queue.spec.ts` |
| **읽은 것이 지금 연 줄의 것인가** | `inspect-open-race.spec.ts` |
| **교사가 고친 학번·이름이 표와 정렬까지 가는가** | `inspect-correct.spec.ts` |
| **대조 판정이 돌던 실험에 앉는가** | `inspect-reproduce-live.spec.ts` · `inspect-reproduce-cache.spec.ts` |
| **표의 머리와 칸이 열마다 같은 쪽으로 서는가** | `table-align.spec.ts` |
| **표의 줄이 마우스를 따라오고, 두 강조가 다른 말을 하는가** | `table-rows.spec.ts` |
| **무결성 판이 자기 문장대로 서는가** | `inspect-integrity-panel.spec.ts` |
| **떠나는 화면의 알림을 걷는 것이 도착한 뒤의 알림까지 걷는가** | `welcome-fail.spec.ts` |
| **나가는 묶음에 원본이 안 실리고, 폴더가 안 겹치는가** | `portfolio-bundle.spec.ts` |
| **`.mlpx`가 받아들이는 시각의 집합** | `schema.spec.ts` · `schema-structure.spec.ts` |
| 도는 일의 셈 자체가 맞는가 | `useWork.spec.ts` |
| `t()`에 읽기 전용 객체를 넘기는가 | `ui-rules.spec.ts` |
| 문구가 부르는 버튼 이름이 실재하는가 — **로케일 어디엔가 그 글자가 있는지**만 본다. 키(화면)를 안 가려서, 한 화면에서 사라진 단추도 다른 화면에 같은 글자가 남으면 조용하다(데이터 화면의 [폴더에서 추가]가 전처리의 `preprocess.testImagesAddFolder` 때문에 그랬다, #38). 데이터 화면 빈 상태 하나는 `image-source-menu.spec.ts`가 화면의 단추로 잰다 | `locales.spec.ts` · `image-source-menu.spec.ts` |
| 나눠 그린 미니 카드가 원문과 같은 글자인가 | `app-choices.spec.ts` |
| 산점도 표식이 가리켜도 안 변하는가 | `cluster-chart.spec.ts` |
| §1.1 http로 띄운 자가호스팅에서도 도는가 | `secure-context-rules.spec.ts` |
| zip 엔트리를 옛 이름으로 부르는 주석 | `entry-names.spec.ts` |
| 종류마다 갈리는 문구의 키를 조립하지 않는가 | `ui-rules.spec.ts` |
| 등록부가 가리키는 문구가 모든 언어에 있는가 | `kinds.spec.ts` |
| 준비 문구 두 벌이 함께 서는가 | `kinds.spec.ts` |
| 예측이 화면에 양보하는가 | `ui-rules.spec.ts` · `src/screen.ts` |
| 예측이 떠나면 멈추는가 | `ui-rules.spec.ts` |
| 엑셀 폴백이 값을 주는가, 그려진 글자를 주는가 | `xlsx.spec.ts` |
| 정본 MIME을 소스에 박는가 | `limits-rules.spec.ts` · `data/image/formats.ts` |
| 팝오버 안을 굴려도 안 닫히는가 | `app-popover.spec.ts` |
| 답에 붙일 증거를 등록부가 고르는가 | `answer-evidence.spec.ts` |
| 되보내는 부품이 인자를 흘리는가 | `ui-rules.spec.ts` |
| 범주 이름이 세 운영체제에서 폴더가 되는가 | `image.spec.ts` |
| 문서를 가리키는 참조가 살아 있는가 | `doc-refs.spec.ts` |
| 판례의 절 제목이 규칙 문서의 절과 짝인가 — 번호 없는 `###` 아래와 번호는 같고 제목이 다른 것은 못 본다 | `cases-headings.spec.ts` |
| 규칙과 판례가 짝이고, 결정문이 `[미정]`·`[결정]`·`[폐기]`를 갖는가 · 결정 번호가 겹치지 않는가 | `docs-structure.spec.ts` |
| 사진을 굽기 전에 자리를 묻는가 | `image-room.spec.ts` |
| **예측 화면의 폴더·zip이 폴더 이름을 안 읽는가**(open-decisions.md 67 결정 7) — 놓기와 메뉴의 [폴더 선택]으로 잰다. 데이터 화면이 같은 입력을 거절하는 것도 본다 | `image-predict-labels.spec.ts` · `image-upload-zip.spec.ts` |
| **그리기의 획 모델과 규격**(open-decisions.md 67) — 획·되돌리기·좌표 변환·다시 그리기·이름 발급·PNG 내보내기를 가짜 컨텍스트로 본다. 캔버스 크기가 정본보다 작지 않은가, 바탕이 굽기 여백색과 같은가도. 실제 캔버스에 획이 보이는가는 사람 확인이다 | `sketch.spec.ts` |
| **사진 입력 방식 등록부**가 줄·무게·덧붙임을 내고 웹캠 줄이 없는가 | `image-sources.spec.ts` |
| **그리기 창**이 빈 그림을 등록부의 칸으로 거절하고, 모은 장·[추가]의 `File[]`·닫기와 버릴지 확인(쌓임 차례, `Esc` 연타)·긋는 중의 단추를 옳게 굴리는가 — 캔버스 접착(`sketch-canvas.ts`)은 갈아끼운다. 최상위 레이어의 쌓임은 `showModal` 호출 차례로만 재고, 크롬의 close watcher 묶음은 흉내다(사람 확인) | `sketch-dialog.spec.ts` · `app-dialog.spec.ts` |
| **[사진 추가] 메뉴의 배선** — 팝오버가 닫혀도·메뉴가 내려가도 받은 것이 닿는가, 그린 사진이 파일로 고른 사진과 같은 워커 요청인가, 그림 이름이 판에서 안 겹치는가, 그리기 창이 떠 있는 동안 붙여넣기를 안 받는가, 트리거가 지금 버튼의 잠금을 받는가. 그리기 창 안의 캔버스는 안 본다 | `image-source-menu.spec.ts` |
| 행 상한 칸에 **제 이름의 상수**가 오는가 | `algorithms.spec.ts` · `limits.ts` |
| 화면이 넘기는 **데이터 종류**가 열린 프로젝트의 것인가 | `training-source.spec.ts` · `data/kinds.ts` |
| MB가 십진인가 | `limits-rules.spec.ts` |
| 미래에서 온 것을 예측 가능하게 거부하는가 | `storage.spec.ts` |
| **그림이 어디서 성립하는지를 등록부가 아는가** | `charts.spec.ts` |
| **눈으로만 보이는 그림 규칙** | `chart-config.spec.ts` |
| **`sr-only`에 담는 상자가 있는가** | `ui-rules.spec.ts` |
| **계산과 잠금이 화면에서 실제로 만나는가** | `chart-dialog.spec.ts` |
| **검사 사이에 자동 저장이 새지 않는가** — 저장소를 지우는 길이 하나이고 그 길이 스토어를 먼저 닫는다. 저장소를 지우지 않고 끝나는 스펙의 타이머는 못 본다 | `database-reset.spec.ts` · `tests/fixtures/database.ts` |
| **소스를 글자로 보는 검사가 주석을 파서로 걷는가** — 속성값·문자열 속 주석 표시가 검사를 끄지 않는다. `fixtures/source.ts`의 스캐너(`withoutComments`)는 여러 줄 속성값·템플릿 리터럴과 정규식 리터럴 속 표시를 못 가른다 | `tests/fixtures/parsed-source.ts` · `ci-language.spec.ts` · `table-align.spec.ts` · `table-rows.spec.ts` · `ui-rules.spec.ts` · `bench-rules.spec.ts` · `locales.spec.ts` |



**소스 전체를 훑는 검사** — 목록을 여기 적지 않는다. `readdirSync`(또는 `fixtures/source.ts`의
`sourceFiles`)로 소스·문서 트리를 걷는 스펙이 그것이고, 커밋마다 늘 돌린다 (`docs/workflow.md` §3).
`grep -lE "readdirSync|sourceFiles\(" frontend/tests/*.spec.ts`가 지금의 목록이다.

## 타입이 막는다

| 규약 | 어떻게 |
|---|---|
| §2 축이 늘면 컴파일이 깨진다 | `ml/axes.ts` · `ml/algorithms.ts`의 `Record<축, …>` |
| §2 등록부에 줄만 더한다 | 등록부 타입이 모든 칸을 요구한다 |
| 상한 판정이 세는 대상 | `trainableRowCount`의 `nSamples`가 **필수 인자**다 (#22) |

## 사람이 지킨다 — 아무것도 안 막는다

**여기가 이 문서의 알맹이다.** 감사를 부를 자리와 검사를 새로 만들 자리다.

### 검사로 만들 수 있는데 아직 없는 것

| 규약 | 만든다면 |
|---|---|
| §4 벤더링 머리말 셋(출처·라이선스·바꾼 것) | `ml/engines/`에서 남의 코드를 들인 파일에 머리말 세 줄을 요구 |
| §4 커밋 규칙(GPG · 경로 명시 · 도구 표기 금지) | `commit-msg`·`pre-commit` 훅 |
| §4 태그 서명 | 설정은 기기에 산다 — 새 기기에서 사람이 확인한다 |
| §4 단정형 주석은 무는 검사를 가리킨다 | 감사가 본다. 기계는 문장이 단정인지 모른다 |
| §4 힙독 금지 | CI가 아니라 에이전트 훅(`.claude/hooks/no-heredoc.mjs`)이 막는다 |
| §2 서버가 없으면 서버 옵션을 이유와 함께 비활성화 | `docs/acceptance.md`에서 사람이 본다. 판정 함수는 `ml/backend.ts`의 `runtimeOptions` |

### 검사로 만들 수 없는 것 — 감사나 사람 눈이 봐야 한다

| 규약 | 누가 보나 |
|---|---|
| 버튼 이름과 그 버튼이 하는 일이 같은가 | 감사 |
| 화면에 뜨는 시각·개수가 **실제로 갱신되는가** (두 시점 비교) | 감사 |
| `limits.ts` 상한의 **값 자체** | 사람 (실측) |
| 문장이 **페이지를 넘긴 뒤에도 참인가** | 감사 |
| 라이선스 표기가 실제 전문과 같은가, 이중 라이선스에서 무엇을 골랐는가 | PR 템플릿의 라이선스 절 + 리뷰어 |
| §2 용어 — 학계 낱말, 우리가 지어낸 말 금지 | `docs/terms.md` + 감사 |
| §2 파이썬 관행(이름·순서·기본값) | 감사 |
| 화면 문구의 말투 | 코드 소유자 (`docs/copy.md`) |
| 화면 생김새 · 빈 상태 · 로딩 · 에러 | **코드 소유자가 자기 브라우저로** |
| 브라우저마다 갈리는 기능 | 코드 소유자가 **실기기로** (아래) |
| 문서와 코드의 정합성 | 감사 |
| 원칙 이탈 (§6의 자문 목록) | 감사 |
| **검사가 규칙을 실제로 가르는가** | `npm run mutate`(`tools/mutants.json`) + 감사 |
| **고친 자리의 이웃도 훑었는가** | 사람 — 지적마다 `grep`으로 센다 (`workflow.md` §3 "감사 국면은 어떻게 도는가") |
| **처방이 실제로 무는가** | 사람 — 고침을 넣고 원래 돌연변이가 우는지 본다 |

#### 실기기로만 보이는 것 (2026-08-14)

- 보안 컨텍스트 밖(`http://192.168.x.x`)에서만 없는 기능 — `secure-context-rules.spec.ts`가 막는다
- 사파리의 캔버스 WebP 굽기 (`open-decisions.md` "정본은 WebP로 굽는다")
- iOS만의 동작, 폭이 좁아 접히는 것
- **실측 문장에는 기준 기기 중 어느 것인지를 함께 적는다.** 기기는 `docs/cases/rule-coverage.md` 같은 절에 있다.

### 백엔드(V6)가 오면 생기는 것 — 아직 뼈대뿐이다

**V6 착수 시 아래를 검사로 만든다.** 첫째만 이미 있다.

- 백엔드 응답에 자연어 문자열이 하나도 없는지 (§1.4) — `backend/tests/test_no_korean_literals.py`
  (**한글만** 잡고 `app/` 밖은 안 본다)
- 작업 완료·실패·취소·타임아웃 **모든 경로**에서 임시 파일이 삭제되는지
- 디스크 부족 시 업로드 거부 (§1.5)
- 세션이 끊기면 그 세션의 모든 것이 지워지는지 (§1.1)
- 백엔드 주소가 설정 가능해지지 않았는지 (§2)

---

## 세워 두고 안 문 자리 — 사람의 판단을 기다린다 (2026-08-30, R12 감사)

→ 이동: `docs/cases/rule-coverage.md` 같은 절. 그 자리를 만질 때 함께 정한다.

### 2026-08-31 사각 감사가 남긴 것

→ 이동: `docs/cases/rule-coverage.md` 같은 절.

## 검사가 구조적으로 못 잡는 것

초록인 CI와 공존하는 실패의 목록이다. 상세와 사례는 `docs/cases/rule-coverage.md` 같은 절.

## 검사가 없는 자리의 지도 (2026-09-02)

→ 이동: `docs/cases/rule-coverage.md` 같은 절. 감사 국면을 열 때 겨냥점으로 읽는다.

### 조용히 틀리는 것 — 돌연변이가 조용했던 자리 셋

→ 이동: `docs/cases/rule-coverage.md`.

### 어떤 스펙도 간접으로도 못 닿는 로직 (52파일 중 로직 쪽)

→ 이동: `docs/cases/rule-coverage.md`.

### 판정 핵은 물리는데 배선은 못 무는 자리

→ 이동: `docs/cases/rule-coverage.md`.

### 화면 층 — 무도달 43판의 공통 모양

→ 이동: `docs/cases/rule-coverage.md`.

### 물려 있음을 실측으로 확인한 것 — 다시 파지 마라

→ 이동: `docs/cases/rule-coverage.md`.

### 이 지도가 확인 못 한 것

→ 이동: `docs/cases/rule-coverage.md`.
