// Phone numbers are stored in E.164 (+919876543210).

/** Normalises user input. A 10-digit Indian mobile gets +91. Returns null if invalid. */
export function toE164(input: string | null | undefined, defaultCountry = '91'): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  let digits = trimmed.replace(/[^\d]/g, '');
  if (!digits) return null;
  if (trimmed.startsWith('+')) {
    // already international
  } else if (trimmed.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = defaultCountry + digits.slice(1);
  } else if (digits.length === 10) {
    digits = defaultCountry + digits;
  }
  const e164 = `+${digits}`;
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) return null;
  if (e164.startsWith('+91') && !/^\+91[6-9]\d{9}$/.test(e164)) return null;
  return e164;
}

/** +919876543210 → +91 98765 43210 */
export function prettyPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}

/** Digits only, for wa.me links. */
export function waDigits(e164: string): string {
  return e164.replace(/[^\d]/g, '');
}
