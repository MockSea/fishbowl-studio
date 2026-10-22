// URL safety and normalisation. Sources must be plain HTTPS hosts: no credentials,
// no port, no IP addresses. Item links must be HTTPS.

const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$|^\[?[0-9a-f:]+\]?$/i;

export function safeHttpsUrl(raw) {
  let u;
  try { u = new URL(String(raw ?? '').trim()); } catch { return { ok: false, reason: 'not a valid web address' }; }
  if (u.protocol !== 'https:') return { ok: false, reason: 'must start with https://' };
  if (u.username || u.password) return { ok: false, reason: 'must not contain a username or password' };
  if (u.port) return { ok: false, reason: 'must not specify a port' };
  const host = u.hostname.toLowerCase();
  if (IP_RE.test(host) || !host.includes('.') || host.endsWith('.local') || host === 'localhost') return { ok: false, reason: 'must be a public host name, not an IP or local address' };
  u.hash = '';
  return { ok: true, url: u.toString(), host };
}

const TRACKING = /^(utm_\w+|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|cmpid|ncid|ocid)$/i;

// Canonical form used for exact-URL dedupe.
export function normaliseUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return String(raw || '').trim(); }
  u.hash = '';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '');
  return u.toString();
}

export function hostOf(raw) {
  try { return new URL(raw).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

// Aggregator unwrapping: when an item's link points at an aggregator host, pull the
// original article out of its description. HTTPS only, not the aggregator, not a bare homepage.
export function unwrapAggregator(link, descriptionHtml, aggregatorHosts = []) {
  const host = hostOf(link);
  if (!aggregatorHosts.some((h) => host === h || host.endsWith('.' + h))) return null;
  const hrefs = [...String(descriptionHtml || '').matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => decodeAmp(m[1]));
  for (const h of hrefs) {
    const s = safeHttpsUrl(h);
    if (!s.ok) continue;
    if (aggregatorHosts.some((a) => s.host === a || s.host.endsWith('.' + a))) continue;
    const u = new URL(s.url);
    if (u.pathname === '/' || u.pathname === '') continue;
    return s.url;
  }
  return null;
}

const decodeAmp = (s) => s.replace(/&amp;/g, '&');
