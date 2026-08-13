/** Canonical links shared by standalone pages and in-workspace dialogs. */
export const publicInformationNavigation = [
  ['/privacy', 'Privacy'],
  ['/terms', 'Terms'],
  ['/acceptable-use', 'Acceptable use'],
  ['/retention', 'Retention'],
  ['/account-deletion', 'Account deletion'],
  ['/contact', 'Contact'],
] as const;

export type PublicInformationPath =
  (typeof publicInformationNavigation)[number][0];

/** Public-information paths rendered outside the workspace application shell. */
const PUBLIC_INFORMATION_PATHS = new Set([
  ...publicInformationNavigation.map(([path]) => path),
  '/privacy-policy',
  '/terms-of-use',
]);

/** Returns true for paths rendered by the public information shell. */
export function isPublicInformationPath(pathname: string): boolean {
  return PUBLIC_INFORMATION_PATHS.has(pathname);
}
