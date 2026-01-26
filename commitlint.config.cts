import type { UserConfig } from '@commitlint/types'

const config: UserConfig = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'chore', 'revert', 'ci', 'build'],
    ],
    'subject-empty': [2, 'never'],
    'subject-case': [0],
    'body-leading-blank': [2, 'always'],
    'body-max-line-length': [0],
    'footer-leading-blank': [2, 'always'],
    'header-max-length': [2, 'always', 100],
  },
}

export default config
