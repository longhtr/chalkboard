/** Shared expectations and collision-free identities for PostgreSQL-backed browser stories. */
import {
  expect,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from '@playwright/test';

export async function expectCloudReady(page: Page): Promise<void> {
  await expect(page.getByText(/^Synced$/u)).toBeVisible();
}

/** Starts and completes test-mode email verification, retaining the session cookie. */
export async function registerCloudAccount(
  request: APIRequestContext,
  account: { displayName: string; email: string; password: string },
): Promise<APIResponse> {
  const registration = await request.post('/api/auth/register', {
    data: account,
  });
  expect(registration.status()).toBe(202);
  const verification = await request.post('/api/auth/verify-email', {
    data: { code: '1234-5678', email: account.email },
  });
  expect(verification.status()).toBe(201);
  return verification;
}

export function uniqueEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@chalkboard.test`;
}
