#!/usr/bin/env node
// npm 11 can skip Electron's install script, which leaves it without its binary. Run the
// script once if the binary is missing, so `npm run desktop` and `npm run make` just work.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const dir = path.dirname(require.resolve('electron/package.json'));
if (!fs.existsSync(path.join(dir, 'path.txt'))) execFileSync(process.execPath, [path.join(dir, 'install.js')], { stdio: 'inherit' });
