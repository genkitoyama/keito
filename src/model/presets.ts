import { currentSignal, signalOf } from './signals';
import type { ColorKey, DeviceNode, Doc, Edge, EdgeEnd, Node, Port, ShapeKind } from './types';

/** What a port added for a type is called before its number: AC 1, HDMI 1, LAN 1. */
export const portBase = (signal: string): string => (signal === 'power' ? 'AC' : signal === 'video' ? 'HDMI' : signalOf(signal).prefix);

export interface Preset {
  key: string;
  name: string;
  category: string;
  /** Ports as "名前:種別". `in` goes on the left, `out` on the right. */
  in: string[];
  out: string[];
}

export const PRESETS: Preset[] = [
  { key: 'pc', name: 'PC', category: 'PC', in: ['LAN:lan', 'USB:usb', 'AC:power'], out: ['HDMI 1:video', 'HDMI 2:video', 'DP:video'] },
  { key: 'mac', name: 'Mac', category: 'PC', in: ['LAN:lan', 'USB-C:usb', 'AC:power'], out: ['HDMI:video', 'TB 1:video', 'TB 2:video'] },
  { key: 'player', name: 'メディアプレーヤー', category: '再生機', in: ['LAN:lan', 'AC:power'], out: ['HDMI:video', 'AUDIO:audio'] },
  { key: 'pj', name: 'プロジェクター', category: '映像表示', in: ['HDMI:video', 'SDI:video', 'HDBaseT:lan', 'LAN:lan', 'AC:power'], out: [] },
  { key: 'display', name: 'ディスプレイ', category: '映像表示', in: ['HDMI 1:video', 'HDMI 2:video', 'RS-232C:serial', 'AC:power'], out: [] },
  { key: 'ledproc', name: 'LEDプロセッサ', category: '映像表示', in: ['HDMI:video', 'SDI:video', 'LAN:lan', 'AC:power'], out: ['PORT 1:lan', 'PORT 2:lan', 'PORT 3:lan', 'PORT 4:lan'] },
  { key: 'led', name: 'LEDウォール', category: '映像表示', in: ['DATA:lan', 'AC:power'], out: [] },
  { key: 'switcher', name: 'スイッチャー', category: '映像処理', in: ['HDMI IN 1:video', 'HDMI IN 2:video', 'HDMI IN 3:video', 'HDMI IN 4:video', 'LAN:lan'], out: ['HDMI PGM:video', 'HDMI AUX:video', 'HDMI MV:video'] },
  { key: 'matrix', name: 'マトリクススイッチャー', category: '映像処理', in: ['HDMI IN 1:video', 'HDMI IN 2:video', 'HDMI IN 3:video', 'HDMI IN 4:video', 'LAN:lan'], out: ['HDMI OUT 1:video', 'HDMI OUT 2:video', 'HDMI OUT 3:video', 'HDMI OUT 4:video'] },
  { key: 'da', name: '分配器', category: '映像処理', in: ['HDMI IN:video'], out: ['HDMI OUT 1:video', 'HDMI OUT 2:video', 'HDMI OUT 3:video', 'HDMI OUT 4:video'] },
  { key: 'conv', name: 'コンバーター', category: '映像処理', in: ['SDI IN:video'], out: ['HDMI OUT:video'] },
  { key: 'tx', name: 'エクステンダー TX', category: '延長器', in: ['HDMI IN:video'], out: ['HDBaseT:lan'] },
  { key: 'rx', name: 'エクステンダー RX', category: '延長器', in: ['HDBaseT:lan'], out: ['HDMI OUT:video'] },
  { key: 'capture', name: 'キャプチャー', category: '映像処理', in: ['HDMI IN:video'], out: ['USB:usb', 'HDMI LOOP:video'] },
  { key: 'cam', name: 'カメラ', category: 'カメラ', in: ['LAN:lan', 'DC:power'], out: ['SDI:video', 'HDMI:video'] },
  { key: 'webcam', name: 'Webカメラ', category: 'カメラ', in: [], out: ['USB:usb'] },
  { key: 'depth', name: '深度カメラ', category: 'センサー', in: ['DC:power'], out: ['USB:usb'] },
  { key: 'lidar', name: 'LiDAR', category: 'センサー', in: ['DC:power'], out: ['LAN:lan'] },
  { key: 'sensor', name: 'センサー', category: 'センサー', in: ['DC:power'], out: ['SIG:serial'] },
  { key: 'mcu', name: 'マイコン', category: '制御', in: ['USB:usb', 'GPIO IN:serial'], out: ['GPIO OUT:serial', 'DMX:dmx'] },
  { key: 'sw', name: 'L2スイッチ', category: 'ネットワーク', in: ['UPLINK:lan', 'AC:power'], out: ['PORT 1:lan', 'PORT 2:lan', 'PORT 3:lan', 'PORT 4:lan', 'PORT 5:lan', 'PORT 6:lan', 'PORT 7:lan'] },
  { key: 'router', name: 'ルーター', category: 'ネットワーク', in: ['WAN:lan', 'AC:power'], out: ['LAN 1:lan', 'LAN 2:lan', 'LAN 3:lan', 'LAN 4:lan'] },
  { key: 'ap', name: 'Wi-Fi AP', category: 'ネットワーク', in: ['LAN/PoE:lan'], out: ['Wi-Fi:wireless'] },
  { key: 'tablet', name: 'タブレット', category: '操作端末', in: ['Wi-Fi:wireless', 'USB-C:usb'], out: [] },
  { key: 'touch', name: 'タッチモニター', category: '操作端末', in: ['HDMI:video', 'AC:power'], out: ['USB:usb'] },
  { key: 'streamdeck', name: 'Stream Deck', category: '操作端末', in: [], out: ['USB:usb'] },
  { key: 'audioif', name: 'オーディオIF', category: '音響', in: ['USB:usb', 'MIC 1:audio', 'MIC 2:audio'], out: ['OUT L:audio', 'OUT R:audio'] },
  { key: 'mixer', name: 'ミキサー', category: '音響', in: ['CH 1:audio', 'CH 2:audio', 'CH 3:audio', 'CH 4:audio', 'USB:usb'], out: ['MAIN L:audio', 'MAIN R:audio', 'AUX:audio'] },
  { key: 'amp', name: 'パワーアンプ', category: '音響', in: ['IN L:audio', 'IN R:audio', 'AC:power'], out: ['SP L:audio', 'SP R:audio'] },
  { key: 'speaker', name: 'スピーカー', category: '音響', in: ['IN:audio', 'AC:power'], out: [] },
  { key: 'mic', name: 'マイク', category: '音響', in: [], out: ['OUT:audio'] },
  { key: 'dmxnode', name: 'DMXノード', category: '照明', in: ['LAN:lan', 'AC:power'], out: ['DMX 1:dmx', 'DMX 2:dmx'] },
  { key: 'light', name: '照明器具', category: '照明', in: ['DMX IN:dmx', 'AC:power'], out: ['DMX THRU:dmx'] },
  { key: 'tap', name: '電源タップ', category: '電源', in: ['AC IN:power'], out: ['AC 1:power', 'AC 2:power', 'AC 3:power', 'AC 4:power', 'AC 5:power', 'AC 6:power'] },
  { key: 'ups', name: 'UPS', category: '電源', in: ['AC IN:power'], out: ['AC 1:power', 'AC 2:power', 'AC 3:power', 'AC 4:power'] },
  // --- PC・再生機
  { key: 'macmini', name: 'Mac mini', category: 'PC', in: ['LAN:lan', 'USB:usb', 'AC:power'], out: ['HDMI:video', 'TB 1:video', 'TB 2:video'] },
  { key: 'gamingpc', name: 'ゲーミングPC', category: 'PC', in: ['LAN:lan', 'USB:usb', 'AC:power'], out: ['HDMI:video', 'DP 1:video', 'DP 2:video', 'DP 3:video'] },
  { key: 'laptop', name: 'ノートPC', category: 'PC', in: ['LAN:lan', 'USB:usb', 'AC:power'], out: ['HDMI:video', 'USB-C:video'] },
  { key: 'raspi', name: 'Raspberry Pi', category: 'PC', in: ['LAN:lan', 'USB:usb', 'GPIO:serial', 'DC 5V:power'], out: ['HDMI 0:video', 'HDMI 1:video'] },
  { key: 'mediaserver', name: 'メディアサーバー', category: '再生機', in: ['LAN:lan', 'SDI IN:video', 'LTC:audio', 'AC:power'], out: ['DP OUT 1:video', 'DP OUT 2:video', 'DP OUT 3:video', 'DP OUT 4:video'] },
  { key: 'signage', name: 'サイネージプレーヤー', category: '再生機', in: ['LAN:lan', 'GPIO:serial', 'DC:power'], out: ['HDMI:video', 'AUDIO:audio'] },
  { key: 'nas', name: 'NAS', category: 'ネットワーク', in: ['LAN:lan', 'AC:power'], out: [] },
  // --- 映像表示
  { key: 'laserpj', name: 'レーザープロジェクター', category: '映像表示', in: ['HDMI:video', 'SDI:video', 'DIGITAL LINK:lan', 'LAN:lan', 'AC:power'], out: [] },
  { key: 'shortpj', name: '超短焦点プロジェクター', category: '映像表示', in: ['HDMI 1:video', 'HDMI 2:video', 'LAN:lan', 'AC:power'], out: [] },
  { key: 'signagemon', name: 'サイネージモニター', category: '映像表示', in: ['HDMI 1:video', 'HDMI 2:video', 'DP:video', 'LAN:lan', 'RS-232C:serial', 'AC:power'], out: [] },
  { key: 'videowall', name: 'マルチディスプレイ', category: '映像表示', in: ['HDMI:video', 'DP:video', 'LAN:lan', 'AC:power'], out: ['DP OUT:video'] },
  { key: 'oled', name: '透過ディスプレイ', category: '映像表示', in: ['HDMI:video', 'USB (タッチ):usb', 'AC:power'], out: [] },
  { key: 'previewmon', name: '確認用モニター', category: '映像表示', in: ['HDMI:video', 'SDI:video', 'DC:power'], out: ['SDI LOOP:video'] },
  { key: 'ledsender', name: 'LED送信ボックス', category: '映像表示', in: ['DVI/HDMI:video', 'USB:usb', 'AC:power'], out: ['PORT 1:lan', 'PORT 2:lan'] },
  { key: 'ledcabinet', name: 'LEDキャビネット', category: '映像表示', in: ['DATA IN:lan', 'AC IN:power'], out: ['DATA OUT:lan', 'AC OUT:power'] },
  // --- 映像処理
  { key: 'atemmini', name: 'ATEM Mini Pro', category: '映像処理', in: ['HDMI 1:video', 'HDMI 2:video', 'HDMI 3:video', 'HDMI 4:video', 'MIC 1:audio', 'MIC 2:audio', 'LAN:lan', 'DC:power'], out: ['HDMI OUT:video', 'USB-C:usb'] },
  { key: 'sdiswitcher', name: 'SDIスイッチャー', category: '映像処理', in: ['SDI 1:video', 'SDI 2:video', 'SDI 3:video', 'SDI 4:video', 'LAN:lan', 'AC:power'], out: ['SDI PGM:video', 'SDI AUX:video', 'HDMI MV:video'] },
  { key: 'seamless', name: 'シームレススイッチャー', category: '映像処理', in: ['HDMI 1:video', 'HDMI 2:video', 'HDMI 3:video', 'HDMI 4:video', 'LAN:lan', 'AC:power'], out: ['HDMI OUT A:video', 'HDMI OUT B:video'] },
  { key: 'scaler', name: 'スケーラー', category: '映像処理', in: ['HDMI IN:video', 'DC:power'], out: ['HDMI OUT:video'] },
  { key: 'blend', name: 'エッジブレンド／マルチ出力', category: '映像処理', in: ['DP IN:video', 'USB:usb', 'DC:power'], out: ['HDMI OUT 1:video', 'HDMI OUT 2:video', 'HDMI OUT 3:video'] },
  { key: 'hdmisplit', name: 'HDMIスプリッター', category: '映像処理', in: ['HDMI IN:video', 'DC:power'], out: ['HDMI OUT 1:video', 'HDMI OUT 2:video'] },
  { key: 'hdmisel', name: 'HDMIセレクター', category: '映像処理', in: ['HDMI IN 1:video', 'HDMI IN 2:video', 'HDMI IN 3:video', 'HDMI IN 4:video'], out: ['HDMI OUT:video'] },
  { key: 'sdida', name: 'SDI分配器', category: '映像処理', in: ['SDI IN:video', 'DC:power'], out: ['SDI OUT 1:video', 'SDI OUT 2:video', 'SDI OUT 3:video', 'SDI OUT 4:video'] },
  { key: 'h2s', name: 'HDMI→SDIコンバーター', category: '映像処理', in: ['HDMI IN:video', 'DC:power'], out: ['SDI OUT 1:video', 'SDI OUT 2:video'] },
  { key: 's2h', name: 'SDI→HDMIコンバーター', category: '映像処理', in: ['SDI IN:video', 'DC:power'], out: ['HDMI OUT:video', 'SDI LOOP:video'] },
  { key: 'ioif', name: '映像入出力IF', category: '映像処理', in: ['SDI IN:video', 'HDMI IN:video'], out: ['Thunderbolt:usb', 'SDI OUT:video', 'HDMI OUT:video'] },
  { key: 'ndienc', name: 'NDIエンコーダー', category: '映像処理', in: ['HDMI IN:video', 'DC/PoE:power'], out: ['LAN (NDI):lan', 'HDMI LOOP:video'] },
  { key: 'ndidec', name: 'NDIデコーダー', category: '映像処理', in: ['LAN (NDI):lan', 'DC/PoE:power'], out: ['HDMI OUT:video'] },
  { key: 'streamenc', name: '配信エンコーダー', category: '映像処理', in: ['HDMI IN:video', 'SDI IN:video', 'AUDIO IN:audio', 'AC:power'], out: ['LAN:lan'] },
  { key: 'recorder', name: 'レコーダー', category: '映像処理', in: ['SDI IN:video', 'HDMI IN:video', 'DC:power'], out: ['SDI OUT:video', 'HDMI OUT:video'] },
  // --- 延長器
  { key: 'fibertx', name: '光エクステンダー TX', category: '延長器', in: ['HDMI IN:video', 'DC:power'], out: ['FIBER:fiber'] },
  { key: 'fiberrx', name: '光エクステンダー RX', category: '延長器', in: ['FIBER:fiber', 'DC:power'], out: ['HDMI OUT:video'] },
  { key: 'usbext', name: 'USBエクステンダー', category: '延長器', in: ['USB HOST:usb', 'DC:power'], out: ['LAN:lan'] },
  { key: 'usbhub', name: 'USBハブ', category: '延長器', in: ['HOST:usb', 'DC:power'], out: ['PORT 1:usb', 'PORT 2:usb', 'PORT 3:usb', 'PORT 4:usb'] },
  { key: 'kvmtx', name: 'KVMエクステンダー TX', category: '延長器', in: ['HDMI IN:video', 'USB:usb', 'DC:power'], out: ['LAN:lan'] },
  { key: 'kvmrx', name: 'KVMエクステンダー RX', category: '延長器', in: ['LAN:lan', 'DC:power'], out: ['HDMI OUT:video', 'USB:usb'] },
  // --- カメラ
  { key: 'ptz', name: 'PTZカメラ', category: 'カメラ', in: ['LAN/PoE:lan', 'RS-422:serial', 'DC:power'], out: ['SDI:video', 'HDMI:video'] },
  { key: 'cinecam', name: 'シネマカメラ', category: 'カメラ', in: ['DC:power', 'TC IN:audio'], out: ['SDI:video', 'HDMI:video'] },
  { key: 'mirrorless', name: 'ミラーレス一眼', category: 'カメラ', in: ['USB-C:usb', 'DC:power'], out: ['HDMI:video'] },
  { key: 'actioncam', name: 'アクションカメラ', category: 'カメラ', in: ['USB-C:usb'], out: ['HDMI:video'] },
  { key: 'machinecam', name: '産業用カメラ', category: 'カメラ', in: ['PoE:lan', 'TRIGGER:serial'], out: ['USB3:usb'] },
  { key: 'ipcam', name: 'ネットワークカメラ', category: 'カメラ', in: ['LAN/PoE:lan'], out: [] },
  // --- センサー
  { key: 'tof', name: 'ToFカメラ', category: 'センサー', in: ['DC:power'], out: ['USB-C:usb'] },
  { key: 'stereocam', name: 'ステレオ深度カメラ', category: 'センサー', in: [], out: ['USB-C:usb'] },
  { key: 'lidar3d', name: '3D LiDAR', category: 'センサー', in: ['DC:power'], out: ['LAN:lan'] },
  { key: 'irtouch', name: '赤外線タッチフレーム', category: 'センサー', in: [], out: ['USB:usb'] },
  { key: 'leap', name: 'ハンドトラッキングセンサー', category: 'センサー', in: [], out: ['USB:usb'] },
  { key: 'mocap', name: 'モーションキャプチャーカメラ', category: 'センサー', in: ['PoE:lan'], out: [] },
  { key: 'tracker', name: 'トラッカー基地局', category: 'センサー', in: ['DC:power'], out: ['同期:wireless'] },
  { key: 'pir', name: '人感センサー', category: 'センサー', in: ['DC:power'], out: ['SIG:serial'] },
  { key: 'loadcell', name: '重量センサー', category: 'センサー', in: ['DC:power'], out: ['SIG:serial'] },
  { key: 'button', name: '押しボタン', category: 'センサー', in: ['LED:serial'], out: ['SW:serial'] },
  { key: 'footsw', name: 'フットスイッチ', category: 'センサー', in: [], out: ['SW:serial'] },
  { key: 'rfid', name: 'RFID／NFCリーダー', category: 'センサー', in: [], out: ['USB:usb'] },
  { key: 'qr', name: 'QRコードリーダー', category: 'センサー', in: [], out: ['USB:usb'] },
  { key: 'micarray', name: 'マイクアレイ', category: 'センサー', in: [], out: ['USB:usb'] },
  // --- 制御
  { key: 'arduino', name: 'Arduino', category: '制御', in: ['USB:usb', 'DIGITAL IN:serial', 'ANALOG IN:serial', 'DC:power'], out: ['DIGITAL OUT:serial', 'PWM:serial'] },
  { key: 'esp32', name: 'ESP32', category: '制御', in: ['USB:usb', 'GPIO IN:serial', 'DC 5V:power'], out: ['GPIO OUT:serial', 'Wi-Fi:wireless'] },
  { key: 'm5', name: 'M5Stack', category: '制御', in: ['USB-C:usb', 'GROVE:serial'], out: ['GPIO:serial', 'Wi-Fi:wireless'] },
  { key: 'plc', name: 'PLC', category: '制御', in: ['LAN:lan', 'DI:serial', 'DC 24V:power'], out: ['DO:serial', 'RS-485:serial'] },
  { key: 'relay', name: 'リレーボード', category: '制御', in: ['CTRL:serial', 'DC:power'], out: ['CH 1:power', 'CH 2:power', 'CH 3:power', 'CH 4:power'] },
  { key: 'ioboard', name: 'ネットワークI/O', category: '制御', in: ['LAN:lan', 'DI:serial', 'DC:power'], out: ['DO:serial', 'RS-232C:serial'] },
  { key: 'motordrv', name: 'モータードライバー', category: '制御', in: ['CTRL:serial', 'DC:power'], out: ['MOTOR:power'] },
  { key: 'motor', name: 'モーター', category: '制御', in: ['DRIVE:power'], out: ['ENC:serial'] },
  { key: 'solenoid', name: 'ソレノイド', category: '制御', in: ['DRIVE:power'], out: [] },
  { key: 'robotarm', name: 'ロボットアーム', category: '制御', in: ['LAN:lan', 'I/O:serial', 'AC:power'], out: [] },
  { key: 'showctl', name: 'ショーコントローラー', category: '制御', in: ['LAN:lan', 'LTC IN:audio', 'GPI:serial', 'AC:power'], out: ['RS-232C:serial', 'GPO:serial', 'DMX:dmx'] },
  { key: 'tcgen', name: 'タイムコードジェネレーター', category: '制御', in: ['LAN:lan', 'DC:power'], out: ['LTC OUT:audio', 'MIDI:serial'] },
  { key: 'midictl', name: 'MIDIコントローラー', category: '操作端末', in: [], out: ['USB:usb'] },
  { key: 'ipad', name: 'iPad', category: '操作端末', in: ['USB-C:usb', 'Wi-Fi:wireless'], out: [] },
  { key: 'phone', name: 'スマートフォン', category: '操作端末', in: ['Wi-Fi:wireless'], out: [] },
  { key: 'kbm', name: 'キーボード／マウス', category: '操作端末', in: [], out: ['USB:usb'] },
  { key: 'gamepad', name: 'ゲームコントローラー', category: '操作端末', in: [], out: ['USB:usb'] },
  { key: 'vr', name: 'VRヘッドセット', category: '操作端末', in: ['USB-C:usb', 'Wi-Fi:wireless'], out: [] },
  // --- ネットワーク
  { key: 'poesw', name: 'PoEスイッチ', category: 'ネットワーク', in: ['UPLINK:lan', 'AC:power'], out: ['PoE 1:lan', 'PoE 2:lan', 'PoE 3:lan', 'PoE 4:lan', 'PoE 5:lan', 'PoE 6:lan', 'PoE 7:lan', 'PoE 8:lan'] },
  { key: 'tengsw', name: '10Gスイッチ', category: 'ネットワーク', in: ['SFP+ 1:fiber', 'SFP+ 2:fiber', 'AC:power'], out: ['PORT 1:lan', 'PORT 2:lan', 'PORT 3:lan', 'PORT 4:lan', 'PORT 5:lan', 'PORT 6:lan', 'PORT 7:lan', 'PORT 8:lan'] },
  { key: 'mobilert', name: 'モバイルルーター', category: 'ネットワーク', in: ['回線:wireless', 'DC:power'], out: ['LAN:lan', 'Wi-Fi:wireless'] },
  { key: 'mediaconv', name: 'メディアコンバーター', category: 'ネットワーク', in: ['LAN:lan', 'DC:power'], out: ['FIBER:fiber'] },
  { key: 'poeinj', name: 'PoEインジェクター', category: 'ネットワーク', in: ['LAN IN:lan', 'AC:power'], out: ['PoE OUT:lan'] },
  // --- 音響
  { key: 'digimixer', name: 'デジタルミキサー', category: '音響', in: ['IN 1-8:audio', 'IN 9-16:audio', 'USB:usb', 'LAN:lan', 'AC:power'], out: ['MAIN L/R:audio', 'AUX 1:audio', 'AUX 2:audio', 'Dante:lan'] },
  { key: 'danteif', name: 'Dante IF', category: '音響', in: ['Dante:lan', 'DC/PoE:power'], out: ['OUT 1:audio', 'OUT 2:audio'] },
  { key: 'dsp', name: 'オーディオプロセッサー', category: '音響', in: ['IN 1:audio', 'IN 2:audio', 'LAN:lan', 'AC:power'], out: ['OUT 1:audio', 'OUT 2:audio', 'OUT 3:audio', 'OUT 4:audio'] },
  { key: 'passivesp', name: 'パッシブスピーカー', category: '音響', in: ['SP IN:audio'], out: [] },
  { key: 'subwoofer', name: 'サブウーファー', category: '音響', in: ['IN:audio', 'AC:power'], out: ['THRU:audio'] },
  { key: 'dirsp', name: '指向性スピーカー', category: '音響', in: ['IN:audio', 'DC:power'], out: [] },
  { key: 'exciter', name: '振動スピーカー', category: '音響', in: ['SP IN:audio'], out: [] },
  { key: 'wlmic', name: 'ワイヤレスマイク', category: '音響', in: [], out: ['RF:wireless'] },
  { key: 'wlrx', name: 'ワイヤレス受信機', category: '音響', in: ['RF:wireless', 'DC:power'], out: ['OUT 1:audio', 'OUT 2:audio'] },
  { key: 'hpamp', name: 'ヘッドホンアンプ', category: '音響', in: ['IN:audio', 'DC:power'], out: ['HP 1:audio', 'HP 2:audio', 'HP 3:audio', 'HP 4:audio'] },
  { key: 'headphone', name: 'ヘッドホン', category: '音響', in: ['IN:audio'], out: [] },
  { key: 'di', name: 'DIボックス', category: '音響', in: ['IN:audio'], out: ['XLR OUT:audio', 'THRU:audio'] },
  { key: 'embed', name: '音声エンベデッダー', category: '音響', in: ['HDMI IN:video', 'AUDIO IN:audio', 'DC:power'], out: ['HDMI OUT:video'] },
  { key: 'deembed', name: '音声分離器', category: '音響', in: ['HDMI IN:video', 'DC:power'], out: ['HDMI OUT:video', 'AUDIO OUT:audio'] },
  { key: 'intercom', name: 'インカム親機', category: '音響', in: ['AC:power'], out: ['CH A:audio', 'CH B:audio'] },
  // --- 照明
  { key: 'lightdesk', name: '照明卓', category: '照明', in: ['LAN:lan', 'AC:power'], out: ['DMX A:dmx', 'DMX B:dmx', 'Art-Net:lan'] },
  { key: 'dmxusb', name: 'USB-DMXインターフェース', category: '照明', in: ['USB:usb'], out: ['DMX:dmx'] },
  { key: 'dmxsplit', name: 'DMXスプリッター', category: '照明', in: ['DMX IN:dmx', 'AC:power'], out: ['OUT 1:dmx', 'OUT 2:dmx', 'OUT 3:dmx', 'OUT 4:dmx'] },
  { key: 'moving', name: 'ムービングライト', category: '照明', in: ['DMX IN:dmx', 'AC:power'], out: ['DMX THRU:dmx'] },
  { key: 'ledpar', name: 'LEDパー', category: '照明', in: ['DMX IN:dmx', 'AC:power'], out: ['DMX THRU:dmx', 'AC THRU:power'] },
  { key: 'ledbar', name: 'LEDバー', category: '照明', in: ['DMX IN:dmx', 'AC:power'], out: ['DMX THRU:dmx'] },
  { key: 'pixelctl', name: 'ピクセルLEDコントローラー', category: '照明', in: ['LAN (Art-Net):lan', 'DC:power'], out: ['OUT 1:serial', 'OUT 2:serial', 'OUT 3:serial', 'OUT 4:serial'] },
  { key: 'ledtape', name: 'LEDテープ', category: '照明', in: ['DATA:serial', 'DC:power'], out: [] },
  { key: 'dcpsu', name: 'DC電源', category: '電源', in: ['AC IN:power'], out: ['DC OUT 1:power', 'DC OUT 2:power'] },
  { key: 'dimmer', name: 'ディマー', category: '照明', in: ['DMX IN:dmx', 'AC IN:power'], out: ['CH 1:power', 'CH 2:power', 'CH 3:power', 'CH 4:power'] },
  { key: 'laser', name: 'レーザー', category: '照明', in: ['ILDA/LAN:lan', 'DMX:dmx', 'AC:power'], out: [] },
  { key: 'fog', name: 'フォグ／ヘイズマシン', category: '照明', in: ['DMX IN:dmx', 'AC:power'], out: [] },
  // --- 電源
  { key: 'distro', name: '分電盤', category: '電源', in: ['主幹:power'], out: ['回路 1:power', '回路 2:power', '回路 3:power', '回路 4:power', '回路 5:power', '回路 6:power'] },
  { key: 'cbox', name: 'C型コンセントボックス', category: '電源', in: ['C型 IN:power'], out: ['AC 1:power', 'AC 2:power', 'AC 3:power', 'AC 4:power'] },
  { key: 'pdu', name: 'リモート電源制御', category: '電源', in: ['AC IN:power', 'LAN:lan'], out: ['AC 1:power', 'AC 2:power', 'AC 3:power', 'AC 4:power'] },
  { key: 'transformer', name: 'トランス', category: '電源', in: ['AC IN:power'], out: ['AC OUT:power'] },
  { key: 'battery', name: 'ポータブル電源', category: '電源', in: ['充電:power'], out: ['AC 1:power', 'AC 2:power', 'USB-C:power'] },
  // --- 出力機器
  { key: 'printer', name: 'プリンター', category: '出力機器', in: ['USB:usb', 'LAN:lan', 'AC:power'], out: [] },
  { key: 'thermal', name: 'サーマルプリンター', category: '出力機器', in: ['USB:usb', 'LAN:lan', 'DC:power'], out: [] },
  { key: 'photoprt', name: '昇華型フォトプリンター', category: '出力機器', in: ['USB:usb', 'AC:power'], out: [] },
  { key: 'mobileprt', name: 'モバイルプリンター', category: '出力機器', in: ['Bluetooth:wireless', 'USB:usb'], out: [] },
  { key: 'blank', name: '新しい機材', category: '', in: ['IN:other'], out: ['OUT:other'] },
];

/**
 * The presets the library shows by default: the gear that turns up on most installation jobs.
 * Everything else stays one search (or one "show all") away.
 */
export const COMMON = new Set([
  'pc', 'mac', 'macmini', 'laptop', 'raspi',
  'player', 'mediaserver',
  'pj', 'display', 'previewmon', 'touch', 'ledproc', 'led',
  'switcher', 'matrix', 'hdmisplit', 'scaler', 'conv', 'capture',
  'tx', 'rx', 'fibertx', 'fiberrx', 'usbext', 'usbhub',
  'cam', 'webcam', 'depth', 'lidar', 'sensor', 'qr',
  'mcu', 'relay',
  'sw', 'poesw', 'router', 'mobilert', 'ap',
  'tablet', 'streamdeck',
  'audioif', 'mixer', 'dsp', 'amp', 'speaker', 'mic',
  'dmxnode', 'light',
  'tap', 'ups',
  'printer',
]);

/**
 * Pieces of software for software boards: what runs where, and how it talks. Their ports are the
 * ends of protocols (an API, an OSC input …), not sockets on a box.
 */
export const SOFTWARE: Preset[] = [
  { key: 'td', name: 'TouchDesigner', category: 'アプリ', in: ['OSC IN:osc', 'NDI IN:ndi'], out: ['OSC OUT:osc', 'NDI OUT:ndi'] },
  { key: 'unityapp', name: 'Unity アプリ', category: 'アプリ', in: ['OSC IN:osc', 'WebSocket:websocket'], out: ['HTTP:http'] },
  { key: 'nativeapp', name: 'アプリ', category: 'アプリ', in: ['IN:data'], out: ['OUT:data'] },
  { key: 'browser', name: 'Web ブラウザ（フロント）', category: 'アプリ', in: [], out: ['HTTP:http', 'WebSocket:websocket'] },
  { key: 'mobile', name: 'スマホアプリ', category: 'アプリ', in: [], out: ['HTTP:http', 'WebSocket:websocket'] },
  { key: 'admin', name: '管理画面', category: 'アプリ', in: [], out: ['HTTP:http'] },
  { key: 'sensorapp', name: 'センサー制御アプリ', category: 'アプリ', in: [], out: ['OSC:osc', 'UDP:udp'] },
  { key: 'webserver', name: 'Web サーバー', category: 'サーバー', in: ['HTTP:http'], out: ['HTTP:http'] },
  { key: 'apiserver', name: 'API サーバー', category: 'サーバー', in: ['HTTP:http', 'WebSocket:websocket'], out: ['DB:tcp', 'HTTP:http'] },
  { key: 'wsserver', name: 'WebSocket サーバー', category: 'サーバー', in: ['WebSocket:websocket'], out: ['WebSocket:websocket'] },
  { key: 'worker', name: 'バッチ・ワーカー', category: 'サーバー', in: ['QUEUE:tcp'], out: ['HTTP:http', 'DB:tcp'] },
  { key: 'mqttbroker', name: 'MQTT ブローカー', category: 'サーバー', in: ['MQTT:mqtt'], out: ['MQTT:mqtt'] },
  { key: 'oscrouter', name: 'OSC ルーター', category: 'サーバー', in: ['OSC IN:osc'], out: ['OSC OUT:osc'] },
  { key: 'db', name: 'データベース', category: 'データ', in: ['TCP:tcp'], out: [] },
  { key: 'cache', name: 'キャッシュ（Redis など）', category: 'データ', in: ['TCP:tcp'], out: [] },
  { key: 'storage', name: 'ストレージ（S3 など）', category: 'データ', in: ['HTTP:http'], out: [] },
  { key: 'nas', name: 'NAS・共有フォルダ', category: 'データ', in: ['SMB:file'], out: [] },
  { key: 'cdn', name: 'CDN', category: 'データ', in: ['HTTP:http'], out: ['HTTP:http'] },
  { key: 'extapi', name: '外部 API', category: '外部サービス', in: ['HTTP:http'], out: [] },
  { key: 'aiapi', name: '生成 AI API', category: '外部サービス', in: ['HTTP:http'], out: [] },
  { key: 'stream', name: '配信サービス', category: '外部サービス', in: ['RTMP / SRT:ndi'], out: [] },
  { key: 'plc', name: 'PLC・マイコン', category: '機器制御', in: ['TCP:tcp'], out: ['UDP:udp'] },
  { key: 'lightctl', name: '照明・演出制御', category: '機器制御', in: ['OSC:osc'], out: [] },
  { key: 'swblank', name: '新しい部品', category: '', in: ['IN:data'], out: ['OUT:data'] },
];

export const presetOf = (key: string): Preset | undefined => PRESETS.find((p) => p.key === key) ?? SOFTWARE.find((p) => p.key === key);

export const allIds = (doc: Doc): Set<string> => {
  const ids = new Set<string>();
  for (const n of doc.nodes) {
    ids.add(n.id);
    if (n.type === 'device') for (const p of n.ports) ids.add(`${n.id}/${p.id}`);
  }
  for (const e of doc.edges) ids.add(e.id);
  return ids;
};

/** Short human-readable id (also used as the handle in the YAML text form). */
export function freshId(taken: Set<string>, prefix: string): string {
  for (let i = 1; ; i++) {
    const id = `${prefix}${i}`;
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}

export const randomId = (): string => Math.random().toString(36).slice(2, 10);

/** "HDMI 1:video" → port. The old video types (hdmi, sdi, dp) are read as 映像. */
export function parsePort(spec: string, side: Port['side'], id: string): Port {
  const i = spec.lastIndexOf(':');
  const name = (i < 0 ? spec : spec.slice(0, i)).trim();
  const signal = i < 0 ? 'other' : currentSignal(spec.slice(i + 1).trim().toLowerCase());
  return { id, name, side, signal };
}

export function presetPorts(p: Preset): Port[] {
  let n = 0;
  return [
    ...p.in.map((s) => parsePort(s, 'left', `p${++n}`)),
    ...p.out.map((s) => parsePort(s, 'right', `p${++n}`)),
  ];
}

export function makeDevice(preset: Preset, x: number, y: number, taken: Set<string>): DeviceNode {
  return {
    id: freshId(taken, preset.key === 'blank' ? 'dev' : preset.key === 'swblank' ? 'app' : preset.key),
    type: 'device',
    x,
    y,
    w: 180,
    h: 0,
    text: preset.name,
    maker: '',
    model: '',
    category: preset.category,
    note: '',
    ports: presetPorts(preset),
  };
}

export type CreateKind = ShapeKind | 'sticky' | 'text' | 'frame' | 'sequence';

const SIZE: Record<CreateKind, [number, number]> = {
  rect: [140, 60],
  round: [140, 50],
  diamond: [150, 90],
  ellipse: [140, 70],
  cloud: [180, 100],
  sticky: [160, 160],
  text: [160, 40],
  frame: [460, 320],
  sequence: [0, 0],
};

export function makeNode(kind: CreateKind, cx: number, cy: number, taken: Set<string>, text = '', color?: ColorKey): Node {
  const [w, h] = SIZE[kind];
  const base = { x: cx - w / 2, y: cy - h / 2, w, h, text };
  if (kind === 'sticky') return { ...base, id: freshId(taken, 'note'), type: 'sticky', color: color ?? 'yellow' };
  if (kind === 'text') return { ...base, id: freshId(taken, 'txt'), type: 'text' };
  if (kind === 'frame') return { ...base, id: freshId(taken, 'area'), type: 'frame', text: text || 'エリア' };
  if (kind === 'sequence') return { ...base, x: cx, y: cy, id: freshId(taken, 'seq'), type: 'sequence' };
  return { ...base, id: freshId(taken, 'n'), type: 'shape', shape: kind, color: color ?? 'white' };
}

/** Picture node centred on (cx, cy), scaled down to a comfortable size on the board. */
export function makeImage(taken: Set<string>, img: { src: string; w: number; h: number; name: string }, cx: number, cy: number): Node {
  const k = Math.min(1, 480 / img.w, 360 / img.h);
  const w = Math.max(20, Math.round(img.w * k));
  const h = Math.max(20, Math.round(img.h * k));
  return { id: freshId(taken, 'img'), type: 'image', x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h, text: img.name, src: img.src };
}

export function makeEdge(taken: Set<string>, from: Edge['from'], to: Edge['to'], signal: string): Edge {
  return {
    id: freshId(taken, 'e'),
    from,
    to,
    signal,
    label: '',
    length: null,
    arrow: signal === 'flow' ? 'end' : 'none',
    note: '',
  };
}

/**
 * Pick the port a cable dropped on a device body should use: a free port of the
 * same signal on the right side, or a new one when all are taken — so hooking a
 * dozen devices up to a UPS never means adding ports by hand.
 */
export function claimPort(doc: Doc, nodeId: string, signal: string, side: Port['side']): { end: EdgeEnd; doc: Doc } {
  const n = doc.nodes.find((x) => x.id === nodeId);
  if (!n || n.type !== 'device' || signal === 'flow') return { end: { node: nodeId }, doc };
  const used = new Set<string | undefined>();
  for (const e of doc.edges) {
    if (e.from.node === nodeId) used.add(e.from.port);
    if (e.to.node === nodeId) used.add(e.to.port);
  }
  // Only the matching side counts: an outlet must never be satisfied by the device's own inlet.
  const found = n.ports.find((p) => p.signal === signal && p.side === side && !used.has(p.id));
  if (found) return { end: { node: nodeId, port: found.id }, doc };
  const count = n.ports.filter((p) => p.signal === signal && p.side === side).length;
  const port: Port = { id: freshId(new Set(n.ports.map((p) => p.id)), 'p'), name: `${portBase(signal)} ${count + 1}`, side, signal };
  return {
    end: { node: nodeId, port: port.id },
    doc: { ...doc, nodes: doc.nodes.map((x) => (x.id === nodeId ? { ...n, ports: [...n.ports, port] } : x)) },
  };
}

export const JUNCTION = 12;

/** A legend block with its top-left corner at (x, y); its height follows its rows once it is on a board. */
export const makeLegend = (taken: Set<string>, x: number, y: number): Node => ({ id: freshId(taken, 'legend'), type: 'legend', x, y, w: 200, h: 64, text: '凡例' });

/**
 * Put a junction dot on a line at `at`. The line keeps its identity up to the dot; a second line
 * of the same kind carries on from the dot to where the original ended.
 */
export function splitEdge(doc: Doc, edgeId: string, at: { x: number; y: number }): { doc: Doc; junction: string } | null {
  const edge = doc.edges.find((e) => e.id === edgeId);
  if (!edge) return null;
  const taken = allIds(doc);
  const id = freshId(taken, 'j');
  taken.add(id);
  const dot: Node = { id, type: 'junction', x: Math.round(at.x - JUNCTION / 2), y: Math.round(at.y - JUNCTION / 2), w: JUNCTION, h: JUNCTION, text: '分岐' };
  const rest: Edge = { ...makeEdge(taken, { node: id }, edge.to, edge.signal), arrow: edge.arrow, color: edge.color, dash: edge.dash, spec: edge.spec, maker: edge.maker, model: edge.model, url: edge.url, tag: edge.tag };
  const { route: _route, labelAt: _labelAt, ...head } = edge;
  return {
    junction: id,
    doc: { ...doc, nodes: [...doc.nodes, dot], edges: [...doc.edges.map((e) => (e.id === edgeId ? { ...head, to: { node: id } } : e)), rest] },
  };
}

/** The kind of line a junction carries, taken from any line already on it. */
export const junctionSignal = (doc: Doc, node: string): string | undefined => doc.edges.find((e) => e.from.node === node || e.to.node === node)?.signal;
