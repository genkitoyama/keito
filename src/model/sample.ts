/** First-run demo board, written in the same YAML the editor imports. */
export const SAMPLE_YAML = `title: 展示システム系統図（サンプル）
project: サンプル展示
author: keito
devices:
  - id: pc1
    name: メインPC
    maker: Apple
    model: Mac Studio M2 Max
    watts: 370
    category: PC
    area: 制御室
    in: [LAN:lan, USB:usb, AC:power]
    out: [HDMI 1:hdmi, HDMI 2:hdmi]
  - id: sd1
    name: Stream Deck
    maker: Elgato
    model: Stream Deck MK.2
    category: 操作端末
    area: 制御室
    out: [USB:usb]
  - id: sw1
    name: L2スイッチ
    maker: NETGEAR
    model: GS308
    watts: 10
    category: ネットワーク
    area: 制御室
    in: [PORT 1:lan]
    out: [PORT 2:lan, PORT 3:lan, PORT 4:lan]
  - id: tx1
    name: エクステンダー TX
    maker: ATEN
    model: VE811T
    watts: 5
    category: 延長器
    area: 制御室
    in: [HDMI IN:hdmi]
    out: [HDBaseT:lan]
  - id: rx1
    name: エクステンダー RX
    maker: ATEN
    model: VE811R
    category: 延長器
    area: 展示室
    in: [HDBaseT:lan]
    out: [HDMI OUT:hdmi]
  - id: pj1
    name: プロジェクター
    maker: Panasonic
    model: PT-RZ990
    watts: 580
    category: 映像表示
    area: 展示室
    in: [HDMI:hdmi, LAN:lan, AC:power]
  - id: mon1
    name: 操作用モニター
    maker: EIZO
    model: EV2485
    watts: 30
    category: 映像表示
    area: 制御室
    in: [HDMI:hdmi]
  - id: lidar1
    name: LiDAR
    maker: 北陽電機
    model: UST-10LX
    category: センサー
    area: 展示室
    in: [DC:power]
    out: [LAN:lan]
  - id: ups1
    name: UPS
    maker: APC
    model: SMT1500J
    category: 電源
    area: 制御室
    preset: ups
    capacity: 1200
cables:
  - { from: ups1, to: pc1.AC, type: power }
  - { from: ups1, to: sw1, type: power }
  - { from: ups1, to: mon1, type: power }
  - { from: ups1, to: tx1, type: power }
  - { from: ups1, to: pj1.AC, type: power, length: 30 }
  - { from: sd1.USB, to: pc1.USB, type: usb, length: 1.5 }
  - { from: pc1.HDMI 1, to: tx1.HDMI IN, type: hdmi, length: 2, label: メイン映像 }
  - { from: pc1.HDMI 2, to: mon1.HDMI, type: hdmi, length: 2 }
  - { from: tx1.HDBaseT, to: rx1.HDBaseT, type: lan, length: 30, label: Cat6A }
  - { from: rx1.HDMI OUT, to: pj1.HDMI, type: hdmi, length: 1 }
  - { from: sw1.PORT 2, to: pj1.LAN, type: lan, length: 30, label: PJLink }
  - { from: lidar1.LAN, to: sw1.PORT 1, type: lan, length: 30 }
  - { from: sw1.PORT 3, to: pc1.LAN, type: lan, length: 2 }
shapes:
  - { id: s1, shape: round, text: 来場者が入室, color: green }
  - { id: s2, shape: diamond, text: LiDARが検知？, color: yellow }
  - { id: s3, shape: rect, text: インタラクション映像を再生, color: blue }
  - { id: s4, shape: rect, text: 待機ループ映像 }
  - { id: s5, shape: rect, text: 緊急停止, color: red, fill: solid }
  - { id: memo1, shape: sticky, text: "TODO: 電源容量の確認。\\nPJ は 200V 系統？" }
  - { id: c1, shape: cloud, text: "検知範囲は\\n現地で調整", color: blue, fill: none, dash: true }
flows:
  - { from: s1, to: s2 }
  - { from: s2, to: s3, label: はい }
  - { from: s2, to: s4, label: いいえ }
  - { from: s4, to: s5, label: 異常時, dash: true }
sequences:
  - id: seq1
    text: |
      title: 起動シーケンス
      participant PC as メインPC
      participant PJ as プロジェクター
      participant LD as LiDAR
      PC -> PJ: 電源ON (PJLink)
      PJ --> PC: OK
      note over PJ: ウォームアップ 30秒
      PC -> LD: 計測開始
      LD --> PC: 点群ストリーム
`;
