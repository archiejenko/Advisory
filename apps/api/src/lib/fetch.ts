// Every call to another service gets a deadline. A hung upstream would otherwise hold a request, or a batch of queue
// messages, until the platform's own limit, and each retry would hang again.
export const TIMEOUT_MS = 10000;

export function fetchT(url: string | URL, init: RequestInit = {}, ms = TIMEOUT_MS): Promise<Response> {
  return fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(ms) });
}
