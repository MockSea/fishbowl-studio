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
  const bare = host.replace(/\.+$/, '');
  if (IP_RE.test(bare) || !bare.includes('.') || LOCAL_TLD.test(bare)) return { ok: false, reason: 'must be a public host name, not an IP or local address' };
  u.hash = '';
  return { ok: true, url: u.toString(), host };
}

// Names that only ever mean "this machine" or "this network" (trailing dots already removed).
const LOCAL_TLD = /(^|\.)(localhost|local|internal|intranet|lan|home\.arpa|localdomain)$/;

// Refuse a host whose DNS answer includes a loopback, private, link-local, CGNAT, ULA,
// multicast or otherwise non-public address. `lookup` is dns.promises.lookup or a test double.
export async function checkAddress(host, lookup) {
  let addrs;
  try { addrs = await lookup(host, { all: true, verbatim: true }); } catch { throw new Error('host not found'); }
  const list = (Array.isArray(addrs) ? addrs : [addrs]).map((a) => (typeof a === 'string' ? a : a.address));
  if (!list.length) throw new Error('host not found');
  const bad = list.find(privateAddress);
  if (bad) throw new Error(`refused: ${host} points at a private or local address`);
}

export function privateAddress(ip) {
  ip = String(ip).toLowerCase().replace(/^\[|\]$/g, '');
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) ip = mapped[1];
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && Number(v4[3]) === 0) ||
      (a === 198 && (b === 18 || b === 19));
  }
  if (!ip.includes(':')) return true;
  if (ip === '::' || ip === '::1') return true;
  const head = parseInt(ip.split(':')[0] || '0', 16);
  return (head & 0xfe00) === 0xfc00 || (head & 0xffc0) === 0xfe80 || (head & 0xff00) === 0xff00 || /^::ffff:/.test(ip);
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
