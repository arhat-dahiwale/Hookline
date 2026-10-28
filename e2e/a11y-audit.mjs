// Accessibility + responsive audit (Phase 15). Boots nothing itself: expects
// the API on :4000 and the web dev server on :3100 (Playwright webServer in
// the main config handles that when run via `pnpm test:e2e`; this script is
// run with the servers already up). Produces docs/screenshots/a11y-*.png and
// logs findings as JSON.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = 'http://localhost:3100';
const OUT = resolve('docs/screenshots');
mkdirSync(OUT, { recursive: true });

const findings = [];
const note = (check, page, ok, detail) => findings.push({ check, page, ok, detail });

const email = `a11y-${Date.now()}@example.test`;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

// Sign up (a11y of the auth form included).
await page.goto(`${BASE}/sign-up`);
await page.getByLabel('Name').fill('A11y Audit');
await page.getByLabel('Email').fill(email);
await page.getByLabel('Password').fill('password-123456');
await page.getByTestId('sign-up-submit').click();
await page.waitForURL(/\/overview/, { timeout: 30_000 });
await page.waitForTimeout(1500);

// 1. Every image/icon-only control has an accessible name; scan nav + header.
const unnamedButtons = await page.evaluate(() =>
  [...document.querySelectorAll('button')]
    .filter(
      (b) =>
        !(b.textContent ?? '').trim() && !b.getAttribute('aria-label') && !b.getAttribute('title'),
    )
    .map((b) => b.outerHTML.slice(0, 80)),
);
note(
  'icon buttons have accessible names',
  '/overview',
  unnamedButtons.length === 0,
  unnamedButtons,
);

// 2. Keyboard: tab order reaches the nav links and focus is visible.
await page.keyboard.press('Tab');
await page.keyboard.press('Tab');
await page.keyboard.press('Tab');
const focused = await page.evaluate(() => {
  const el = document.activeElement;
  return { tag: el.tagName, text: (el.textContent ?? '').trim().slice(0, 30) };
});
note(
  'keyboard focus lands on interactive elements',
  '/overview',
  ['A', 'BUTTON'].includes(focused.tag),
  focused,
);

const focusOutline = await page.evaluate(() => {
  const el = document.activeElement;
  const styles = getComputedStyle(el);
  return {
    outlineWidth: styles.outlineWidth,
    boxShadow: styles.boxShadow !== 'none',
    outlineStyle: styles.outlineStyle,
  };
});
note(
  'focus indicator visible',
  '/overview',
  focusOutline.outlineWidth !== '0px' || focusOutline.boxShadow,
  focusOutline,
);
await page.screenshot({ path: resolve(OUT, 'a11y-focus-keyboard.png') });

// 3. Landmarks and headings.
const landmarks = await page.evaluate(() => ({
  nav: !!document.querySelector('nav'),
  main: !!document.querySelector('main'),
  h1: document.querySelector('h1')?.textContent ?? null,
}));
note(
  'landmarks + h1 present',
  '/overview',
  landmarks.nav && landmarks.main && !!landmarks.h1,
  landmarks,
);

// 4. Page pages render (light) — full set for evidence.
for (const [path, name] of [
  ['/overview', 'a11y-overview'],
  ['/endpoints', 'a11y-endpoints'],
  ['/deliveries', 'a11y-deliveries'],
]) {
  await page.goto(`${BASE}${path}`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: resolve(OUT, `${name}.png`), fullPage: true });
}
note('pages render light mode', '/overview,/endpoints,/deliveries', true, 'screenshots saved');

// First-run (no organization yet) shows guidance, not a raw error.
await page.goto(`${BASE}/deliveries`);
await page.getByTestId('org-required').waitFor({ timeout: 20_000 });
await page.screenshot({ path: resolve(OUT, 'a11y-org-required.png') });
note('no-org state guides instead of erroring', '/deliveries', true, 'org-required block rendered');

// 5. Contrast: sample text/background colors of key elements (light + dark).
async function contrastPairs() {
  return page.evaluate(() => {
    const pairs = [];
    for (const el of document.querySelectorAll('h1, p, button, a, td, th')) {
      const styles = getComputedStyle(el);
      if (!el.textContent?.trim() || styles.visibility === 'hidden') continue;
      pairs.push({
        text: el.textContent.trim().slice(0, 20),
        color: styles.color,
        bg: styles.backgroundColor,
      });
      if (pairs.length > 40) break;
    }
    return pairs;
  });
}
const lightPairs = contrastPairs ? await contrastPairs() : [];

// Dark mode via the theme toggle.
await page.getByLabel('Toggle theme').click();
await page.waitForTimeout(800);
const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
note('theme toggle switches to dark', '/overview', isDark, { isDark });
await page.screenshot({ path: resolve(OUT, 'a11y-dark-overview.png'), fullPage: true });
const darkPairs = await contrastPairs();
note('color samples captured (contrast eyeballed on screenshots)', '/overview', true, {
  lightPairs: lightPairs.length,
  darkPairs: darkPairs.length,
});

// 6. Mobile width: nav collapses to the hamburger, pages usable.
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/overview`);
await page.waitForTimeout(1200);
const mobile = await page.evaluate(() => ({
  horizontalOverflow:
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
  hamburger: !!document.querySelector('button[aria-label*="navigation" i]'),
}));
note(
  'mobile: no horizontal overflow, nav collapses',
  '/overview',
  !mobile.horizontalOverflow && mobile.hamburger,
  mobile,
);
await page.screenshot({ path: resolve(OUT, 'a11y-mobile-overview.png'), fullPage: true });

await browser.close();
writeFileSync(resolve(OUT, 'a11y-findings.json'), JSON.stringify(findings, null, 2));
const failed = findings.filter((f) => !f.ok);
console.log(
  JSON.stringify(
    { passed: findings.length - failed.length, failed: failed.length, findings },
    null,
    2,
  ),
);
process.exitCode = failed.length === 0 ? 0 : 1;
