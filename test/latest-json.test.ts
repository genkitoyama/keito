import { describe, expect, it } from 'vitest';
import { withPlatform } from '../scripts/latest-json.mjs';

const now = new Date('2026-11-02T00:00:00Z');
const mac = { url: 'https://example.com/keito_0.2.0_aarch64.app.tar.gz', signature: 'mac-sig' };
const win = { url: 'https://example.com/keito_0.2.0_x64-setup.exe', signature: 'win-sig' };

describe('the manifest of a release', () => {
  it('names the update made for one system', () => {
    expect(withPlatform(null, '0.2.0', 'darwin-aarch64', mac.url, mac.signature, now)).toEqual({
      version: '0.2.0',
      pub_date: '2026-11-02T00:00:00.000Z',
      platforms: { 'darwin-aarch64': mac },
    });
  });

  it('keeps the other systems of the same version, in whichever order they are made', () => {
    const first = withPlatform(null, '0.2.0', 'windows-x86_64', win.url, win.signature, now);
    const both = withPlatform(first, '0.2.0', 'darwin-aarch64', mac.url, mac.signature, now);
    expect(both.platforms).toEqual({ 'windows-x86_64': win, 'darwin-aarch64': mac });
  });

  it('replaces the same system made again', () => {
    const first = withPlatform(null, '0.2.0', 'darwin-aarch64', mac.url, 'old-sig', now);
    expect(withPlatform(first, '0.2.0', 'darwin-aarch64', mac.url, mac.signature, now).platforms).toEqual({ 'darwin-aarch64': mac });
  });

  it('drops the systems of another version, so none is offered an older update', () => {
    const old = withPlatform(null, '0.1.9', 'windows-x86_64', 'https://example.com/old.exe', 'old-sig', now);
    expect(withPlatform(old, '0.2.0', 'darwin-aarch64', mac.url, mac.signature, now).platforms).toEqual({ 'darwin-aarch64': mac });
  });
});
