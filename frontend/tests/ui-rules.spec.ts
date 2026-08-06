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
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

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
