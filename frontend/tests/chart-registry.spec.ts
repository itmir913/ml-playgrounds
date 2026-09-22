/**
 * 그림 부품이 **자기 설정이 부르는 Chart.js 눈금을 등록했는가.**
 *
 * **2026-09-22에 이 이음매가 끊겨 있었다.** 히스토그램에 로그 축을 붙이면서 옵션에
 * `type: 'logarithmic'`을 적었는데 `Chart.register`에 `LogarithmicScale`을 안 넣었다 —
 * 브라우저에서 `"logarithmic" is not a registered scale`로 죽고 **그림이 통째로 사라졌다.**
 *
 * **그런데 검사는 전부 초록이었다.** `chart-config.spec.ts`가 옵션 객체를 물지만 등록은
 * **다른 파일의 일**이고, 그 둘을 잇는 검사가 없었다 — 조각마다 초록인데 길이 끊긴
 * 모양이다.
 *
 * **왜 소스를 읽는가.** `<script setup>`의 최상위 코드는 **import가 아니라 setup에서**
 * 돈다. 부품을 들이는 것만으로는 `Chart.register`가 안 돌고, 돌게 하려면 i18n·배색·
 * 데이터셋을 갖춘 마운트가 필요하다 — **그 준비물이 정작 재려는 것(등록 한 줄)보다 크다.**
 * 그래서 `ui-rules.spec.ts`와 같은 방식으로 소스를 읽는다.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { sourceFiles } from './fixtures/source'

const SRC = join(process.cwd(), 'src')
if (!existsSync(SRC)) throw new Error(`src not found: ${SRC}`)

/** 경로 하나를 글자로 읽는다. 주석은 여기서 안 걷는다 — 아래 둘 다 코드 모양만 본다. */
function read(path: string): string {
  return readFileSync(path, 'utf-8')
}

/**
 * 눈금 이름 → 등록해야 하는 클래스.
 *
 * **Chart.js의 이름 규칙이지 우리 것이 아니다.** 여기 없는 이름이 설정에 나타나면 아래
 * 검사가 **모른다고 울고**, 그때 할 일은 이 표에 한 줄을 더하는 것이다 — 조용히 넘기면
 * 그 축이 등록됐는지 아무도 안 본다.
 */
const SCALE_CLASS: Readonly<Record<string, string>> = {
  category: 'CategoryScale',
  linear: 'LinearScale',
  logarithmic: 'LogarithmicScale',
  time: 'TimeScale',
  radialLinear: 'RadialLinearScale',
}

/** 설정 파일이 부르는 눈금 이름들. `type: '<이름>'` 한 표기만 본다. */
function scaleTypesIn(source: string): string[] {
  return [...source.matchAll(/type:\s*'(\w+)'/g)].map((match) => match[1] as string)
}

/** 한 부품이 `Chart.register(...)`에 넣은 이름들. */
function registeredIn(source: string): string[] {
  const call = /Chart\.register\(([^)]*)\)/s.exec(source)
  return call === null
    ? []
    : (call[1] as string)
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== '')
}

describe('그림이 쓰는 눈금이 등록돼 있다', () => {
  const all = sourceFiles(SRC)
  const configPath = all.find((path) => path.endsWith(join('data', 'chart-config.ts')))
  // **경로 구분자가 운영체제마다 다르다.** 윈도는 `\`이고, 한쪽만 보면 그 기계에서만
  // 검사가 돈다 — 찾은 것이 0개인데 조용히 통과하는 모양이다.
  const chartPaths = all.filter((path) => /[\\/]charts[\\/]\w+Chart\.vue$/.test(path))
  const config = configPath === undefined ? '' : read(configPath)

  it('설정 파일과 그림 부품을 실제로 찾았다', () => {
    expect(configPath, 'chart-config.ts must be scanned').toBeDefined()
    expect(chartPaths.length, 'chart components must be scanned').toBeGreaterThan(0)
  })

  /**
   * **이름이 표에 없으면 판정을 못 한다.** 새 축을 들이면서 표를 안 고치면 이 검사가
   * 조용히 통과하는 것이 아니라 여기서 선다.
   */
  it('설정이 부르는 이름을 전부 안다', () => {
    const unknown = scaleTypesIn(config).filter((name) => !(name in SCALE_CLASS))
    expect(unknown, 'add the scale to SCALE_CLASS so the check below can judge it').toEqual([])
  })

  /**
   * **그 축을 켤 수 있는 부품이 그 축을 등록한다.**
   *
   * **부품마다 켤 수 있는 것이 다르다** — 막대그래프는 `barOptions`를 쓰지만 로그를 안
   * 켜고, 히스토그램만 켠다. 그래서 *"이 설정이 낼 수 있는 축 전부"*를 모두에게 요구하면
   * **쓰지도 않는 것을 등록하라는 말**이 되고, 그 등록 줄은 다음 사람에게 거짓말이 된다.
   *
   * **판정은 이름으로 한다.** 부품이 `logarithmic`이라는 이름을 자기 소스에서 말한다면
   * 그 축을 켤 수 있다는 뜻이다 — 실제로 끊겼던 자리가 정확히 그 모양이었다(플래그는
   * 있고 등록만 없었다). 나중에 막대그래프가 같은 손잡이를 갖는 날에도 이름이 함께
   * 들어오므로 이 검사가 따라간다.
   */
  it('그 축을 켤 수 있는 부품이 그 축을 등록한다', () => {
    const known = [...new Set(scaleTypesIn(config))]
    expect(known, 'chart-config must ask for a logarithmic scale').toContain('logarithmic')

    const missing: string[] = []
    for (const path of chartPaths) {
      const text = read(path)
      const registered = registeredIn(text)
      for (const name of known) {
        if (!new RegExp(`\\b${name}\\b`).test(text)) continue
        const cls = SCALE_CLASS[name] as string
        if (!registered.includes(cls)) missing.push(`${path}: ${cls}`)
      }
    }
    expect(missing, 'register the scale this chart can switch on').toEqual([])
  })

  /** **검사기가 실제로 무는지 본다.** 안 그러면 위 검사가 무엇을 읽든 말이 없다. */
  it('검사기가 빠진 등록을 잡는다', () => {
    expect(registeredIn('Chart.register(BarController, LinearScale)')).toEqual([
      'BarController',
      'LinearScale',
    ])
    expect(registeredIn('등록이 없는 파일')).toEqual([])
    expect(scaleTypesIn("y: { type: 'logarithmic' }")).toEqual(['logarithmic'])
  })
})
