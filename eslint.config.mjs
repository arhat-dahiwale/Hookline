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
  'delivery-queue',
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
      // Schema files are exempt: FK definitions need cross-module table
      // references (declarative only — DATA.md's ownership rule is about
      // queries, which still go through the owning module's repository).
      ignores: [`apps/server/src/modules/${moduleName}/*.schema.ts`],
      files: [`apps/server/src/modules/${moduleName}/**/*.ts`],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                // `../<other>/...` (deep import) is banned. The public index
                // import is allowed in both forms: `../<other>` (bare) and
                // `../<other>/index.js` (NodeNext extension form).
                regex: String.raw`(\.\./)+(${otherModules.join('|')})/(?!index\.js$).+`,
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
      '**/.next/**',
      '**/next-env.d.ts',
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
  {
    // TypeScript resolves globals via @types packages; the JS no-undef rule
    // has no type information and false-positives on DOM/Node globals in the
    // web app (typescript-eslint's own recommendation is to disable it).
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'no-undef': 'off',
    },
  },
  ...moduleBoundaryRules,
  {
    // Node scripts (dev runners, codegen) run in plain Node, not TS.
    files: ['**/scripts/**/*.mjs', '**/scripts/**/*.js', '**/e2e/*.mjs', '*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
        __ENV: 'readonly',
        __ITER: 'readonly',
        __VU: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
  },
  {
    // Next.js config runs in the Next build context (Node globals available).
    files: ['**/next.config.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
      },
    },
  },
  prettier,
);
