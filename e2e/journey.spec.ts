import { expect, test, type Page } from '@playwright/test';

/**
 * Core user journey (AGENTS.md done criteria): sign up, create an
 * organization, create an endpoint, send an event through the public REST API
 * with an API key, see the delivery in the dashboard, then replay it.
 */

const API = 'http://localhost:4000';

const unique = (): string => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function signUp(page: Page, email: string): Promise<void> {
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill(`E2E ${email.slice(0, 12)}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password-123456');
  await page.getByTestId('sign-up-submit').click();
  await expect(page).toHaveURL(/\/overview/, { timeout: 30_000 });
}

test('sign up, create org + endpoint, ingest via API key, see delivery, replay', async ({
  page,
}) => {
  const email = `e2e-${unique()}@example.test`;
  const orgName = `E2E Org ${unique()}`;
  const endpointUrl = 'http://localhost:3100/api/mock-receiver';

  await signUp(page, email);

  // Create the organization (first-run path via the org switcher).
  await page.getByTestId('org-switcher').click();
  await page.getByTestId('create-org-trigger').click();
  await page.getByLabel('Name').fill(orgName);
  await page.getByTestId('create-org-submit').click();
  await expect(page.getByTestId('org-switcher')).toContainText(orgName, { timeout: 30_000 });

  // Create an endpoint pointing at the in-app mock receiver.
  await page.goto('/endpoints');
  await page.getByTestId('create-endpoint').click();
  await page.getByLabel('URL').fill(endpointUrl);
  await page.getByTestId('create-endpoint-submit').click();
  const secretDialog = page.getByTestId('endpoint-secret');
  await expect(secretDialog).toBeVisible();
  await expect(secretDialog).toContainText('whsec_');
  await page.screenshot({ path: 'docs/screenshots/endpoint-secret-reveal.png' });
  await page.getByTestId('endpoint-secret-done').click();
  await expect(page.getByTestId('endpoints-table')).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/endpoints-populated.png', fullPage: true });

  // Create an API key through the dashboard (secret shown exactly once).
  await page.goto('/api-keys');
  await page.getByTestId('create-api-key').click();
  await page.getByLabel('Name').fill(`e2e-key-${unique()}`);
  await page.getByTestId('scope-picker').getByLabel('events:write').check();
  await page.getByTestId('scope-picker').getByLabel('events:read').check();
  await page.getByTestId('create-api-key-submit').click();
  const keyDialog = page.getByTestId('api-key-secret');
  await expect(keyDialog).toBeVisible();
  const apiKey = (await keyDialog.getByTestId('api-key-secret-secret').textContent()) ?? '';
  expect(apiKey).toMatch(/^hl_live_/);
  await page.getByTestId('api-key-secret-done').click();

  // Send an event through the PUBLIC REST API with the key.
  const ingest = await fetch(`${API}/v1/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'e2e.journey', payload: { run: unique() } }),
  });
  expect(ingest.status).toBe(202);

  // The delivery appears in the dashboard (reloaded view reads via tRPC).
  await page.goto('/deliveries');
  await expect(
    page.getByTestId('deliveries-table').locator('tr', { hasText: 'succeeded' }).first(),
  ).toBeVisible({ timeout: 45_000 });

  // Open the delivery detail and replay it.
  await page.getByTestId('deliveries-table').locator('tr').first().locator('a').click();
  await expect(page.getByTestId('replay-delivery')).toBeVisible();
  await page.getByTestId('replay-delivery').click();
  await expect(page.getByTestId('replay-delivery-result')).toContainText('Replay queued');

  // The replay creates a second delivery for the same event, and it too
  // reaches the receiver (succeeded) — proving the full loop again.
  await page.goto('/deliveries');
  await expect(
    page.getByTestId('deliveries-table').locator('tr', { hasText: 'replay' }),
  ).toBeVisible({
    timeout: 45_000,
  });
  await expect(
    page.getByTestId('deliveries-table').locator('tr', { hasText: 'succeeded' }),
  ).toHaveCount(2, { timeout: 45_000 });
  await page.screenshot({ path: 'docs/screenshots/deliveries-populated.png', fullPage: true });

  // Delivery detail with the attempt timeline expanded.
  await page.getByTestId('deliveries-table').locator('tr').first().locator('a').click();
  await expect(page.getByTestId('attempt-timeline')).toBeVisible();
  await page.getByTestId('attempt-timeline').locator('button').first().click();
  await page.screenshot({ path: 'docs/screenshots/delivery-detail.png', fullPage: true });
});
