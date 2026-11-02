// The manifest the app looks at for a newer version (plugins.updater in tauri.conf.json): one
// version, and its update for each system. Each release script adds the one it made:
//
//   node scripts/latest-json.mjs <latest.json> <version> <platform> <url> <signature>
//
// (platform: darwin-aarch64, windows-x86_64 …; signature: the .sig file's contents)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The manifest with this system's update in it. The others made for the same version stay; a
 * manifest of another version is started afresh, so that no system is offered an older update.
 */
export function withPlatform(latest, version, platform, url, signature, now = new Date()) {
  const kept = latest?.version === version ? (latest.platforms ?? {}) : {};
  return { version, pub_date: now.toISOString(), platforms: { ...kept, [platform]: { url, signature } } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, version, platform, url, signature] = process.argv.slice(2);
  if (!signature) {
    console.error('usage: node scripts/latest-json.mjs <latest.json> <version> <platform> <url> <signature>');
    process.exit(1);
  }
  const latest = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  writeFileSync(file, `${JSON.stringify(withPlatform(latest, version, platform, url, signature), null, 2)}\n`);
}
