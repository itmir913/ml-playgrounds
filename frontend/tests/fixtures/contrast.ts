/**
 * 색 대비를 재는 계산.
 *
 * **CSS 두 파일에서 값을 읽어 WCAG 식으로 잰다.** 값의 사본을 검사에 적지 않는다 - 사본은 CSS가
 * 바뀌어도 초록으로 남는다. `theme.spec.ts`(흐린 글자)와 `flow-contrast.spec.ts`(흐름도의 색)가
 * 같은 계산을 부른다.
 *
 * **`color-mix(in srgb, …)`의 계산기를 함께 둔다.** 흐름도의 색은 토큰을 섞어 만들므로(`utilities.css`의
 * `flow-*`) 토큰만 재서는 화면에 나오는 색을 못 잰다. `in srgb`는 감마가 입혀진 채널 값을 그대로
 * 섞는다 - 선형으로 바꾸지 않는다. 불투명한 색만 다룬다(섞는 상대가 `transparent`면 바탕 위에
 * 얹는 것과 같은 식이다).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 색 하나. 채널은 0~255. */
export type Rgb = readonly [number, number, number]

/** `src/styles/<file>`에서 `--color-<name>: #rrggbb;` 한 줄의 값을 읽는다. 없으면 던진다. */
export function token(file: string, name: string): string {
  const css = readFileSync(join(process.cwd(), 'src', 'styles', file), 'utf-8')
  const found = new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6});`).exec(css)
  if (!found?.[1]) throw new Error(`token not found: ${file} ${name}`)
  return found[1]
}

export function parseHex(hex: string): Rgb {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`not a #rrggbb color: ${hex}`)
  return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as unknown as Rgb
}

export function toHex(color: Rgb): string {
  return `#${color.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`
}

/** WCAG 2.x 상대 휘도. */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((raw) => {
    const channel = raw / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/** 두 색의 대비 비. 순서는 상관없다. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light! + 0.05) / (dark! + 0.05)
}

/**
 * `color-mix(in srgb, <first> <firstPercent>%, <second>)`의 결과.
 *
 * 둘째 색의 몫은 `100 - firstPercent`다. 채널은 감마가 입혀진 값 그대로 섞고, 브라우저가 8비트로
 * 내릴 때처럼 반올림한다.
 */
export function mixSrgb(first: string, firstPercent: number, second: string): string {
  if (firstPercent < 0 || firstPercent > 100)
    throw new Error(`percent out of range: ${firstPercent}`)
  const share = firstPercent / 100
  const a = parseHex(first)
  const b = parseHex(second)
  return toHex([0, 1, 2].map((at) => a[at]! * share + b[at]! * (1 - share)) as unknown as Rgb)
}
