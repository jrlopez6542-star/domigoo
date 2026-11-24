export class ProxyError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ProxyError";
    this.status = status;
    if (code !== undefined) {
      this.code = code;
    }
  }
}

export async function callProxy<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/proxy/${path}`, {
    method,
    headers: {
      "content-type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = { message: text };
    }
  }
  if (!res.ok) {
    const msg =
      typeof parsed === "object" &&
      parsed !== null &&
      "message" in parsed &&
      typeof parsed.message === "string"
        ? (parsed as { message: string }).message
        : `Error ${String(res.status)}`;
    const code =
      typeof parsed === "object" &&
      parsed !== null &&
      "code" in parsed &&
      typeof parsed.code === "string"
        ? (parsed as { code: string }).code
        : undefined;
    throw new ProxyError(msg, res.status, code);
  }
  return parsed as T;
}

export function extractTrackingToken(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }
  const match = /\/tracking\/([^/?#]+)/i.exec(trimmed);
  if (match && match[1]) {
    return decodeURIComponent(match[1]);
  }
  return trimmed;
}
