async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashPassword(value: string): Promise<string> {
  const digest = await sha256Hex(value);
  return `sha256:${digest}`;
}

export async function passwordMatches(storedValue: string | null, provided: string): Promise<boolean> {
  if (!storedValue) return false;

  if (storedValue.startsWith("sha256:")) {
    return storedValue === await hashPassword(provided);
  }

  return storedValue === provided;
}
