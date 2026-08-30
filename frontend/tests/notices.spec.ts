/**
 * **나가는 산출물에 남의 고지가 함께 가는가** (`open-decisions.md` "나눠 주는 남의
 * 코드는 산출물이 세어서 고지한다").
 *
 * **목록 자체는 여기서 안 본다.** 그것은 빌드가 실제 모듈 그래프를 세어 만들고,
 * 전문을 못 찾으면 그 자리에서 선다 (`scripts/notices.ts`). 여기가 보는 것은 **그
 * 장치가 기대는 손으로 적은 것 둘**이다 — 둘 다 조용히 썩는 종류다.
 *
 * 1. **저장소가 채운 전문이 아직 필요한가.** 패키지가 스스로 전문을 들고 오기
 *    시작하면 `SUPPLIED`의 그 줄은 죽은 줄이고, 그때부터 우리는 **옛 전문을**
 *    싣는다. 빌드는 아무 말도 안 한다 — 채운 것이 있으니 성공하기 때문이다.
 * 2. **`exceljs`가 구워 넣은 이름 목록이 실제와 같은가.** 그 묶음 파일은 손으로 만든
 *    것이고, exceljs를 올리면 안의 내용물이 바뀐다. 이름이 갈리는 순간 우리는
 *    **안 실린 것을 고지하고 실린 것을 빠뜨린다.**
 *
 * **허용 목록도 여기서 본다** (`open-decisions.md` "들어오는 라이선스는 허용 목록이
 * 막고, 나가는 PR은 템플릿이 묻는다"). 산출물에 실린 것을 실제로 세는 일은 빌드가
 * 하고, 여기가 보는 것은 **판정 자체**와 **목록의 모양**이다.
 *
 * **못 보는 것: SPDX 표기가 실제 전문과 맞는지.** `package.json`이 MIT이라 적고
 * LICENSE에 다른 것이 들어 있어도 기계는 모른다. 사람이 볼 자리다.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ALLOWED_SPDX,
  BUNDLED_INSIDE,
  MODELS,
  REQUIRED,
  SUPPLIED,
  SUPPLIED_DIR,
  packageFromId,
  readShipped,
  renderNotices,
  unallowed,
  type Shipped,
} from '../scripts/notices'
import { BACKBONES } from '../src/ml/backbones'

const NODE_MODULES = join(process.cwd(), 'node_modules')

function ownLicenseFile(name: string): string | undefined {
  const dir = join(NODE_MODULES, ...name.split('/'))
  if (!existsSync(dir)) return undefined
  return readdirSync(dir).find((entry) => /^(licen[cs]e|copying)/i.test(entry))
}

describe('저장소가 채운 전문', () => {
  it('채운 파일이 실제로 있다', () => {
    for (const file of [...Object.values(SUPPLIED), ...Object.values(BUNDLED_INSIDE)]) {
      expect(existsSync(join(SUPPLIED_DIR, file)), file).toBe(true)
    }
  })

  it('아직 필요하다 — 패키지가 스스로 들고 오기 시작하면 죽은 줄이다', () => {
    for (const name of Object.keys(SUPPLIED)) {
      expect(ownLicenseFile(name), `${name}이(가) 이제 스스로 전문을 들고 온다`).toBeUndefined()
    }
  })

  it('가리키는 패키지가 설치되어 있다', () => {
    for (const name of [...Object.keys(SUPPLIED), ...Object.keys(BUNDLED_INSIDE)]) {
      expect(existsSync(join(NODE_MODULES, ...name.split('/'))), name).toBe(true)
    }
  })

  /**
   * **빌드의 바닥이 가리키는 이름들이 아직 실재하는가.**
   *
   * `REQUIRED`는 수집이 통째로 실패했을 때 빌드를 세우는 목록이다. 그 이름이 저장소를
   * 떠나면 바닥이 **언제나 던지게** 되어 빌드가 못 돌고, 그러면 사람이 목록을 지우고
   * 싶어진다 — 지우면 바닥이 사라진다. 여기서 미리 운다.
   *
   * **산출물을 보지는 않는다.** 그건 이 파일이 안 하기로 한 일이고(머리말), 실제로
   * 실렸는지는 빌드가 센다.
   */
  it('빌드가 요구하는 이름들이 아직 설치되어 있다', () => {
    expect(REQUIRED.length).toBeGreaterThan(0)
    for (const name of REQUIRED) {
      expect(existsSync(join(NODE_MODULES, ...name.split('/'))), name).toBe(true)
    }
  })
})

describe('미리 빌드된 번들이 업고 오는 것', () => {
  /** 그 번들의 소스맵이 대는 이름들. 우리 목록의 정답지다. */
  function insideExceljs(): Set<string> {
    const map = JSON.parse(
      readFileSync(join(NODE_MODULES, 'exceljs/dist/exceljs.min.js.map'), 'utf8'),
    ) as { sources: string[] }
    const names = new Set<string>()
    for (const source of map.sources) {
      const name = packageFromId(source)
      if (name !== null) names.add(name)
    }
    return names
  }

  /**
   * 묶음 파일이 제목 줄로 대는 이름들.
   *
   * **줄 모양만 보고 고르면 안 된다** — 전문 안에도 `이름  (` 처럼 읽히는 줄이 있어
   * 처음에 `it.`이라는 패키지를 하나 지어냈다. 제목은 **줄자 두 줄 사이**에 있다.
   */
  function listedInBundleFile(): Set<string> {
    const file = BUNDLED_INSIDE.exceljs
    if (file === undefined) throw new Error('exceljs가 BUNDLED_INSIDE에서 사라졌다')
    const rule = '-'.repeat(80)
    const lines = readFileSync(join(SUPPLIED_DIR, file), 'utf8').split('\n')
    const names = new Set<string>()
    for (let i = 1; i < lines.length - 1; i += 1) {
      if (lines[i - 1] !== rule || lines[i + 1] !== rule) continue
      const name = lines[i]?.split('  ')[0]
      if (name !== undefined && name !== '') names.add(name)
    }
    return names
  }

  it('묶음 파일의 이름이 그 번들의 소스맵과 같다', () => {
    const actual = insideExceljs()
    const listed = listedInBundleFile()
    expect([...listed].sort()).toEqual([...actual].sort())
  })
})

describe('베낀 모델 목록', () => {
  it('등록부와 같은 말을 한다 — 원본은 backbones.ts의 credit이다', () => {
    expect(MODELS.map((model) => ({ ...model })).sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      BACKBONES.map((backbone) => ({
        id: backbone.id,
        holder: backbone.credit.holder,
        license: backbone.credit.license,
        url: backbone.modelUrl,
      })).sort((a, b) => a.id.localeCompare(b.id)),
    )
  })
})

describe('허용 목록', () => {
  function one(spdx: string | null): Shipped {
    return { name: 'somebody-elses-code', version: '1.0.0', spdx, text: 'license text' }
  }

  it('목록 안의 표기는 통과한다', () => {
    expect(unallowed([...ALLOWED_SPDX].map(one))).toEqual([])
  })

  it('표기가 없으면 걸린다 — 이름만 적고 넘어가지 않는다', () => {
    expect(unallowed([one(null)])).toHaveLength(1)
  })

  it('이중 라이선스 표현식은 걸린다 — 고르는 것은 사람의 결정이다', () => {
    expect(unallowed([one('(MIT OR GPL-3.0-or-later)')])).toHaveLength(1)
    expect(unallowed([one('MIT AND Zlib')])).toHaveLength(1)
  })

  it('목록에 카피레프트가 없다', () => {
    for (const id of ALLOWED_SPDX) {
      expect(id, id).not.toMatch(/GPL|MPL|EPL|CDDL|SSPL|CC-BY-SA/)
    }
  })

  it('저장소가 손으로 붙든 패키지들도 목록 안이다', () => {
    const names = [...Object.keys(SUPPLIED), ...Object.keys(BUNDLED_INSIDE)]
    expect(unallowed(names.map(readShipped)).map((shipped) => shipped.name)).toEqual([])
  })
})

describe('packageFromId', () => {
  it('절대 경로에서 뽑는다', () => {
    expect(packageFromId('C:/repo/frontend/node_modules/vue/dist/vue.js')).toBe('vue')
  })

  it('역슬래시 경로도 같다', () => {
    expect(packageFromId('C:\\repo\\node_modules\\vue\\dist\\vue.js')).toBe('vue')
  })

  it('앞의 빗금 없이 시작해도 뽑는다 — 자산의 원본 경로가 그 모양이다', () => {
    expect(packageFromId('node_modules/pretendard/dist/web/a.woff2')).toBe('pretendard')
  })

  it('묶음 이름은 두 칸을 함께 본다', () => {
    expect(packageFromId('node_modules/@tensorflow/tfjs-core/dist/index.js')).toBe(
      '@tensorflow/tfjs-core',
    )
  })

  it('중첩 설치는 안쪽이 답이다', () => {
    expect(packageFromId('node_modules/exceljs/node_modules/saxes/saxes.js')).toBe('saxes')
  })

  it('우리 소스는 아무것도 아니다', () => {
    expect(packageFromId('C:/repo/frontend/src/ml/backbones.ts')).toBeNull()
  })

  it('점으로 시작하는 자리는 패키지가 아니다 — .vite/deps 같은 것들', () => {
    expect(packageFromId('node_modules/.vite/deps/vue.js')).toBeNull()
  })

  it('이름에 node_modules가 섞인 디렉터리에 안 속는다', () => {
    expect(packageFromId('C:/repo/my-node_modules/thing/index.js')).toBeNull()
  })
})

describe('readShipped', () => {
  it('전문을 못 찾으면 던진다 — 조용히 빠지는 길이 없다', () => {
    expect(() => readShipped('this-package-does-not-exist')).toThrow(/No license text/)
  })

  it('패키지가 들고 온 전문을 읽는다', () => {
    const vue = readShipped('vue')
    expect(vue.spdx).toBe('MIT')
    expect(vue.text).toMatch(/Permission is hereby granted/)
  })

  it('안 들고 오는 것은 저장소가 채운 것으로 읽는다', () => {
    const font = readShipped('pretendard')
    expect(font.spdx).toBe('OFL-1.1')
    expect(font.text).toMatch(/Reserved Font Name 'Pretendard'/)
  })
})

describe('renderNotices', () => {
  const one: Shipped = { name: 'alpha', version: '1.0.0', spdx: 'MIT', text: 'ALPHA TEXT' }
  const two: Shipped = { name: 'beta', version: '2.0.0', spdx: 'ISC', text: 'SHARED TEXT' }
  const three: Shipped = { name: 'gamma', version: null, spdx: null, text: 'SHARED TEXT' }

  it('이름과 버전과 SPDX를 적는다', () => {
    const text = renderNotices([one], [])
    expect(text).toMatch(/alpha 1\.0\.0/)
    expect(text).toMatch(/MIT/)
    expect(text).toContain('ALPHA TEXT')
  })

  it('버전이나 SPDX가 없으면 그 사실을 적는다 — 모르는 것을 지어내지 않는다', () => {
    const text = renderNotices([three], [])
    expect(text).toMatch(/gamma\n/)
    expect(text).toMatch(/no license id declared/)
  })

  it('같은 전문은 한 벌만 싣고 이름을 나란히 적는다', () => {
    const text = renderNotices([one, two, three], [])
    expect(text.split('SHARED TEXT')).toHaveLength(2)
    expect(text).toContain('beta, gamma')
  })

  it('미리 빌드된 번들의 묶음을 뒤에 붙인다', () => {
    expect(renderNotices([one], ['BUNDLED BLOCK'])).toContain('BUNDLED BLOCK')
  })

  it('미리 학습된 모델을 적는다', () => {
    const text = renderNotices([one], [])
    for (const model of MODELS) {
      expect(text).toContain(model.id)
      expect(text).toContain(model.license)
      expect(text).toContain(model.holder)
      expect(text).toContain(model.url)
    }
  })

  it('우리 것은 MIT이라고 밝힌다 — 이 목록이 우리 라이선스로 읽히면 안 된다', () => {
    expect(renderNotices([one], [])).toMatch(/ML Playgrounds itself, which is MIT/)
  })
})
