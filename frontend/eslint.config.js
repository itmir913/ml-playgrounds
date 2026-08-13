import pluginVue from 'eslint-plugin-vue'
import vueTsEslintConfig from '@vue/eslint-config-typescript'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'

export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  ...pluginVue.configs['flat/recommended'],
  ...vueTsEslintConfig(),
  skipFormatting,
  {
    rules: {
      // CLAUDE.md 4: any 금지. 불가피하면 이유를 주석으로 남긴다.
      '@typescript-eslint/no-explicit-any': 'error',
      // import을 빠뜨린 컴포넌트는 **조용히 평문이 된다** - 태그가 그대로 남아 슬롯
      // 내용만 흐르고 props도 이벤트도 안 걸린다. 실제로 예측 화면의 동작 바가
      // 그렇게 나갔다(2026-08-14). 타입 검사도 검사 파일도 이것을 못 봤다.
      // vue-router가 전역으로 등록하는 둘만 빼 준다.
      'vue/no-undef-components': ['error', { ignorePatterns: ['RouterView', 'RouterLink'] }],
    },
  },
]
