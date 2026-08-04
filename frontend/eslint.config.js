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
    },
  },
]
