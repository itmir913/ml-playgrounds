# 0.35.2 경계 감사 B — 앱 밖으로 나가는 사용자 글 · 규정 서랍 · 이름 충돌

> 공통 규칙은 `docs/workflow.md` §3 "감사 국면은 어떻게 도는가"부터 "감사가 되풀이해 잡은 병"까지와 §10. **먼저 읽어라.**
> 금지: `git commit`·`push`·`tag`·`add` · 영구 수정 · `npm run lint` · `npm run ci` 전체 · `git stash` · `git checkout .`·디렉터리 단위 되돌리기 ·
> 하위 에이전트·클라우드 · 버전 올리기 제안 · 브라우저 자동화. 보고서 파일은 쓰지 말고 최종 메시지로 돌려준다.
> 기준: `a180e38`(0.35.2 + 로드맵 갱신). 같은 시각에 감사 A가 다른 worktree에서 돈다.

## 0. 어디서 도는가 — 반드시 지킨다

- 작업 트리는 **`C:\Users\user\Documents\PycharmProjects\mlp-audit-b`** 하나다. 원 저장소(`...\ml-playgrounds`)는 읽기만 하고 **절대 쓰지 않는다.**
- **모든 git 명령은 `git -C C:\Users\user\Documents\PycharmProjects\mlp-audit-b ...`로 쓴다.** 셸 cwd를 믿지 마라.
  첫 확인으로 `git -C <위 경로> log -1 --format=%h`가 `a180e38`인지 보고서 첫 줄에 적는다.
- `frontend\node_modules`는 원 저장소로 가는 **정션**이다. 그 안을 지우거나 고치지 마라. `npm install`·`npm ci` 금지.
- 스펙은 `<위 경로>\frontend`에서 `npx vitest run tests/<파일>`, 타입은 `npx vue-tsc --build`. 출력은 파일로 받고 읽는다(`workflow.md` §3).
- 임시 스펙은 `frontend/tests/zz-edge-b-*.spec.ts`로 만들고 끝에 지운다. 돌연변이는 `git -C <위 경로> restore -- <파일>`로 되돌리고
  묶음마다 `git -C <위 경로> diff --quiet -- frontend/src frontend/public`.

## 1. 왜 이 감사인가

`docs/roadmap.md` "지금 어디인가"의 **감사가 안 본 채로 남은 경계** 중 셋이다. `document.md`는 판정 구역(`project/portfolio.ts`, 결정
89·93)이 코드 밖의 `<`와 http·https가 아닌 링크를 글자로 싣는다. 보안 검토는 입력으로 뚫는 방식이었고 **판정 구역의 돌연변이는 구현자만
돌렸다.** 규정 서랍(`public/legal/index.html`)의 스크립트는 **돌리는 검사가 없다.** R43이 C로 남긴 `renameCollidesWithTest`는 대소문자를 접지 않는다.

## 2. 볼 것

1. **판정 구역이 무는가** — `project/portfolio.ts`의 판정을 한 갈래씩 뭉개고 `tests/portfolio.spec.ts`·`portfolio-bundle.spec.ts`·`export-button.spec.ts`가
   우는지 잰다. 마크다운 렌더러의 실제 규칙과 판정이 갈린다고 주장하려면 **그 렌더러를 돌려라**(`workflow.md` §3 "표준 라이브러리와 갈린다").
2. **사용자 글을 앱 밖 산출물에 싣는 자리 전수** — `document.md` 말고도 사용자 글(프로젝트·범주·열·실험 이름, 메모)이 파일·zip 항목 이름·
   내보내기(CSV·엑셀 등)에 실리는 자리를 `grep`으로 세고, 각 자리가 판정(또는 그 자리에 맞는 이스케이프)을 거치는지 본다. 엑셀·CSV의 수식 주입
   (`=`·`+`·`-`·`@` 머리)도 이 축이다. 한 자리라도 판정을 안 거치면 이웃 수와 함께 적는다.
3. **규정 서랍** — `frontend/public/legal/index.html`의 스크립트를 읽고, 임시 jsdom 스펙으로 돌려 본다(언어 고르기, `<html lang>` 초기값 —
   최근 고침 `62d1fdc`, 없는 언어·해시). 돌리는 검사가 없다는 사실 자체는 지적이 아니다 — 학생·교사가 다치는 결함을 찾는다.
4. **`renameCollidesWithTest`** — `project/images.ts`·`data/image/test-set.ts`·`locks.ts`. 대소문자를 안 접는 것이 실제로 무엇을 깨는가(`categoryFolderKey`의
   접기와 견줘, 내려받은 zip을 NTFS에 풀 때 겹치는가). **진짜 입구로 재현하라.**

## 3. 규모

돌연변이 20개 안팎. 1 → 2 → 3 → 4 순이다. 남는 시간은 안 본 것에 쓴다.

## 4. 제외

- 화면 생김새·문구 말투, 실기기·스크린 리더, 의존성 갱신.
- 라우터·알림 수위선·화면 상태의 갱신 누락 — 감사 A의 몫이다.
- GitHub #40·#41·#42.

## 5. 보고

지적마다 등급(A/B/C)·자리(`경로:줄`)·주장·재현·처방(임시로 넣어 원래 돌연변이가 우는지까지)·이웃 수. 돌연변이 표 전체(운 것까지),
"못 한 것", "확정 불가"를 쓴 자리. 마지막 줄에 `git -C <위 경로> status --short`.
