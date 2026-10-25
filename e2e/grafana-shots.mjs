// One-off: capture Grafana dashboards + Prometheus targets as PNGs (Phase 13
// evidence). Not part of the Playwright suite — run with:
//   node e2e/grafana-shots.mjs
import { chromium } from '@playwright/test';

const pass = 'admin'; // this deployment started with the default; see LOGS Run 015
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 850 } });

await page.goto('http://localhost:3001/login');
await page.locator('input[name="user"]').fill('admin');
await page.locator('input[name="password"]').fill(pass);
await page.locator('button[type="submit"]').click();
await page.waitForURL(/\/d\/|\/\?org|\/home|\/dashboards/, { timeout: 15000 }).catch(() => {});
// Default-admin login opens a "change password" step — skip it.
const skip = page
  .getByRole('link', { name: /skip/i })
  .or(page.getByRole('button', { name: /skip/i }));
if ((await skip.count()) > 0)
  await skip
    .first()
    .click()
    .catch(() => {});

const panels = {
  'hookline-delivery': 'Attempt outcomes',
  'hookline-queues': 'Delivery queue depth by state',
  'hookline-api': 'Request duration p95',
  'hookline-infra': 'Redis memory used',
};
for (const [uid, panelTitle] of Object.entries(panels)) {
  await page.goto(`http://localhost:3001/d/${uid}?from=now-30m&to=now`, {
    waitUntil: 'networkidle',
  });
  await page.getByTitle(panelTitle, { exact: false }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
  const path = `docs/screenshots/grafana-${uid.replace('hookline-', '')}.png`;
  await page.screenshot({ path });
  console.log('captured', path);
}

await page.goto('http://localhost:9090/targets?search=', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'docs/screenshots/prometheus-targets.png' });
console.log('captured prometheus targets');
await browser.close();
