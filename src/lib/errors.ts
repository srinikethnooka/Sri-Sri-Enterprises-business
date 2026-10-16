// Turns Supabase / Postgres errors into short messages a shop owner can act on.
// Database functions already raise friendly messages; we pass those through and
// hide anything technical.
export function errorMessage(e: unknown): string {
  if (!e) return 'Something went wrong. Please try again.';
  const err = e as { message?: string; code?: string; details?: string };
  const msg = err.message ?? String(e);
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'No internet connection. Please check and try again.';
  if (err.code === '42501' || /permission denied|row-level security/i.test(msg)) {
    return /permission denied for|row-level security/i.test(msg)
      ? 'You do not have permission to do this.'
      : msg;
  }
  if (err.code === '23505' || /duplicate key/i.test(msg)) {
    return /duplicate key/i.test(msg) ? 'This already exists.' : msg;
  }
  if (/JWT|session/i.test(msg)) return 'Your session has expired. Please sign in again.';
  if (/check constraint/i.test(msg)) return 'Some values are not valid. Please check the form.';
  if (/^[A-Z][^{}<>]{3,200}$/.test(msg) || /₹/.test(msg)) return msg;
  return 'Something went wrong. Please try again.';
}

export function newKey(): string {
  return crypto.randomUUID();
}
