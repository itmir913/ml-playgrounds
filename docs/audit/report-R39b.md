# R39b 감사 회신 (코드 소유자가 옮겨 적음) — A 1 · B 7 · C 7

대상 main 6a009a9(FIX-R39a 커밋 **전** — 그 뒤 3611a1b가 스토어 `claim()`을 더했다). 돌연변이 58(운 것 21 · 조용 37), 대조군 조용.
뿌리: **`await` 뒤에 "누구의 무엇"을 다시 묻지 않는다**(사진 굽기·대조 바쁨) · 검사 쪽: **조각마다 초록인데 화면 입구를 지나는 검사가 없다**(살균기↔v-html, 사진 입력↔attach, 붙여넣기, 문항 삭제, 절반짜리 zip 가드). 무결성·대조의 판정 계산 자체는 조용.

## A-1 사진을 굽는 동안 프로젝트가 바뀌면 사진이 다른 프로젝트에 붙는다
`views/PortfolioView.vue:332-350` `attach` — `await bakeAttachments(files)` 뒤 `project.file`·`portfolio.value`를 다시 읽고 소유권·문항 존재를 확인 안 함. 재현(임시 스펙): SectionCard attach emit → 굽기 지연 → unmount → store.file을 다른 프로젝트(OTHER)로 → 굽기 완료 → OTHER에 `attachments={"motivation":["portfolio/attachments/1.webp"]}`. 같은 프리셋 양식이면 문항 id가 같아 남의 프로젝트 해당 문항에 보인 채로 붙음. 창 = 굽는 시간(브라우저 미측정). 처방(쟀다): 첫 줄 `const owner = project.projectId`, await 뒤 `if (project.projectId !== owner || !sections.value.some((one) => one.id === sectionId)) return` → 재현 2 초록, portfolio-attach·portfolio-view 18/18; 처방 빼면 재현 2 빨강. **이제 main에 스토어 `claim()`(같은 id·같은 열기 세대)이 있으니 그것을 써라.** 이웃: `@이벤트` async 처리기 7곳 — 소유 경로는 여기 하나, 나머지 ImagePanel `readPicked`·`moveSelected`·`commitName`, WelcomeView `openFile`·`create`·`openProject`, ProjectName `start`(무해) 안 잼(ImagePanel readPicked는 R39a가 claim으로 막음).
## B-1 굽는 동안 그 문항을 지우면 안 보이고 못 지우는 사진이 남는다 — A-1 처방으로 함께 닫힘(`attachments={"motivation":[...]}`인데 `sections=[]`, portfolioBytes에 합산, photosOf 0장, .mlpx·묶음 zip엔 실리고 document.md엔 없음).
## B-2 대조 판: 다른 실험이 대조 중이면 [대조 시작]이 이유 없이 회색
`views/inspect/ReproducePanel.vue:147` `cannotStart = busy || blockers.length>0` — busy가 이유 목록 밖(§10.2 위반, computed로 ui-rules 우회). 재현: 실험 a 대조 → props를 b로 → 버튼 disabled, 사유·진행·[멈추기] 없음, `알 수 없음`만. 처방(쟀다): `comparing !== null && comparing !== props.experiment.id`면 사유(예 `COMPARING_OTHER` + 로케일 키; `inspect.blocked.` 접두는 locales.spec PAIRED_PREFIXES에 있음). 새 키 없이 넣으면 live 검사 셋이 i18n 누락으로 빨강. M30(busy 제거 → 두 대조 동시 시작) 조용 — 두 번 시작 막는 검사 없음. 이웃: busy를 :disabled에 직접 쓰는 곳 ~20(그 화면 자신이 바쁨이라 다른 병), "다른 대상이 바쁨"은 여기 하나.
## B-3 (결정 필요, 결정문 57 ②) 옛 파일의 "재현되지 않음"이 학생 탓으로 읽힌다
재현: k-평균 run 파일 실루엣 0.69901, 재계산 0.63651 → `K-평균(K-Means) 판정 결과가 재현되지 않음 차이 실루엣 계수 -6.25e-2`. 앱 버전 이후 규칙이 바뀌었을 수 있다는 말 없음, `manifest.appVersion`을 대조가 안 봄. 52도 같은 비용. ① 현행 ② appVersion이 규칙 변경 이전이면 해당 run `NOT_JUDGED` + 사유(권고; `engineVersionFallback`과 같은 모양, 규칙 변경 시점을 버전 목록으로 들어야 해서 결정 먼저) ③ 판정 두고 판 아래 한 줄.
## B-4 유일한 v-html 자리 살균을 아무 검사도 안 묾
M20 `GuidanceText.vue:26` `renderGuidance(props.markdown)` → `props.markdown` → portfolio-view·portfolio-markdown·ui-rules 292 초록(병 #2). 처방(쟀다): GuidanceText를 `<img src=x onerror=...>`·`javascript:` 링크로 마운트, DOM에 img·`href="javascript` 없음 단언 → M20 빨강, 원복 초록.
## B-5 화면 입구가 안 물리는 경로 넷(학생이 다침)
M14 `SectionCard.vue` onPaste `images.length === 0` 가드 끔 → 답 칸에 글자 붙여넣기 불가, 조용 · M15 onPicked `[]` emit → [사진 추가] 사진 안 붙음, 조용(검사가 `card.vm.$emit('attach')`로 입구 건너뜀) · M07 PortfolioView remove() no-op → 문항 삭제 안 됨, 조용 · M23 PhotoCards `remove('')` → 사진 삭제 안 됨, 조용. 처방: 실제 DOM 이벤트(paste·change·클릭→확인)로 한 판씩(안 잼).
## B-6 점검 묶음 "다 읽었을 때만 내려받는다" 가드 안 물림
M36 `InspectView.vue:597` `whole &&` 제거 → inspect 넷 21 초록. §8.21 규칙, R28이 고친 자리. 처방: collect 중 `roster.show(새 명렬)` → `downloadBlob` 안 불림 단언(안 잼).
## B-7 포트폴리오 입구에서 양식 언어가 새도 안 욺
M04 `importMarkdown` locale 인자 제거 조용 · M18 `TemplateSourceList` row.locale 제거 조용(시작 화면) · M19(메뉴)만 욺. 처방: portfolio-view.spec "언어까지 함께 간다"를 시작 화면(TemplateSourceList)과 importMarkdown 끝(template.locale)까지.

## C
- C-1 점검 포트폴리오 판이 사진만 있고 글 없는 제출물(이전 문항 답만 있는 파일)을 "아직 쓴 글이 없습니다"로 덮음 `PortfolioPanel.vue:52` — 처방 written에 사진·orphans 포함(쟀다, 초록). 묶음 zip과 다른 말.
- C-2 `project/portfolio.ts:283-284` "최대 번호 + 1… 개수로 세면 번호가 되풀이" 거짓 — 1·2 붙이고 2 떼면 다음이 2.webp. 해 경로 미확인. 주석 고치거나 바이트 키까지 max에.
- C-3 `portfolio-bundle.ts` folderNames `['Kim.mlpx','kim.mlpx']` → `['Kim','kim']` 윈도에서 합쳐짐(R28 C-20 이웃).
- C-4 교사가 고친 학번·이름이 묶음 document.md 머리글엔 안 감(editHint "이 목록에만" — 사양대로, 결정 여지).
- C-5 ExportButton 저장된 학번·이름 미리 채움 끄기(M49) 조용 — 끄면 빈 값이 manifest를 덮음.
- C-6 AppToast·TermPopover·PhotoCards·OrphanAnswers·PortfolioPreview·StudentEditor 전용 스펙 없음, M24·M25 조용.
- C-7 ExportButton 마크다운 → flush → zip 사이 프로젝트 교체 경합(이론, 안 잼).

## 돌연변이 58 — 조용 37
M03 M04 M06(거의 등가) M07 M08 M09 M10(jsdom) M11 M12 M13(등가) M14 M15 M16 M18 M20 M23 M24 M25 M27 M29 M30 M31 M33 M36 M37 M39 M40(사용자 보고 퇴행 자리) M42 M43 M44(거의 등가) M46 M48 M49 M50 M53 M54(jsdom) M58. 욺: M01 M02 M05 M17 M19 M21 M22 M26 M28 M32 M34 M35 M38 M41 M45 M47 M51 M52 M55 M56 M57.
## 못 한 것: 커버리지(정션이라 npm i 불가), A-1 창 길이, B-5·6·7 처방 검사 미측정, C-7, 스토어·plan-cache·TrainView 안 봄.
## 조용했던 자리: renderGuidance 살균 규칙 자체 · 포트폴리오는 실험·지표를 인용 안 함 · 양식 가져오기는 추가만(답 남음) · 사진 삭제 → 참조·바이트 제거 · useRoster.show가 교사 고침 비움 · TemplateSourceList unmount 뒤 emit(Vue 가드) · i18n 조립 키 PAIRED_PREFIXES·가운데 사용자 데이터 없음 · ProjectPicker 잠금 사유 · AppDialog persistent · 무결성 changed 필터.
