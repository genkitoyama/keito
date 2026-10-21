/** Names Windows keeps for devices: a file may not be called these, whatever its extension. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
/** How long a name may run, in UTF-8 bytes: room is left for what goes after it ("_機材・ケーブル表.xlsx"). */
const MAX_BYTES = 150;

/**
 * A board's title made fit to be a file's name on any system: characters Windows and macOS refuse
 * (and runs of spaces) become "_", no device name of Windows, no trailing dot or space, and short
 * enough for the file system once something is added after it.
 */
export function safeName(title: string): string {
  let name = title
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f\s]+/g, '_')
    .replace(/[._\s]+$/g, '');
  if (RESERVED.test(name.split('.')[0])) name = `_${name}`;
  const bytes = new TextEncoder();
  while (bytes.encode(name).length > MAX_BYTES) name = [...name].slice(0, -1).join('');
  return name || 'board';
}
