/**
 * Dashboard ↔ metric drift check (Phase 12): every `hookline_*` metric name
 * referenced by a Grafana dashboard under infra/grafana/dashboards must be
 * registered in the MetricsService (apps/server/src/modules/observability/
 * metrics.ts), and every registered hookline_* metric must appear in the
 * ARCHITECTURE.md 7.3 table. Run via `pnpm check:dashboards`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const metricsSource = readFileSync(
  join(root, 'apps/server/src/modules/observability/metrics.ts'),
  'utf8',
);
const architecture = readFileSync(join(root, 'ARCHITECTURE.md'), 'utf8');

// All hookline metric names are string literals in metrics.ts (passed to
// prom-client configs); the registered set is exactly these literals.
const registered = new Set(metricsSource.match(/hookline_[a-z0-9_]+/g));

const dashboardDir = join(root, 'infra/grafana/dashboards');
const failures = [];
for (const file of readdirSync(dashboardDir).filter((name) => name.endsWith('.json'))) {
  const content = readFileSync(join(dashboardDir, file), 'utf8');
  const dashboard = JSON.parse(content);
  const referenced = new Set(content.match(/hookline_[a-z0-9_]+/g));
  for (const name of referenced) {
    // Histograms expose <name>_bucket/_sum/_count series — the registered
    // name is the base, so series suffixes are valid references.
    const base = name.replace(/_(bucket|sum|count)$/, '');
    if (!registered.has(name) && !registered.has(base)) {
      failures.push(
        `${dashboard.title} (${file}) references "${name}" which is NOT registered in MetricsService`,
      );
    }
  }
  if (
    referenced.size === 0 &&
    !dashboard.panels.some((panel) => (panel.targets ?? []).length > 0)
  ) {
    failures.push(`${dashboard.title} (${file}) has no panels with targets`);
  }
}

for (const name of registered) {
  if (!architecture.includes(name)) {
    failures.push(`Registered metric "${name}" is missing from the ARCHITECTURE.md 7.3 table`);
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `dashboard metric check failed:\n${failures.map((f) => `  - ${f}`).join('\n')}\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `dashboard metric check passed: ${registered.size} registered hookline_* metrics, all dashboard references valid\n`,
);
