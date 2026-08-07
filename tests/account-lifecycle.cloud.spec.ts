/** PostgreSQL-backed registration, login, logout, restoration, validation, and offline account lifecycle. */
import { expect, test } from '@playwright/test';

import {
  expectCloudReady,
  registerCloudAccount,
  uniqueEmail,
} from './helpers/cloudAccount';

test('updates account identity and recovers a forgotten password', async ({
  context,
  page,
}) => {
  const originalEmail = uniqueEmail('settings-original');
  const changedEmail = uniqueEmail('settings-changed');
  await registerCloudAccount(context.request, {
    displayName: 'Original Name',
    email: originalEmail,
    password: 'original password',
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Open account' }).click();
  const account = page.getByRole('dialog', { name: 'Account' });

  await account.getByLabel('Username').fill('Changed Name');
  await account.getByRole('button', { name: 'Save username' }).click();
  await expect(account.getByRole('status')).toHaveText('Username updated.');

  await account.getByLabel('Account email').fill(changedEmail);
  await account
    .getByLabel('Current password for email change')
    .fill('original password');
  await account.getByRole('button', { name: 'Verify new email' }).click();
  await expect(
    account.getByText(/email body is completely empty/u),
  ).toBeVisible();
  await account.getByLabel('Verification code').fill('1234-5678');
  await account.getByRole('button', { name: 'Verify email' }).click();
  await expect(account.getByRole('status')).toHaveText('Email updated.');
  await expect(account.getByLabel('Account email')).toHaveValue(changedEmail);

  await account
    .getByLabel('Current password', { exact: true })
    .fill('original password');
  await account
    .getByLabel('New password', { exact: true })
    .fill('changed password');
  await account.getByLabel('Confirm new password').fill('changed password');
  await account.getByRole('button', { name: 'Change password' }).click();
  await expect(account.getByRole('status')).toHaveText('Password updated.');
  await account.getByRole('button', { name: 'Sign out' }).click();

  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.getByLabel('Password reset email').fill(changedEmail);
  await page.getByRole('button', { name: 'Send reset code' }).click();
  await expect(page.getByText(/email body is completely empty/u)).toBeVisible();
  await page.getByLabel('Password reset code').fill('1234-5678');
  await page
    .getByLabel('Reset new password', { exact: true })
    .fill('recovered password');
  await page.getByLabel('Confirm reset password').fill('recovered password');
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(
    page.getByText('Password updated. Sign in with your new password.'),
  ).toBeVisible();

  await page.getByLabel('Email').fill(changedEmail);
  await page.getByLabel('Password', { exact: true }).fill('recovered password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('dialog', { name: 'Account' })).toBeVisible();
  await expect(page.getByLabel('Username')).toHaveValue('Changed Name');
});

test('completes the visible account lifecycle and restores the session', async ({
  page,
}) => {
  const email = uniqueEmail('account');
  const boardTitle = `Cloud board ${crypto.randomUUID().slice(0, 8)}`;

  await page.goto('/');
  await expect(
    page.getByRole('application', { name: 'Chalkboard drawing canvas' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Open account' }).click();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Display name').fill('Ada Browser');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('correct horse');
  await page.getByLabel('Confirm password').fill('correct horse');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(
    page.getByText('Verify your email before creating the account'),
  ).toBeVisible();
  await expect(
    page.getByText(/You do not need to open the email/u),
  ).toBeVisible();
  await page.getByLabel('Verification code').fill('1234-5678');
  await page.getByRole('button', { name: 'Verify email' }).click();

  await expect(page.getByRole('dialog', { name: 'Account' })).toBeVisible();
  await page.getByRole('button', { name: 'Close account panel' }).click();
  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'New board' }).click();
  const storageMenu = page.getByRole('menu', {
    name: 'Choose board storage',
  });
  await expect(storageMenu).toBeVisible();
  await storageMenu.getByRole('menuitem', { name: /Cloud/u }).click();
  await expectCloudReady(page);
  await expect(page).toHaveURL(/\/boards\/[^/]+$/u);
  const initialTitleSaved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      /\/api\/boards\/[^/]+$/u.test(response.url()),
  );
  await page.getByRole('textbox', { name: 'Board title' }).fill(boardTitle);
  await page.getByRole('textbox', { name: 'Board title' }).blur();
  await initialTitleSaved;

  await page.reload();
  await expectCloudReady(page);
  const accountButton = page.getByRole('button', {
    name: 'Open account',
  });
  const cloudBoardUrl = page.url();
  await accountButton.click();
  await expect(page.getByRole('dialog', { name: 'Account' })).toBeVisible();
  await expect(page.getByLabel('Account email')).toHaveValue(email);
  await expect(page.getByText('Your boards')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close account panel' }).click();

  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Open boards' }).click();
  let library = page.getByRole('dialog', { name: 'Boards' });
  await library
    .getByRole('list', { name: 'On this device' })
    .getByRole('button', { name: /^Open /u })
    .first()
    .click();
  await expect(page).toHaveURL(/\/local\/[^/]+$/u);
  await page.goBack();
  await expect(page).toHaveURL(cloudBoardUrl);
  await expectCloudReady(page);

  const renamedTitle = `${boardTitle} renamed`;
  const renamedTitleSaved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      /\/api\/boards\/[^/]+$/u.test(response.url()),
  );
  await page.getByRole('textbox', { name: 'Board title' }).fill(renamedTitle);
  await page.getByRole('textbox', { name: 'Board title' }).blur();
  await renamedTitleSaved;
  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Open boards' }).click();
  library = page.getByRole('dialog', { name: 'Boards' });
  const cloudEntry = library
    .getByRole('button', { name: `Open cloud board ${renamedTitle}` })
    .locator('..');
  await cloudEntry.getByRole('button', { name: 'Trash' }).click();
  await expect(library.getByText('No cloud boards yet.')).toBeVisible();
  await expect(page).toHaveURL(/\/local\/[^/]+$/u);
  await library.getByRole('button', { name: 'Close boards' }).click();

  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Open boards' }).click();
  library = page.getByRole('dialog', { name: 'Boards' });
  await expect(library.getByRole('list', { name: 'Cloud trash' })).toHaveCount(
    0,
  );
  await library.getByRole('button', { name: 'Cloud trash (1)' }).click();
  await expect(
    library.getByRole('list', { name: 'Cloud trash' }).getByText(renamedTitle),
  ).toBeVisible();
  await library.getByRole('button', { name: 'Restore all' }).click();
  await expect(library.getByRole('status')).toHaveText(
    'Restored all cloud boards.',
  );
  await library.getByRole('button', { name: '← Back to boards' }).click();
  const restoredEntry = library
    .getByRole('button', { name: `Open cloud board ${renamedTitle}` })
    .locator('..');
  await restoredEntry.getByRole('button', { name: 'Trash' }).click();
  await library.getByRole('button', { name: 'Cloud trash (1)' }).click();
  await library.getByRole('button', { name: 'Empty trash' }).click();
  await expect(library.getByRole('status')).toHaveText('Emptied cloud trash.');
  await expect(library.getByRole('list', { name: 'Cloud trash' })).toHaveCount(
    0,
  );
  await expect(library.getByText('Trash is empty.')).toBeVisible();
  await library.getByRole('button', { name: 'Close boards' }).click();

  await accountButton.click();
  await page.getByRole('button', { name: 'Sign out' }).click();

  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  const password = page.getByLabel('Password', { exact: true });
  await password.fill('incorrect password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    page.getByText(
      'We couldn’t sign you in. Check your email and password and try again.',
    ),
  ).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveValue(email);
  await expect(password).toHaveValue('');
  await expect(password).toBeFocused();
});
