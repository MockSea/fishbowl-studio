// Dev harness request guard: /rpc and /reseed only take JSON from the harness page itself (or
// from curl, which sends no Origin), so another site open in the browser can't drive the server.
// `extra` lists further exact origins, for a preview served under another name (DEV_ORIGINS).
export function allowedPost(headers, port, extra = []) {
  const type = String(headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return false;
  const origin = headers.origin;
  return origin === undefined || origin === `http://localhost:${port}` || origin === `http://127.0.0.1:${port}` || extra.includes(origin);
}
