import { test, expect } from '@playwright/test';
import { registerUserWithGuild, enterGeneralChannel } from './helpers';

const BASE = process.env.E2E_BASE_URL ?? 'https://localhost:5173';

test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

test('attaching a file (no text) uploads and renders it', async ({ browser, request }) => {
  test.setTimeout(150000);
  // Regression: request.form() yields starlette UploadFile, but the API checked
  // isinstance(value, fastapi.UploadFile) — a subclass — so every attachment was
  // silently dropped. File-only sends then 400'd ("Cannot send an empty message")
  // and the client showed "Failed to upload file(s). Please try again."
  const owner = await registerUserWithGuild(request, 'upl');

  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: BASE });
  const page = await ctx.newPage();
  try {
    await enterGeneralChannel(page, owner.token, { email: owner.email, password: 'TestPass123A' });

    // Attach a file WITHOUT typing any text — the exact reported failure mode.
    await page.locator('input[type="file"]').setInputFiles({
      name: 'e2e-upload.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('relay e2e upload payload\n'),
    });

    // The pending-file chip appears; send with Enter (empty composer + one file).
    await expect(page.getByLabel('Files to upload')).toBeVisible({ timeout: 10000 });
    await page.locator('textarea[aria-label*="Message"]').press('Enter');

    // It must NOT show the upload-failed error.
    await expect(
      page.getByText('Failed to upload file(s). Please try again.')
    ).toHaveCount(0, { timeout: 10000 });

    // The attachment must render in the message list, and its link must be a
    // same-origin /cdn URL (not http://localhost:9000) so it works over HTTPS and
    // for remote viewers.
    const link = page.locator('a[href*="/cdn/relay-attachments/"]').first();
    await expect(link).toBeVisible({ timeout: 15000 });
    const href = await link.getAttribute('href');
    expect(href).toMatch(/^\/cdn\/relay-attachments\/.+\/e2e-upload\.txt$/);
  } finally {
    await ctx.close();
  }
});

test('an uploaded image renders with a real src (regression: proxy_url="" gave empty src)', async ({ browser, request }) => {
  test.setTimeout(150000);
  // proxy_url comes back "" (AttachmentInput has no proxy_url field), and the <img>
  // used `proxy_url ?? url` — nullish coalescing keeps "" so images got src="" and
  // never loaded, while videos (which use `url`) worked.
  const owner = await registerUserWithGuild(request, 'img');

  // A minimal valid 1x1 PNG.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  );

  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: BASE });
  const page = await ctx.newPage();
  try {
    await enterGeneralChannel(page, owner.token, { email: owner.email, password: 'TestPass123A' });

    await page.locator('input[type="file"]').setInputFiles({
      name: 'e2e-pic.png',
      mimeType: 'image/png',
      buffer: png,
    });
    await expect(page.getByLabel('Files to upload')).toBeVisible({ timeout: 10000 });
    await page.locator('textarea[aria-label*="Message"]').press('Enter');

    await expect(
      page.getByText('Failed to upload file(s). Please try again.')
    ).toHaveCount(0, { timeout: 10000 });

    // The rendered <img> must have a non-empty, same-origin /cdn src and actually load.
    const img = page.locator('img[src*="/cdn/relay-attachments/"]').first();
    await expect(img).toBeVisible({ timeout: 15000 });
    const src = await img.getAttribute('src');
    expect(src).toMatch(/^\/cdn\/relay-attachments\/.+\/e2e-pic\.png$/);
    // naturalWidth > 0 proves the browser actually decoded the image (not a broken src).
    await expect
      .poll(async () => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 15000 })
      .toBeGreaterThan(0);
  } finally {
    await ctx.close();
  }
});
