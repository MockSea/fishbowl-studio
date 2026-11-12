// npm runs this when it installs the studio from GitHub (npx github:MockSea/fishbowl-studio#vX.Y.Z).
// It does nothing itself. Having a prepare script makes npm run a full install in its clone, which
// follows package-lock.json, and package.json lists every runtime dependency under
// bundleDependencies, so the package npm builds from that clone carries those exact versions.
// Without it, npm resolves the dependency tree fresh for each person and ignores the lock file.
