/**
 * gRPC codegen without protoc (AGENTS.md cross-platform rules).
 *
 * NOTE: the `proto-loader-gen-types` name on npm is a dependency-confusion
 * placeholder, NOT the real tool. The generator ships inside
 * `@grpc/proto-loader` as its bin — this script spawns that bundled CLI.
 * Run via `pnpm proto:gen` from the repo root.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');
const require = createRequire(import.meta.url);
const generatorBin = require.resolve('@grpc/proto-loader/build/bin/proto-loader-gen-types.js');

const args = [
  generatorBin,
  '--longs=Number',
  '--enums=String',
  '--defaults',
  '--oneofs',
  '--grpcLib=@grpc/grpc-js',
  `--inputTemplate=I%s`,
  `--outputTemplate=O%s`,
  `-I`,
  join(packageRoot, 'protos'),
  '-O',
  join(packageRoot, 'generated'),
  join(packageRoot, 'protos', 'worker.proto'),
  join(packageRoot, 'protos', 'health.proto'),
];

const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
if (result.status !== 0) {
  process.stderr.write('proto type generation failed\n');
  process.exit(result.status ?? 1);
}
process.stdout.write('proto types generated\n');
