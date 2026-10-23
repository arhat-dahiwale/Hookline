// @ts-check
/**
 * Root ESLint config for the whole monorepo.
 *
 * Includes the server module-boundary rules (ARCHITECTURE.md section 4):
 * a module under apps/server/src/modules/<m>/ may import another module only
 * through its public index (`../<m>` or `../<m>/index.js`). Deep imports into
 * another module are errors. `platform` is the shared kernel and may be
 * imported at any depth. packages/* and protocol layers are not restricted.
 */
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

const SERVER_MODULES = [
  'auth',
  'api-keys',
  'endpoints',
  'events',
  'deliveries',
  'delivery-engine',
  'realtime',
  'analytics',
  'audit',
  'health',
  'platform',
];

const moduleBoundaryRules = SERVER_MODULES.flatMap((moduleName) => {
  const otherModules = SERVER_MODULES.filter((m) => m !== moduleName && m !== 'platform');
  if (otherModules.length === 0) return [];
  return [
    {
      files: [`apps/server/src/modules/${moduleName}/**/*.ts`],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                // `../<other>/...` or `../../<other>/...` (deep import). The bare
                // `../<other>` (public index) does not match because it has no
                // trailing slash + path segment.
                regex: String.raw`(\.\./)+(${otherModules.join('|')})/`,
                message: `Module "${moduleName}" may import other modules only via their public index.ts (e.g. ../${otherModules[0]}), never deep imports. See ARCHITECTURE.md section 4.`,
              },
            ],
          },
        ],
      },
    },
  ];
});

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.turbo/**',
      'packages/proto/generated/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // NOTE: consistent-type-imports is intentionally NOT enabled: NestJS DI
      // relies on emitDecoratorMetadata, which requires constructor-injected
      // services to stay value imports.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  ...moduleBoundaryRules,
  {
    // Node scripts (dev runners, codegen) run in plain Node, not TS.
    files: ['**/scripts/**/*.mjs', '*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
  },
  prettier,
);
