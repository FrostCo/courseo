/**
 * Credential validation rules shared by the server (enforcement) and the
 * web UI (inline feedback).
 */

export const MIN_PASSWORD_LENGTH = 8;
/** Upper bound to keep password hashing cost bounded. */
export const MAX_PASSWORD_LENGTH = 128;
export const MAX_USERNAME_LENGTH = 64;
export const MAX_DISPLAY_NAME_LENGTH = 128;

/** Starts alphanumeric, then alphanumerics plus . _ - */
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

export function isValidUsername(username: string): boolean {
  return (
    username.length >= 1 &&
    username.length <= MAX_USERNAME_LENGTH &&
    USERNAME_PATTERN.test(username)
  );
}

export function isValidPassword(password: string): boolean {
  return (
    password.length >= MIN_PASSWORD_LENGTH &&
    password.length <= MAX_PASSWORD_LENGTH
  );
}

export function isValidDisplayName(displayName: string): boolean {
  const trimmed = displayName.trim();
  return trimmed.length >= 1 && trimmed.length <= MAX_DISPLAY_NAME_LENGTH;
}
