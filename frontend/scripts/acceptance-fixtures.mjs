// 인수 테스트용 데이터를 만든다 → docs/acceptance.md
// 사용: node frontend/scripts/acceptance-fixtures.mjs <outDir> [--images N] [--classes N] [--rows N] [--seed N]
// 같은 seed면 같은 파일이 나온다.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'

const args = process.argv.slice(2)
const outDir = args[0]
if (!outDir || outDir.startsWith('--')) {
  console.error(
    'usage: acceptance-fixtures.mjs <outDir> [--images N] [--classes N] [--rows N] [--seed N]',
  )
  process.exit(1)
}
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : Number(args[i + 1])
}
const nImages = opt('images', 12)
const nClasses = Math.min(10, opt('classes', 3))
const nRows = opt('rows', 120)
const seed = opt('seed', 42)

function mulberry32(a) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(seed)

// 표: 숫자 열 둘 · 범주 열 하나 · 빈칸 몇 개 · 목표 열
const colors = ['red', 'green', 'blue']
const lines = ['height,weight,color,label']
for (let i = 0; i < nRows; i++) {
  const h = 140 + rand() * 50
  const w = 35 + (h - 140) * 0.6 + rand() * 10
  const c = colors[Math.floor(rand() * colors.length)]
  const label = w > 55 ? 'big' : 'small'
  const cell = (v) => (rand() < 0.05 ? '' : v)
  lines.push([cell(h.toFixed(1)), cell(w.toFixed(1)), cell(c), label].join(','))
}
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'table.csv'), lines.join('\n') + '\n')

// 이미지: MNIST를 흉내 낸 28x28 흑백 숫자. 획의 위치·굵기·기울기를 흔들고 잡음을 얹는다.
const SIZE = 28
// 일곱 획(위·왼위·오른위·가운데·왼아래·오른아래·아래)의 양 끝, 10x16 틀 기준
const SEGMENTS = [
  [
    [0, 0],
    [10, 0],
  ],
  [
    [0, 0],
    [0, 8],
  ],
  [
    [10, 0],
    [10, 8],
  ],
  [
    [0, 8],
    [10, 8],
  ],
  [
    [0, 8],
    [0, 16],
  ],
  [
    [10, 8],
    [10, 16],
  ],
  [
    [0, 16],
    [10, 16],
  ],
]
const DIGITS = [
  '1110111',
  '0010010',
  '1011101',
  '1011011',
  '0111010',
  '1101011',
  '1101111',
  '1010010',
  '1111111',
  '1111011',
]

function drawDigit(d) {
  const px = new Float32Array(SIZE * SIZE)
  const scale = 0.9 + rand() * 0.3
  const slant = (rand() - 0.5) * 0.4
  const ox = 9 + (rand() - 0.5) * 4
  const oy = 6 + (rand() - 0.5) * 3
  const thick = 1.3 + rand() * 0.9
  const map = ([x, y]) => [ox + (x + slant * (16 - y)) * scale, oy + y * scale]
  DIGITS[d].split('').forEach((on, s) => {
    if (on !== '1') return
    const [a, b] = SEGMENTS[s].map(map)
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const t = Math.max(
          0,
          Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)),
        )
        const dist = Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy)
        const v = Math.max(0, Math.min(1, thick - dist + 0.5))
        px[y * SIZE + x] = Math.max(px[y * SIZE + x], v)
      }
    }
  })
  return px.map((v) => Math.max(0, Math.min(255, Math.round(v * 255 + (rand() - 0.5) * 40))))
}

function png(gray) {
  const raw = Buffer.alloc((SIZE + 1) * SIZE)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) raw[y * (SIZE + 1) + 1 + x] = gray[y * SIZE + x]
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0)
  ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8 // 비트 깊이
  ihdr[9] = 0 // 흑백
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (let d = 0; d < nClasses; d++) {
  const dir = join(outDir, 'images', String(d))
  mkdirSync(dir, { recursive: true })
  for (let i = 0; i < nImages; i++) {
    writeFileSync(join(dir, `${d}-${String(i).padStart(3, '0')}.png`), png(drawDigit(d)))
  }
}
console.log(
  `wrote ${nRows} rows and ${nImages * nClasses} images (${nClasses} digits) to ${outDir}`,
)
