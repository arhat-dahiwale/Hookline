// Plain-CSS side-effect imports (e.g. `import './globals.css'` in the app
// layout) must resolve during type checking: TypeScript 6 reports
// unresolvable side-effect imports as errors by default (TS2882), and Next's
// global types only declare `*.module.css`, never plain `*.css`. Next's more
// specific `*.module.css` declaration still wins for real CSS modules.
declare module '*.css';
