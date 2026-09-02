/**
 * 화면 코드가 지켜야 하는 규칙.
 *
 * 둘 다 **사람의 주의로는 못 지키는 종류다.** 급할 때 `text-sm` 하나, 안 맞을 때
 * `w-[327px]` 하나가 들어가고 리뷰에서는 자연스러워 보인다. i18n 규칙을 검사로
 * 만든 것과 같은 이유로 여기도 검사로 만든다 (tests/i18n-usage.spec.ts).
 *
 * **검사기 자체를 먼저 검사한다.** 정규식이 틀렸을 때 아무것도 안 잡으면서 조용히
 * 초록색이 되는 것이 제일 나쁜 상태다.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { windowedHits, withoutComments } from './fixtures/source'

/** 정규식과 예문 안에 그대로 못 적는다 - 이 파일 자신이 검사 대상이라 조립 자리로 읽힌다. */
const BACKTICK = String.fromCharCode(96)

/**
 * 여는 태그 안의 속성들. **따옴표 안의 `>`를 태그 끝으로 안 읽는다.**
 *
 * `[^>]*`로 자르던 때는 `:disabled="page >= total - 1"`이나
 * `v-if="entries.length > 0"`이 **앞에 놓이기만 해도** 그 태그가 통째로 안 보였다.
 * 코드는 그대로인데 **속성 순서만 바꿔도 검사를 빠져나간다** (2026-08-31 사각 감사 A-1).
 * 템플릿에서 속성값에 `>`를 품은 줄이 마흔 곳이 넘으므로, 만나는 것은 시간 문제다.
 */
const ATTRS = String.raw`(?:"[^"]*"|'[^']*'|[^>"'])*`

const SRC = join(process.cwd(), 'src')
if (!existsSync(SRC)) throw new Error(`src not found: ${SRC}`)

interface Rule {
  readonly name: string
  readonly why: string
  readonly pattern: RegExp
  /** 패턴이 걸린 뒤 한 번 더 거르는 조건. **넘어오는 것은 줄이 아니라 매치다** (`hits`). */
  readonly only?: (match: string) => boolean
  readonly violations: readonly string[]
  readonly allowed: readonly string[]
  /**
   * **prettier가 실제로 편 위반.** 여러 줄짜리 한 덩어리로 적는다.
   *
   * 한 줄짜리 표본만 두면 그 규칙은 "한 줄로 쓴 위반"만 지킨다고 말하는 셈이다
   * (`architecture.md` §9.3.1의 규약 2). **지어내지 말고 포매터에 넣어 나온 것을
   * 쓴다** — `npx prettier --stdin-filepath probe.ts`.
   */
  readonly wrapped?: readonly string[]
}

const RULES: readonly Rule[] = [
  {
    name: '범주 목록을 settings에서 직접 읽지 않는다',
    why:
      '범주는 폴더가 갖고 목록과 순서는 settings가 갖는다 - 둘이 갈리면 폴더가 이긴다. ' +
      '그 병합은 imageCategories 하나가 한다. 화면이 settings만 보면 있는 범주를 ' +
      '"모르는 범주"라 부르고, 학생이 그 말대로 빼면 그 범주가 없는 테스트셋으로 ' +
      '채점한다 - 잠금이 막으려던 바로 그 상태다 (2026-08-30 R12 감사 A-2).',
    // 멤버 체인은 prettier가 끊는다. 토큰 사이의 `\s*`는 규약이다 (architecture.md §9.3.1).
    pattern: /dataSettings\([^)]*\)\s*\.\s*categories/,
    violations: [
      "  settings.value === null ? [] : dataSettings('image', settings.value).categories,",
      'return dataSettings(kind, document.settings).categories',
    ],
    allowed: [
      'const categories = computed(() => imageCategories(project.file))',
      "return backboneFor(dataSettings('image', file.document.settings).backboneId)",
    ],
  },
  {
    name: 'text-base보다 작은 글씨를 쓰지 않는다',
    why: '중고등학생이 교실 모니터로 본다. 촘촘함은 글자를 줄여서가 아니라 여백으로 얻는다.',
    pattern: /\btext-(xs|sm)\b/,
    violations: ['<p class="text-sm text-ink-soft">', 'class="mt-1 text-xs"'],
    allowed: [
      '<p class="text-base">',
      '<h2 class="text-lg font-bold">',
      // 낱말 안에 우연히 들어간 경우는 걸리지 않아야 한다.
      'class="context-small"',
    ],
  },
  {
    name: '바인딩 안의 문자열에도 임의 값을 쓰지 않는다',
    why:
      '아래 규칙은 정적 class만 본다 - 바인딩 안의 대괄호는 코드라서 일부러 뺐다. ' +
      '그런데 배열이나 객체 안의 문자열 리터럴은 코드가 아니라 클래스다. ' +
      '지금 0건이고, 0건일 때 세워 두는 것이 값싸다 (2026-08-30 R12 감사 C-5).',
    pattern: /:class="[^"]*'[^']*[a-z]-\[/,
    violations: [':class="[CELL, \'w-[327px]\']"', ':class="{ \'text-[0.625rem]\': small }"'],
    allowed: [
      ":class=\"[CELL, active ? 'bg-brand' : '']\"",
      ':class="toneOf(column)"',
      // 정적 class의 임의 값은 아래 규칙이 잡는다. 두 번 잡지 않는다.
      '<div class="w-[327px]">',
    ],
  },
  {
    name: 'Tailwind 임의 값을 쓰지 않는다',
    why: '기본 클래스만 쓴다. 임의 값이 흩뿌려지면 눈금이 사라지고 디자인 교체가 전수 조사가 된다.',
    // class 속성 안의 `[...]`만 본다. :class 바인딩의 배열·객체는 자바스크립트다.
    pattern: /\sclass="[^"]*\[[^"]*\]/,
    violations: [
      '<div class="w-[327px]">',
      '<span class="text-[0.625rem] font-bold">',
      '<table class="[&_th]:px-4">',
    ],
    allowed: [
      '<div class="w-full max-w-xs">',
      // 바인딩 안의 대괄호는 클래스가 아니라 코드다.
      ":class=\"[CELL, active ? 'bg-brand' : '']\"",
      'v-for="(row, index) in rows"',
    ],
  },
  {
    name: '잠금 조건을 템플릿에서 조립하지 않는다',
    why:
      '조건을 하나 더할 때 고쳐야 할 파일이 늘고, 조건 하나를 확인하려고 화면 전체를 ' +
      '마운트해야 하니 아무도 그 조건을 테스트하지 않는다. 무엇보다 **학생이 왜 못 ' +
      '누르는지 모른다** — 회색 버튼은 이유 없이는 고장으로 보인다 (architecture.md §10). ' +
      '조합이 필요해진 순간이 gate 함수(또는 이름 붙은 computed)를 만들 순간이다.',
    // 막아야 할 죄는 **조합**이다. `!canSubmit`이나 `gate.length > 0`처럼 한 군데를
    // 가리키는 표현은 통과시킨다 - 국소 조건까지 잡으면 검사가 성가셔지고, 성가신
    // 검사는 꺼진다.
    pattern: /:disabled="[^"]*(&&|\|\|)/,
    violations: [
      ':disabled="!hasData || !hasTarget"',
      ':disabled="busy && !ready"',
      ':disabled="computing || page === 0"',
    ],
    allowed: [
      ':disabled="busy"',
      ':disabled="!canSubmit"',
      ':disabled="gate.length > 0"',
      ':disabled="props.disabled"',
      // :disabled가 아닌 곳의 조합은 상관없다.
      'v-if="ready && !busy"',
    ],
  },
  {
    name: '화면에서 데이터 종류·과제 유형을 직접 비교하지 않는다',
    why:
      '"X는 Y에서만 쓸 수 있다"는 X의 등록부 항목에 적는다 (architecture.md §9.1). ' +
      '화면에 적으면 이미지가 들어오는 날 고쳐야 할 파일이 등록부 하나가 아니라 그 ' +
      '사실을 아는 화면 전부가 되고, **그중 하나를 빠뜨린 것은 컴파일도 검사도 못 잡고 ' +
      '학생이 화면에서 알게 된다.**',
    // **문자열 리터럴과의 비교만 잡는다.** `=== undefined`는 "어느 종류인가"가 아니라
    // "아직 안 골랐는가"이고, 안 고른 상태는 등록부가 답할 수 있는 것이 아니다
    // (ml/algorithms.ts의 supportedTaskTypes가 그때 좁히지 않는 것과 같다).
    pattern: /(dataType|taskType)\s*(===|!==)\s*['"`]/,
    violations: [
      `<section v-if="dataType === 'tabular'">`,
      `:class="props.taskType !== 'clustering' ? 'font-bold' : ''"`,
    ],
    allowed: [
      '<component :is="kind.prepPanel" />',
      'v-for="panel in panels"',
      // 등록부에 넘기는 것은 비교가 아니다.
      ':panels="metricPanelsFor(dataType, taskType, run)"',
      // 아직 안 골랐는가는 종류 분기가 아니다.
      'v-if="props.taskType === undefined"',
      'if (taskType === undefined) return []',
    ],
  },
  {
    name: '작업 공간 래퍼의 세로 간격이 화면마다 같다',
    why:
      '단계를 옮길 때마다 내용이 몇 px씩 위아래로 뛴다. 한 화면만 gap-4였던 것이 실제로 ' +
      '그랬고, 원인을 짚기 어려운 만큼 더 나쁘다 — 학생은 화면이 불안하다고만 느낀다.',
    // 작업 공간의 바깥 여백은 `p-4 sm:p-5`로 고정돼 있다. 그 래퍼의 gap이 gap-5가
    // 아니면 그 화면만 다른 리듬으로 선다.
    pattern: /\sclass="[^"]*p-4 sm:p-5[^"]*"/,
    only: (line) => /gap-\d/.test(line) && !/gap-5/.test(line),
    violations: [
      '<div class="flex flex-col gap-4 p-4 sm:p-5">',
      '<div class="flex h-full flex-col gap-3 p-4 sm:p-5">',
    ],
    allowed: [
      '<div class="flex flex-col gap-5 p-4 sm:p-5">',
      '<div class="flex h-full flex-col gap-5 p-4 sm:p-5">',
      // 래퍼가 아닌 곳의 gap-4는 상관없다.
      '<div class="mt-3 flex flex-col gap-4">',
    ],
  },
  {
    name: '작업 공간 래퍼의 높이는 h-full이 아니라 min-h-full이다',
    why:
      '`h-full`은 화면이 낮을 때 남은 자리를 0으로 나눠 준다. 그러면 표가 머리만 남긴 채 ' +
      '**잘리는데 스크롤도 안 생긴다** — 작업 공간의 높이가 바깥과 딱 같아서 바깥도 넘칠 ' +
      '것이 없다고 본다. 실제로 데이터 화면과 결과 화면이 둘 다 그랬고, 낮은 창에서만 ' +
      '재현돼서 눈으로는 원인을 못 짚는다.',
    pattern: /\sclass="[^"]*p-4 sm:p-5[^"]*"/,
    // **`min-h-full`이 `h-full`을 품는다.** 앞이 낱말 문자나 하이픈이면 다른 클래스다 -
    // 이걸 빼먹으면 고쳐 놓은 화면을 검사기가 다시 잡는다.
    only: (line) => /(?<![\w-])h-full\b/.test(line),
    violations: [
      '<div class="flex h-full flex-col gap-5 p-4 sm:p-5">',
      '<div class="h-full p-4 sm:p-5">',
    ],
    allowed: [
      '<div class="flex min-h-full flex-col gap-5 p-4 sm:p-5">',
      '<div class="flex flex-col gap-5 p-4 sm:p-5">',
      // 래퍼가 아닌 곳의 h-full은 상관없다 - 진행 막대가 그렇다.
      '<div class="h-full rounded-pill bg-brand" />',
    ],
  },
  {
    name: '나란한 단추가 줄을 바꾸는 자리를 창 폭으로 정하지 않는다',
    why:
      '**나란한 단추(`grid-flow-col auto-cols-fr`)가 사는 곳은 창이 아니라 대화상자이거나 ' +
      '두 칸 중 한 칸이다.** `sm:`으로 갈랐더니 `max-w-lg`인 대화상자가 창 640px을 ' +
      '영영 못 넘어 **휴대폰에서는 `취소`와 `만들기`까지 언제나 세로로 쌓였다** ' +
      '(2026-08-30, 사용자가 겪었다). 반대쪽도 같다 - 창만 넓으면 좁은 칸에서도 셋이 ' +
      '나란히 눌린다. 재야 하는 것은 **그 줄에 남은 자리**이므로 `@container`로 옮긴다.',
    // 창 접두사가 붙은 것만 잡는다. `@sm:`·`@3xs:`는 컨테이너 질의라 통과한다 -
    // 낱말 경계 앞의 `@`를 빼먹으면 고쳐 놓은 자리를 검사기가 다시 잡는다.
    pattern: /(?<![\w@-])(sm|md|lg|xl):(grid-flow-col|auto-cols-fr)\b/,
    violations: [
      '<div class="mt-6 ml-auto grid w-fit gap-3 sm:grid-flow-col sm:auto-cols-fr">',
      '<div class="grid w-fit gap-2 md:auto-cols-fr">',
    ],
    allowed: [
      '<div class="ml-auto grid w-fit gap-3 @3xs:grid-flow-col @3xs:auto-cols-fr">',
      '<div class="mx-auto grid w-fit gap-2 @sm:grid-flow-col @sm:auto-cols-fr">',
      // 창 폭이 정말 기준인 자리는 상관없다 - 셸이 그렇다.
      '<div class="flex min-h-0 flex-1 flex-col md:flex-row">',
    ],
  },
  {
    name: '테두리 토큰을 글자색으로 쓰지 않는다',
    why:
      '**구분자도 글자다.** 상태바의 가운뎃점이 `text-line-strong`이었는데 흰 바탕에서 ' +
      '대비가 1.6:1이라 사실상 안 보였다 — 선으로는 맞는 값이고 글자로는 틀린 값이다. ' +
      '눈으로만 보이는 결함이라 리뷰가 못 잡는다(같은 자리가 셋이었다). 옅게 두고 ' +
      '싶으면 글자 토큰 중 가장 옅은 `ink-faint`를 쓴다.',
    // `marker:`·`placeholder:` 같은 변형이 앞에 붙어도 걸려야 한다. 낱말 경계가
    // 콜론과 t 사이에서 서므로 접두사는 그냥 통과한다.
    pattern: /\btext-line(-strong)?\b/,
    violations: [
      '<span class="text-line-strong" aria-hidden="true"> · </span>',
      '<ul class="marker:text-line-strong">',
      '<span class="text-line">/</span>',
    ],
    allowed: [
      '<span class="text-ink-faint"> · </span>',
      // 테두리 토큰을 테두리에 쓰는 것은 제자리다.
      '<div class="border border-line-strong">',
      '<hr class="border-line" />',
      // 낱말 안에 우연히 들어간 경우는 걸리지 않아야 한다.
      'class="text-lines-count"',
    ],
  },
  {
    name: '표에 h-full을 주지 않는다',
    why:
      '`AppTable`은 스스로 스크롤하는 상자다. 거기에 `h-full`을 주면 **부모가 얼마나 ' +
      '작든 그만큼 따라 줄어들어** 머리만 남고 줄이 하나도 안 보인다. 자리는 부모가 ' +
      'flex로 주고 표는 `min-h-0 flex-1`로 받는다 — 그래야 최소 높이가 부모 쪽 한 군데에 ' +
      '모인다.',
    // 속성을 건너뛰는 조각은 `ATTRS`다. `[^>]*`를 옮기면서 **RULES 안의 이 한 자리를
    // 빠뜨렸고**, 그러면 앞에 `>`를 품은 속성이 하나만 놓여도 규칙이 통째로 꺼진다
    // (2026-08-31 사각 감사 A-1). 아래 위반 표본의 셋째가 그 모양이다.
    pattern: new RegExp(String.raw`<AppTable${ATTRS}\sclass="[^"]*(?<![\w-])h-full\b`),
    violations: [
      '<AppTable class="h-full">',
      '<AppTable v-if="shown" class="mt-2 h-full">',
      '<AppTable v-if="rows.length > 0" class="h-full">',
    ],
    allowed: [
      '<AppTable class="min-h-0 flex-1">',
      '<AppTable>',
      // min-h-full은 다른 클래스다. 낱말 경계만 보면 이것까지 걸린다.
      '<AppTable class="min-h-full">',
      // 표가 아닌 것의 h-full은 상관없다.
      '<div class="h-full">',
    ],
  },
  {
    name: '종류마다 갈리는 문구의 키를 손으로 조립하지 않는다',
    why:
      '**조립한 키는 등록부를 지나치고, 정적 키 검사는 그것을 못 본다.** 대시보드가 ' +
      '할 일 문구를 조립해서, 이미지 프로젝트의 전처리 줄에 `타깃(Target) 선택하기`가 ' +
      '떴다 — 같은 목록이 데이터 화면 안에서는 `범주(Class) 나누기`였다. 두 언어의 키 ' +
      '집합은 완벽히 맞으므로 로케일 검사도 초록이다. 문구 키는 `stepTasks`·' +
      '`currentTask`·`stepTextKey`가 준 것을 그대로 `t()`에 넣는다.',
    // `steps.{id}.label`은 종류를 안 가려서 조립해도 된다. purpose·locked만 본다.
    // `t(` 다음의 `\s*`는 규약이다 (architecture.md §9.3.1). 인자가 셋이면 prettier가
    // **정확히 그 자리에서** 줄을 바꾸고, 그러면 창으로 이어도 공백 하나 때문에 샌다.
    pattern: new RegExp(
      `t\\(\\s*${BACKTICK}(tasks\\.\\$\\{|steps\\.\\$\\{[^${BACKTICK}]*\\}\\.(purpose|locked)${BACKTICK})`,
    ),
    violations: [
      `{{ t(${BACKTICK}tasks.\${task.key}${BACKTICK}) }}`,
      `t('project.resume', { task: t(${BACKTICK}tasks.\${now.key}${BACKTICK}) })`,
      `{{ t(${BACKTICK}steps.\${entry.step}.purpose${BACKTICK}) }}`,
      `{{ t(${BACKTICK}steps.\${step}.locked${BACKTICK}) }}`,
    ],
    allowed: [
      '{{ t(task.labelKey) }}',
      '{{ t(now.labelKey) }}',
      "{{ t(stepTextKey(kind, entry.step, 'purpose')) }}",
      // 단계 이름은 종류를 안 가린다.
      `{{ t(${BACKTICK}steps.\${entry.step}.label${BACKTICK}) }}`,
      // 등록부 id로 이름을 찾는 것은 이 규칙과 무관하다.
      `t(${BACKTICK}algorithms.\${one.algorithm}${BACKTICK})`,
    ],
    // `npx prettier`에 넣어 받은 출력 그대로다. 인자가 셋이면 포매터가 **`t(` 바로
    // 뒤에서** 줄을 바꾸고, 그 자리가 이 패턴이 인접을 요구하던 곳이다.
    wrapped: [
      [
        'const a = t(',
        `  ${BACKTICK}tasks.\${entryWithARatherLongName.stepAndMoreAndMore}${BACKTICK},`,
        '  fallbackValueWithLongName,',
        '  third,',
        ')',
      ].join('\n'),
    ],
  },
  {
    name: '로케일 파라미터에 이름 목록을 배열째 넘기지 않는다',
    why:
      '**Vue가 배열을 `JSON.stringify(값, null, 2)`로 편다.** 일괄 예측 화면이 없는 열을 ' +
      '배열째 넘겨서, 학생이 받은 문장이 대괄호와 따옴표와 줄바꿈이 든 것이었다 ' +
      '(2026-08-29 전 경로 감사). 던지는 쪽이 `nameList`로 이어 붙여서 준다 — ' +
      '`ClientErrorParams`는 스칼라만 받으므로 던지는 자리는 타입이 막지만, ' +
      '`t()`를 직접 부르는 이 자리는 타입이 못 본다.',
    pattern: /\bt\(.*\{[^}]*\b(columns|names|features|categories)\s*:\s*[A-Za-z_$][\w$.]*\s*[,}]/,
    violations: [
      "{{ t('client.PREDICT_DATASET_COLUMN_MISSING', { columns: missingColumns }) }}",
      "t('data.tabular.droppedColumns', { names: dropped })",
    ],
    allowed: [
      "{{ t('client.PREDICT_DATASET_COLUMN_MISSING', { columns: nameList(missingColumns) }) }}",
      "t('data.tabular.droppedColumns', { names: dropped.join(', ') })",
      // 세는 값은 목록이 아니다.
      "t('data.tabular.tooManyColumns', { columns: 20 })",
    ],
  },
  {
    name: '배색을 `data-theme` 속성에서 직접 읽지 않는다',
    why:
      '**속성 읽기는 반응형 원본이 아니라서 감시자가 안 깨어난다.** `ClusterScatter.vue`가 ' +
      '배색을 따라가려고 그 속성을 게터로 읽었는데 **한 번도 안 돌았고**, 배색을 바꾼 ' +
      '학생의 산점도는 이전 배색의 값을 그대로 들고 있었다 — 밝은 화면에 어두운 배색의 ' +
      '선이 검게 그려졌다 (2026-08-29 전 경로 감사). 화면이 볼 원본은 `theme.ts`의 ' +
      '`theme` ref 하나이고, 속성을 쓰는 것은 그 파일뿐이다.',
    // 토큰 사이의 `\s*`는 규약이다 (architecture.md §9.3.1). 지금은 인자가 짧아
    // prettier가 `getAttribute(` 뒤에서 안 꺾지만, 그 사실이 규칙의 근거가 되면 안 된다.
    pattern:
      /dataset\s*(\.\s*theme\b|\[\s*['"]theme['"]\s*\])|getAttribute\(\s*['"]data-theme['"]\s*\)/,
    violations: [
      "watch(() => document.documentElement.dataset['theme'], readTokens)",
      'const now = document.documentElement.dataset.theme',
      "if (root.getAttribute('data-theme') === 'dark') return",
    ],
    allowed: [
      'watch(theme, readTokens)',
      "const dark = theme.value === 'dark'",
      // 데이터셋의 다른 열쇠는 이 규칙과 무관하다.
      'const id = element.dataset.themeIndependent',
      "element.getAttribute('data-open')",
    ],
  },
  {
    name: '아이콘 세트를 화면이 직접 들여오지 않는다',
    why:
      '`icons.ts`가 등록부다 - 아이콘을 바꾸려면 거기 한 줄만 고치면 되고, 무엇을 ' +
      '쓰고 있는지가 한눈에 보이며, 세트를 갈아치울 때 화면을 안 건드린다. 그 파일 ' +
      '머리말이 그렇게 선언해 두었는데 **무엇도 그것을 안 지켰다** - 화면에서 직접 ' +
      '들여와도 검사도 타입도 eslint도 조용했다 (2026-08-31 사각 감사 A-3). ' +
      '`icons.ts` 자신과 검사는 대상이 아니다(등록부와 그 대조가 사는 자리다).',
    pattern: /from\s*['"]lucide-vue-next['"]/,
    violations: [
      "import { Plus } from 'lucide-vue-next'",
      'import { Check } from "lucide-vue-next"',
    ],
    allowed: ["import { ACTION_ICONS } from '@/icons'", "import { STEP_ICONS } from '@/icons'"],
  },
]

/**
 * **`only`는 매치가 본 것만 본다.**
 *
 * 창으로 여러 줄을 이으면서 갈린 자리다 — 넘긴 것이 줄이면 `only`가 **창 안의 무관한
 * 줄**을 보고 판정이 뒤집힌다. 실제로 그랬다: 쪽 넘김의 `{{ page + 1 }} / {{ total }}`이
 * 여섯 줄 옆의 `t('common.prevPage')` 때문에 "번역이 섞였다"로 잡혔다 (R14-5 감사 A-1을
 * 고치면서 나왔다). 그래서 `only`가 넓은 문맥을 봐야 하는 규칙은 **패턴이 그 문맥까지
 * 잡아야 한다** — `class="…"` 규칙 둘이 그 모양이다.
 */
function hits(rule: Rule, text: string): boolean {
  const match = rule.pattern.exec(text)
  return match !== null && (rule.only?.(match[0]) ?? true)
}

/**
 * 규칙 하나가 이 파일에서 잡은 자리들.
 *
 * **훑기 구현은 `fixtures/source.ts` 하나다** — 이 파일만 창을 갖고 있던 동안
 * `i18n-usage`의 RULES와 `secure-context-rules`는 여전히 줄 하나씩 보고 있었다
 * (R14-5 감사 A-1). 갈라 두면 셋이 고쳐질 때 하나가 안 고쳐진다.
 */
function ruleHits(rule: Rule, source: string, label: string): string[] {
  return windowedHits((text) => hits(rule, text), source, label)
}

/**
 * `<AppButton ... @click="이름">`인데 그 `이름`이 **기다려야 하는 일**인 경우.
 *
 * **`async function`만이 아니다.** `const 이름 = async (` 꼴과, 동기 함수가 안에서
 * `void 오래걸리는것()`을 부르는 래퍼도 같은 것이다 — 예전에는 그 둘이 검사를 그대로
 * 통과했다 (V11 R4 B-9). 지금 그런 자리 둘은 안쪽에 `busy` 가드가 있어 아무것도 안
 * 무너지는데, **문제는 다음 사람이 그 가드를 안 넣어도 초록이라는 것**이다.
 *
 * **오래 걸리는 일은 `action`으로 줘야 버튼이 스스로 꺼진다**(CLAUDE.md §4).
 * `@click`은 리스너의 반환값을 기다려 주지 않으므로 두 번 눌리는 것을 못 막는다.
 */
function unguardedButtons(
  source: string,
  resolveImport?: (name: string) => string | null,
): string[] {
  const asyncNames = new Set(
    [...source.matchAll(/async function (\w+)/g)].map((match) => match[1] ?? ''),
  )
  /**
   * **다른 모듈에서 온 것도 본다** (2026-09-01 감사 B-3). 이 파일 안의 선언만 모으던
   * 동안은 `import { setLimitsOff } from '@/limits-switch'`처럼 **들여온 async 함수**를
   * `@click`에 그대로 써도 안 걸렸다 — 감사자가 상태 표시줄의 `:action`을 `@click`으로
   * 바꿔 확인했다(안 울었다). 이 저장소가 그런 함수를 화면에 들여온 것이 그때가 처음이다.
   *
   * **한 겹만 따라간다.** 들여온 모듈이 또 어디선가 들여온 것까지는 사람이 볼 자리다.
   */
  if (resolveImport) {
    for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
      const from = match[2] ?? ''
      const resolved = resolveImport(from)
      if (resolved === null) continue
      /**
       * **주석을 걷고 본다** (2026-09-01 R17 감사 B-2). 이 저장소는 머리글에 **옛 서명을
       * 그대로 인용**하는 것이 관행이라(*"예전에는 `export async function save` 였다"*),
       * 날것으로 훑으면 동기 함수가 async로 잡혀 **멀쩡한 화면이 `:action`으로 바꾸라는
       * 빨강을 받는다.** 거짓 빨강은 관문을 세우고, 다음 사람은 규칙이 아니라 화면을 고친다.
       *
       * **해결기가 아니라 여기서 걷는다.** 아래 짝들이 해결기를 세워서 넘기므로
       * (`() => '...'`) 저쪽에서 걷으면 **짝이 그 자리를 한 번도 안 지나간다.**
       * 받는 쪽이 자기가 쓸 모양으로 만드는 것이 맞다.
       */
      const module = withoutComments(resolved).join('\n')
      for (const raw of (match[1] ?? '').split(',')) {
        /**
         * **`x as y`는 이름이 둘이다** — 저쪽이 내보낸 것은 `x`이고 화면이 부르는 것은
         * `y`다. 하나로 뭉치던 때는 별칭 임포트가 통째로 빠져나갔고, **이 파일의
         * 자기검사가 그것을 잡았다** (2026-09-01).
         */
        const [exportedName, localName] = raw.split(/\s+as\s+/).map((one) => one.trim())
        const outside = exportedName ?? ''
        const inside = localName ?? outside
        if (outside === '') continue
        const exported = new RegExp(
          `export (?:async function ${outside}\\b|const ${outside}\\s*=\\s*async)`,
        )
        if (exported.test(module)) asyncNames.add(inside)
      }
    }
  }
  // `const 이름 = async (` 꼴도 같다. 선언 방식으로 규칙을 빠져나갈 수 있으면 안 된다.
  for (const match of source.matchAll(/const (\w+)\s*=\s*async\s*\(/g)) {
    asyncNames.add(match[1] ?? '')
  }
  // 동기 래퍼: `function 이름(…) { … void 비동기것(…) … }`. **한 겹만 따라간다** —
  // 두 겹부터는 이 검사가 아니라 사람이 볼 자리다 (V11 R4 B-9).
  //
  // **몸통은 `topLevelDeclarations`가 자른다.** 600자 창으로 자르던 때는 **뒤따르는
  // 다른 함수의 몸통을 같이 읽었고**, 반대로 `void 비동기것(`이 600자 뒤에 있으면
  // 그 래퍼를 놓쳤다 (R14-2 감사 C-1).
  for (const declaration of topLevelDeclarations(source)) {
    if (asyncNames.has(declaration.name)) continue
    const called = [...declaration.body.matchAll(/void (\w+)\(/g)].map((one) => one[1] ?? '')
    if (called.some((one) => asyncNames.has(one))) asyncNames.add(declaration.name)
  }

  /**
   * **`<AppButton>`만도 아니고 식별자 하나만도 아니다.**
   *
   * `<AppButton @click="이름">`만 보던 때는 저장소의 `@click` 93개 중 **15개**만
   * 검사했다 — 맨 `<button>`도, `@click="fn(a)"`·`@click="() => fn()"`도 전부
   * 빠져나갔다. 그런데 그 `it`의 이름은 `지금 소스에 안 막힌 버튼이 없다`였다
   * (R14-2 감사 A-2).
   *
   * 핸들러 식에서 **불리는 이름을 전부 뽑아** 비동기 목록과 견준다.
   */
  const template = source.slice(source.indexOf('<template>'))
  const found: string[] = []
  const clickable = new RegExp(String.raw`<(?:AppButton|button)\b${ATTRS}?@click="([^"]+)"`, 'gs')
  for (const match of template.matchAll(clickable)) {
    const handler = match[1] ?? ''
    const names = [...handler.matchAll(/[A-Za-z_$][\w$]*/g)].map((one) => one[0])
    found.push(...names.filter((name) => asyncNames.has(name)))
  }
  return found
}

/**
 * 최상위 선언들의 `이름 · 인자 · 몸통`. **`function` 선언과 화살표 const를 둘 다 본다.**
 *
 * `function`만 보던 때는 `const chooseHoldout = (): void => {…}`가 목록에서 빠졌고,
 * 그러면 그 라디오 그룹이 "확인 모달이 안 걸린 그룹"으로 분류되어 **`register` 검사
 * 자체가 건너뛰어졌다** (R13-5 감사 A-3). **선언 방식으로 규칙을 빠져나갈 수 있으면
 * 안 된다** — 같은 파일의 `unguardedButtons`가 이미 그 교훈을 적어 두었다.
 *
 * 몸통의 끝은 **들여쓰기 없는 닫는 중괄호**다. prettier가 최상위 선언을 그렇게 둔다.
 *
 * **구현이 하나여야 한다** — 세 검사가 각자 같은 정규식을 들고 있었고, 그래서 한 자리를
 * 고치면 둘이 안 고쳐졌다 (`tests/fixtures/source.ts` 머리말과 같은 이야기다).
 */
function topLevelDeclarations(script: string): { name: string; params: string; body: string }[] {
  const opens = String.raw`(?:function (\w+)\(([^)]*)\)[^{]*|const (\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)[^{]*=>\s*)`
  // 몸통의 끝은 들여쓰기 없는 닫는 중괄호다. 줄바꿈을 정규식 리터럴에 못 적으므로
  // 문자열로 조립한다.
  const nl = String.fromCharCode(10)
  const pattern = new RegExp(`${opens}\\{${nl}([\\s\\S]*?)${nl}\\}`, 'g')
  return [...script.matchAll(pattern)].map((match) => ({
    name: match[1] ?? match[3] ?? '',
    params: match[2] ?? match[4] ?? '',
    body: match[5] ?? '',
  }))
}

/**
 * 확인 모달(`request*`)이 걸린 라디오 그룹인데, 그룹의 노드 중 하나라도
 * `useRadioGroupGuard`로 등록돼 있지 않은 경우 (`architecture.md` §8.15).
 *
 * **취소를 거쳐야 하는 옵션이 하나라도 있으면 그룹 전체를 등록해야 한다.** 라디오는
 * 값이 실제로 안 바뀌면 Vue가 `checked`를 다시 안 써 주는데, 브라우저는 클릭한 순간
 * 이미 같은 이름 그룹 전체의 네이티브 `checked`를 새 선택에 맞게 바꿔 둔 뒤다. 하나만
 * 등록해 두면 취소했을 때 그 라디오만 되돌아오고 나머지는 브라우저가 꺼 둔 채로 남는다.
 *
 * "확인 모달이 걸렸다"는 `@change` 핸들러가 `request*` 함수(붙이거나 뗄 때 먼저
 * 물어보는 이 저장소의 기존 관례, `PreprocessView.vue`의
 * `requestApplyTest`/`requestRemoveTest`)를 부르는지로 판정한다.
 */
function unguardedConfirmRadios(source: string): string[] {
  const template = source.slice(source.indexOf('<template>'))
  const radioTag = new RegExp(String.raw`<input\b${ATTRS}\btype="radio"${ATTRS}/?>`, 'gs')
  const radios = [...template.matchAll(radioTag)].map((match) => match[0])
  if (radios.length === 0) return []

  const groups = new Map<string, string[]>()
  for (const tag of radios) {
    const name = /\bname="([^"]+)"/.exec(tag)?.[1]
    if (!name) continue
    groups.set(name, [...(groups.get(name) ?? []), tag])
  }

  // 몸통에서 request*를 부르는 함수 이름들. 최상위 함수의 닫는 중괄호는 Prettier가
  // 들여쓰기 없이 새 줄에 둔다 - 그 모양만 몸통으로 본다.
  const script = source.slice(0, source.indexOf('<template>'))
  const gatedFunctions = new Set(
    topLevelDeclarations(script)
      .filter((one) => /\brequest[A-Z]\w*\(/.test(one.body))
      .map((one) => one.name),
  )

  const violations: string[] = []
  for (const tags of groups.values()) {
    /**
     * **닫는 따옴표를 요구하지 않는다.** `@change="chooseHoldout()"`처럼 호출 꼴로
     * 적는 것은 Vue에서 완전히 합법인데, 그때 이름이 안 뽑혀 그 그룹이 통째로
     * "확인 모달이 안 걸린 그룹"으로 분류됐다 — `register`가 하나도 없어도 위반이
     * 0건이 되는 조용한 건너뜀이다 (R14-2 감사 A-4). 형제인
     * `unsyncedLockedInputs`는 같은 이유로 이미 열려 있었고 여기만 안 받았다.
     */
    const changeHandlers = tags
      .flatMap((tag) => [...(/@change="([^"]*)"/.exec(tag)?.[1] ?? '').matchAll(/[\w$]+/g)])
      .map((match) => match[0])
    if (!changeHandlers.some((name) => gatedFunctions.has(name))) continue
    for (const tag of tags) {
      if (!/:ref="[^"]*\.register\(/.test(tag)) violations.push(tag)
    }
  }
  return violations
}

/**
 * `:disabled`가 걸린 입력인데 `@change` 핸들러가 **DOM을 스키마 값으로 되돌리지 않는**
 * 경우 (`architecture.md` §8.15.1).
 *
 * **DOM과 스키마가 갈리는 순간 영구 차단이 된다.** `:checked`는 `v-model`이 아니라,
 * 계산값이 안 바뀌면 Vue가 DOM 프로퍼티를 다시 안 쓴다. 그런데 브라우저는 클릭한 순간
 * 이미 `checked`를 뒤집어 둔 뒤다. 그래서 핸들러가 스키마를 못 고치면(파일이 없다·가드가
 * 막았다·적용이 실패했다) 화면이 파일과 다른 값을 보여주고, **잠금 판정은 스키마를 보므로
 * 그 상태에서 입력이 회색이 되면 학생이 고칠 문이 없다.**
 *
 * 되돌리기로 인정하는 모양 둘 - 핸들러가 입력에 직접 쓰거나(`.checked = `), 그 입력이
 * `useRadioGroupGuard`에 등록돼 있는 것(`:ref="....register("`). 후자를 여기서 다시
 * 요구하지 않는 이유는 **되돌리기가 핸들러가 아니라 취소 시점에 일어나기 때문**이고,
 * 그 짝이 맞는지는 위 `unguardedConfirmRadios`가 이미 본다.
 */
function unsyncedLockedInputs(source: string): string[] {
  const template = source.slice(source.indexOf('<template>'))
  const script = source.slice(0, source.indexOf('<template>'))

  // 되돌리기를 하는 함수 이름들. 최상위 함수의 닫는 중괄호는 Prettier가 들여쓰기 없이
  // 새 줄에 둔다 - 그 모양만 몸통으로 본다 (unguardedConfirmRadios와 같은 방식).
  //
  // **숫자 칸은 `.value`로 되돌린다.** 그런데 `foo.value = ...`는 Vue의 ref에도 그대로
  // 나오는 모양이라 그것만 보면 아무 핸들러나 되돌린다고 판정한다. 그래서 **요소를 손에
  // 쥔 함수**(인자로 받거나 몸통에서 캐스팅하거나)에서만 `.value` 대입을 되돌리기로
  // 센다 - 그게 이 저장소가 쓰는 관용구다.
  //
  // **함수 단위로 본다. 갈래 단위가 아니다.** 되돌리는 줄이 한 갈래에만 있어도 그 함수는
  // 되돌린다고 판정한다 - 이르게 `return`하는 갈래 하나가 빠진 것은 이 검사가 못 잡는다.
  // 위 `.checked` 규칙도 같은 굵기이고, 갈래를 세려면 파서가 필요하다.
  const resyncing = new Set(
    topLevelDeclarations(script)
      .filter(({ params, body }) => {
        if (/\.checked\s*=|\.resync\(/.test(body)) return true
        // 인자로 받든(`input: HTMLInputElement`) 몸통에서 캐스팅하든
        // (`event.target as HTMLInputElement`) 둘 다 요소를 손에 쥔 것이다.
        return /HTMLInputElement/.test(params + body) && /\.value\s*=/.test(body)
      })
      .map((one) => one.name),
  )

  // 몸통이 `emit(...)` 하나뿐인 함수들. 값을 고치지 않고 그대로 올려보내는 자리다.
  const forwarding = new Set(
    topLevelDeclarations(script)
      .filter((one) => /^\s*emit\([^;]*\)\s*$/.test(one.body))
      .map((one) => one.name),
  )

  return (
    [...template.matchAll(new RegExp(String.raw`<input\b${ATTRS}>`, 'gs'))]
      .map((match) => match[0])
      // **숫자 칸은 잠기지 않아도 본다.** 아래 "한 번 더 누르면 맞아진다"는 라디오와
      // 체크박스 이야기다 - 그것들은 상태가 둘뿐이라 학생이 다시 누르면 맞아진다.
      // **숫자 칸에는 '한 번 더'가 없다.** 클램프한 값이 지금 값과 같으면 Vue가 DOM을
      // 다시 안 쓰고, 학생이 친 숫자가 칸에 그대로 남아 화면이 계속 거짓말한다
      // (2026-08-12 감사 B-3).
      .filter((tag) => /:disabled=/.test(tag) || /type="number"/.test(tag))
      // 그룹째 되돌리는 라디오는 §8.15의 검사가 맡는다.
      .filter((tag) => !/:ref="[^"]*\.register\(/.test(tag))
      .filter((tag) => {
        // **인자를 넘기는 꼴도 읽는다** - `@change="setRows($event.target)"`처럼 쓰는
        // 자리가 실재하고, 이름만 읽으면 그 입력이 통째로 검사를 빠져나간다.
        const handler = /@change="(\w+)/.exec(tag)?.[1]
        // 핸들러가 없으면 학생이 바꿀 수 없는 입력이라 갈릴 것도 없다.
        if (handler === undefined) return false
        // **그대로 넘기기만 하는 것은 되돌릴 주체가 아니다.** 상태를 가진 쪽이 부모라
        // 이 컴포넌트에는 되돌릴 값이 없고, 부모가 값을 바꾸면 다시 그려진다.
        // 값을 **고쳐서** 넘기는 핸들러는 여기 안 걸린다 - 그때는 저장된 값과 칸의
        // 값이 갈릴 수 있어서 되돌려야 한다.
        if (handler === 'emit' || forwarding.has(handler)) return false
        return !resyncing.has(handler)
      })
  )
}

/**
 * 보이는 이름에 배지가 없는 이름-값 그룹 (architecture.md 8.16 "나열에서 이름은 배지,
 * 값은 plaintext다").
 *
 * **글자만 이어 붙으면 어디서 한 값이 끝나고 다음 값이 시작하는지 안 보인다.** 처음에는
 * 가운뎃점으로 갈랐는데, 점은 "여기서 끊긴다"만 말하고 **어느 쪽이 이름인지는 여전히
 * 서식으로 알아내야 한다.** 이름을 배지로 세우면 둘을 한 번에 말한다.
 *
 * **`class="flex ... gap-1.5"`인 그룹만 본다.** `ProjectSummary.vue`처럼 `justify-between`으로
 * 한 줄씩 세로로 쌓는 그룹은 줄 자체가 경계라 배지가 필요 없다 - 거기까지 알약을 씌우면
 * 회색이 열 줄 넘게 쌓여 값보다 눈에 띈다.
 *
 * **`sr-only`인 이름은 안 잡는다.** 값 자체가 무엇인지 말하고 있어 이름을 숨겨 둔 자리이고
 * (파일 이름, 실험 개수), 안 보이는 것에 배지를 씌울 수도 없다.
 *
 * **`class`가 첫 속성이 아니어도 본다.** 한때 `<div class="flex…gap-1.5">`로 못 박혀 있어
 * `<div v-if="…" class="…">`도 `class="… gap-1.5 shrink-0"`도 통째로 빠져나갔다 —
 * 앞의 모양은 이 저장소에 이미 있다(`ClusterScatter.vue`). 규칙이 자기 모양의 가장 흔한
 * 변형에서 꺼지고 있었다 (R8 감사 B-1).
 */
function unbadgedMetaNames(source: string): string[] {
  const template = source.slice(source.indexOf('<template>'))
  // 이 훑기는 **지금도 눈이 멀어 있었다** — 근거로 든 `ClusterScatter.vue`의 실물 태그가
  // `<div v-if="props.axes.length > 2" class="…">`라 `[^>]*`에서 잘렸다 (사각 감사 A-1).
  const metaGroup = new RegExp(
    String.raw`<div\b${ATTRS}\bclass="[^"]*\bflex\b[^"]*\bgap-1\.5\b[^"]*"${ATTRS}>\s*(<dt${ATTRS}>[\s\S]*?</dt>)`,
    'g',
  )
  const groups = [...template.matchAll(metaGroup)]
  return groups
    .map((match) => match[1] ?? '')
    .filter((tag) => !tag.includes('sr-only') && !tag.includes('<AppBadge'))
}

/**
 * `AppStatusBar` 밖의 가운뎃점 구분자 (architecture.md 8.16).
 *
 * **이 절은 한 번 뒤집혔다.** 옛 모양을 기억하는 사람이 점을 다시 넣는 것을 막는 자리가
 * 있어야 한다. 상태 표시줄만 예외인 이유는 거기가 `<dl>`이 아니라 한 줄로 이어 붙인
 * 요약이고, **높이를 늘릴 수 없어 배지가 설 자리가 없기 때문이다.**
 */
function strayDotSeparators(source: string): string[] {
  const dot = new RegExp(String.raw`<span${ATTRS}aria-hidden="true">\s*·\s*</span>`, 'g')
  return [...source.matchAll(dot)].map((match) => match[0])
}

/**
 * 상세 패널이 선언한 프롭 이름들 (architecture.md §8.13.2).
 *
 * **패널은 `input` 하나만 받는다.** 개별 프롭으로 흩으면 안 쓰는 패널이 그것을 선언하지
 * 않게 되고, **선언하지 않은 객체 프롭은 `[object Object]`라는 어트리뷰트로 DOM에 그대로
 * 박힌다.** 계약이 넓어질 때마다 패널 전부를 고쳐야 하는 모양이기도 하다.
 *
 * **여기가 검사여야 하는 이유는 타입이 못 지키기 때문이다** — 호출부가
 * `<component :is>` 하나뿐이라 vue-tsc가 프롭을 대조하지 않는다.
 */
function panelProps(source: string): string[] {
  const match = /defineProps<\{([\s\S]*?)\}>\(\)/.exec(source)
  if (!match) return []
  return [...(match[1] ?? '').matchAll(/(\w+)\s*\??\s*:/g)].map((one) => one[1] ?? '')
}

function vueFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return vueFiles(path)
    return entry.endsWith('.vue') ? [path] : []
  })
}

/**
 * **DOM 부재를 판정하는 유일하게 허용된 표기.**
 *
 * 표기가 여럿이면 아래 `reachesDomGuard`가 못 보는 가드가 생기고, 그 순간 이 규칙
 * 전체가 헛돈다. 그래서 `STRAY_DOM_CHECKS`가 다른 표기를 금지해 이 정규식을 유일한
 * 창으로 만든다. **둘은 한 쌍이고 따로 떼면 안 된다.**
 */
const DOM_GUARD =
  /typeof\s+(?:document|window|navigator|localStorage|matchMedia|ResizeObserver)\s*[!=]==?\s*['"]undefined['"]/

/** 같은 뜻인데 위 정규식이 못 보는 표기들. */
const STRAY_DOM_CHECKS: readonly RegExp[] = [
  /globalThis\s*\.\s*(?:document|window|navigator|localStorage|matchMedia|ResizeObserver)\b/,
  /['"](?:document|window|navigator|localStorage|matchMedia|ResizeObserver)['"]\s+in\s/,
  // 앞에 `.`이나 낱말 글자가 있으면 우리 자료구조의 속성이다 —
  // `record.document?.manifest`(project/storage.ts)가 실제로 그렇다.
  /(?<![.\w$])(?:document|window|navigator|localStorage|matchMedia|ResizeObserver)\s*\?\./,
]

function strayDomChecks(source: string): string[] {
  return withoutComments(source)
    .filter((line) => STRAY_DOM_CHECKS.some((pattern) => pattern.test(line)))
    .map((line) => line.trim())
}

function hasDomGuard(source: string): boolean {
  return withoutComments(source).some((line) => DOM_GUARD.test(line))
}

function codeFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return codeFiles(path)
    return /\.(?:ts|vue)$/.test(entry) ? [path] : []
  })
}

const sources = new Map<string, string>()
function sourceOf(path: string): string {
  const cached = sources.get(path)
  if (cached !== undefined) return cached
  const text = readFileSync(path, 'utf-8')
  sources.set(path, text)
  return text
}

/**
 * import 대상 중 **우리 소스인 것만.** 외부 패키지는 이 규칙의 관심이 아니다.
 * `await import(...)`도 센다 — 지금 안 불러도 검사가 await하면 그때 닿는다.
 */
function localImports(file: string, source: string): string[] {
  const found: string[] = []
  for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    const specifier = match[1] ?? ''
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) continue
    const base = specifier.startsWith('@/')
      ? join(SRC, specifier.slice(2))
      : resolve(dirname(file), specifier)
    const hit = [base, `${base}.ts`, `${base}.vue`, join(base, 'index.ts')].find(
      (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
    )
    if (hit !== undefined) found.push(hit)
  }
  return found
}

/** 이 파일에서 (전이적으로) 닿는 첫 DOM 가드 모듈. 없으면 `null`. */
function reachesDomGuard(file: string, seen: Set<string> = new Set()): string | null {
  if (seen.has(file)) return null
  seen.add(file)
  const source = sourceOf(file)
  if (file.startsWith(SRC) && hasDomGuard(source)) return file
  for (const dependency of localImports(file, source)) {
    const hit = reachesDomGuard(dependency, seen)
    if (hit !== null) return hit
  }
  return null
}

/** 첫 줄에 적는다. vitest는 파일 첫 주석에서 이것을 읽는다. */
const DECLARES_JSDOM = /^\/\/\s*@vitest-environment\s+jsdom\s*$/m

function specFiles(): string[] {
  return codeFiles(join(process.cwd(), 'tests')).filter((path) => path.endsWith('.spec.ts'))
}

describe('검사기가 실제로 잡는다', () => {
  for (const rule of RULES) {
    describe(rule.name, () => {
      for (const line of rule.violations) {
        it(`위반을 잡는다: ${line}`, () => {
          expect(hits(rule, line)).toBe(true)
        })
      }
      for (const line of rule.allowed) {
        it(`정상을 안 잡는다: ${line}`, () => {
          expect(hits(rule, line)).toBe(false)
        })
      }
      for (const [index, source] of (rule.wrapped ?? []).entries()) {
        /**
         * **줄이 펴져도 잡는가** (`architecture.md` §9.3.1의 규약 2).
         *
         * 한 줄짜리 표본만으로는 이 축을 한 번도 안 태운다 — 그래서 창을 세우고도
         * 규칙 하나가 새어 나갔다 (R14-5 감사 A-1).
         */
        it(`prettier가 편 위반도 잡는다 (${index + 1})`, () => {
          // 표본이 진짜로 여러 줄인지부터 본다 - 한 줄에 다 있으면 이 검사는 아무것도
          // 안 재는 것이 된다.
          const perLine = source.split('\n').filter((line) => hits(rule, line))
          expect(perLine, 'the shape must be one that line-by-line reading cannot catch').toEqual(
            [],
          )
          const found = windowedHits((text) => hits(rule, text), source, 'wrapped')
          expect(found).toHaveLength(1)

          /**
           * **적힌 자리를 열면 위반이 거기 있어야 한다** (2026-09-01 R17 감사 C-1).
           *
           * 개수만 세던 동안은 **창 좁히기를 통째로 지워도 336개가 전부 초록**이었다
           * (돌연변이 M7). 좁히기를 넣은 이유가 *"그 줄을 열면 위반이 없었다"*는 것이라
           * (감사자가 76행에 심은 것을 71행이라 보고했다), **개수는 그 이유를 하나도
           * 안 지킨다.**
           */
          const where = /^wrapped:(\d+)(?:-(\d+))?\s/.exec(found[0] ?? '')
          expect(where, 'the hit must name where it is').not.toBeNull()
          const from = Number(where?.[1])
          const to = Number(where?.[2] ?? where?.[1])
          const named = source.split('\n').slice(from - 1, to)
          expect(hits(rule, named.join(' ')), `${found[0]} must hit when read alone`).toBe(true)
        })
      }
    })
  }

  it('주석은 걷어낸다', () => {
    const source = [
      '<!-- text-sm 은 금지다 -->',
      '/* w-[327px] 도 금지 */',
      '// text-xs 금지',
    ].join('\n')
    expect(withoutComments(source).join('').trim()).toBe('')
  })

  it('여러 줄 HTML 주석도 걷어내고 줄 수는 그대로다', () => {
    const source = ['<!--', 'text-sm 은 금지다', '-->', '<p class="text-base">x</p>'].join('\n')
    const lines = withoutComments(source)
    expect(lines).toHaveLength(4)
    expect(lines.slice(0, 3).join('').trim()).toBe('')
    expect(lines[3]).toContain('text-base')
  })

  /**
   * **URL 안의 `//`는 주석이 아니다.**
   *
   * 이 파일은 한때 `line.replace(/\/\/.*$/, '')` 한 줄로 주석을 걷었다. 그래서
   * `href="https://…"`가 앞에 붙은 줄은 **그 지점부터 끝까지가 소스에서 사라졌고**,
   * 줄 단위로 도는 규칙 전부가 그 한 줄에서 통째로 꺼졌다 (R8 감사 A-1).
   * `class="text-xs"`도 `w-[327px]`도 조립한 단계 문구도 아무것도 안 잡혔다.
   */
  it('따옴표 안의 //는 주석이 아니다 - 링크가 든 줄에서도 규칙이 산다', () => {
    const line = '<a href="https://example.org" class="text-xs">x</a>'
    expect(withoutComments(line)[0]).toContain('text-xs')
  })
})

/**
 * **오래 도는 예측은 화면에 양보한다** (`screen.ts`의 `yieldToScreen`).
 *
 * 예측은 메인 스레드에서 돈다. 한 작업 안에서 동기로 끝나면 `AppButton`의 이중 실행
 * 방지가 통째로 무력해진다 — 꺼짐이 화면에 서기 전에 풀려서, **연타한 만큼 계산이 다시
 * 돌고 브라우저가 먹통이 된다**(2026-08-14, 이미지 예측 화면에서 실제로 그랬다).
 *
 * **눈으로는 "느리다"로만 보이는 결함이라** 검사가 본다. 예측 판이 하나 더 생기는 날
 * (음성·텍스트) 같은 실수를 그대로 반복할 자리다.
 */
describe('예측 판은 화면에 양보한다', () => {
  const PREDICT_DIR = join(SRC, 'views', 'predict')

  /**
   * **손으로 적지 않는다.** 예전에는 판 이름 둘을 배열에 박아 두었는데, 그러면
   * **빠진 판을 아무도 못 본다** — `BatchPredict.vue`가 실제로 그렇게 빠져 있었고
   * (V11 R4 B-1) 그 파일이 예측 경로에서 가장 무거운 고리를 돈다. 판이 하나 더
   * 생기는 날(음성·텍스트) 같은 실수를 반복할 자리이기도 하다.
   *
   * 판정 기준은 **무거운 계산을 부르거나, 스스로 양보를 부르거나**다. 목록을 부르지 않는
   * 표시용 부품(`InputRow`·`PredictFilters` 따위)은 여기 해당하지 않는다.
   *
   * **뒤엣것이 빠져 있었다.** 기준이 호출 이름 둘뿐이라 `ImageClusterEvidence.vue`가
   * 검사 밖이었다 — **스스로 `yieldToScreen`을 부르는 판인데** 그 유일한 호출을 지워도
   * 아무도 안 울었다 (R8 감사 B-2). 무겁다고 스스로 선언한 판이 판정 밖에 있으면
   * 이 머리말의 "빠진 판을 아무도 못 본다"가 그대로 다시 일어난다.
   *
   * **정규식을 안 쓴다.** 상태가 없어야 하고, 이 파일에 정규식으로 적어 넣다가
   * 제어문자가 박혀 **조용히 아무것도 안 잡은 적이 있다** (2026-08-18).
   */
  const HEAVY = ['predictPage', 'loadModel', 'yieldToScreen']
  const PANELS = readdirSync(PREDICT_DIR)
    .filter((name) => name.endsWith('.vue'))
    .filter((name) => {
      const source = withoutComments(readFileSync(join(PREDICT_DIR, name), 'utf-8')).join('\n')
      return HEAVY.some((call) => source.includes(call))
    })

  /**
   * **요구가 판마다 다르다.**
   *
   * 단위를 돌며 계산하는 판은 **시작하기 전에 한 번, 단위마다 한 번**이라 둘이다.
   * 한 덩어리로 끝나는 판(`ImageClusterEvidence` — 군집 하나의 대표를 찾는다)은
   * 나눌 단위가 없으므로 **상자를 먼저 세우는 한 번**이 요구의 전부다. 거기에 둘을
   * 요구하면 지킬 수 없는 규칙이 되고, 하나로 낮추면 도는 판에서 하나가 사라져도
   * 안 울게 된다. 그래서 가른다.
   *
   * 가르는 기준은 **`for`가 있는가**다. 문자열로 본다 — 정규식을 안 쓰는 이유는 위와 같다.
   */
  function loopsOverUnits(source: string): boolean {
    return withoutComments(source).some((line) => line.includes('for ('))
  }

  /** 훑을 파일이 실제로 있어야 한다. 0개면 판정이 썩은 것이지 규칙이 지켜진 게 아니다. */
  it('검사할 판을 실제로 찾는다', () => {
    expect(
      PANELS.length,
      `a panel under ${PREDICT_DIR} that calls heavy work`,
    ).toBeGreaterThanOrEqual(4)
  })

  /** **양쪽 갈래가 다 비어 있지 않아야 한다.** 한쪽이 0이면 그 갈래는 아무것도 안 지킨다. */
  it('두 갈래가 다 서 있다', () => {
    const sources = PANELS.map((name) => readFileSync(join(PREDICT_DIR, name), 'utf-8'))
    expect(sources.filter(loopsOverUnits)).not.toHaveLength(0)
    expect(sources.filter((source) => !loopsOverUnits(source))).not.toHaveLength(0)
  })

  for (const name of PANELS) {
    it(`${name}의 예측이 양보한다`, () => {
      const source = readFileSync(join(PREDICT_DIR, name), 'utf-8')
      const calls = [
        ...withoutComments(source)
          .join('\n')
          .matchAll(/await yieldToScreen\(\)/g),
      ]
      const least = loopsOverUnits(source) ? 2 : 1
      expect(calls.length, `${name}: calls yieldToScreen`).toBeGreaterThanOrEqual(least)
    })
  }

  /**
   * **양보하는 것과 멈추는 것은 다른 일이다.** `yieldToScreen()`은 화면에 그릴 틈을 줄
   * 뿐이고, 학생이 다른 단계로 넘어가도 그 틈마다 계산이 다시 이어진다 — 아무도 안 보는
   * 답을 위해 `사진 × 모델`이 끝까지 돈다.
   *
   * **워커를 끊는 것으로는 절반이다.** `ImagePredictPanel`은 임베딩 워커를 끊고 있었고
   * 주석도 *"떠날 때 끊는다"*라고 말했는데, 그 뒤의 답 루프는 워커가 아니라 컴포넌트
   * 안에서 돌아 그대로 남아 있었다 (2026-08-29 사용자 지적).
   *
   * **도는 판만 본다.** 한 덩어리로 끝나는 판은 중간에 끊을 자리가 없다 — 위의 양보
   * 규칙이 갈래를 가르는 이유와 같다.
   *
   * **파일을 내놓는 계산은 예외다** — `BatchPredict`의 내려받기는 떠나도 끝까지 간다.
   * 학생이 누른 버튼이 조용히 아무 파일도 안 내놓으면 그건 고장으로 읽힌다. 그래서 판
   * 하나에 **막는 자리 하나**만 있으면 통과다.
   */
  describe('도는 판은 떠나면 멈춘다', () => {
    /**
     * **수명은 이제 `useWork`가 든다** (2026-09-02 R23 B-2). 화면이 `let alive = true`를
     * 손으로 들던 것을 `alive()`/`retire()`가 가져갔으므로 두 표기를 다 받는다 —
     * 아직 `useWork`를 안 쓰는 판(`TabularPredictPanel`)이 옛 표기로 남아 있다.
     */
    function stopsOnLeave(source: string): boolean {
      const lines = withoutComments(source)
      return (
        lines.some((line) => line.includes('onBeforeUnmount')) &&
        lines.some((line) => line.includes('if (!alive)') || line.includes('if (!alive())'))
      )
    }

    it('검사기가 안 멈추는 판을 잡는다', () => {
      expect(stopsOnLeave('for (const x of xs) { await yieldToScreen() }')).toBe(false)
    })

    it('검사기가 워커만 끊는 판을 잡는다 - 루프는 그대로 돌아간다', () => {
      const half = [
        'onBeforeUnmount(() => {',
        '  running.value?.cancel()',
        '})',
        'for (const x of xs) { await yieldToScreen() }',
      ].join('\n')
      expect(stopsOnLeave(half)).toBe(false)
    })

    it('검사기가 주석 속의 표시는 안 센다', () => {
      const commented = ['// if (!alive) return', 'onBeforeUnmount(() => {})'].join('\n')
      expect(stopsOnLeave(commented)).toBe(false)
    })

    it('검사기가 둘 다 갖춘 판은 안 잡는다', () => {
      const whole = ['onBeforeUnmount(() => {})', 'if (!alive) return'].join('\n')
      expect(stopsOnLeave(whole)).toBe(true)
    })

    it('검사기가 useWork의 수명 표기도 받는다', () => {
      const viaWork = ['onBeforeUnmount(retire)', 'if (!alive()) return'].join('\n')
      expect(stopsOnLeave(viaWork)).toBe(true)
    })

    const LOOPING = PANELS.filter((name) =>
      loopsOverUnits(readFileSync(join(PREDICT_DIR, name), 'utf-8')),
    )

    /** 0개면 판정이 썩은 것이지 규칙이 지켜진 게 아니다. 위의 양보 규칙과 같은 이유다. */
    it('검사할 판을 실제로 찾는다', () => {
      expect(LOOPING.length, 'a panel that loops over units').toBeGreaterThanOrEqual(3)
    })

    for (const name of LOOPING) {
      it(`${name}이 떠나면 멈춘다`, () => {
        expect(stopsOnLeave(readFileSync(join(PREDICT_DIR, name), 'utf-8')), name).toBe(true)
      })
    }
  })
})

/**
 * **모든 버튼 변종이 테두리를 갖는다. 보이든 안 보이든.**
 *
 * 테두리가 있는 변종만 2px 높아서 나란히 세우면 줄이 어긋난다. 실제로 첫 화면의 버튼
 * 셋이 64·66·69px이었고, **원인이 색이 아니라 상자라서 눈으로는 원인을 못 짚는다.**
 * 안 보여야 하는 자리는 `border-transparent`로 두고 자리는 언제나 차지한다.
 */
describe('버튼의 상자가 변종마다 같다', () => {
  const SOURCE = readFileSync(join(SRC, 'components', 'AppButton.vue'), 'utf-8')

  /**
   * VARIANTS 표의 `이름: '클래스들'` 줄만 뽑는다.
   *
   * **따옴표로 감싼 열쇠도 읽는다.** `(\w+):`였을 때 `'ghost-danger':` 하나가 통째로
   * 안 뽑혀 **여섯 중 다섯만 검사됐다** (R14-2 감사 A-1). 하이픈이 든 이름은 열쇠에
   * 따옴표가 필요하므로, 이름을 늘리는 사람이 그 사실을 알 길이 없다.
   */
  function variantClasses(source: string): [string, string][] {
    const table = source.slice(source.indexOf('const VARIANTS'))
    return [...table.slice(0, table.indexOf('}')).matchAll(/'?([\w-]+)'?:\s*'([^']*)'/g)].map(
      (match) => [match[1] ?? '', match[2] ?? ''],
    )
  }

  /** `type Variant = 'a' | 'b' | …`의 항들. 표가 몇 줄이어야 하는지의 유일한 출처다. */
  function declaredVariants(source: string): string[] {
    const line = /type Variant = ([^\n]+)/.exec(source)?.[1] ?? ''
    return [...line.matchAll(/'([\w-]+)'/g)].map((match) => match[1] ?? '')
  }

  /**
   * **이름 둘을 `toContain`으로 보는 것으로는 부족하다.** 그 둘이 하필 따옴표 없는
   * 안전한 열쇠였고, 표에 몇이 들어왔는지는 아무도 안 셌다 (공통 §2.8).
   */
  it('검사기가 표를 통째로 읽는다 - 타입이 말하는 수만큼', () => {
    const names = variantClasses(SOURCE).map(([name]) => name)
    const declared = declaredVariants(SOURCE)
    expect(declared.length, 'this check needs the variant union to be read').toBeGreaterThan(1)
    expect([...names].sort()).toEqual([...declared].sort())
  })

  it('검사기가 따옴표로 감싼 열쇠도 읽는다', () => {
    const table = "const VARIANTS = {\n  'ghost-danger': 'text-danger',\n}"
    expect(variantClasses(table)).toEqual([['ghost-danger', 'text-danger']])
  })

  it('검사기가 테두리 없는 변종을 잡는다', () => {
    const broken = "const VARIANTS = {\n  ghost: 'text-ink-soft',\n}"
    expect(
      variantClasses(broken).filter(([, classes]) => !/\bborder\b/.test(classes)),
    ).toHaveLength(1)
  })

  it('지금 모든 변종에 테두리가 있다', () => {
    const missing = variantClasses(SOURCE)
      .filter(([, classes]) => !/\bborder\b/.test(classes))
      .map(([name]) => name)
    expect(missing).toEqual([])
  })
})

/**
 * **라우트가 그리는 화면은 루트가 하나여야 한다.**
 *
 * `App.vue`가 라우트 전환에 `<Transition>`을 쓰는데, 트랜지션은 자식이 **하나**여야 한다.
 * 루트가 둘 이상이면 작업 공간이 통째로 비고 DOM에는 `<!---->`만 남는다 — 그런데
 * **새로고침하면 정상으로 보여서** 원인을 짚기가 아주 어렵다. 실제로 그렇게 겪었다.
 *
 * `v-if` / `v-else` 짝은 한 노드로 컴파일되므로 루트 하나다. 세는 것은 **동시에 그려질 수
 * 있는 것**의 수다.
 */
describe('화면의 루트가 하나다', () => {
  const VIEWS = join(SRC, 'views')

  interface Root {
    readonly tag: string
    readonly attrs: string
  }

  /** 최상위 여는 태그들. `.vue`의 최상위는 두 칸 들여쓰기다(Prettier가 맞춰 준다). */
  function roots(source: string): Root[] {
    const start = source.indexOf('<template>') + '<template>'.length
    const block = source
      .slice(start, source.lastIndexOf('</template>'))
      .replace(/<!--[\s\S]*?-->/g, '')
    // 여기도 `ATTRS`다. 루트 태그가 `<div v-if="rows.length > 0">`이면 `[^>]*`에서
    // 잘려 **그 화면의 루트를 하나 덜 세고**, 루트가 둘인 것을 못 본다.
    const rootTag = new RegExp(String.raw`^ {2}<([A-Za-z][\w-]*)(${ATTRS})>`, 'gm')
    return [...block.matchAll(rootTag)].map((match) => ({
      tag: match[1] ?? '',
      attrs: match[2] ?? '',
    }))
  }

  /** 동시에 그려질 수 있는 루트. v-else 가지는 앞의 것과 같은 자리를 나눠 쓴다. */
  function drawnAtOnce(source: string): string[] {
    return roots(source)
      .filter((root) => !/\bv-else\b|\bv-else-if=/.test(root.attrs))
      .map((root) => root.tag)
  }

  it('검사기가 v-else 짝을 하나로 센다', () => {
    const source = '<template>\n  <div v-if="x">a</div>\n\n  <AppEmpty v-else />\n</template>'
    expect(drawnAtOnce(source)).toEqual(['div'])
  })

  it('검사기가 여분의 루트를 잡는다', () => {
    const source =
      '<template>\n  <div v-if="x">a</div>\n\n  <AppEmpty v-else />\n\n  <AppDialog\n    :open="y"\n  >\n  </AppDialog>\n</template>'
    expect(drawnAtOnce(source)).toEqual(['div', 'AppDialog'])
  })

  it('지금 모든 화면의 루트가 하나다', () => {
    const found = readdirSync(VIEWS)
      .filter((entry) => entry.endsWith('.vue'))
      .map((entry) => ({ entry, tags: drawnAtOnce(readFileSync(join(VIEWS, entry), 'utf-8')) }))
      .filter(({ tags }) => tags.length !== 1)
      .map(({ entry, tags }) => `${entry}  ${tags.join(', ')}`)
    expect(found).toEqual([])
  })
})

describe('버튼이 두 번 눌리지 않는다', () => {
  const NEWLINE = String.fromCharCode(10)

  it('검사기가 안 막힌 버튼을 잡는다', () => {
    const source = [
      'async function save() {}',
      '<template>',
      '<AppButton @click="save">x</AppButton>',
    ].join(NEWLINE)
    expect(unguardedButtons(source)).toEqual(['save'])
  })

  it('검사기가 action과 동기 핸들러는 안 잡는다', () => {
    const source = [
      'async function save() {}',
      'function close() {}',
      '<template>',
      '<AppButton :action="save">x</AppButton>',
      '<AppButton @click="close">x</AppButton>',
    ].join(NEWLINE)
    expect(unguardedButtons(source)).toEqual([])
  })

  /**
   * **기다리는 것이 다음 틱뿐인 둘.** 규칙이 지키려는 것은 "오래 걸리는 일"이고,
   * 이 둘은 두 번 눌려도 같은 자리에 머문다. **파일과 이름을 함께 못 박는다** —
   * 이름만 적으면 다른 화면의 같은 이름이 조용히 함께 빠져나간다.
   */
  const ALLOWED = new Set([
    // 가드 자신이다. 이 함수가 `blocked`를 보고 두 번째 클릭을 버린다.
    'components/AppButton.vue  run',
    // `await nextTick()` 뒤에 `select()`뿐이다. 두 번 누르면 글자가 두 번 선택된다.
    'components/ProjectName.vue  start',
  ])

  /**
   * `@/…` 임포트를 소스로 바꿔 준다. **`unguardedButtons`가 임포트를 한 겹 따라갈 때 쓴다**
   * (2026-09-01 감사 B-3). 없는 파일이면 `null`이고, 그때는 따라가지 않는다.
   */
  function moduleSource(specifier: string, from?: string): string | null {
    /**
     * **별칭과 상대 경로를 다 푼다** (2026-09-01 감사 B-1). `@/`만 풀던 때는 **같은 파일을
     * `../`로 들여오면** 규칙이 그 async 함수를 몰랐다 — 감사자가 실물로 재현했다(`@/`면
     * 울고 `../`면 안 운다). 지금 그런 자리는 0건이지만 **막는 것이 아무것도 없었다.**
     *
     * **재수출은 안 따라간다** (`export * from`). 한 겹만 본다는 뜻이고, 지금 저장소의
     * 재수출 인덱스 아래에는 async 함수가 하나도 없다.
     */
    const base = specifier.startsWith('@/')
      ? join(SRC, specifier.slice(2))
      : specifier.startsWith('.') && from !== undefined
        ? join(dirname(from), specifier)
        : null
    if (base === null) return null
    for (const suffix of ['.ts', '.vue', '/index.ts']) {
      // 날것으로 준다. **주석을 걷는 것은 받는 쪽(`unguardedButtons`)의 일이다** —
      // 여기서 걷으면 해결기를 세워 넘기는 짝들이 그 자리를 안 지나간다 (R17 감사 B-2).
      if (existsSync(`${base}${suffix}`)) return readFileSync(`${base}${suffix}`, 'utf-8')
    }
    return null
  }

  /**
   * **검사기 자체를 검사한다** (2026-09-01 감사 B-2). 임포트 한 겹 따라가기는 이번에
   * 새로 생긴 능력인데 **그 짝이 없었다** — `moduleSource`를 통째로 `null`로 죽여도
   * 202개가 초록이었다. 이 파일의 다른 검사기 열둘은 전부 합성 소스로 물리는 짝을 갖는다.
   */
  describe('임포트를 한 겹 따라간다', () => {
    // **`<template>`부터 본다** — 검사기가 그 뒤만 훑는다. 합성 소스도 같아야 한다.
    const button = '<template><AppButton @click="save">저장</AppButton></template>'

    it('들여온 async 함수를 잡는다', () => {
      const found = unguardedButtons(
        `import { save } from '@/x'
${button}`,
        () => 'export async function save(): Promise<void> {}',
      )
      expect(found).toEqual(['save'])
    })

    it('들여온 동기 함수는 안 잡는다', () => {
      const found = unguardedButtons(
        `import { save } from '@/x'
${button}`,
        () => 'export function save(): void {}',
      )
      expect(found).toEqual([])
    })

    it('이름을 바꿔 들여와도 잡는다', () => {
      const source = `import { store as save } from '@/x'
${button}`
      expect(
        unguardedButtons(source, () => 'export async function store(): Promise<void> {}'),
      ).toEqual(['save'])
    })

    it('따라갈 것이 없으면 안 잡는다 - 이 능력이 죽으면 여기가 아니라 위가 운다', () => {
      expect(
        unguardedButtons(
          `import { save } from '@/x'
${button}`,
          () => null,
        ),
      ).toEqual([])
    })

    /**
     * **주석의 옛 서명에 안 속는다** (2026-09-01 R17 감사 B-2). 이 저장소는 머리글에
     * 옛 서명을 그대로 인용하는 것이 관행이고, 날것으로 읽던 때는 그것이 **거짓 빨강**이
     * 됐다. 지금 저장소에 그 조합은 없다 — **다음 사람이 밟는다.**
     */
    it('주석에만 있는 async 서명에 안 속는다', () => {
      const found = unguardedButtons(
        `import { save } from '@/x'
${button}`,
        () => `/** 예전에는 export async function save 였다. 지금은 동기다. */
export function save(): void {}`,
      )
      expect(found).toEqual([])
    })
  })

  /**
   * **`moduleSource` 자체를 잰다** (2026-09-01 R17 감사 B-3).
   *
   * 위 짝들은 전부 해결기를 **세워서**(`() => '...'`) 넘기므로 `moduleSource`를 한 번도
   * 안 지나간다. 그리고 실소스 훑기는 `@/`뿐이라, **상대 경로 갈래를 통째로 지워도
   * 206개가 전부 초록이었다**(돌연변이 M5). 그 갈래를 넣은 근거가 *"`@/`면 울고 `../`면
   * 안 운다"*는 실물 재현이었는데 짝이 안 따라왔다.
   */
  describe('`moduleSource`가 두 표기를 다 푼다', () => {
    // 실제로 있는 파일로 잰다. **없는 파일로 재면 `null`끼리 같아서 늘 통과한다.**
    const viaAlias = moduleSource('@/limits')

    it('별칭을 푼다', () => {
      expect(viaAlias).not.toBeNull()
      expect(viaAlias).toContain('MAX_DATASET_ROWS')
    })

    it('상대 경로를 푼다 - 같은 파일에 닿는다', () => {
      expect(moduleSource('../limits', join(SRC, 'ml', 'backend.ts'))).toBe(viaAlias)
    })

    it('기준 파일이 없으면 상대 경로는 안 푼다', () => {
      expect(moduleSource('../limits')).toBeNull()
    })
  })

  it('지금 소스에 안 막힌 버튼이 없다', () => {
    const found = vueFiles(SRC).flatMap((path) =>
      unguardedButtons(readFileSync(path, 'utf-8'), (spec) => moduleSource(spec, path)).map(
        (name) =>
          `${path
            .slice(SRC.length + 1)
            .split('\\')
            .join('/')}  ${name}`,
      ),
    )
    expect(found.filter((one) => !ALLOWED.has(one))).toEqual([])
  })

  /**
   * **허용 목록이 실재하는 자리를 가리키는가.** 안 그러면 다음 사람이 그 파일을
   * 고치거나 지웠을 때 목록만 남아 "여기는 봤다"고 거짓말한다.
   */
  it('허용한 둘이 실제로 그 자리에 있다', () => {
    const found = new Set(
      vueFiles(SRC).flatMap((path) =>
        unguardedButtons(readFileSync(path, 'utf-8'), (spec) => moduleSource(spec, path)).map(
          (name) =>
            `${path
              .slice(SRC.length + 1)
              .split('\\')
              .join('/')}  ${name}`,
        ),
      ),
    )
    expect([...ALLOWED].filter((one) => !found.has(one))).toEqual([])
  })
})

describe('확인 모달이 걸린 라디오는 그룹째 되돌린다', () => {
  const NEWLINE = String.fromCharCode(10)

  it('검사기가 안 막힌 그룹을 잡는다', () => {
    const source = [
      'function requestRemove(): void {}',
      'function chooseHoldout(): void {',
      '  requestRemove()',
      '}',
      '<template>',
      '<input type="radio" name="g" @change="chooseHoldout" />',
      '<input type="radio" name="g" @change="chooseOther" />',
      '</template>',
    ].join(NEWLINE)
    expect(unguardedConfirmRadios(source)).toEqual([
      '<input type="radio" name="g" @change="chooseHoldout" />',
      '<input type="radio" name="g" @change="chooseOther" />',
    ])
  })

  it('검사기가 전부 등록된 그룹은 안 잡는다', () => {
    const source = [
      'function requestRemove(): void {}',
      'function chooseHoldout(): void {',
      '  requestRemove()',
      '}',
      '<template>',
      '<input :ref="guard.register(\'a\')" type="radio" name="g" @change="chooseHoldout" />',
      '<input :ref="guard.register(\'b\')" type="radio" name="g" @change="chooseOther" />',
      '</template>',
    ].join(NEWLINE)
    expect(unguardedConfirmRadios(source)).toEqual([])
  })

  it('검사기가 확인 모달이 없는 그룹은 안 잡는다', () => {
    const source = [
      'function chooseHoldout(): void {',
      '  doSomething()',
      '}',
      '<template>',
      '<input type="radio" name="g" @change="chooseHoldout" />',
      '<input type="radio" name="g" @change="chooseOther" />',
      '</template>',
    ].join(NEWLINE)
    expect(unguardedConfirmRadios(source)).toEqual([])
  })

  it('지금 소스에 안 막힌 확인 라디오가 없다', () => {
    const found = vueFiles(SRC).flatMap((path) =>
      unguardedConfirmRadios(readFileSync(path, 'utf-8')).map(
        (tag) => `${path.slice(SRC.length + 1)}  ${tag.trim()}`,
      ),
    )
    expect(found).toEqual([])
  })

  /**
   * **층이 하나 더 있다.** 위 검사는 `register(`가 적혀 있는지만 보고, 훅 안은
   * `radio-guard.spec.ts`가 태운다. 그 사이에 **되돌리기를 실제로 부르는 한 줄**이
   * 있는데 그것을 아무도 안 봤다 — 지워도 저장소 전체가 조용했다
   * (2026-08-31 사각 감사 A-5).
   *
   * 그때 학생이 겪는 일: 취소했는데 **라디오가 방금 누른 것에 머문다.** 값은 안
   * 바뀌었으므로 Vue는 DOM을 다시 안 쓰고, 브라우저는 이미 옮겨 둔 뒤다.
   */
  it('가드를 만든 화면은 되돌리기를 실제로 부른다', () => {
    const owners = vueFiles(SRC)
      .map((path) => ({ path, source: readFileSync(path, 'utf-8') }))
      .filter(({ source }) => source.includes('useRadioGroupGuard<'))

    expect(owners.length, 'this check needs a screen that uses the guard').toBeGreaterThan(0)
    const silent = owners
      .filter(({ source }) => !/\.resync\(/.test(source))
      .map(({ path }) => path.slice(SRC.length + 1))
    expect(silent).toEqual([])
  })
})

describe('잠기는 입력은 DOM을 스키마로 되돌린다', () => {
  const NEWLINE = String.fromCharCode(10)

  it('되돌리지 않는 잠기는 입력을 잡는다', () => {
    const source = [
      'function onStratify(): void {',
      '  apply(withSplit(file.document, { stratify: true }, now()))',
      '}',
      '<template>',
      '<input type="checkbox" :checked="x" :disabled="locked" @change="onStratify" />',
      '</template>',
    ].join(NEWLINE)
    expect(unsyncedLockedInputs(source)).toEqual([
      '<input type="checkbox" :checked="x" :disabled="locked" @change="onStratify" />',
    ])
  })

  it('되돌리는 핸들러는 안 잡는다', () => {
    const source = [
      'function onStratify(event: Event): void {',
      '  apply(withSplit(file.document, { stratify: true }, now()))',
      '  input.checked = settings.split.stratify',
      '}',
      '<template>',
      '<input type="checkbox" :checked="x" :disabled="locked" @change="onStratify" />',
      '</template>',
    ].join(NEWLINE)
    expect(unsyncedLockedInputs(source)).toEqual([])
  })

  it('라디오 그룹 가드에 등록된 입력은 안 잡는다 - 되돌리기가 취소 시점에 있다', () => {
    const source = [
      'function chooseProvided(): void {',
      '  requestApplyTest()',
      '}',
      '<template>',
      `<input :ref="guard.register('provided')" type="radio" :disabled="!ok" @change="chooseProvided" />`,
      '</template>',
    ].join(NEWLINE)
    expect(unsyncedLockedInputs(source)).toEqual([])
  })

  it('되돌리지 않는 숫자 칸을 잡는다 - 잠겨 있지 않아도 본다', () => {
    const source = [
      'function setRows(raw: string): void {',
      '  apply(withSampling(file.document, clamp(raw), now()))',
      '}',
      '<template>',
      '<input type="number" :value="n" @change="setRows($event.target.value)" />',
      '</template>',
    ].join(NEWLINE)
    expect(unsyncedLockedInputs(source)).toEqual([
      '<input type="number" :value="n" @change="setRows($event.target.value)" />',
    ])
  })

  it('요소를 받아 되돌리는 숫자 칸은 안 잡는다', () => {
    const source = [
      'function setRows(input: HTMLInputElement): void {',
      '  apply(withSampling(file.document, clamp(input.value), now()))',
      '  input.value = String(next)',
      '}',
      '<template>',
      '<input type="number" :value="n" @change="setRows($event.target)" />',
      '</template>',
    ].join(NEWLINE)
    expect(unsyncedLockedInputs(source)).toEqual([])
  })

  it('ref에 쓰는 것은 되돌리기가 아니다 - 요소를 받는 함수만 센다', () => {
    // `foo.value = ...`는 Vue의 ref에도 그대로 나오는 모양이다. 그것만 보면
    // 아무 핸들러나 되돌린다고 판정해 검사가 통째로 무력해진다.
    const source = [
      'function setRows(raw: string): void {',
      '  opened.value = null',
      '  apply(withSampling(file.document, clamp(raw), now()))',
      '}',
      '<template>',
      '<input type="number" :value="n" @change="setRows($event.target.value)" />',
      '</template>',
    ].join(NEWLINE)
    expect(unsyncedLockedInputs(source)).toHaveLength(1)
  })

  it('잠기지 않는 입력은 안 잡는다 - 한 번 더 누르면 맞아진다', () => {
    const source = [
      'function onTestSize(): void {',
      '  apply(withSplit(file.document, { testSize: 0.2 }, now()))',
      '}',
      '<template>',
      '<input type="range" :value="size" @change="onTestSize" />',
      '</template>',
    ].join(NEWLINE)
    expect(unsyncedLockedInputs(source)).toEqual([])
  })

  it('지금 소스에 안 막힌 잠기는 입력이 없다', () => {
    const found = vueFiles(SRC).flatMap((path) =>
      unsyncedLockedInputs(readFileSync(path, 'utf-8')).map(
        (tag) => `${path.slice(SRC.length + 1)}  ${tag.replace(/\s+/g, ' ').trim()}`,
      ),
    )
    expect(found).toEqual([])
  })
})

describe('나열에서 이름은 배지, 값은 plaintext다', () => {
  const NEWLINE = String.fromCharCode(10)

  it('배지 없는 이름을 잡는다', () => {
    const source = [
      '<template>',
      '<dl>',
      '  <div class="flex items-baseline gap-1.5"><dt>a</dt><dd>1</dd></div>',
      '</dl>',
      '</template>',
    ].join(NEWLINE)
    expect(unbadgedMetaNames(source)).toEqual(['<dt>a</dt>'])
  })

  it('배지가 있으면 안 잡는다', () => {
    const source = [
      '<template>',
      '<dl>',
      '  <div class="flex items-baseline gap-1.5"><dt><AppBadge>a</AppBadge></dt><dd>1</dd></div>',
      '</dl>',
      '</template>',
    ].join(NEWLINE)
    expect(unbadgedMetaNames(source)).toEqual([])
  })

  it('class가 첫 속성이 아니어도 잡는다', () => {
    const source = [
      '<template>',
      '<dl>',
      '  <div v-if="ok" class="flex items-baseline gap-1.5"><dt>a</dt><dd>1</dd></div>',
      '</dl>',
      '</template>',
    ].join(NEWLINE)
    expect(unbadgedMetaNames(source)).toEqual(['<dt>a</dt>'])
  })

  it('gap-1.5 뒤에 클래스가 더 붙어도 잡는다', () => {
    const source = [
      '<template>',
      '<dl>',
      '  <div class="flex items-baseline gap-1.5 shrink-0"><dt>a</dt><dd>1</dd></div>',
      '</dl>',
      '</template>',
    ].join(NEWLINE)
    expect(unbadgedMetaNames(source)).toEqual(['<dt>a</dt>'])
  })

  it('숨긴 이름은 안 잡는다 - 값 자체가 무엇인지 말하는 자리다', () => {
    const source = [
      '<template>',
      '<dl>',
      '  <div class="flex items-baseline gap-1.5"><dt class="sr-only">a</dt><dd>1</dd></div>',
      '</dl>',
      '</template>',
    ].join(NEWLINE)
    expect(unbadgedMetaNames(source)).toEqual([])
  })

  it('가운뎃점 구분자를 잡는다', () => {
    const source = '<span class="text-line-strong" aria-hidden="true"> · </span>'
    expect(strayDotSeparators(source)).toHaveLength(1)
  })

  it('지금 소스에 배지 없는 이름이 없다', () => {
    const found = vueFiles(SRC).flatMap((path) =>
      unbadgedMetaNames(readFileSync(path, 'utf-8')).map(
        (tag) => `${path.slice(SRC.length + 1)}  ${tag.trim()}`,
      ),
    )
    expect(found).toEqual([])
  })

  it('가운뎃점은 하단 상태 표시줄에만 있다', () => {
    const found = vueFiles(SRC)
      .filter((path) => !path.endsWith('AppStatusBar.vue'))
      .flatMap((path) =>
        strayDotSeparators(readFileSync(path, 'utf-8')).map(
          (tag) => `${path.slice(SRC.length + 1)}  ${tag.trim()}`,
        ),
      )
    expect(found).toEqual([])
  })
})

/**
 * **테스트 데이터를 바꾸는 일은 실험을 지운다. 판이 둘이어도 계약은 하나여야 한다.**
 *
 * 이미지 판은 붙일 때만 안 묻고 올린 뒤에 "지웠습니다"라고 알렸다 — 같은 판의
 * [지우기]는 묻는데 [올리기]는 안 묻는 상태였다 (2026-08-29 전 경로 감사).
 * **조각마다 초록인데 잇는 검사가 없던 자리다.**
 */
describe('전처리 판은 붙일 때도 뗄 때도 묻는다', () => {
  const PANELS = ['preprocess/TabularPrepPanel.vue', 'preprocess/ImagePrepPanel.vue']

  /** 확인 대화상자가 실험 수를 세어 말하는가. 세는 자리가 곧 묻는 자리다. */
  function asksBeforeLosingExperiments(source: string): {
    counts: boolean
    attach: boolean
    remove: boolean
  } {
    const code = withoutComments(source).join('\n')
    return {
      counts: /experimentCount\.value > 0/.test(code),
      attach: /Attach(Title|Confirm)'\)/.test(code),
      remove: /Remove(Title|Confirm)'\)/.test(code),
    }
  }

  it('묻지 않는 판을 잡는다', () => {
    const source = ["t('preprocess.testImagesRemoveTitle')", 'if (count > 0) return'].join('\n')
    expect(asksBeforeLosingExperiments(source)).toEqual({
      counts: false,
      attach: false,
      remove: true,
    })
  })

  it('주석으로만 적어 둔 것은 안 센다', () => {
    const source = "// t('preprocess.testImagesAttachTitle')를 붙여야 한다"
    expect(asksBeforeLosingExperiments(source).attach).toBe(false)
  })

  it('지금 두 판이 둘 다 묻는다', () => {
    const found = PANELS.map((name) => ({
      name,
      asks: asksBeforeLosingExperiments(readFileSync(join(SRC, 'views', name), 'utf-8')),
    }))
      .filter((entry) => !entry.asks.counts || !entry.asks.attach || !entry.asks.remove)
      .map((entry) => `${entry.name}  ${JSON.stringify(entry.asks)}`)

    expect(found).toEqual([])
  })

  /**
   * **묻고 나서 실패했을 때 창이 닫히는가.** 닫는 줄이 `try` 안에 있으면 실패했을 때
   * "실험 N개가 사라집니다"라고 적힌 경고창이 열린 채로 남고, 그 아래에 실패 토스트가
   * 뜬다 — 학생은 방금 무슨 일이 났는지 못 읽는다 (2026-08-29 전 경로 감사).
   * 셋이 그 모양이었고 하나는 `try`가 아예 없었다.
   */
  const CLOSERS = [
    { file: 'preprocess/TabularPrepPanel.vue', fn: 'applyTest', ref: 'testAttaching' },
    { file: 'preprocess/TabularPrepPanel.vue', fn: 'removeTest', ref: 'testRemoving' },
    { file: 'preprocess/ImagePrepPanel.vue', fn: 'removeTest', ref: 'testRemoving' },
    { file: 'data/TabularPanel.vue', fn: 'apply', ref: 'confirming' },
  ] as const

  /** 함수 하나의 본문. 다음 최상위 선언 전까지다. */
  function bodyOf(source: string, name: string): string {
    const start = source.indexOf(`async function ${name}(`)
    if (start < 0) return ''
    const rest = source.slice(start + 1)
    const end = rest.search(/\n(async function|function|const|\/\*\*|<\/script>)/)
    return end < 0 ? rest : rest.slice(0, end)
  }

  it('본문을 함수 이름으로 자른다', () => {
    const source = [
      'async function a(): Promise<void> {',
      '  x()',
      '}',
      '',
      'function b() {}',
    ].join('\n')
    expect(bodyOf(source, 'a')).toContain('x()')
    expect(bodyOf(source, 'a')).not.toContain('function b')
  })

  it('try 안에서 닫는 것을 잡는다', () => {
    const source = [
      'async function apply(): Promise<void> {',
      '  try {',
      '    confirming.value = false',
      '  } catch (error) {',
      '    toasts.pushError(error)',
      '  } finally {',
      '    busy.value = false',
      '  }',
      '}',
    ].join('\n')
    const body = bodyOf(source, 'apply')
    expect(body.indexOf('} catch (')).toBeGreaterThan(body.indexOf('confirming.value = false'))
  })

  it('지금 넷이 전부 catch 뒤에서 닫는다', () => {
    const found = CLOSERS.filter(({ file, fn, ref }) => {
      const body = bodyOf(readFileSync(join(SRC, 'views', file), 'utf-8'), fn)
      const closes = body.indexOf(`${ref}.value = false`)
      const caught = body.indexOf('} catch (')
      return closes < 0 || caught < 0 || closes < caught
    }).map(({ file, fn }) => `${file}  ${fn}`)

    expect(found).toEqual([])
  })

  /**
   * **새 확인 대화상자가 생기면 여기가 운다.**
   *
   * 위 `CLOSERS`는 손으로 적은 목록이라 대화상자가 하나 더 생겨도 조용하다
   * (2026-08-30, R12 감사 C-3) — 같은 파일이 위에서 *"손으로 적지 않는다. 그러면 빠진
   * 판을 아무도 못 본다"*고 못 박아 두었는데 여기만 그 모양이었다.
   *
   * **무엇이 대상인지는 사람이 판단해야 한다** — 일하기 전에 닫는 것도 있고
   * (`ImagePrepPanel`의 붙이기 경로) 실패를 안 잡는 것도 있다. 그래서 목록을 자동으로
   * 만들지 않고 **이름을 못 박아** 판단을 부른다. 늘었으면 그 화면이 `CLOSERS`에
   * 들어가는지 보고, 아니면 왜 아닌지를 이 주석에 적어라.
   */
  it('AppDialog를 쓰는 화면이 그대로다 - 늘었으면 CLOSERS를 다시 보라', () => {
    const screens = vueFiles(SRC)
      .filter((path) => readFileSync(path, 'utf-8').includes('AppDialog'))
      .map((path) => path.slice(SRC.length + 1).replace(/\\/g, '/'))
      .sort()

    expect(screens).toEqual([
      'views/PortfolioView.vue',
      'views/PreprocessView.vue',
      'views/TrainView.vue',
      'views/WelcomeView.vue',
      'views/data/ImagePanel.vue',
      'views/data/TabularPanel.vue',
      'views/predict/ImagePredictPanel.vue',
      'views/preprocess/ImagePrepPanel.vue',
      'views/preprocess/TabularPrepPanel.vue',
    ])
  })
})

/**
 * **표를 덮는 한 줄은 그 표에 실제로 있는 것만 말해야 한다.**
 *
 * 군집 요약표의 머리말이 `각 칸은 … 평균입니다` 하나였는데, 범주형 열의 칸에 앉는 것은
 * 평균이 아니라 최빈 범주다 — 학생이 보는 칸에는 `체육`이라고 적혀 있었다
 * (2026-08-29 전 경로 감사). **바로 아래 열 머리 도움말은 이미 갈라져 있었고**
 * (`clusterMeanHelp`/`clusterModeHelp`) 갈리지 않은 것은 모두가 읽는 그 한 줄뿐이었다.
 */
describe('군집 요약표는 평균과 최빈을 갈라 말한다', () => {
  const PANEL = join(SRC, 'views', 'results', 'panels', 'ClusterResultPanel.vue')

  /** 이 파일이 실제로 부르는 로케일 키들. 주석에 적어 둔 것은 안 센다. */
  function keysIn(source: string): string[] {
    return [
      ...withoutComments(source)
        .join('\n')
        .matchAll(/'(results\.tabular\.cluster\w+)'/g),
    ].map((hit) => hit[1] ?? '')
  }

  it('주석에 적힌 키는 안 센다', () => {
    expect(keysIn("// t('results.tabular.clusterModeHelp')를 붙여야 한다")).toEqual([])
  })

  it('부르는 키를 전부 센다', () => {
    expect(keysIn("t('results.tabular.clusterMeanHelp', x)")).toEqual([
      'results.tabular.clusterMeanHelp',
    ])
  })

  /**
   * **머리 문장의 두 갈래는 이제 판이 아니라 `ml/clusters.ts`가 든다** (2026-08-30,
   * R12 감사 C-2). 화면에서 삼항으로 조립하던 때에는 두 갈래를 서로 바꿔도 아무도 안
   * 울어서, 판정을 밖으로 뺐다 — 열 머리 도움말 둘은 그대로 판이 든다.
   */
  it('머리말도 도움말도 두 갈래를 다 든다', () => {
    const keys = [
      ...keysIn(readFileSync(PANEL, 'utf-8')),
      ...keysIn(readFileSync(join(SRC, 'ml', 'clusters.ts'), 'utf-8')),
    ]

    for (const pair of [
      ['results.tabular.clusterMeanHelp', 'results.tabular.clusterModeHelp'],
      ['results.tabular.clusterSummaryLead', 'results.tabular.clusterSummaryLeadMixed'],
    ]) {
      for (const key of pair) expect(keys, `${key} is missing`).toContain(key)
    }
  })
})

describe('상세 패널은 프롭을 하나만 선언한다', () => {
  const PANELS = join(SRC, 'views', 'results', 'panels')

  it('개별 프롭으로 흩은 패널을 잡는다', () => {
    const source = `<script setup lang="ts">
const props = defineProps<{ run: Run; dataset: Dataset | null }>()
</script>`
    expect(panelProps(source)).toEqual(['run', 'dataset'])
  })

  it('선택 프롭도 이름으로 센다', () => {
    // `modelBytes?: Uint8Array`처럼 물음표가 붙어도 프롭은 프롭이다.
    const source = 'const props = defineProps<{ input: PanelInput; extra?: number }>()'
    expect(panelProps(source)).toEqual(['input', 'extra'])
  })

  it('지금 패널이 전부 input 하나만 받는다', () => {
    const found = vueFiles(PANELS)
      .map((path) => ({ path, props: panelProps(readFileSync(path, 'utf-8')) }))
      .filter((entry) => entry.props.length !== 1 || entry.props[0] !== 'input')
      .map((entry) => `${entry.path.slice(SRC.length + 1)}  ${entry.props.join(', ')}`)
    expect(found).toEqual([])
  })

  it('패널이 하나라도 있다 - 빈 디렉터리에서 조용히 통과하지 않는다', () => {
    expect(vueFiles(PANELS).length).toBeGreaterThan(0)
  })

  /**
   * **판의 세로 리듬은 둘뿐이다** (2026-08-31 여백 감사) — 덩어리 사이는 `gap-5`,
   * 덩어리 안의 제목과 내용은 `gap-1.5`다. 결과 카드 본문이 `gap-5`이고
   * `ClusterResultPanel`이 그 안에서 같은 리듬을 쓴다.
   *
   * **어긋나면 카드 안에 층이 생긴다.** 실제로 둘이 그랬다 — 새 판이 덩어리 여럿을
   * 전부 `gap-1.5`로 붙여 표 제목이 설명문에 달라붙었고(사용자가 화면에서 봤다),
   * `ImageClusterPanel`은 저 혼자 `4`와 `2`였다. **눈으로만 지키면 다음 판에서 또 갈린다.**
   *
   * **세로 스택만 본다.** 가로줄(`flex items-center gap-4`)과 격자(`grid gap-2`)는
   * 리듬이 아니라 그 부품의 내부 간격이라 대상이 아니다.
   */
  const verticalGaps = (source: string): string[] =>
    [...source.matchAll(/class="([^"]*\bflex-col\b[^"]*)"/g)]
      .flatMap((match) => [...(match[1] ?? '').matchAll(/(?<![\w-])gap-([\d.]+)/g)])
      .map((match) => match[1] ?? '')

  it('세로 간격을 골라낸다', () => {
    expect(verticalGaps('<div class="flex flex-col gap-4">')).toEqual(['4'])
    // 가로 간격만 있는 줄은 세로 리듬이 아니다.
    expect(verticalGaps('<div class="flex items-center gap-4">')).toEqual([])
    // `gap-x-3`은 다른 클래스다 - 앞의 경계가 없으면 이것까지 잡는다.
    expect(verticalGaps('<div class="flex flex-col gap-x-3 gap-1.5">')).toEqual(['1.5'])
  })

  it('지금 판이 전부 gap-1.5 아니면 gap-5다', () => {
    const found = vueFiles(PANELS).flatMap((path) =>
      verticalGaps(readFileSync(path, 'utf-8'))
        .filter((gap) => gap !== '1.5' && gap !== '5')
        .map((gap) => `${path.slice(SRC.length + 1)}  gap-${gap}`),
    )
    expect(found).toEqual([])
  })
})

/**
 * **`.vue`만 본다.** 이름 그대로 화면 코드의 규칙이라 의도한 범위다. `.ts`에서 파라미터를
 * 넘겨 `t()`를 부르는 자리는 지금 없지만, 생기면 이 훑기가 못 본다
 * (R13-5 감사 C-8). `src/composables/`에는 `useI18n()`을 쓰는 `.ts`가 이미 있다.
 */
describe('지금 화면 코드에 위반이 없다', () => {
  for (const rule of RULES) {
    it(`${rule.name} — ${rule.why}`, () => {
      const found = vueFiles(SRC).flatMap((path) =>
        ruleHits(rule, readFileSync(path, 'utf-8'), path.slice(SRC.length + 1)),
      )
      expect(found).toEqual([])
    })
  }
})

/**
 * **DOM이 필요한 검사는 스스로 밝힌다.**
 *
 * vitest의 기본 환경은 `node`다(`vite.config.ts`). DOM이 필요한 스펙은 첫 줄에
 * `// @vitest-environment jsdom`을 적고, **빠뜨리면 `document is not defined`로 그
 * 자리에서 죽는다** — 거기까지는 사람이 안 지켜도 시끄러우니 검사가 필요 없다.
 *
 * **조용한 구멍은 그다음이다.** 소스가 `typeof document === 'undefined'`로 DOM 부재를
 * 분기하고 있으면, 밝히지 않은 스펙은 죽는 대신 **대체 경로를 검사한다.** 초록색인데
 * 다른 것을 보고 있는 상태라 사람 눈으로는 영원히 안 보인다. 실제로 `i18n.ts`·
 * `theme.ts`·`ClusterScatter.vue` 셋에 그런 분기가 있다.
 *
 * **직접 부르지 않아도 막는다.** 지금 그 함수를 안 부른다는 것이 내일도 안 부른다는
 * 뜻은 아니고, 부르는 줄이 하나 늘어나는 순간 조용해진다. 닿기만 하면 요구한다.
 */
describe('DOM이 필요한 검사는 스스로 밝힌다', () => {
  const guarded = codeFiles(SRC).filter((path) => hasDomGuard(sourceOf(path)))
  const specs = specFiles()
  const needsDom = specs
    .map((path) => ({ path, via: reachesDomGuard(path) }))
    .filter((entry): entry is { path: string; via: string } => entry.via !== null)

  it('허용된 표기의 가드를 잡는다', () => {
    expect(hasDomGuard("if (typeof document === 'undefined') return")).toBe(true)
    expect(hasDomGuard('return typeof window === "undefined" ? null : matchMedia(query)')).toBe(
      true,
    )
    expect(hasDomGuard("if (typeof navigator !== 'undefined') {")).toBe(true)
  })

  it('주석 속 가드는 안 잡는다 - 규칙을 설명할 수 있어야 한다', () => {
    expect(hasDomGuard("// typeof document === 'undefined'로 판정한다")).toBe(false)
  })

  it('검사기가 못 보는 표기를 잡는다', () => {
    expect(strayDomChecks('const target = globalThis.document')).toHaveLength(1)
    expect(strayDomChecks("if ('document' in globalThis) return")).toHaveLength(1)
    expect(strayDomChecks('document?.documentElement.setAttribute("lang", locale)')).toHaveLength(1)
  })

  it('같은 이름의 속성 접근은 안 잡는다 - 우리 자료구조에도 document가 있다', () => {
    // project/storage.ts의 `record.document?.manifest`가 실제로 이 모양이다.
    expect(strayDomChecks('taskType: record.document?.manifest?.taskType')).toEqual([])
    expect(strayDomChecks('const saved = state.document')).toEqual([])
  })

  it('지금 소스에 인정되지 않은 DOM 부재 표기가 없다', () => {
    const found = codeFiles(SRC).flatMap((path) =>
      strayDomChecks(sourceOf(path)).map((line) => `${path.slice(SRC.length + 1)}  ${line}`),
    )
    expect(found).toEqual([])
  })

  it('가드가 있는 모듈이 실제로 있다 - 없으면 아래가 조용히 통과한다', () => {
    expect(guarded.length).toBeGreaterThan(0)
  })

  it('가드에 닿는 스펙이 실제로 있다 - 없으면 아래가 조용히 통과한다', () => {
    expect(specs.length).toBeGreaterThan(10)
    expect(needsDom.length).toBeGreaterThan(0)
  })

  it('가드에 닿는 스펙은 전부 jsdom을 밝히고 있다', () => {
    const silent = needsDom
      .filter((entry) => !DECLARES_JSDOM.test(sourceOf(entry.path)))
      .map(
        (entry) =>
          `${entry.path.split(/[\\/]/).pop()} — ${entry.via.slice(SRC.length + 1)}에 닿는다. ` +
          `첫 줄에 // @vitest-environment jsdom 을 적어라`,
      )
    expect(silent).toEqual([])
  })
})

/**
 * **종류를 모르는 화면은 데이터 계층과 학습 계층을 import하지 않는다**
 * (architecture.md §9.1.2).
 *
 * 표의 열이든 이미지의 범주든, 그 사실을 아는 것은 등록부에서 꺼낸 판이다. 공통 화면이
 * 한 줄만 끌어와도 그 화면은 "표가 있다"를 아는 화면이 되고, **이미지가 들어오는 날
 * 고쳐야 할 파일이 등록부 하나가 아니라 그 사실을 아는 화면 전부가 된다** (§9.1).
 *
 * 실제로 그 자리가 둘 있었다 — 테스트용 파일의 `accept`와 시트 고르기가 종류를 모르는
 * 화면에 있었고(2026-08-12에 판으로 옮겼다), 층화 판정이 타깃 열 분포를 직접 보고
 * 있었다(같은 날 라벨 분포로 낮췄다). **둘 다 그 자리에서는 한 줄이 더 싸 보였다.**
 *
 * **`@/project`의 종류별 계층도 본다 (2026-08-12).** 예전에는 `@/data/*`와 `@/ml/*`만
 * 봤고, 그 사이로 `PreprocessView`가 `readDataset`을 부르고 있었다 — 머리글의 행 수·열
 * 수다. 그 자리를 판으로 옮기면서(§9.3.2) 이 구멍도 함께 닫았다. **정본을 표로 파싱하는
 * 함수를 종류를 모르는 화면이 부르면, 이미지 프로젝트는 영원히 빈 화면이고 그 사실이
 * 컴파일에서도 검사에서도 안 드러난다.**
 */
describe('종류를 모르는 화면은 종류를 모른다', () => {
  /**
   * 데이터 종류를 모른 채 판을 그리는 화면들. **판(`views/data/`·`views/preprocess/`)은
   * 여기 없다** — 그쪽은 자기 종류를 아는 것이 일이다.
   */
  const KIND_AGNOSTIC = ['DataView.vue', 'PreprocessView.vue']

  const NEWLINE = String.fromCharCode(10)
  /** 윈도우와 POSIX를 함께 다룬다 - 경로 구분자가 갈린다. */
  const SEPARATOR = new RegExp('[\\\\/]')

  /**
   * 종류를 아는 계층. 판만 여기서 꺼내 쓴다.
   *
   * **등록부(`@/data/kinds`)는 예외다.** 종류를 모르는 화면이 판을 얻는 유일한 문이고,
   * 그것을 부르는 것이 곧 "종류를 모른 채 그린다"는 뜻이다 — 막으면 규칙이 자기 장치를
   * 금지하는 셈이 된다.
   */
  /**
   * **별칭과 상대 경로를 둘 다 본다.** 예전에는 `@/`만 봐서
   * `from '../project/dataset'`가 한 글자도 안 걸렸다 (2026-08-30 R12 감사 A-2).
   * 지금 이 두 화면은 상대 경로를 안 쓰지만 `src/`의 `.ts`에는 118곳이 있고,
   * `.vue`에서 그 표기를 막는 린트 규칙은 없다 - **표기 하나가 규칙을 통째로 끈다.**
   */
  const KIND_AWARE =
    /from '(?:@\/|(?:\.\.\/)+)(?:(?:data|ml)\/(?!kinds')|project\/(?:dataset|images)')/

  /**
   * 예문은 **조립해서 만든다.** 이 파일도 import 훑기의 대상이라, 예문을 그대로 적으면
   * `ui-rules.spec.ts`가 진짜로 그 모듈을 부르는 것으로 읽힌다 - 실제로 그렇게 읽혀서
   * DOM 가드 도달성 검사가 울었다. 위의 `BACKTICK`이 같은 이유로 서 있다.
   */
  const QUOTE = String.fromCharCode(39)
  const imported = (spec: string): string => `import { x } from ${QUOTE}${spec}${QUOTE}`

  const KIND_AWARE_HITS = [
    '@/project/dataset',
    '../project/dataset',
    '../../project/images',
    '../ml/selection',
    '@/data/columns',
  ].map(imported)

  const KIND_AWARE_MISSES = [
    '@/data/kinds',
    '../data/kinds',
    '@/stores/project',
    '@/components/AppEmpty.vue',
    '@/project/settings',
  ].map(imported)

  it.each(KIND_AWARE_HITS)('검사기가 잡는다: %s', (line) => {
    expect(KIND_AWARE.test(line)).toBe(true)
  })

  it.each(KIND_AWARE_MISSES)('검사기가 안 잡는다: %s', (line) => {
    expect(KIND_AWARE.test(line)).toBe(false)
  })

  it('목록의 화면이 실제로 있다 - 없으면 아래가 조용히 통과한다', () => {
    const names = vueFiles(SRC).map((path) => path.split(SEPARATOR).pop())
    for (const screen of KIND_AGNOSTIC) expect(names, screen).toContain(screen)
  })

  it('종류를 아는 계층(data/*, ml/*, project/dataset, project/images)을 별칭으로도 상대 경로로도 import하지 않는다', () => {
    const found = vueFiles(SRC)
      .filter((path) => KIND_AGNOSTIC.includes(path.split(SEPARATOR).pop() ?? ''))
      .flatMap((path) =>
        readFileSync(path, 'utf-8')
          .split(NEWLINE)
          .filter((line) => KIND_AWARE.test(line))
          .map((line) => `${path.slice(SRC.length + 1)}  ${line.trim()}`),
      )
    expect(
      found,
      'the layer that knows the kind is called by the panel taken from the registry',
    ).toEqual([])
  })
})

/**
 * **단계 문구를 화면이 손으로 조립하지 않는다** (architecture.md 8.10, docs/i18n.md 규칙 10).
 *
 * 종류를 가리는 셋(`data.purpose`·`predict.purpose`·`train.locked`)은 `steps.*`에 없고
 * 등록부가 갖는다. 그런데 대시보드가 `steps.${step}.purpose`를 직접 만들고 있어서
 * **로케일에 없는 키를 부르고, 화면에 키 문자열이 그대로 떴다** (2026-08-13에 발견).
 *
 * **왜 아무 검사도 안 울었나.** 정적 키 검사는 따옴표 안에 통째로 적힌 키만 보고,
 * 조립 자리 검사는 앞부분(`steps.`)에 키가 하나라도 있으면 통과한다 — `label`이 거기
 * 남아 있어서 조용했다. 조립된 키의 **뒤**는 어떤 검사도 확인할 수 없다. 그러므로
 * 막을 자리는 문구가 아니라 **조립 자체**다.
 *
 * `label`은 예외다. 그건 종류를 안 가려서 언제나 `steps.*`에 있다.
 */
function composedStepText(source: string): string[] {
  // 주석은 걷어낸다. 이 규칙을 설명하려면 금지된 모양을 주석에 적어야 한다.
  const code = withoutComments(source).join(String.fromCharCode(10))
  const pattern = new RegExp(String.fromCharCode(96) + String.raw`steps[.]\$\{[^}]*\}[.](\w+)`, 'g')
  return [...code.matchAll(pattern)]
    .map((match) => match[1] ?? '')
    .filter((slot) => slot !== 'label')
}

describe('단계 문구를 화면이 조립하지 않는다', () => {
  it('검사기가 purpose와 locked를 잡는다', () => {
    expect(composedStepText('t(`steps.${step}.purpose`)')).toEqual(['purpose'])
    expect(composedStepText('t(`steps.${entry.step}.locked`)')).toEqual(['locked'])
  })

  it('검사기가 label은 안 잡는다', () => {
    expect(composedStepText('t(`steps.${step}.label`)')).toEqual([])
  })

  it('지금 소스에 조립한 단계 문구가 없다', () => {
    const found = codeFiles(SRC).flatMap((path) =>
      composedStepText(readFileSync(path, 'utf-8')).map(
        (slot) => `${path.slice(SRC.length + 1)}  steps.*.${slot}`,
      ),
    )
    expect(found).toEqual([])
  })
})

/**
 * **`v-html`은 한 자리에만 있다** (mlpx-spec.md §8.1).
 *
 * 남이 준 마크다운을 그리는 일이 이 앱에 하나 생겼고(문항 안내문), 그 살균은
 * `renderGuidance` 한 곳이 한다. **`v-html`이 다른 자리에 하나만 더 생기면 그 자리가
 * 곧 구멍이다** — 살균을 안 거친 글자가 그대로 DOM이 된다.
 *
 * **지금이 못 박기 가장 싼 시점이었다.** 이 규칙을 세울 때 소스 전체에 `v-html`이
 * 정확히 하나였다.
 */
describe('v-html은 안내문 한 자리에만 있다', () => {
  /** 살균을 거친 것만 넣는 자리. 늘리려면 그 자리도 `renderGuidance`를 지나야 한다. */
  const ALLOWED = 'GuidanceText.vue'

  /** 윈도와 POSIX를 함께 다룬다 - 경로 구분자가 갈린다. */
  const PATH_SEPARATOR = new RegExp('[\\\\/]')

  function usesVHtml(source: string): boolean {
    return /\sv-html\s*=/.test(source)
  }

  it('검사기가 v-html을 잡는다', () => {
    expect(usesVHtml('<div v-html="html" />')).toBe(true)
    expect(usesVHtml('<div :inner="html" />')).toBe(false)
  })

  it('허용된 자리가 실제로 있다 - 없으면 아래가 조용히 통과한다', () => {
    const users = vueFiles(SRC).filter((path) => usesVHtml(readFileSync(path, 'utf-8')))
    expect(users.map((path) => path.split(PATH_SEPARATOR).pop())).toEqual([ALLOWED])
  })

  it('허용된 자리 밖에 v-html이 없다', () => {
    const found = vueFiles(SRC)
      .filter((path) => usesVHtml(readFileSync(path, 'utf-8')))
      .filter((path) => path.split(PATH_SEPARATOR).pop() !== ALLOWED)
      .map((path) => path.slice(SRC.length + 1))
    expect(found).toEqual([])
  })
})

/**
 * **머리의 맥락 자리에는 버튼이 없다** (architecture.md §8.9, 2026-08-13).
 *
 * `StepHeader`의 맥락 슬롯은 `<dl>`이다 — 이름-값 쌍이 들어가는 자리다. 데이터 화면이
 * 거기에 [파일 선택]·[사진 추가]를 넣어 두어서, **버튼이 `<dl>` 안에 있었고** 네 단계
 * 화면의 같은 자리가 데이터에서만 다른 모양이었다. 데이터가 없을 때는 화면 가운데
 * [파일 선택]과 **같은 동작의 버튼이 둘**이 되기도 했다.
 *
 * **동작 슬롯까지 막지는 않는다.** 대시보드의 [바로가기]가 맨 위 오른쪽이어야 하는
 * 이유가 §8.9에 따로 있다. 막는 것은 맥락 슬롯 하나다.
 */
describe('머리의 맥락 자리에는 버튼이 없다', () => {
  /** `<StepHeader …> … </StepHeader>` 안쪽들. 없으면 빈 배열이다. */
  function headerBlocks(source: string): string[] {
    return [...source.matchAll(/<StepHeader[\s\S]*?<\/StepHeader>/g)].map((match) => match[0])
  }

  /**
   * 맥락 슬롯 안에 버튼이 있는가.
   *
   * **동작 슬롯은 걷어내고 본다.** `#actions` 안의 버튼은 허용이므로, 그 블록을 먼저
   * 지운 뒤에 남은 자리에서 찾는다.
   */
  function buttonsInContext(source: string): boolean {
    return headerBlocks(source)
      .map((block) => block.replaceAll(/<template #actions>[\s\S]*?<\/template>/g, ''))
      .some((block) => /<AppButton/.test(block))
  }

  it('맥락 슬롯 안의 버튼을 잡는다', () => {
    const source = `<StepHeader :title="t('steps.data.label')" :purpose="p">
      <template #context>
        <dd>{{ rows }}</dd>
        <AppButton @click="pick">고르기</AppButton>
      </template>
    </StepHeader>`
    expect(buttonsInContext(source)).toBe(true)
  })

  it('동작 슬롯 안의 버튼은 안 잡는다 - 대시보드의 [바로가기]가 거기 산다', () => {
    const source = `<StepHeader :title="t('project.dashboard')" :purpose="p">
      <template #actions>
        <AppButton size="lg" @click="go">바로가기</AppButton>
      </template>
    </StepHeader>`
    expect(buttonsInContext(source)).toBe(false)
  })

  it('머리 밖의 버튼은 안 잡는다 - 동작은 본문에 선다', () => {
    const source = `<StepHeader :title="t" :purpose="p">
      <template #context><dd>{{ rows }}</dd></template>
    </StepHeader>
    <div><AppButton @click="change">데이터 바꾸기</AppButton></div>`
    expect(buttonsInContext(source)).toBe(false)
  })

  it('머리를 쓰는 화면이 실제로 있다 - 없으면 아래가 조용히 통과한다', () => {
    const users = vueFiles(SRC).filter(
      (path) => headerBlocks(readFileSync(path, 'utf-8')).length > 0,
    )
    expect(users.length).toBeGreaterThan(0)
  })

  it('지금 소스에 맥락 슬롯 안의 버튼이 없다', () => {
    const found = vueFiles(SRC)
      .filter((path) => buttonsInContext(readFileSync(path, 'utf-8')))
      .map((path) => path.slice(SRC.length + 1))
    expect(found).toEqual([])
  })
})

/**
 * **양식을 나르는 부품이 인자를 흘리면 안 된다** (mlpx-spec.md §8.5).
 *
 * `TemplateSourceMenu`는 `TemplateSourceList`를 감싸 되보내기만 한다. 그런데 **선언을
 * 손으로 두 벌 적어 두어서, 목록에 언어가 붙던 날 메뉴만 인자 하나짜리로 남았다** —
 * 시작 화면(목록을 직접 쓴다)은 멀쩡하고 팝오버로 가져온 양식만 언어를 잃었다.
 * 타입도 안 울었다. 되보내는 쪽이 덜 받는 것은 TypeScript에서 정상이기 때문이다.
 *
 * 아이패드에서 만든 실물 `.mlpx`가 잡았다 (2026-08-15).
 */
describe('되보내는 부품은 같은 것을 보낸다', () => {
  const declarationOf = (file: string): string => {
    const source = readFileSync(join(SRC, 'views', 'portfolio', file), 'utf-8')
    // `pick: [...]` 한 줄. 주석은 안 본다.
    const found = /^\s*pick: \[(.+)\]$/m.exec(source)
    return found?.[1]?.trim() ?? ''
  }

  it('양식 목록과 그것을 감싼 메뉴가 같은 인자를 보낸다', () => {
    const list = declarationOf('TemplateSourceList.vue')
    // 선언을 실제로 찾았는지부터 본다 - 못 찾으면 아래가 빈 문자열끼리 통과한다.
    expect(list).not.toBe('')
    expect(declarationOf('TemplateSourceMenu.vue')).toBe(list)
  })
})

/**
 * **`t()`에 넘기는 인자는 새 객체여야 한다.**
 *
 * vue-i18n은 복수 판정에 쓰는 `count`·`n`을 **넘겨받은 객체에 써 넣는다.** 스토어나
 * `computed`가 든 읽기 전용 객체를 그대로 넘기면 그 쓰기가 막혀 콘솔에 경고가 쌓이고,
 * **복수형이 있는 언어에서는 그 값이 안 들어가 문장이 어긋난다** — 한국어는 복수형이
 * 없어 여태 안 드러났다 (2026-09-02, dev 서버를 직접 밟다 봤다).
 *
 * 검사로 세우는 이유는 **콘솔 경고가 조용하기 때문이다** — 검사도 타입도 안 운다.
 */
describe('t()의 인자는 새 객체다', () => {
  /**
   * `t(…, X.value…)`나 `t(…, Object.freeze(…))` 꼴. 객체 리터럴이나 개별 값은 안 잡는다.
   *
   * **얼린 것도 같은 병이다** — vue-i18n이 `count`를 써 넣지 못하는 것은 `readonly`든
   * `Object.freeze`든 마찬가지다. R21 감사가 이 구멍을 돌연변이로 찾았다.
   */
  const REF_PARAMS =
    /\bt\(\s*(?:'[^']*'|"[^"]*"|`[^`]*`|[\w.]+)\s*,\s*(?:[\w.$]+\.value|Object\.freeze\()/g

  function refParams(source: string): string[] {
    const code = withoutComments(source).join(String.fromCharCode(10))
    return [...code.matchAll(REF_PARAMS)].map((match) => match[0])
  }

  it('읽기 전용 객체를 그대로 넘기는 모양을 잡는다', () => {
    expect(refParams("t('train.progress', training.progress.value)")).toHaveLength(1)
    expect(refParams("t('train.progress', Object.freeze({ completed: 1 }))")).toHaveLength(1)
    expect(refParams("t('train.progress', { completed: at.value ?? 0 })")).toEqual([])
    expect(refParams("t('x', { done: now.completed, total: now.total })")).toEqual([])
  })

  /**
   * **못 보는 것**: `props.x`나 스토어 항목을 그대로 넘기는 것. 지금 소스에 그런 호출은
   * 없고(R21이 3인자 `t()`를 전수로 훑었다), 이름만으로는 읽기 전용인지 알 수 없어
   * 넓히면 멀쩡한 코드를 문다 — **거짓 빨강도 결함이다.**
   */
  it('개별 값과 이름 있는 객체는 안 잡는다 - 알고 그렇다', () => {
    expect(refParams("t('x', props.params)")).toEqual([])
    expect(refParams("t('x', { count: props.count })")).toEqual([])
  })

  it('화면 어디에도 그 모양이 없다', () => {
    const offenders = vueFiles(SRC).flatMap((path) =>
      refParams(sourceOf(path)).map((hit) => `${path}: ${hit}`),
    )
    expect(offenders).toEqual([])
  })
})

/**
 * **화면은 스토어에 함수로 쓴다** (architecture.md §8.10.3).
 *
 * 파일을 통째로 넘기면 그 값은 **부르는 쪽이 언제 읽었는지**에 달린다. 긴 비동기를 여는
 * 함수는 시작할 때 `project.file`을 붙들고 끝에 그 스냅샷의 파생물을 쓰므로, 그 사이
 * 학생이 한 일이 사라진다 — 예측이 도는 동안 놓은 사진, 백본을 받는 동안 뺀 모델
 * (2026-09-02 R20 A-2·A-3에서 실측).
 *
 * **`await`를 건너는 자리만 고르지 않는다.** 그 판정은 사람이 해야 하고, 사람은 틀린다 —
 * 이 저장소에서 실제로 **한 자리만 고쳐진 채 넷이 남아 있었다.** 모양을 하나로 두면
 * 다섯째 자리가 생기는 날 그 자리도 안전하다.
 *
 * 동기 경로에서는 두 모양이 같은 값을 낸다. **그래서 이 규칙은 손해가 없다.**
 */
describe('화면은 스토어에 함수로 쓴다', () => {
  const WRITE = /project\.(?:save|update)\(/g
  /** `(live) => …`나 `live => …`로 시작하는가. 이름은 안 본다. */
  const RECIPE = /^project\.(?:save|update)\(\s*(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*=>/

  /** 파일 통째로 넘기는 자리들. **주석과 문자열이 아니라 코드만 본다.** */
  function snapshotWrites(source: string): string[] {
    const code = withoutComments(source).join('\n')
    const found: string[] = []
    for (const match of code.matchAll(WRITE)) {
      const rest = code.slice(match.index)
      if (!RECIPE.test(rest)) found.push(rest.slice(0, 60).split('\n')[0] ?? '')
    }
    return found
  }

  /**
   * **검사기를 먼저 검사한다.** 정규식이 아무것도 안 잡으면서 초록인 것이 제일 나쁜
   * 상태다 — 이 파일의 머리말이 그것을 말한다.
   */
  it('통째로 넘기는 모양을 실제로 잡는다', () => {
    expect(snapshotWrites('await project.save(applied.project)')).toHaveLength(1)
    expect(snapshotWrites('project.update({ ...file, document: next })')).toHaveLength(1)
    // 함수로 넘긴 것은 안 잡는다 — 한 줄로도, 줄을 바꿔서도.
    expect(snapshotWrites('await project.save((live) => addImages(live))')).toEqual([])
    expect(snapshotWrites('project.update(\n  (live) => ({ ...live }),\n)')).toEqual([])
    // 주석 안의 예문은 코드가 아니다.
    expect(snapshotWrites('// project.save(applied.project)')).toEqual([])
  })

  /**
   * **함수 참조도 잡는다. 알고 그렇다.** 이름만으로는 값인지 함수인지 못 가르고, 가르려
   * 들면 타입 정보가 필요하다. 그래서 `ImagePanel.save`가 받은 함수를 `(live) => next(live)`로
   * 한 번 더 감싼다 — **규칙을 위한 규칙이 맞다**(R21 C-3). 값이 같고 한 줄이라 치르는
   * 값이 없어 그대로 둔다.
   */
  it('함수 참조를 값과 못 가른다 - 감싸는 이유가 그것이다', () => {
    expect(snapshotWrites('await project.save(next)')).toHaveLength(1)
    expect(snapshotWrites('await project.save((live) => next(live))')).toEqual([])
  })

  it('화면과 부품 어디에도 통째로 넘기는 자리가 없다', () => {
    const offenders = vueFiles(SRC).flatMap((path) =>
      snapshotWrites(sourceOf(path)).map((line) => `${path}: ${line}`),
    )
    expect(offenders).toEqual([])
  })
})

/**
 * **화면은 도는 일을 셈으로 든다** (architecture.md §8.10.4).
 *
 * 겹침을 허용한 뒤로(§8.10.3) **칸 하나짜리 상태는 전부 주인이 둘이 됐다.** `busy`가
 * boolean이면 굽는 중에 들어온 읽기가 자기 `finally`에서 **굽는 중인 자물쇠를 열고**,
 * 손잡이가 칸 하나면 먼저 끝난 쪽이 **남의 손잡이를 지워** 떠날 때 워커가 한쪽만 끊긴다.
 * R21 감사가 화면 넷에서 실측했다.
 *
 * **타입이 절반을 막는다** — `useWork()`의 `busy`는 `ComputedRef`라 값을 못 쓴다.
 * 여기서 막는 것은 **그 앞 단계**다: 화면이 자기 boolean과 자기 손잡이 칸을 다시
 * 만드는 것. (그 타입이 정말 서는지는 `useWork.spec.ts`가 `@ts-expect-error`로 지킨다 —
 * `Ref<boolean>`을 돌려주던 동안 이 문장은 **거짓이었다**, 2026-09-02 R22 A-2.)
 *
 * **이 그물이 못 보는 것 셋.** 규칙에 못 보는 것을 안 적으면 다음 사람이 그물을 방패로
 * 읽는다:
 *
 * - **다른 이름의 칸.** `const baking = ref(false)`는 안 걸린다. 이름을 고르는 사람을
 *   막을 방법이 없어서, 그 뒤는 화면을 띄워 재는 검사들이 받는다
 *   (`image-panel-drop`·`image-prep-drop`·`tabular-panel-overlap`·`image-predict-race`).
 * - **`ref`가 아닌 손잡이.** `let handle: Cancellable | null = null`은 그물 밖이다.
 *   아래 `SPAWNS` 규칙이 `.hold(`를 요구해 그 자리를 대신 좁힌다.
 * - **간접으로 워커를 여는 화면.** `TrainView`는 `trainingSourceOf`를 거치므로
 *   `SPAWNS`에 안 걸리고 **아래 두 규칙이 통째로 면제다.** 그 화면의 손잡이와 취소
 *   삼킴은 `train-preparing.spec.ts`와 `train-preparing-live.spec.ts`가 따로 잰다.
 */
describe('화면은 도는 일을 셈으로 든다', () => {
  const VIEWS = join(SRC, 'views')

  /**
   * 화면이 스스로 든 바쁨 boolean. 이름이 `busy`인 것만 본다 — 그것이 이 저장소의 말이다.
   *
   * **`let`과 타입 주석까지 본다** (2026-09-02 R22 C-4). `const busy =`만 보던 때는
   * `let busy = ref(false)`와 `const busy: Ref<boolean> = ref(false)`가 **그대로
   * 빠져나갔다** — 같은 병을 두 글자 차이로 다시 만들 수 있었다.
   */
  const OWN_BUSY = /(?:const|let)\s+busy\s*(?::[^=]+)?=\s*(?:shallowRef|ref)\s*[(<]/
  /** 끊을 것을 담아 둔 칸. `ref`에 담으면 주인이 하나뿐이라는 가정이 박힌다. */
  const OWN_HANDLE = /(?:const|let)\s+\w*[Rr]unning\s*(?::[^=]+)?=\s*(?:shallowRef|ref)\s*[(<]/

  function ownsWorkState(source: string): string[] {
    const code = withoutComments(source).join('\n')
    return code
      .split('\n')
      .filter((line) => OWN_BUSY.test(line) || OWN_HANDLE.test(line))
      .map((line) => line.trim())
  }

  /** 워커를 여는 화면들. **이들은 끊을 것을 일에 맡겨야 한다.** */
  const SPAWNS = /\b(?:canonicalizeImages|embedImages)\s*\(/

  it('검사기가 화면이 스스로 든 것을 잡는다', () => {
    expect(ownsWorkState('const busy = ref(false)')).toHaveLength(1)
    expect(ownsWorkState('const busy = shallowRef(false)')).toHaveLength(1)
    expect(ownsWorkState('const running = ref<CanonicalizeHandle | null>(null)')).toHaveLength(1)
    // **두 글자 차이로 빠져나가던 모양들** (2026-09-02 R22 C-4).
    expect(ownsWorkState('let busy = ref(false)')).toHaveLength(1)
    expect(ownsWorkState('const busy: Ref<boolean> = ref(false)')).toHaveLength(1)
    expect(ownsWorkState('let running: Ref<Handle | null> = shallowRef(null)')).toHaveLength(1)
    // `useWork()`에서 받아 오는 것은 잡지 않는다.
    expect(ownsWorkState('const { busy, start } = useWork()')).toEqual([])
    // 주석 속의 옛 모양은 코드가 아니다 — 이 파일의 머리말이 그 이유다.
    expect(ownsWorkState('// const busy = ref(false)')).toEqual([])
    // 다른 이름의 boolean은 이 규칙의 대상이 아니다(대화상자 플래그가 그렇다).
    expect(ownsWorkState('const deleting = ref(false)')).toEqual([])
    // **`ref`가 아닌 것도 아니다.** 손잡이를 그냥 변수로 드는 것은 이 그물 밖이다.
    expect(ownsWorkState('let preparingHandle: Cancellable | null = null')).toEqual([])
  })

  /**
   * **부품도 훑는다.** 화면만 보던 때는 `src/components/**`가 통째로 면제였는데, 그
   * 면제의 실제 이유는 `AppButton`의 boolean `running` 하나뿐이었다 — 다른 부품이 같은
   * 칸을 들어도 아무도 안 봤다 (2026-09-02 R22 C-4).
   *
   * **`AppButton`은 경로로 면제한다.** 그 `running`은 **한 버튼이 자기 동작이 도는지**
   * 아는 칸이라 화면의 겹침과 무관하고, 그것이 없으면 `action`이 두 번 눌리는 것을
   * 못 막는다 (CLAUDE.md §4).
   */
  const OWN_STATE_EXEMPT = 'AppButton.vue'

  it('화면과 부품 어디에도 자기 바쁨과 자기 손잡이 칸이 없다', () => {
    const scanned = [...vueFiles(VIEWS), ...vueFiles(join(SRC, 'components'))].filter(
      (path) => !path.endsWith(OWN_STATE_EXEMPT),
    )
    // **면제가 실제로 무언가를 빼고 있는지 본다.** 파일이 안 늘면 이 규칙이 죽은 것이다.
    expect(scanned.length).toBeGreaterThan(vueFiles(VIEWS).length)

    const offenders = scanned.flatMap((path) =>
      ownsWorkState(sourceOf(path)).map((line) => `${path}: ${line}`),
    )
    expect(offenders).toEqual([])
  })

  it('면제한 부품은 실제로 그 칸을 들고 있다 - 면제가 낡으면 여기서 선다', () => {
    const button = vueFiles(join(SRC, 'components')).find((path) => path.endsWith(OWN_STATE_EXEMPT))
    expect(button).toBeDefined()
    expect(ownsWorkState(sourceOf(button ?? ''))).toHaveLength(1)
  })

  it('워커를 여는 화면은 끊을 것을 일에 맡기고 떠날 때 전부 끊는다', () => {
    const opens = vueFiles(VIEWS).filter((path) =>
      SPAWNS.test(withoutComments(sourceOf(path)).join('\n')),
    )
    // **검사할 화면을 실제로 찾는다.** 0개면 이 규칙이 죽은 것이다.
    expect(opens.length).toBeGreaterThan(0)

    for (const path of opens) {
      const code = withoutComments(sourceOf(path)).join('\n')
      expect(code, `${path}: handle is not held by a job`).toMatch(/\.hold\(/)
      // **`retire()`도 받는다** — 떠날 때 부르는 것은 이제 그쪽이고, 그 안에서
      // `cancelAll()`이 돈다 (2026-09-02 R23 B-2). 화면이 [취소]를 갖고 있으면
      // `cancelAll`도 함께 있다.
      expect(code, `${path}: leaving does not cancel every job`).toMatch(/cancelAll|retire/)
    }
  })

  /**
   * **끊은 것을 실패로 말하지 않는다.** 손잡이를 맡기는 순간 떠나기가 워커를 끊고, 그
   * 거절(`JOB_CANCELLED`)이 굽기의 `catch`로 온다. 삼키지 않으면 **다음 화면에 빨간
   * 알림이 뜨고, 그 문구는 "학습을 멈췄습니다"다** — 굽기는 학습이 아니고 전처리 화면은
   * 학습 화면도 아니다.
   *
   * **R21이 이 자리를 만들었다.** `ImagePrepPanel`은 손잡이를 버리고 있어서 취소가 아예
   * 안 일어났고, 위 규칙을 세워 손잡이를 맡기게 하자 **거절이 처음으로 도착했다.**
   * 이웃 넷은 전부 삼키고 있었고 그 하나만 안 삼켰다 — **사람이 자리마다 판정하면 틀린다.**
   */
  it('워커를 여는 화면은 취소를 실패로 말하지 않는다', () => {
    const opens = vueFiles(VIEWS).filter((path) =>
      SPAWNS.test(withoutComments(sourceOf(path)).join('\n')),
    )
    expect(opens.length).toBeGreaterThan(0)

    for (const path of opens) {
      const code = withoutComments(sourceOf(path)).join('\n')
      expect(code, `${path}: cancellation is reported as a failure`).toMatch(/JOB_CANCELLED/)
    }
  })
})
