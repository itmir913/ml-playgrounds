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

/** 정규식과 예문 안에 그대로 못 적는다 - 이 파일 자신이 검사 대상이라 조립 자리로 읽힌다. */
const BACKTICK = String.fromCharCode(96)

const SRC = join(process.cwd(), 'src')
if (!existsSync(SRC)) throw new Error(`src를 찾지 못했다: ${SRC}`)

interface Rule {
  readonly name: string
  readonly why: string
  readonly pattern: RegExp
  /** 패턴이 걸린 뒤 한 번 더 거르는 조건. 없으면 패턴이 곧 위반이다. */
  readonly only?: (line: string) => boolean
  readonly violations: readonly string[]
  readonly allowed: readonly string[]
}

const RULES: readonly Rule[] = [
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
    pattern: /<AppTable[^>]*\sclass="[^"]*(?<![\w-])h-full\b/,
    violations: ['<AppTable class="h-full">', '<AppTable v-if="shown" class="mt-2 h-full">'],
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
    pattern: new RegExp(
      `t\\(${BACKTICK}(tasks\\.\\$\\{|steps\\.\\$\\{[^${BACKTICK}]*\\}\\.(purpose|locked)${BACKTICK})`,
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
  },
]

function hits(rule: Rule, line: string): boolean {
  return rule.pattern.test(line) && (rule.only?.(line) ?? true)
}

/**
 * `<AppButton ... @click="이름">`인데 그 `이름`이 같은 파일의 `async function`인 경우.
 *
 * **오래 걸리는 일은 `action`으로 줘야 버튼이 스스로 꺼진다**(CLAUDE.md §4).
 * `@click`은 리스너의 반환값을 기다려 주지 않으므로 두 번 눌리는 것을 못 막는다.
 */
function unguardedButtons(source: string): string[] {
  const asyncNames = new Set(
    [...source.matchAll(/async function (\w+)/g)].map((match) => match[1] ?? ''),
  )
  const template = source.slice(source.indexOf('<template>'))
  return [...template.matchAll(/<AppButton[^>]*?@click="(\w+)"/gs)]
    .map((match) => match[1] ?? '')
    .filter((name) => asyncNames.has(name))
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
  const radios = [...template.matchAll(/<input\b[^>]*\btype="radio"[^>]*\/?>/gs)].map(
    (match) => match[0],
  )
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
    [...script.matchAll(/function (\w+)\([^)]*\)[^{]*\{\n([\s\S]*?)\n\}/g)]
      .filter((match) => /\brequest[A-Z]\w*\(/.test(match[2] ?? ''))
      .map((match) => match[1] ?? ''),
  )

  const violations: string[] = []
  for (const tags of groups.values()) {
    const changeHandlers = tags
      .map((tag) => /@change="(\w+)"/.exec(tag)?.[1])
      .filter((name): name is string => !!name)
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
    [...script.matchAll(/function (\w+)\(([^)]*)\)[^{]*\{\n([\s\S]*?)\n\}/g)]
      .filter((match) => {
        const params = match[2] ?? ''
        const body = match[3] ?? ''
        if (/\.checked\s*=|\.resync\(/.test(body)) return true
        // 인자로 받든(`input: HTMLInputElement`) 몸통에서 캐스팅하든
        // (`event.target as HTMLInputElement`) 둘 다 요소를 손에 쥔 것이다.
        return /HTMLInputElement/.test(params + body) && /\.value\s*=/.test(body)
      })
      .map((match) => match[1] ?? ''),
  )

  // 몸통이 `emit(...)` 하나뿐인 함수들. 값을 고치지 않고 그대로 올려보내는 자리다.
  const forwarding = new Set(
    [...script.matchAll(/function (\w+)\(([^)]*)\)[^{]*\{\n([\s\S]*?)\n\}/g)]
      .filter((match) => /^\s*emit\([^;]*\)\s*$/.test(match[3] ?? ''))
      .map((match) => match[1] ?? ''),
  )

  return (
    [...template.matchAll(/<input\b[^>]*>/gs)]
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
 */
function unbadgedMetaNames(source: string): string[] {
  const template = source.slice(source.indexOf('<template>'))
  const groups = [
    ...template.matchAll(/<div class="flex[^"]*gap-1\.5">\s*(<dt[^>]*>[\s\S]*?<\/dt>)/g),
  ]
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
  return [...source.matchAll(/<span[^>]*aria-hidden="true">\s*·\s*<\/span>/g)].map(
    (match) => match[0],
  )
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
 * 주석을 걷어낸 줄들. 규칙을 설명하려면 금지된 모양을 주석에 적어야 하는데,
 * 그것까지 걸리면 문서를 못 쓴다. `.vue`에는 HTML 주석과 JS 주석이 함께 있다.
 */
function withoutComments(source: string): string[] {
  const stripped = source.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  return stripped.split(/\r?\n/).map((line) => line.replace(/\/\/.*$/, ''))
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

  /** VARIANTS 표의 `이름: '클래스들'` 줄만 뽑는다. */
  function variantClasses(source: string): [string, string][] {
    const table = source.slice(source.indexOf('const VARIANTS'))
    return [...table.slice(0, table.indexOf('}')).matchAll(/(\w+):\s*'([^']*)'/g)].map((match) => [
      match[1] ?? '',
      match[2] ?? '',
    ])
  }

  it('검사기가 표를 실제로 읽는다', () => {
    const names = variantClasses(SOURCE).map(([name]) => name)
    expect(names).toContain('primary')
    expect(names).toContain('ghost')
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
    return [...block.matchAll(/^ {2}<([A-Za-z][\w-]*)([^>]*)>/gm)].map((match) => ({
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

  it('지금 소스에 안 막힌 버튼이 없다', () => {
    const found = vueFiles(SRC).flatMap((path) =>
      unguardedButtons(readFileSync(path, 'utf-8')).map(
        (name) => `${path.slice(SRC.length + 1)}  ${name}`,
      ),
    )
    expect(found).toEqual([])
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
})

describe('지금 화면 코드에 위반이 없다', () => {
  for (const rule of RULES) {
    it(`${rule.name} — ${rule.why}`, () => {
      const found: string[] = []
      for (const path of vueFiles(SRC)) {
        withoutComments(readFileSync(path, 'utf-8')).forEach((line, index) => {
          if (hits(rule, line)) {
            found.push(`${path.slice(SRC.length + 1)}:${index + 1}  ${line.trim()}`)
          }
        })
      }
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
 * 실제로 그 자리가 둘 있었다 — 평가용 파일의 `accept`와 시트 고르기가 종류를 모르는
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
  const KIND_AWARE = /from '@\/(data|ml)\/(?!kinds')|from '@\/project\/(dataset|images)'/

  it('목록의 화면이 실제로 있다 - 없으면 아래가 조용히 통과한다', () => {
    const names = vueFiles(SRC).map((path) => path.split(SEPARATOR).pop())
    for (const screen of KIND_AGNOSTIC) expect(names, screen).toContain(screen)
  })

  it('종류를 아는 계층(@/data/*, @/ml/*, @/project/dataset, @/project/images)을 import하지 않는다', () => {
    const found = vueFiles(SRC)
      .filter((path) => KIND_AGNOSTIC.includes(path.split(SEPARATOR).pop() ?? ''))
      .flatMap((path) =>
        readFileSync(path, 'utf-8')
          .split(NEWLINE)
          .filter((line) => KIND_AWARE.test(line))
          .map((line) => `${path.slice(SRC.length + 1)}  ${line.trim()}`),
      )
    expect(found, '종류를 아는 계층은 등록부에서 꺼낸 판이 부른다').toEqual([])
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
