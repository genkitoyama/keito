import { fromYaml } from './dsl';
import { docBounds } from './geometry';
import { randomId } from './presets';
import { catalog, pull } from './shared';
import { placeLabels } from './labels';
import type { Doc } from './types';

/**
 * The project a first run starts with: a small interactive floor projection, drawn the way a real
 * one would be (makers, models, addresses, lengths, power), on the three kinds of board most work
 * uses. Every board says it is a sample, to be changed or thrown away. Written in the same YAML the
 * editor imports; the PCs are shared between the boards (software runs on them).
 */

const PROJECT = 'サンプル展示';

/** The banner heading each sample board (put above the drawing once it is laid out: see bannerOnTop). */
const NOTE = (what: string) => `
  - id: note
    shape: rect
    color: yellow
    fontSize: 13
    size: [760, 64]
    text: "これはサンプルです。${what}\\n自由に書き換えたり、上の「削除」で消したりしてかまいません。新しい案件はボード一覧の「＋ 新しい案件」から作れます。"`;

const SYSTEM = `title: 【サンプル】映像・センサー系統図
project: ${PROJECT}
signals:
  - { id: hdbt, label: HDBaseT, prefix: HDB, color: "#0d9488" }
areas:
  - { name: 制御ブース, color: blue, rect: [-20, 10, 910, 1170] }
  - { name: 展示室, color: green, rect: [1090, 10, 970, 1170] }
devices:
  # The booth on the left, the room on the right: picture and sound run left to right in the
  # upper rows, the network along the lower ones, and every long run crosses once between them.
  - id: pc1
    name: 映像再生PC
    maker: Dell
    model: Precision 3680 Tower (RTX 4000 Ada)
    category: PC
    area: 制御ブース
    ip: 192.168.10.11
    host: td-main
    watts: 450
    shared: sh_sample_td
    note: TouchDesigner
    in: [AC:power]
    out: [DP 1:video, DP 2:video, USB:usb, LAN:lan]
    width: 240
    pos: [100, 80]
  - id: pc2
    name: センサーPC
    maker: ASUS
    model: NUC 13 Pro
    category: PC
    area: 制御ブース
    ip: 192.168.10.12
    host: sensor-pc
    watts: 65
    shared: sh_sample_sensor
    in: [DC:power]
    out: [LAN:lan]
    pos: [100, 654]
  - id: tx1
    name: HDBaseT 送信機 1
    maker: ATEN
    model: VE811T
    category: 延長器
    area: 制御ブース
    watts: 5
    in: [HDMI IN:video, DC:power]
    out: [HDBaseT:hdbt]
    pos: [640, 80]
  - id: tx2
    name: HDBaseT 送信機 2
    maker: ATEN
    model: VE811T
    category: 延長器
    area: 制御ブース
    watts: 5
    in: [HDMI IN:video, DC:power]
    out: [HDBaseT:hdbt]
    pos: [640, 230]
  - id: au1
    name: オーディオIF
    maker: RME
    model: Babyface Pro FS
    category: 音響
    area: 制御ブース
    in: [USB:usb]
    out: [OUT 1:audio, OUT 2:audio]
    pos: [640, 350]
  - id: sw1
    name: PoEスイッチ
    maker: NETGEAR
    model: GS308PP
    category: ネットワーク
    area: 制御ブース
    ip: 192.168.10.2
    watts: 95
    in: [AC:power, PoE 1:lan, PoE 2:lan]
    out: [PoE 3:lan, PoE 4:lan, PoE 5:lan, PoE 6:lan, PoE 7:lan, PoE 8:lan]
    pos: [640, 610]
  - id: ipad1
    name: スタッフ用 iPad
    maker: Apple
    model: iPad (第10世代)
    category: 操作端末
    area: 展示室
    ip: 192.168.10.51
    shared: sh_sample_ipad
    in: [Wi-Fi:wireless]
    pos: [1560, 960]
  - id: ups1
    name: UPS
    maker: APC
    model: SMT1500J
    category: 電源
    area: 制御ブース
    capacity: 1000
    in: [AC IN:power]
    out: [AC 1:power, AC 2:power, AC 3:power, AC 4:power, AC 5:power, AC 6:power]
    pos: [100, 830]
  - id: rx1
    name: HDBaseT 受信機 1
    maker: ATEN
    model: VE811R
    category: 延長器
    area: 展示室
    watts: 5
    in: [HDBaseT:hdbt, DC:power]
    out: [HDMI OUT:video]
    pos: [1180, 80]
  - id: rx2
    name: HDBaseT 受信機 2
    maker: ATEN
    model: VE811R
    category: 延長器
    area: 展示室
    watts: 5
    in: [HDBaseT:hdbt, DC:power]
    out: [HDMI OUT:video]
    pos: [1180, 230]
  - id: sp1
    name: スピーカー L
    maker: GENELEC
    model: 8030C
    category: 音響
    area: 展示室
    watts: 50
    in: [IN:audio, AC:power]
    pos: [1180, 350]
  - id: sp2
    name: スピーカー R
    maker: GENELEC
    model: 8030C
    category: 音響
    area: 展示室
    watts: 50
    in: [IN:audio, AC:power]
    pos: [1180, 470]
  - id: pj1
    name: プロジェクター 1（床・左）
    maker: Panasonic
    model: PT-REZ12
    category: 映像表示
    area: 展示室
    ip: 192.168.10.31
    watts: 560
    in: [HDMI:video, AC:power, LAN:lan]
    width: 220
    pos: [1560, 80]
  - id: pj2
    name: プロジェクター 2（床・右）
    maker: Panasonic
    model: PT-REZ12
    category: 映像表示
    area: 展示室
    ip: 192.168.10.32
    watts: 560
    in: [HDMI:video, AC:power, LAN:lan]
    width: 220
    pos: [1560, 230]
  - id: ld1
    name: LiDAR 1
    maker: 北陽電機
    model: UST-10LX
    category: センサー
    area: 展示室
    ip: 192.168.10.21
    watts: 4
    in: [LAN:lan, DC 24V:power]
    pos: [1180, 720]
  - id: ld2
    name: LiDAR 2
    maker: 北陽電機
    model: UST-10LX
    category: センサー
    area: 展示室
    ip: 192.168.10.22
    watts: 4
    in: [LAN:lan, DC 24V:power]
    pos: [1180, 840]
  - id: ap1
    name: Wi-Fi AP
    maker: TP-Link
    model: EAP225
    category: ネットワーク
    area: 展示室
    ip: 192.168.10.5
    in: [LAN/PoE:lan]
    out: [Wi-Fi:wireless]
    pos: [1180, 960]
  - id: tap1
    name: 電源タップ
    category: 電源
    area: 展示室
    capacity: 1500
    in: [AC IN:power]
    out: [AC 1:power, AC 2:power, AC 3:power, AC 4:power, AC 5:power, AC 6:power, AC 7:power, AC 8:power]
    pos: [1560, 580]
  - id: mains1
    name: 会場電源
    category: 電源
    area: 制御ブース
    venue: true
    capacity: 1500
    note: 壁コンセント（15A 回路）
    out: [AC:power]
    pos: [100, 1070]
  - id: mains2
    name: 会場電源
    category: 電源
    area: 展示室
    venue: true
    capacity: 1500
    note: 壁コンセント（15A 回路）
    out: [AC:power]
    pos: [1180, 1070]
  - id: psu1
    name: 24V 電源
    maker: MEAN WELL
    model: LRS-50-24
    category: 電源
    area: 展示室
    capacity: 50
    in: [AC:power]
    out: [DC 1:power, DC 2:power]
    pos: [1560, 420]
cables:
  - { from: pc1.DP 1, to: tx1.HDMI IN, type: video, spec: DP→HDMI 変換, length: 2 }
  - { from: pc1.DP 2, to: tx2.HDMI IN, type: video, spec: DP→HDMI 変換, length: 2 }
  - { from: tx1.HDBaseT, to: rx1.HDBaseT, type: hdbt, spec: Cat6A STP, length: 30 }
  - { from: tx2.HDBaseT, to: rx2.HDBaseT, type: hdbt, spec: Cat6A STP, length: 30 }
  - { from: rx1.HDMI OUT, to: pj1.HDMI, type: video, spec: HDMI, length: 1, labelAt: 0.65 }
  - { from: rx2.HDMI OUT, to: pj2.HDMI, type: video, spec: HDMI, length: 1, labelAt: 0.65 }
  - { from: pc1.USB, to: au1.USB, type: usb, length: 1 }
  - { from: au1.OUT 1, to: sp1.IN, type: audio, spec: TRS-XLR, length: 20 }
  - { from: au1.OUT 2, to: sp2.IN, type: audio, spec: TRS-XLR, length: 20 }
  - { from: pc1.LAN, to: sw1.PoE 1, type: lan, spec: Cat6, length: 1 }
  - { from: pc2.LAN, to: sw1.PoE 2, type: lan, spec: Cat6, length: 1 }
  - { from: sw1.PoE 3, to: pj1.LAN, type: lan, spec: Cat6, length: 30, label: PJLink, route: [[1380, 665], [1380, 179]] }
  - { from: sw1.PoE 4, to: pj2.LAN, type: lan, spec: Cat6, length: 30, label: PJLink, route: [[1410, 687], [1410, 329]] }
  - { from: sw1.PoE 5, to: ld1.LAN, type: lan, spec: Cat6, length: 30, route: [[1060, 709], [1060, 775]] }
  - { from: sw1.PoE 6, to: ld2.LAN, type: lan, spec: Cat6, length: 30, route: [[1030, 731], [1030, 895]] }
  - { from: sw1.PoE 7, to: ap1.LAN/PoE, type: lan, spec: Cat6, length: 25, route: [[1000, 753], [1000, 1015]] }
  - { from: ap1.Wi-Fi, to: ipad1.Wi-Fi, type: wireless, label: Wi-Fi }
  - { from: mains1.AC, to: ups1.AC IN, type: power, length: 3 }
  - { from: mains2.AC, to: tap1.AC IN, type: power, length: 5 }
  - { from: ups1.AC 1, to: pc1.AC, type: power, length: 2 }
  - { from: ups1.AC 2, to: pc2.DC, type: power, length: 2 }
  - { from: ups1.AC 3, to: sw1.AC, type: power, length: 1.5 }
  - { from: ups1.AC 4, to: tx1.DC, type: power, length: 1.5 }
  - { from: ups1.AC 5, to: tx2.DC, type: power, length: 1.5 }
  - { from: tap1.AC 1, to: pj1.AC, type: power, length: 5 }
  - { from: tap1.AC 2, to: pj2.AC, type: power, length: 5 }
  - { from: tap1.AC 3, to: rx1.DC, type: power, length: 2 }
  - { from: tap1.AC 4, to: rx2.DC, type: power, length: 2 }
  - { from: tap1.AC 5, to: sp1.AC, type: power, length: 3 }
  - { from: tap1.AC 6, to: sp2.AC, type: power, length: 3 }
  - { from: tap1.AC 7, to: psu1.AC, type: power, length: 1 }
  - { from: psu1.DC 1, to: ld1.DC 24V, type: power, length: 10 }
  - { from: psu1.DC 2, to: ld2.DC 24V, type: power, length: 10 }
shapes:${NOTE('来場者の位置を床の LiDAR で読み取り、床に映す映像が変わる展示の構成です。')}
`;

const SOFTWARE = `title: 【サンプル】ソフトウェア構成
kind: software
project: ${PROJECT}
areas:
  # One area per machine: the apps that share an address sit together.
  - { name: スタッフ用 iPad（192.168.10.51）, color: green, rect: [680, 0, 280, 140] }
  - { name: センサーPC（192.168.10.12）, color: orange, rect: [20, 160, 600, 340] }
  - { name: 映像再生PC（192.168.10.11）, color: blue, rect: [680, 160, 610, 340] }
devices:
  - id: sensor
    name: センサー処理
    model: Python 3.12
    category: アプリ
    area: センサーPC（192.168.10.12）
    runsOn: sh_sample_sensor
    note: LiDAR 2 台の点群から人の位置を出す
    in: [HTTP:http, LiDAR:udp]
    out: [OSC:osc]
    pos: [400, 380]
  - id: td
    name: 床映像（TouchDesigner）
    model: TouchDesigner 2025
    category: アプリ
    area: 映像再生PC（192.168.10.11）
    runsOn: sh_sample_td
    in: [WebSocket:websocket, HTTP:http, OSC:osc]
    width: 220
    pos: [1040, 200]
  - id: ui
    name: 操作UI（Web）
    model: Safari
    category: アプリ
    area: スタッフ用 iPad（192.168.10.51）
    runsOn: sh_sample_ipad
    note: 映像再生PC の TouchDesigner が配信するページを開く
    out: [WebSocket:websocket]
    pos: [710, 50]
  - id: boot
    name: 起動・監視スクリプト
    model: Node.js 22
    category: アプリ
    area: センサーPC（192.168.10.12）
    runsOn: sh_sample_sensor
    note: 開館時に機材とアプリを順に立ち上げ、止まったら再起動する
    out: [HTTP 1:http, HTTP 2:http, PJLink:tcp]
    pos: [50, 222]
cables:
  - { from: sensor.OSC, to: td.OSC, type: osc, spec: 7000/udp, label: 人の位置 }
  - { from: ui.WebSocket, to: td.WebSocket, type: websocket, spec: 9980/tcp, label: 演出の切替 }
  - { from: boot.HTTP 1, to: td.HTTP, type: http, spec: 9981/tcp, label: 死活監視 }
  - { from: boot.HTTP 2, to: sensor.HTTP, type: http, spec: 8080/tcp, label: 死活監視 }
shapes:${NOTE('系統図の PC と iPad で動くアプリと、その間の通信（ポート番号つき）です。')}
`;

const SEQUENCE = `title: 【サンプル】起動手順
kind: sequence
project: ${PROJECT}
sequences:
  - id: seq1
    text: |
      title: 開館時の起動手順
      autonumber
      participant ST as スタッフ
      participant BT as 起動スクリプト
      participant PJ as プロジェクター
      participant SN as センサー処理
      participant TD as 床映像
      ST -> BT: 起動ボタン（操作UI）
      BT -> PJ: 電源ON（PJLink）
      PJ --> BT: OK
      note over PJ: ウォームアップ 約60秒
      BT -> SN: 起動
      BT -> TD: 起動
      loop 30秒ごと
      BT -> SN: 死活監視
      BT -> TD: 死活監視
      end
      alt 応答なし
      BT -> TD: 再起動
      BT -> ST: 通知
      end
shapes:${NOTE('開館時に、機材とアプリを立ち上げる順番です。')}
`;

/** The first-run project's boards, the system diagram first (it is the one opened). */
export const SAMPLE_BOARDS = [SYSTEM, SOFTWARE, SEQUENCE];

/** A board's banner (the sample's "これはサンプルです") over the top left of everything else. */
function bannerOnTop(doc: Doc): Doc {
  const note = doc.nodes.find((n) => n.id === 'note');
  const rest = note && docBounds({ ...doc, nodes: doc.nodes.filter((n) => n !== note) });
  if (!note || !rest) return doc;
  return { ...doc, nodes: doc.nodes.map((n) => (n === note ? { ...n, x: rest.x, y: rest.y - n.h - 40 } : n)) };
}

/** The sample project's boards, the PCs they share filled in on each (its software runs on them). */
export function sampleBoards(): Doc[] {
  try {
    const docs = SAMPLE_BOARDS.map((yaml) => fromYaml(yaml, { version: 1, id: randomId(), meta: { title: '', project: '' }, nodes: [], edges: [] }));
    const entries = catalog(docs);
    // The drawings are laid out by hand in the YAML: only the line labels are slid to where they are clear.
    return docs.map((d) => bannerOnTop(d.kind === 'sequence' ? pull(d, entries) : placeLabels(pull(d, entries))));
  } catch (e) {
    console.error(e);
    return [{ version: 1, id: randomId(), meta: { title: '', project: '' }, nodes: [], edges: [] }];
  }
}
