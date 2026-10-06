import Anthropic from '@anthropic-ai/sdk';
import { DSL_GUIDE } from './dsl';

export const AI_SYSTEM = `あなたは映像・インタラクティブ展示のテクニカルディレクターを補佐し、システム構成図（系統図）を keito YAML で書くアシスタントです。

${DSL_GUIDE}
ルール:
- 出力は YAML 全体を \`\`\`yaml コードブロック1つだけで返す。説明文は書かない。
- 既存の YAML が与えられたら、指示された箇所だけを変更し、それ以外（id・pos・rect を含む）はそのまま残す。
- 新しく追加する要素には pos を書かない（自動レイアウトされる）。
- 信号は出力ポート(out) → 入力ポート(in) の向きで cables に書く。実在する機材は maker / model を分かる範囲で埋め、不確かなら空にする。url は与えられたものだけを書き、推測で作らない。
- 電源・LAN など、指示に無くても系統として必要な結線は補ってよいが、過剰に増やさない。`;

/** Full prompt for pasting into any chat when no API key is configured. */
export const promptFor = (instruction: string, yaml: string): string =>
  `${AI_SYSTEM}\n\n# 現在の YAML\n\`\`\`yaml\n${yaml}\`\`\`\n\n# 指示\n${instruction}\n`;

export function extractYaml(text: string): string {
  const m = /```(?:ya?ml)?\s*\n([\s\S]*?)```/.exec(text);
  return (m ? m[1] : text).trim() + '\n';
}

export async function generateYaml(apiKey: string, instruction: string, yaml: string): Promise<string> {
  // The key stays in this browser's localStorage and is sent only to api.anthropic.com.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  try {
    const message = await client.beta.messages
      .stream({
        model: 'claude-opus-5-5',
        max_tokens: 32000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        // Re-run on Anthropic's recommended fallback model if a safety classifier declines.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: AI_SYSTEM,
        messages: [{ role: 'user', content: `# 現在の YAML\n\`\`\`yaml\n${yaml}\`\`\`\n\n# 指示\n${instruction}` }],
      })
      .finalMessage();
    if (message.stop_reason === 'refusal') throw new Error('リクエストがモデルに拒否されました。指示の内容を見直してください。');
    if (message.stop_reason === 'max_tokens') throw new Error('出力が長すぎて途中で切れました。図を分割するか指示を絞ってください。');
    const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    return extractYaml(text);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('API キーが正しくありません。');
    if (e instanceof Anthropic.PermissionDeniedError) throw new Error('この API キーではモデルを利用できません。');
    if (e instanceof Anthropic.RateLimitError) throw new Error('レート制限に達しました。少し待って再実行してください。');
    if (e instanceof Anthropic.APIConnectionError) throw new Error('API に接続できませんでした。ネットワークを確認してください。');
    if (e instanceof Anthropic.APIError) throw new Error(`API エラー (${e.status ?? '?'}): ${e.message}`);
    throw e;
  }
}
