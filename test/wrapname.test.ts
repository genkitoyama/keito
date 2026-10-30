import { describe, expect, it } from 'vitest';
import { wrapName, wrapText } from '../src/model/text';

// Outside the browser text is measured by estimate: a full-width character is as wide as the type.
const font = '700 13px sans-serif';
const width = 168;

describe('device names on two lines', () => {
  it('breaks before a bracket rather than inside a word', () => {
    expect(wrapText('HDBaseT 送信機（ステージ下手側）', width, font)).not.toEqual(['HDBaseT 送信機', '（ステージ下手側）']);
    expect(wrapName('HDBaseT 送信機（ステージ下手側）', width, font)).toEqual(['HDBaseT 送信機', '（ステージ下手側）']);
    expect(wrapName('プロジェクター 1（床・左側・天吊り）', width, font)).toEqual(['プロジェクター 1', '（床・左側・天吊り）']);
  });

  it('breaks after a separator when no bracket or space will do', () => {
    expect(wrapText('床投影・壁投影用メディアサーバー', width, font)).toEqual(['床投影・壁投影用メディア', 'サーバー']);
    expect(wrapName('床投影・壁投影用メディアサーバー', width, font)).toEqual(['床投影・', '壁投影用メディアサーバー']);
  });

  it('keeps a name that fits, and never takes more lines than the plain wrap', () => {
    expect(wrapName('映像再生PC', width, font)).toEqual(['映像再生PC']);
    const long = 'とても長い名前のついた機材でどこにも区切りがないもの';
    expect(wrapName(long, width, font)).toEqual(wrapText(long, width, font));
    expect(wrapName('A（とても長い名前のついた機材でどこにも区切りがないもの）', width, font).length).toBe(wrapText('A（とても長い名前のついた機材でどこにも区切りがないもの）', width, font).length);
  });
});
