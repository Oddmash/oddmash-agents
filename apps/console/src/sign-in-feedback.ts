export function signInErrorMessage(href: string): string | undefined {
  const error = new URL(href).searchParams.get('error');
  if (error === null) return undefined;
  if (error === 'AccessDenied') return 'Access denied. This GitHub account is not authorized. Try another account.';
  return 'GitHub sign-in could not be completed. Please try again.';
}

export function clearSignInError(href: string): URL {
  const url = new URL(href);
  url.searchParams.delete('error');
  return url;
}
