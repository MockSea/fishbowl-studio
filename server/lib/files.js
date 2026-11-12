// The web app's own files (server/ui, package.json), read relative to the app's root. The core's
// files go through core/lib/files.js. See there for how the standalone build embeds both.
import { ownFiles, packageDir } from '#core/files.js';

export const APP_DIR = packageDir(import.meta.url, 2);
export const { ROOT, readOwn, listOwn } = ownFiles(APP_DIR);

// The folders the web app needs embedded in a standalone build, relative to APP_DIR.
export const OWN_DIRS = ['server/ui', 'server/ui/skins'];
