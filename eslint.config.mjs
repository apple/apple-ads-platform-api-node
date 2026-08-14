import licenseHeader from 'eslint-plugin-license-header';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'src/api/**',
      'src/model/**',
      'src/base.ts',
      'src/common.ts',
      'src/configuration.ts',
    ],
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parser: tsParser,
    },
    plugins: {
      'license-header': licenseHeader,
    },
    rules: {
      'license-header/header': ['error', './LICENSE_HEADER.txt'],
    },
  },
];