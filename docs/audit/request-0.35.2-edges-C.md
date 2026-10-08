# 0.35.2 경계 감사 C — 범주를 고친 뒤의 화면 · 범주와 묶음의 폴더 이름

> 공통 규칙은 `docs/workflow.md` §3 "감사 국면은 어떻게 도는가"부터 "감사가 되풀이해 잡은 병"까지와 §10. **먼저 읽어라.**
> 금지: `git commit`·`push`·`tag`·`add` · 영구 수정 · `npm run lint` · `npm run ci` 전체 · `npm install`·`npm ci` · `git stash` ·
> `git checkout .`·디렉터리 단위 되돌리기 · 하위 에이전트·클라우드 · 버전 올리기 제안 · 브라우저 자동화. 보고서 파일은 쓰지 말고 최종 메시지로 돌려준다.
> 기준: `e78cbd1`. 같은 시각에 고침 라운드 감사자가 `mlp-audit-a`에서, 코드를 쓰는 세션이 원 저장소에서 돈다 — 시간 초과가 나면 종류부터 가른다(§3).

## 0. 어디서 도는가 — 반드시 지킨다

- 작업 트리는 **`C:\Users\user\Documents\PycharmProjects\mlp-audit-b`** 하나다. 원 저장소는 읽기만 한다.
- **모든 git 명령은 `git -C C:\Users\user\Documents\PycharmProjects\mlp-audit-b ...`.** 첫 확인으로 `log -1 --format=%h`가 `e78cbd1`인지 적는다.
- `frontend\node_modules`는 원 저장소로 가는 **정션**이다. 건드리지 마라.
- 임시 스펙은 `frontend/tests/zz-edge-c-*.spec.ts`, 되돌리기는 `git -C <위 경로> restore -- <파일>`, 묶음마다 `diff --quiet -- frontend/src`.
- 보조 스크립트는 `C:\Users\user\AppData\Local\Temp\claude\edgec\` 같은 **새 디렉터리**에 둔다.

## 1. 왜 이 감사인가

`docs/roadmap.md` "감사가 안 본 채로 남은 경계"의 **갱신 누락**에서 감사 A가 결과 화면 하나만 보고 남긴 것과, 감사 B가 "못 한 것"으로
넘긴 폴더 이름 둘이다(`docs/audit/report-0.35.2-edges-A.md`·`report-0.35.2-edges-B.md`).

## 2. 볼 것

1. **범주를 고친 뒤의 화면** — 범주 이름 바꾸기·지우기(결정 106 개정, `project/images.ts`의 `renameCategory`·`removeCategory` 등)와
   테스트 사진 바꾸기 뒤에, 그 사이 열려 있던(또는 다시 뜨는) 학습·예측·점검 화면의 파생 상태가 지금 파일을 따라가는가. 사진 예측의 고른 범주,
   학습 화면의 범주 비율·클래스 목록, 혼동 행렬의 라벨 등. 파일 단위는 `category-test-photos.spec.ts`·`training-source.spec.ts`의 "결정 106"
   묶음이 덮는다 — **화면 단위를 진짜 입구로** 재라. 고른 id가 따라가는 네 자리(`InspectView`·`ClusterNeighbors`·`ImagePanel`·`HistogramChart`)는
   고침 라운드 감사자의 몫이니 빼라.
2. **교사 묶음의 폴더 이름** — `project/portfolio-bundle.ts`의 `folderFor`는 `''`·`.`·`..`만 거르고 `FORBIDDEN_IN_NAME`
   (`data/file-name-rules.ts`)을 안 쓴다. 리눅스·맥에서 지은 `a:b.mlpx`·`CON.mlpx`·끝이 점이나 공백인 이름이 묶음 엔트리가 되면 윈도 탐색기가
   그 묶음을 어떻게 푸는가 — 파이썬 `zipfile`과 윈도 `Expand-Archive`로 실제로 풀어 보고 적어라(B는 코드로만 읽었다).
3. **`.mlpx` 범주 폴더 이름** — `data/image/canonical.ts`의 `isValidCategoryName`을 갈래마다 뭉개고 우는 스펙을 찾는다(이름 창의 gate와
   올리기 두 입구).

## 3. 규모

돌연변이 15개 안팎. 1 → 2 → 3. 약 50분.

## 4. 제외

- 화면 생김새·문구, 실기기, 의존성 갱신, GitHub #40·#41·#42, open-decisions 109·110.

## 5. 보고

지적마다 등급(A/B/C)·자리(`경로:줄`)·주장·재현·처방(임시로 넣어 원래 돌연변이가 우는지까지)·이웃 수. 돌연변이 표 전체, "못 한 것",
"확정 불가". 마지막 줄에 `git -C <위 경로> status --short`.
