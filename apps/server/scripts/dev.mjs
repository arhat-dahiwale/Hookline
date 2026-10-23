// Dev runner: tsc watch + node --watch over the compiled output.
//
// Why not tsx? esbuild (tsx) does not emit decorator metadata, which NestJS
// DI requires for class-typed constructor params. tsc emits it, so the dev
// loop compiles with tsc and restarts node when dist changes.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');

mkdirSync(join(pkgRoot, 'dist'), { recursive: true });

/** @param {string} cmd @param {string[]} args */
function run(cmd, args) {
  const child = spawn(cmd, args, {
    cwd: pkgRoot,
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: process.platform === 'win32',
  });
  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      process.exitCode = code;
    }
  });
  return child;
}

const tsc = run('pnpm', [
  'exec',
  'tsc',
  '-p',
  'tsconfig.build.json',
  '--watch',
  '--preserveWatchOutput',
]);
const node = run('node', ['--watch', 'dist/main.js']);

function shutdown() {
  tsc.kill();
  node.kill();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
