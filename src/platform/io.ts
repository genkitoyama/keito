/**
 * What the app asks of the system it runs in, besides keeping boards (see storage.ts): saving and
 * picking files, asking and telling the user, opening links, the clipboard, small settings. The
 * web's ways are here; the desktop app hands in its own with `usePlatform`, and nothing else in
 * the app needs to know which it runs in.
 */
export interface Platform {
  /** Save a file the user names (or that goes to their downloads); false when they called it off. */
  saveFile(name: string, data: Blob | string, type: string): Promise<boolean>;
  /** One file of the given kinds, or null when the dialog is dismissed. */
  pickFile(accept: string): Promise<File | null>;
  /** A yes-or-no question; true for yes. */
  ask(message: string): Promise<boolean>;
  /** A message the user acknowledges. */
  tell(message: string): Promise<void>;
  /** Open a web page in the user's browser. */
  openLink(url: string): void;
  /** Whether links must be opened through `openLink` (the browser does not follow them itself). */
  ownsLinks: boolean;
  copyText(text: string): Promise<void>;
  /** Put a PNG on the clipboard, handed over while it is still being made (see web's). */
  copyPng(png: Promise<Blob>): Promise<void>;
  /** Print a page made for print (to PDF, through the print dialog); what to tell the user. */
  print(html: string): Promise<string>;
}

const web: Platform = {
  async saveFile(name, data, type) {
    const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    // A browser saves without asking (or asks on its own): it is never called off from here.
    return true;
  },
  pickFile(accept) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.onchange = () => resolve(input.files?.[0] ?? null);
      input.oncancel = () => resolve(null);
      input.click();
    });
  },
  ask: async (message) => window.confirm(message),
  tell: async (message) => window.alert(message),
  openLink: (url) => void window.open(url, '_blank', 'noopener'),
  ownsLinks: false,
  copyText: (text) => navigator.clipboard.writeText(text),
  // Safari only lets the click itself write to the clipboard, not a moment later: the PNG goes in
  // while it is still being made.
  copyPng: (png) => navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]),
  async print(html) {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(frame);
    const d = frame.contentDocument!;
    d.open();
    d.write(html);
    d.close();
    const win = frame.contentWindow!;
    win.onafterprint = () => frame.remove();
    // Pictures (large photos as data) must be drawn before the page goes to print.
    await Promise.all([...d.images].map((img) => img.decode().catch(() => {})));
    win.focus();
    win.print();
    return '印刷ダイアログで送信先を「PDF に保存」にしてください（用紙は横向きで出ます）。';
  },
};

let platform: Platform = web;

/** Hand in the ways of the system the app runs in (the desktop app does, at start). */
export const usePlatform = (p: Platform): void => void (platform = p);

export const saveFile = (name: string, data: Blob | string, type = 'application/octet-stream'): Promise<boolean> => platform.saveFile(name, data, type);
export const pickFile = (accept: string): Promise<File | null> => platform.pickFile(accept);
export const ask = (message: string): Promise<boolean> => platform.ask(message);
export const tell = (message: string): Promise<void> => platform.tell(message);
export const openLink = (url: string): void => platform.openLink(url);
export const copyText = (text: string): Promise<void> => platform.copyText(text);
export const copyPng = (png: Promise<Blob>): Promise<void> => platform.copyPng(png);
export const printPage = (html: string): Promise<string> => platform.print(html);

/** A text file's name and contents, or null when none was picked. */
export async function pickTextFile(accept: string): Promise<{ name: string; text: string } | null> {
  const f = await pickFile(accept);
  return f ? { name: f.name, text: await f.text() } : null;
}

/**
 * What a link does when clicked: followed by the browser, or, where the browser does not follow
 * links out of the app, opened through the system. Spread onto an <a href target="_blank">.
 */
export const linkClick = (url: string | undefined) => (e: { preventDefault(): void; stopPropagation(): void }) => {
  e.stopPropagation();
  if (!url || !platform.ownsLinks) return;
  e.preventDefault();
  openLink(url);
};

/** Small settings of this user (the last export chosen, a panel's width …), kept on this machine. */
export function getSetting(name: string): string {
  try {
    return localStorage.getItem(`keito:setting:${name}`) ?? '';
  } catch {
    return '';
  }
}
export function setSetting(name: string, value: string): void {
  try {
    localStorage.setItem(`keito:setting:${name}`, value);
  } catch {
    // No room, or no storage: the setting is only lost.
  }
}
