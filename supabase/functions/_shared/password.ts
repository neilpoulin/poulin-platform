async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function passwordMatches(storedValue: string | null, provided: string): Promise<boolean> {
  if (!storedValue) return false;

  if (storedValue.startsWith("sha256:")) {
    const digest = await sha256Hex(provided);
    return storedValue === `sha256:${digest}`;
  }

  return storedValue === provided;
}
