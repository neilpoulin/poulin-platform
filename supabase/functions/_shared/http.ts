export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Connection": "keep-alive",
    },
  });
}

export function badRequest(message: string): Response {
  return json(400, { error: message });
}

export function unauthorized(message = "Unauthorized"): Response {
  return json(401, { error: message });
}

export function forbidden(message = "Forbidden"): Response {
  return json(403, { error: message });
}

export function serverError(message = "Internal server error"): Response {
  return json(500, { error: message });
}
