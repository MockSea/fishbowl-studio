// How a second copy of the command and a running studio prove to each other that both hold the
// control secret in the app folder's lock file, without either one sending it.
//   request:  a fresh random nonce and HMAC(secret, "request\n" + nonce)
//   answer:   the launch URL and HMAC(secret, "answer\n" + nonce + "\n" + url)
// A listener on the port that is not the studio (a stale lock file, another user's program) sees
// only the nonce and the request HMAC. It can't produce the answer HMAC, so the command doesn't
// trust its URL.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const NONCE = /^[0-9a-f]{64}$/;
const mac = (secret, text) => createHmac('sha256', String(secret)).update(text).digest('hex');

export function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// The headers a second copy sends, and the nonce it checks the answer against.
export function controlRequest(secret, nonce = randomBytes(32).toString('hex')) {
  return { nonce, headers: { 'x-control-nonce': nonce, 'x-control-auth': mac(secret, `request\n${nonce}`) } };
}

// The server side: true when the request headers were made with this secret.
export function requestValid(secret, headers) {
  const nonce = String(headers['x-control-nonce'] || '');
  return NONCE.test(nonce) && same(headers['x-control-auth'] || '', mac(secret, `request\n${nonce}`));
}

export const answerProof = (secret, nonce, url) => mac(secret, `answer\n${nonce}\n${url}`);
export const answerValid = (secret, nonce, url, proof) => typeof proof === 'string' && same(proof, answerProof(secret, nonce, url));
