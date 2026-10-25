import { expect, test, type Page } from '@playwright/test';

/**
 * Auth gating + page smoke: unauthenticated redirects, sign-in/sign-up
 * validation, and every dashboard page rendering its empty or populated
 * state. Screenshots for the human review are written to docs/screenshots/.
 */

const unique = (): string => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function signUpAndOpenDashboard(page: Page): Promise<string> {
  const email = `e2e-${unique()}@example.test`;
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Screenshot User');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password-123456');
  await page.getByTestId('sign-up-submit').click();
  await expect(page).toHaveURL(/\/overview/, { timeout: 30_000 });
  await page.getByTestId('org-switcher').click();
  await page.getByTestId('create-org-trigger').click();
  await page.getByLabel('Name').fill(`Shot Org ${unique()}`);
  await page.getByTestId('create-org-submit').click();
  await expect(page.getByTestId('org-switcher')).toContainText('Shot Org', { timeout: 30_000 });
  return email;
}

test('anonymous users are redirected to sign-in', async ({ page }) => {
  await page.goto('/overview');
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto('/endpoints');
  await expect(page).toHaveURL(/\/sign-in/);
});

test('sign-in rejects wrong credentials', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(`nobody-${unique()}@example.test`);
  await page.getByLabel('Password').fill('password-123456');
  await page.getByTestId('sign-in-submit').click();
  await expect(page.getByTestId('sign-in-error')).toBeVisible();
});

test('every dashboard page renders with a fresh org', async ({ page }) => {
  test.setTimeout(150_000);
  await signUpAndOpenDashboard(page);

  const pages: { path: string; name: string; expectTestId: string }[] = [
    { path: '/overview', name: 'overview', expectTestId: 'overview-empty' },
    { path: '/endpoints', name: 'endpoints', expectTestId: 'endpoints-empty' },
    { path: '/events', name: 'events', expectTestId: 'events-empty' },
    { path: '/deliveries', name: 'deliveries', expectTestId: 'deliveries-empty' },
    { path: '/api-keys', name: 'api-keys', expectTestId: 'api-keys-empty' },
    { path: '/analytics', name: 'analytics', expectTestId: 'analytics-empty' },
    // A fresh org always has its creator — members shows the table.
    { path: '/members', name: 'members', expectTestId: 'members-table' },
  ];

  for (const entry of pages) {
    await page.goto(entry.path);
    await expect(page.getByTestId(entry.expectTestId)).toBeVisible({ timeout: 30_000 });
    await page.screenshot({
      path: `docs/screenshots/${entry.name}.png`,
      fullPage: true,
    });
  }

  // Settings (admin) — form + audit log.
  await page.goto('/settings');
  await expect(page.getByTestId('settings-save')).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/settings.png', fullPage: true });

  // Sign out clears the session cookie; protected pages redirect again.
  await page.getByTestId('org-switcher').click();
  await page.getByRole('menuitem', { name: /Sign out/ }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto('/overview');
  await expect(page).toHaveURL(/\/sign-in/);
});

test('dark mode renders the dashboard', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await signUpAndOpenDashboard(page);
  await page.screenshot({ path: 'docs/screenshots/overview-dark.png', fullPage: true });
});
