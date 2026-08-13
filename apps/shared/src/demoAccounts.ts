/**
 * Public shared accounts for trying cloud features while registration delivery
 * is unavailable. These credentials are intentionally not secrets.
 */
export interface DemoAccount {
  displayName: string;
  email: string;
  password: string;
}

const DEMO_PASSWORD = 'chalkboard-demo';

/** Accounts shown in the browser and created by the production seed job. */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = Object.freeze([
  {
    displayName: 'Cloud Demo 1',
    email: 'demo1@chalkboard.invalid',
    password: DEMO_PASSWORD,
  },
  {
    displayName: 'Cloud Demo 2',
    email: 'demo2@chalkboard.invalid',
    password: DEMO_PASSWORD,
  },
  {
    displayName: 'Cloud Demo 3',
    email: 'demo3@chalkboard.invalid',
    password: DEMO_PASSWORD,
  },
  {
    displayName: 'Cloud Demo 4',
    email: 'demo4@chalkboard.invalid',
    password: DEMO_PASSWORD,
  },
  {
    displayName: 'Cloud Demo 5',
    email: 'demo5@chalkboard.invalid',
    password: DEMO_PASSWORD,
  },
]);
