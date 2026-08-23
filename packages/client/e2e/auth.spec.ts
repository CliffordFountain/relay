import { test, expect, type Page } from '@playwright/test';
import {
  uniqueId,
  registerUser,
  clearRateLimits,
  loginViaToken,
  API_BASE,
  apiWithRetry,
} from './helpers';

/**
 * Authentication E2E Tests
 *
 * Covers login form, register form, registration flow, login flow,
 * wrong password, logout, and forgot password page.
 */

const PASSWORD = 'TestPass123A';

async function registerViaUI(page: Page, creds: { username: string; email: string; password: string }) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // Wait for login page to appear
  await expect(page.getByText('Welcome back!')).toBeVisible({ timeout: 10000 });

  // Click "Register" link to switch to register form
  await page.locator('a').filter({ hasText: /create an account/i }).click();
  await expect(page.getByText('Create an account')).toBeVisible({ timeout: 10000 });

  // Fill registration form fields
  await page.getByLabel('Email', { exact: false }).fill(creds.email);

  // Display name field
  const displayNameInput = page.getByLabel('Display name', { exact: false });
  await expect(displayNameInput).toBeVisible({ timeout: 5000 });
  await displayNameInput.fill(creds.username);

  await page.getByLabel('Username', { exact: false }).fill(creds.username);
  await page.getByLabel('Password', { exact: false }).fill(creds.password);

  // Fill DOB selects (Month, Day, Year)
  const monthSelect = page.getByLabel('Month');
  await expect(monthSelect).toBeVisible({ timeout: 5000 });
  await monthSelect.selectOption({ index: 1 });
  await page.getByLabel('Day').selectOption({ index: 1 });
  await page.getByLabel('Year').selectOption('1995');

  // Click "Continue" button
  await page.locator('button[type="submit"]').click();

  // Wait for app to load (server sidebar visible)
  await expect(page.locator('nav[aria-label="Servers"]')).toBeVisible({ timeout: 15000 });
}

test.describe('Authentication - Login Page', () => {
  test.beforeAll(() => {
    clearRateLimits();
  });

  test('login page renders with email, password, Log In button, and forgot password link', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    // Verify "Welcome back!" header
    await expect(page.getByText('Welcome back!')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/get back in the game/i)).toBeVisible();

    // Email input
    const emailInput = page.getByLabel(/email/i).first();
    await expect(emailInput).toBeVisible();

    // Password input
    const passwordInput = page.getByLabel(/password/i);
    await expect(passwordInput).toBeVisible();

    // Log In button
    await expect(page.getByRole('button', { name: /log in/i })).toBeVisible();

    // "Forgot your password?" link
    await expect(page.getByText(/forgot your password/i)).toBeVisible();

    // "Need an account? Register" link
    await expect(page.getByText(/new to relay/i)).toBeVisible();
  });
});

test.describe('Authentication - Register Page', () => {
  test.beforeAll(() => {
    clearRateLimits();
  });

  test('register page renders with all required fields', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    // Navigate to register
    await expect(page.getByText('Welcome back!')).toBeVisible({ timeout: 10000 });
    await page.locator('a').filter({ hasText: /create an account/i }).click();

    // Verify "Create an account" header
    await expect(page.getByText('Create an account')).toBeVisible({ timeout: 10000 });

    // Email field - must be visible
    await expect(page.getByLabel(/email/i)).toBeVisible();

    // Display name field - must be visible
    await expect(page.getByLabel(/display name/i)).toBeVisible();

    // Username field - must be visible
    await expect(page.getByLabel(/username/i)).toBeVisible();

    // Password field - must be visible
    await expect(page.getByLabel(/password/i)).toBeVisible();

    // Date of Birth section - must be visible
    await expect(page.getByText(/date of birth/i)).toBeVisible();

    // DOB dropdowns
    await expect(page.getByLabel('Month')).toBeVisible();
    await expect(page.getByLabel('Day')).toBeVisible();
    await expect(page.getByLabel('Year')).toBeVisible();

    // Continue/submit button
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });
});

test.describe('Authentication - Flows', () => {
  test.beforeAll(() => {
    clearRateLimits();
  });

  test('register new user via UI -> app loads with server sidebar and token stored', async ({ page }) => {
    const id = uniqueId();
    const creds = {
      username: `reg_${id}`,
      email: `reg_${id}@test.com`,
      password: PASSWORD,
    };

    await registerViaUI(page, creds);

    // App should be loaded - server sidebar visible with expected buttons
    await expect(page.locator('nav[aria-label="Servers"]')).toBeVisible();
    await expect(page.locator('[role="treeitem"][aria-label="Home"]')).toBeVisible();
    await expect(page.locator('[role="button"][aria-label="Add a Server"]')).toBeVisible();

    // Token should be stored in localStorage
    const token = await page.evaluate(() => localStorage.getItem('token'));
    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
    expect(token!.length).toBeGreaterThan(10);

    // Login page should no longer be visible
    await expect(page.getByText('Welcome back!')).not.toBeVisible();
  });

  test('login with valid credentials -> app loads', async ({ page, request }) => {
    const user = await registerUser(request, 'login');

    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByText('Welcome back!')).toBeVisible({ timeout: 10000 });

    // Fill login form
    await page.getByLabel(/email/i).first().fill(user.email);
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole('button', { name: /log in/i }).click();

    // App should load - server sidebar visible
    await expect(page.locator('nav[aria-label="Servers"]')).toBeVisible({ timeout: 15000 });

    // Login page should be gone
    await expect(page.getByText('Welcome back!')).not.toBeVisible();

    // Token should be stored
    const token = await page.evaluate(() => localStorage.getItem('token'));
    expect(token).toBeTruthy();
  });

  test('login with wrong password -> error message visible, stays on login page', async ({ page, request }) => {
    const user = await registerUser(request, 'wpw');

    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByText('Welcome back!')).toBeVisible({ timeout: 10000 });

    await page.getByLabel(/email/i).first().fill(user.email);
    await page.getByLabel(/password/i).fill('WrongPassword999!');
    await page.getByRole('button', { name: /log in/i }).click();

    // Error indicator must appear
    await expect(page.locator('[class*="error"]')).toBeVisible({ timeout: 10000 });

    // Must still be on login page - Log In button still visible
    await expect(page.getByRole('button', { name: /log in/i })).toBeVisible();

    // Server sidebar must NOT appear
    await expect(page.locator('nav[aria-label="Servers"]')).not.toBeVisible();
  });

  test('logout clears session and returns to login page', async ({ page, request }) => {
    const user = await registerUser(request, 'logout');

    // Login via token with fallback credentials
    await loginViaToken(page, user.token, { email: user.email, password: PASSWORD });

    // Open user settings via gear icon
    const settingsButton = page.locator('[aria-label="User Settings"]');
    await expect(settingsButton).toBeVisible({ timeout: 10000 });
    await settingsButton.click();

    // User settings dialog should open
    const settingsDialog = page.locator('[role="dialog"][aria-label="User Settings"]');
    await expect(settingsDialog).toBeVisible({ timeout: 10000 });

    // Find and click "Log Out" button
    const logOutButton = page.locator('button').filter({ hasText: /log out/i });
    await expect(logOutButton).toBeVisible({ timeout: 10000 });
    await logOutButton.click();

    // Should return to login page
    await expect(page.getByText('Welcome back!')).toBeVisible({ timeout: 10000 });

    // Server sidebar should be gone
    await expect(page.locator('nav[aria-label="Servers"]')).not.toBeVisible();

    // Token should be cleared from localStorage
    const token = await page.evaluate(() => localStorage.getItem('token'));
    expect(token).toBeFalsy();
  });
});

test.describe('Authentication - Forgot Password', () => {
  test.beforeAll(() => {
    clearRateLimits();
  });

  test('forgot password page renders with email input and submit button', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    // Navigate from login page
    await expect(page.getByText('Welcome back!')).toBeVisible({ timeout: 10000 });

    // Click "Forgot your password?" link
    const forgotLink = page.getByText(/forgot your password/i);
    await expect(forgotLink).toBeVisible();
    await forgotLink.click();

    // Verify forgot password page elements
    await expect(page.getByText('Forgot your password?')).toBeVisible({ timeout: 10000 });
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /send reset link/i })).toBeVisible();
  });

  test('back to login link returns to login page', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await expect(page.getByText('Welcome back!')).toBeVisible({ timeout: 10000 });
    await page.getByText(/forgot your password/i).click();
    await expect(page.getByText('Forgot your password?')).toBeVisible({ timeout: 10000 });

    // Click "Back to Login"
    const backLink = page.getByText(/back to login/i);
    await expect(backLink).toBeVisible();
    await backLink.click();

    // Should return to login page
    await expect(page.getByText('Welcome back!')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Authentication - Visual & Structure', () => {
  test.beforeAll(() => {
    clearRateLimits();
  });

  test('login page has a gradient/colored background, not a flat dark color', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await expect(page.getByText('Welcome back!')).toBeVisible({ timeout: 10000 });

    // The outer .page container should have a gradient background, not a flat dark bg
    const pageEl = page.locator('[class*="page"]').first();
    const bg = await pageEl.evaluate(el => getComputedStyle(el).backgroundImage);

    // A gradient background produces a "linear-gradient(...)" value, not "none"
    expect(bg).toContain('gradient');
  });

  test('register page has DOB dropdowns for Month, Day, and Year', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await expect(page.getByText('Welcome back!')).toBeVisible({ timeout: 10000 });
    await page.locator('a').filter({ hasText: /create an account/i }).click();
    await expect(page.getByText('Create an account')).toBeVisible({ timeout: 10000 });

    // All three DOB selects must be visible and be <select> elements
    const monthSelect = page.getByLabel('Month');
    const daySelect = page.getByLabel('Day');
    const yearSelect = page.getByLabel('Year');

    await expect(monthSelect).toBeVisible({ timeout: 5000 });
    await expect(daySelect).toBeVisible({ timeout: 5000 });
    await expect(yearSelect).toBeVisible({ timeout: 5000 });

    // Verify they are actual <select> elements with options
    const monthTag = await monthSelect.evaluate(el => el.tagName.toLowerCase());
    expect(monthTag).toBe('select');

    const dayTag = await daySelect.evaluate(el => el.tagName.toLowerCase());
    expect(dayTag).toBe('select');

    const yearTag = await yearSelect.evaluate(el => el.tagName.toLowerCase());
    expect(yearTag).toBe('select');

    // Month select should have 12 month options (plus the placeholder)
    const monthOptionCount = await monthSelect.locator('option').count();
    expect(monthOptionCount).toBe(13); // 1 placeholder + 12 months
  });

  test('"Forgot your password?" link navigates to forgot password page', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await expect(page.getByText('Welcome back!')).toBeVisible({ timeout: 10000 });

    // Click "Forgot your password?" link
    const forgotLink = page.getByText(/forgot your password/i);
    await expect(forgotLink).toBeVisible();
    await forgotLink.click();

    // Should navigate to forgot password page with its own title
    await expect(page.getByText('Forgot your password?')).toBeVisible({ timeout: 10000 });

    // The login form should no longer be visible
    await expect(page.getByText('Welcome back!')).not.toBeVisible();

    // Forgot password page should have an email input
    await expect(page.getByLabel(/email/i)).toBeVisible();
  });
});

test.describe('Authentication - API', () => {
  test.beforeAll(() => {
    clearRateLimits();
  });

  test('GET /users/@me returns user data with expected fields', async ({ request }) => {
    const user = await registerUser(request, 'me');

    const res = await apiWithRetry(request, 'get', `${API_BASE}/users/@me`, {
      headers: { Authorization: `Bearer ${user.token}` },
    });

    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);

    const data = await res.json() as Record<string, unknown>;

    // Required fields - all must be present with correct values
    expect(data).toHaveProperty('id');
    expect(typeof data.id).toBe('string');
    expect(data).toHaveProperty('username');
    expect(data.username).toBe(user.username);
    expect(data).toHaveProperty('email');
    expect(data.email).toBe(user.email);

    // Avatar field must exist (even if null)
    expect('avatar' in data).toBe(true);

    // Display name field must exist under one of the known keys
    const hasDisplayField =
      'global_name' in data ||
      'display_name' in data ||
      'displayName' in data;
    expect(hasDisplayField).toBe(true);
  });
});
