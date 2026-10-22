// Dev harness request guard: /rpc and /reseed only take JSON from the harness page itself (or
// from curl, which sends no Origin), so another site open in the browser can't drive the server.
export function allowedPost(headers, port) {
  const type = String(headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return false;
  const origin = headers.origin;
  return origin === undefined || origin === `http://localhost:${port}` || origin === `http://127.0.0.1:${port}`;
}
