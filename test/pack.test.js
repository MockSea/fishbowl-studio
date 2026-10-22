import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { listFiles, zip, crc32 } from '../scripts/pack.mjs';

test('pack includes the plugin and leaves out dev, tests and scripts', () => {
  const files = listFiles();
  assert.ok(files.includes('.claude-plugin/plugin.json'));
  assert.ok(files.includes('server/index.js'));
  assert.ok(files.includes('skills/daily-run/SKILL.md'));
  assert.ok(files.some((f) => f.startsWith('shapes/')));
  assert.ok(!files.some((f) => /^(dev|test|scripts)\//.test(f)));
  assert.ok(!files.some((f) => f.startsWith('bin/')), 'a top-level bin/ breaks Cowork installs');
});

test('zip output has valid entries that inflate back', () => {
  const data = Buffer.from('hello hello hello');
  const z = zip([{ name: 'a.txt', data }]);
  assert.equal(z.readUInt32LE(0), 0x04034b50);
  assert.equal(z.readUInt32LE(z.length - 22), 0x06054b50);
  const nameLen = z.readUInt16LE(26), compLen = z.readUInt32LE(18);
  const comp = z.subarray(30 + nameLen, 30 + nameLen + compLen);
  assert.equal(zlib.inflateRawSync(comp).toString(), 'hello hello hello');
  assert.equal(z.readUInt32LE(14), crc32(data));
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});
