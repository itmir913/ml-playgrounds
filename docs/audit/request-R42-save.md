# R42 감사 요청서 — **`.mlpx` 저장은 언제든지 성공하는가**

> 공통 규칙은 `docs/workflow.md` §3의 **"감사 국면은 어떻게 도는가"**부터 **"감사가
> 되풀이해 잡은 병"**까지다. **먼저 읽어라.** 금지 목록(커밋·`push`·`tag`·`add` ·
> `npm run lint` · `git stash`·`git checkout .`·디렉터리 단위 되돌리기 · 하위
> 에이전트·클라우드 · 버전 올리기 제안)과 등급(A/B/C), 돌연변이 절차, 보고서 서식이 전부 거기 있다.
>
> 앞 라운드: `docs/audit/report-R41-project.md`(프로젝트 슬라이스). 그 뒤의 고침 기록은
> `git log --oneline -- frontend/src/project frontend/src/stores/project.ts`로 본다.
>
> `git status --short`가 더러운 것은 정상이다 — 병렬 세션이 같이 돈다.

## 0. 이번 축 — 하나의 명제를 깨러 간다

`docs/mlpx-spec/01-structure.md` §4.2: **"저장은 항상 성공한다."** 코드가 인정하는 예외는
`PROJECT_FILE_TOO_MANY_ENTRIES` 하나다(`project/format.ts`의 `writeProject`).

**이 명제의 반례를 찾아라.** "저장 성공"은 셋을 다 뜻한다:

1. **누를 수 있다** — 학생이 [파일로 저장]·떠나기 확인 창의 [파일로 저장]에 닿을 수 있다.
2. **파일이 나간다** — `writeProject`가 던지지 않고, 약속이 영영 안 풀리는 일이 없고, `downloadBlob`까지 간다.
3. **나간 파일이 다시 열린다** — 같은 앱의 `readProject`/`loadProject`가 그 파일을 받고 무손실이다.
   **3이 깨지는 것이 1·2보다 나쁘다** — 학생은 성공 알림을 보고 PC를 리셋한다.

## 1. 소유 경로 (읽기·돌연변이)

```
frontend/src/project/format.ts          (writeProject · packingOf · zipToBlob · referencedFileEntry · requireFolderBodies · projectFileName)
frontend/src/project/integrity.ts
frontend/src/project/download.ts
frontend/src/project/portfolio-text.ts  (identifiedExport)
frontend/src/project/portfolio*.ts      (내보내기 직전에 마크다운을 만드는 길만)
frontend/src/stores/project.ts          (exportFile · update · flush 와의 관계)
frontend/src/composables/useExportProject.ts
frontend/src/components/ExportButton.vue · LeaveGuard.vue
```

밖은 **읽기만** 한다.

## 2. 의심할 것 — 순서대로

**① 도달 가능한 상태에서 `writeProject`가 던지는가.** `referencedFileEntry`·`requireFolderBodies`·
`encodeJson`·`buildHashes`의 `throw`마다 **그 상태로 가는 진짜 입구**를 찾아라: 마이그레이션 직후,
첨부 떼기(`detachMissingAttachments`), 데이터셋 교체(`replace.ts`), 사진 범주 이동·이름 바꾸기,
시험·예측 데이터 지우기, 모델 드롭(`selectModels`), 임베딩 버리기, 두 탭/열기 취소 뒤의 반쯤 열린 상태.
**픽스처로 상태를 미리 조립하지 마라** — 되풀이된 병 3.

**② 쓴 파일을 우리가 못 읽는가(명제 3).** 쓰는 쪽이 받아 주는 값과 읽는 쪽 스키마(`schema.ts`의 zod,
`refine`·길이·정규식·`.default()`)의 차이를 쌍으로 대조하라. 특히:
`JSON.stringify`가 `NaN`/`Infinity`를 `null`로 바꾸는 자리(지표·하이퍼파라미터·손실 곡선·보정·
임베딩), `undefined` 필드가 빠지는 자리, 사용자 글의 길이·제어문자·고립 서로게이트,
인적사항(학번·이름)·프로젝트 이름의 경계값, 엔트리 경로의 정규화(`entry-path.ts`) — 쓰는 쪽이
만든 경로를 읽는 쪽이 거절하는가.

**③ 언제든지 누를 수 있는가.** 학습 중 · 사진 업로드/임베딩 중 · 배치 예측 중 · 브라우저 저장
실패(`saveFailed`, `STORAGE_QUOTA_EXCEEDED`) · 탭 잠금을 잃은 상태(`stranded`) · 워커 사망 ·
오프라인. 버튼이 잠기거나 사라지는 조건을 전부 적고, **각각이 학생이 작업을 꺼낼 길을 막는지** 본다.
그 사이 학습이 결과를 쓰면 내보낸 파일은 일관적인가(쥔 `current` 한 판인가).

**④ 내보내기 직전의 부수 효과.** `useExportProject`가 `project.update(...)`로 인적사항을 넣은 뒤
`exportFile`을 부른다. `update`·`identifiedExport`·마크다운 생성이 던지면? 그때 인적사항만 반영되고
파일은 안 나간 상태가 무해한가. 실패 알림이 모달(LeaveGuard) 뒤에 숨는 갈래는 없는가.

**⑤ 크기와 메모리.** `zipToBlob`은 무압축(`ZipPassThrough`)으로 조각을 모은 뒤 `new Blob`이 복사한다 —
최고 메모리가 프로젝트 몇 벌인지 **코드로 세어** 적고, `limits.ts`의 사진·행·첨부 상한을 다 채운
프로젝트의 크기를 산수로 낸다. 실측은 하지 마라(Node는 기준 기기가 아니다) — 산수와 "못 한 것"으로 둔다.
`MAX_*` 상한이 해제(`limits-switch.ts`)된 상태에서 엔트리 수 예외 말고 다른 실패가 있는가.

**⑥ 파일 이름.** `projectFileName`이 빈 문자열·`.`만·예약 이름·4바이트 문자·결합 문자 폭탄에서
OS가 거절하는 이름을 내는가. 브라우저의 `download` 속성이 이름을 바꾸는 경우(확장자 뒤 `.zip`,
사파리 `.mlpx.zip`)는 R41이 봤다 — **확인 커밋 이후 변경 없으면 생략**.

## 3. 제외할 것

- 화면 생김새·문구 말투 · 실기기 다운로드 동작(iPad·iOS 사파리) — 코드 소유자가 본다.
- R41 B-1~B-8, C-1~C-8 — 이미 지적됐다. 그 뒤 고쳐졌는지 확인만 하고 같은 지적을 다시 내지 마라.
- 열기(`readProject`)의 변조 탐지 자체 — 명제 3에 걸릴 때만 본다.
- 의존성 갱신 제안.

## 4. 첫 돌연변이

- `format.ts` `writeProject`의 `fitsInArchive(... + 1)`에서 `+ 1` 삭제.
- `stores/project.ts` `exportFile`에서 `flush().catch(...)`를 `await flush()`로.
- `zipToBlob`에서 `new Blob`과 `settled = true` 순서 뒤집기.
- `referencedFileEntry`가 던지는 대신 `undefined` 반환.

## 5. 규모와 보고

- 돌연변이 20~30. 묶음 사이마다 `git diff --quiet -- frontend/src`.
- 관문 전체를 돌리지 마라. 스펙 단위(`npx vitest run tests/<파일>`)와 `npx vue-tsc --build`만.
- 반례를 찾으면 **재현 스크립트를 진짜 입구로** 만들어 보고서에 붙이고, 재현에 쓴 임시 스펙 파일은 지운다.
- 보고서는 `docs/audit/report-R42-save.md`에 쓴다. 지적마다 자리(`경로:줄`)·주장·재현·처방·이웃 수.
  **"명제가 서는 갈래"도 표로 남긴다** — 무엇을 해 봤는데 저장이 됐는지.
