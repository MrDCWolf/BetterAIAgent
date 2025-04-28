import { test, expect } from '@playwright/test';

test('basic playwright test works', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page).toHaveTitle(/Example Domain/);
}); 