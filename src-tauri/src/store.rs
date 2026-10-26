//! The boards folder, read and written as server/store.ts does for the dev server and the command
//! line, so the three agree on every board:
//!
//!   <root>/<title>__<id>/board.json
//!   <root>/<title>__<id>/assets/<hash>.<ext>
//!   <root>/<title>__<id>/revisions/<state id>.json
//!   <root>/presets.json
//!   <root>/.trash/<title>__<id>-<when deleted>/
//!
//! Every write bumps `serial` in board.json. A writer says which serial its change was made on; a
//! write made on an older one is refused, and one made on a board deleted since is refused too.

use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const TRASH: &str = ".trash";

/// Why a write was refused: the board changed elsewhere (at this serial), or was deleted.
#[derive(Debug)]
pub enum WriteError {
    Conflict(u64),
    Gone,
    Other(String),
}

impl From<std::io::Error> for WriteError {
    fn from(e: std::io::Error) -> Self {
        WriteError::Other(e.to_string())
    }
}

/// What an id (of a board, a revision) may be: letters, digits, `-` and `_`, never `__` (which
/// parts the title from the id in a folder's name).
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && !id.contains("__") && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// A picture's file name in a board's folder: a content hash and an image extension.
pub fn valid_asset(name: &str) -> bool {
    let Some((stem, ext)) = name.rsplit_once('.') else { return false };
    !stem.is_empty()
        && stem.len() <= 80
        && stem.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        && matches!(ext.to_ascii_lowercase().as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg")
}

/// A title made fit for a folder name, as server/store.ts makes it.
pub fn slug(title: &str) -> String {
    let mut out = String::new();
    let mut gap = false;
    for c in title.chars() {
        // Spaces as both sides count them: Unicode's, and the byte-order mark JavaScript also takes.
        if c.is_whitespace() || matches!(c, '\u{feff}' | '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '.') {
            gap = true;
        } else {
            if gap && !out.is_empty() {
                out.push('_');
            }
            gap = false;
            out.push(c);
        }
    }
    let out: String = out.trim_matches('_').chars().take(60).collect();
    if out.is_empty() { "board".into() } else { out }
}

/// A few characters no other writer will pick at the same moment.
fn rand_suffix() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(now_ms());
    format!("{:x}", h.finish())
}

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

fn mtime_ms(p: &Path) -> f64 {
    fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0)
}

#[derive(Serialize, Clone)]
pub struct BoardInfo {
    pub id: String,
    pub title: String,
    pub updated: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

#[derive(Serialize)]
pub struct Trashed {
    pub key: String,
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    pub deleted: f64,
}

#[derive(Serialize)]
pub struct Written {
    pub serial: u64,
    pub folder: String,
}

fn str_of(v: &Value, path: &[&str]) -> Option<String> {
    let mut cur = v;
    for k in path {
        cur = cur.get(*k)?;
    }
    cur.as_str().filter(|s| !s.is_empty()).map(String::from)
}

/// A board's version number as written: a whole number, 0 and up, also when typed by hand as text
/// ("5") or a decimal (5.0); anything else reads as 0. The page reads it the same way (load.ts, readSerial).
pub fn serial_of(v: &Value) -> u64 {
    let n = match v.get("serial") {
        Some(Value::Number(n)) => n.as_f64(),
        Some(Value::String(s)) if !s.trim().is_empty() => s.trim().parse::<f64>().ok(),
        _ => None,
    };
    n.filter(|n| n.is_finite() && *n >= 0.0).map(|n| n.floor() as u64).unwrap_or(0)
}

fn read_json(p: &Path) -> Option<Value> {
    serde_json::from_str(&fs::read_to_string(p).ok()?).ok()
}

/// Write a file whole or not at all: to a temporary name no other writer uses, onto the disk, then
/// into place. A crash or a power cut leaves the old file or the new, never half of one; a failed
/// write leaves nothing behind.
fn write_atomic(p: &Path, data: impl AsRef<[u8]>) -> std::io::Result<()> {
    use std::io::Write;
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let tmp = p.with_file_name(format!("{name}.{}-{n}.tmp", std::process::id()));
    let written = (|| {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(data.as_ref())?;
        f.sync_all()?;
        fs::rename(&tmp, p)
    })();
    if written.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    written
}

/// The folder's write lock, the same file server/store.ts takes: the dev server, the command line
/// and this app may all work on one boards folder, and a change (check the version, then write;
/// move a folder) must not run into another's halfway. One left behind by a writer that died is
/// taken over once it is older than STALE.
pub const LOCK: &str = ".keito.lock";
const STALE: Duration = Duration::from_secs(10);
const WAIT: Duration = Duration::from_secs(3);
pub const BUSY: &str = "ほかのアプリがこのフォルダーに書き込み中です。少し待ってからもう一度保存してください";

/// Holding the lock, with the token written in it; let go when dropped, and only if it is still ours
/// (a holder too slow may have had it taken over, and must not take away the next holder's).
struct Locked(PathBuf, String);

impl Drop for Locked {
    fn drop(&mut self) {
        if fs::read_to_string(&self.0).is_ok_and(|t| t == self.1) {
            let _ = fs::remove_file(&self.0);
        }
    }
}

fn lock(root: &Path, wait: Duration) -> Result<Locked, String> {
    use std::io::Write;
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let file = root.join(LOCK);
    let token = format!("{}-{}-{}", std::process::id(), now_ms(), rand_suffix());
    let until = Instant::now() + wait;
    loop {
        match fs::OpenOptions::new().write(true).create_new(true).open(&file) {
            Ok(mut f) => {
                let _ = f.write_all(token.as_bytes());
                return Ok(Locked(file, token));
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                let stale = fs::metadata(&file).and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age > STALE);
                if stale {
                    // Moved aside first: of several writers finding it stale, only one can.
                    let aside = root.join(format!("{LOCK}.{token}.stale"));
                    if fs::rename(&file, &aside).is_ok() {
                        let _ = fs::remove_file(&aside);
                    }
                    continue;
                }
                if Instant::now() > until {
                    return Err(BUSY.into());
                }
                std::thread::sleep(Duration::from_millis(15));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

pub struct Store {
    pub root: PathBuf,
}

impl Store {
    pub fn new(root: PathBuf) -> Self {
        Store { root }
    }

    /// Board folders: not hidden, with a board.json.
    fn dirs(&self) -> Vec<PathBuf> {
        let Ok(read) = fs::read_dir(&self.root) else { return vec![] };
        read.filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| !n.starts_with('.')) && p.join("board.json").is_file())
            .collect()
    }

    pub fn dir_of(&self, id: &str) -> Option<PathBuf> {
        let tail = format!("__{id}");
        let hits: Vec<PathBuf> = self.dirs().into_iter().filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n == id || n.ends_with(&tail))).collect();
        // Folders of "X" and of "_X" both end in "__X": the board inside says which is which.
        if hits.len() < 2 {
            return hits.into_iter().next();
        }
        hits.into_iter().find(|p| read_json(&p.join("board.json")).and_then(|v| v.get("id").and_then(Value::as_str).map(|s| s == id)).unwrap_or(false))
    }

    fn serial_at(&self, dir: Option<&PathBuf>) -> u64 {
        dir.and_then(|d| read_json(&d.join("board.json"))).map(|v| serial_of(&v)).unwrap_or(0)
    }

    /// Every readable board, the most recently written first; one that cannot be read is skipped.
    pub fn list(&self) -> Vec<BoardInfo> {
        let mut out: Vec<BoardInfo> = self
            .dirs()
            .into_iter()
            .filter_map(|d| {
                let file = d.join("board.json");
                let v = read_json(&file)?;
                let id = v.get("id")?.as_str()?.to_string();
                let folder = d.file_name()?.to_str()?.to_string();
                Some(BoardInfo { id, title: str_of(&v, &["meta", "title"]).unwrap_or(folder), updated: mtime_ms(&file), project: str_of(&v, &["meta", "project"]), kind: str_of(&v, &["kind"]) })
            })
            .collect();
        out.sort_by(|a, b| b.updated.partial_cmp(&a.updated).unwrap_or(std::cmp::Ordering::Equal));
        out
    }

    /// The board as stored, or None when there is none (or its file cannot be read as JSON).
    pub fn read(&self, id: &str) -> Result<Option<String>, String> {
        let Some(dir) = self.dir_of(id) else { return Ok(None) };
        fs::read_to_string(dir.join("board.json")).map(Some).map_err(|e| e.to_string())
    }

    /// Write a board, made on version `base` of it (None: whatever is there, for a forced write).
    pub fn write(&self, doc: Value, base: Option<u64>) -> Result<Written, WriteError> {
        let _held = lock(&self.root, WAIT).map_err(WriteError::Other)?;
        self.write_held(doc, base)
    }

    fn write_held(&self, mut doc: Value, base: Option<u64>) -> Result<Written, WriteError> {
        let id = doc.get("id").and_then(Value::as_str).filter(|id| valid_id(id)).map(String::from).ok_or_else(|| WriteError::Other("bad id".into()))?;
        let dir = self.dir_of(&id);
        let now = self.serial_at(dir.as_ref());
        // Made on a version read earlier, of a board deleted since: never brought back unasked.
        if base.is_some() && dir.is_none() {
            return Err(WriteError::Gone);
        }
        if let (Some(b), Some(_)) = (base, &dir) {
            if b != now {
                return Err(WriteError::Conflict(now));
            }
        }
        let title = str_of(&doc, &["meta", "title"]).unwrap_or_default();
        let wanted = self.root.join(format!("{}__{}", slug(&title), id));
        let mut target = dir.unwrap_or_else(|| wanted.clone());
        fs::create_dir_all(&target)?;
        // Follow a renamed board with its folder; keep the old name if the new one is taken.
        if target != wanted && !wanted.exists() {
            fs::rename(&target, &wanted)?;
            target = wanted;
        }
        let serial = now + 1;
        doc["serial"] = Value::from(serial);
        let text = serde_json::to_string_pretty(&doc).map_err(|e| WriteError::Other(e.to_string()))?;
        write_atomic(&target.join("board.json"), &text)?;
        Ok(Written { serial, folder: target.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string() })
    }

    /// Deleting moves the folder aside instead of destroying it.
    pub fn remove(&self, id: &str) -> Result<(), String> {
        let _held = lock(&self.root, WAIT)?;
        let Some(dir) = self.dir_of(id) else { return Ok(()) };
        let trash = self.root.join(TRASH);
        fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
        let name = dir.file_name().and_then(|n| n.to_str()).unwrap_or(id).to_string();
        fs::rename(&dir, trash.join(format!("{name}-{}", now_ms()))).map_err(|e| e.to_string())
    }

    /// Deleted boards, the most recently deleted first.
    pub fn trashed(&self) -> Vec<Trashed> {
        let trash = self.root.join(TRASH);
        let Ok(read) = fs::read_dir(&trash) else { return vec![] };
        let mut out: Vec<Trashed> = read
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let key = e.file_name().to_str()?.to_string();
                let v = read_json(&e.path().join("board.json"))?;
                let id = v.get("id")?.as_str()?.to_string();
                // The folder's name ends with the time it was deleted; failing that, when it was moved.
                let deleted = key.rsplit_once('-').and_then(|(_, t)| (t.len() >= 10).then(|| t.parse::<f64>().ok()).flatten()).unwrap_or_else(|| mtime_ms(&e.path()));
                Some(Trashed { key, id, title: str_of(&v, &["meta", "title"]).unwrap_or_else(|| "無題のボード".into()), project: str_of(&v, &["meta", "project"]), kind: str_of(&v, &["kind"]), deleted })
            })
            .collect();
        out.sort_by(|a, b| b.deleted.partial_cmp(&a.deleted).unwrap_or(std::cmp::Ordering::Equal));
        out
    }

    /// Put a deleted board back where it was, and say its id; a board of the same id there now is never overwritten.
    pub fn restore(&self, key: &str) -> Result<String, String> {
        if key.is_empty() || key.starts_with('.') || key.contains('/') || key.contains('\\') {
            return Err("bad key".into());
        }
        let _held = lock(&self.root, WAIT)?;
        let from = self.root.join(TRASH).join(key);
        let v = read_json(&from.join("board.json")).ok_or("削除したボードが見つかりません")?;
        let id = v.get("id").and_then(Value::as_str).filter(|id| valid_id(id)).ok_or("not a board")?.to_string();
        if self.dir_of(&id).is_some() {
            return Err("同じボードがすでにあります".into());
        }
        let to = self.root.join(format!("{}__{}", slug(&str_of(&v, &["meta", "title"]).unwrap_or_default()), id));
        if to.exists() {
            return Err("同じ名前のフォルダーがすでにあります".into());
        }
        fs::rename(&from, &to).map_err(|e| e.to_string())?;
        Ok(id)
    }

    fn revision_file(&self, board: &str, state: &str) -> Option<PathBuf> {
        if !valid_id(state) {
            return None;
        }
        Some(self.dir_of(board)?.join("revisions").join(format!("{state}.json")))
    }

    pub fn read_revision(&self, board: &str, state: &str) -> Option<String> {
        fs::read_to_string(self.revision_file(board, state)?).ok()
    }

    /// Written holding the lock, into the board's folder as it is then (one renamed meanwhile, for a
    /// new title, is followed rather than made again under its old name).
    pub fn write_revision(&self, board: &str, state: &str, doc: &Value) -> Result<(), String> {
        let text = serde_json::to_string_pretty(doc).map_err(|e| e.to_string())?;
        let _held = lock(&self.root, WAIT)?;
        let file = self.revision_file(board, state).ok_or("save the board first")?;
        fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
        write_atomic(&file, text).map_err(|e| e.to_string())
    }

    pub fn remove_revision(&self, board: &str, state: &str) {
        if let Some(f) = self.revision_file(board, state) {
            let _ = fs::remove_file(f);
        }
    }

    pub fn asset_file(&self, board: &str, name: &str) -> Option<PathBuf> {
        if !valid_id(board) || !valid_asset(name) {
            return None;
        }
        Some(self.dir_of(board)?.join("assets").join(name))
    }

    /// Written as a state of the history is (see write_revision).
    pub fn write_asset(&self, board: &str, name: &str, bytes: &[u8]) -> Result<(), String> {
        let _held = lock(&self.root, WAIT)?;
        let file = self.asset_file(board, name).ok_or("save the board first")?;
        fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
        write_atomic(&file, bytes).map_err(|e| e.to_string())
    }

    pub fn read_presets(&self) -> String {
        fs::read_to_string(self.root.join("presets.json")).unwrap_or_else(|_| "[]".into())
    }

    pub fn write_presets(&self, list: &Value) -> Result<(), String> {
        if !list.is_array() {
            return Err("not a list".into());
        }
        let _held = lock(&self.root, WAIT)?;
        write_atomic(&self.root.join("presets.json"), &serde_json::to_string_pretty(list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp() -> Store {
        // Tests run side by side: each takes a folder of its own.
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let root = std::env::temp_dir().join(format!("keito-rs-{}-{}-{n}", std::process::id(), now_ms()));
        fs::create_dir_all(&root).unwrap();
        Store::new(root)
    }
    fn board(id: &str, title: &str) -> Value {
        json!({ "version": 1, "id": id, "meta": { "title": title, "project": "P" }, "nodes": [], "edges": [] })
    }

    #[test]
    fn makes_folder_names_as_the_page_and_the_command_line_do() {
        let cases: Vec<(String, String)> = serde_json::from_str(include_str!("../../test/slug-cases.json")).unwrap();
        for (title, folder) in cases {
            assert_eq!(slug(&title), folder, "{title:?}");
        }
    }

    #[test]
    fn reads_a_version_number_as_the_page_does() {
        for (v, n) in [(json!(5), 5), (json!("5"), 5), (json!(5.0), 5), (json!(-1), 0), (json!("x"), 0), (json!(null), 0)] {
            assert_eq!(serial_of(&json!({ "serial": v })), n, "{v}");
        }
    }

    #[test]
    fn writes_on_the_version_read_and_refuses_older_ones() {
        let s = temp();
        let w = s.write(board("aaa111", "配置図"), None).unwrap();
        assert_eq!(w.serial, 1);
        assert_eq!(w.folder, "配置図__aaa111");
        assert_eq!(s.write(board("aaa111", "配置図"), Some(1)).unwrap().serial, 2);
        assert!(matches!(s.write(board("aaa111", "配置図"), Some(1)), Err(WriteError::Conflict(2))));
    }

    #[test]
    fn never_brings_back_a_board_deleted_meanwhile() {
        let s = temp();
        s.write(board("aaa111", "配置図"), None).unwrap();
        s.remove("aaa111").unwrap();
        assert!(matches!(s.write(board("aaa111", "配置図"), Some(1)), Err(WriteError::Gone)));
        assert!(s.list().is_empty());
        let t = s.trashed();
        assert_eq!(t.len(), 1);
        assert_eq!(s.restore(&t[0].key).unwrap(), "aaa111");
        assert_eq!(s.list().len(), 1);
    }

    #[test]
    fn follows_a_renamed_board_with_its_folder() {
        let s = temp();
        s.write(board("aaa111", "配置図"), None).unwrap();
        let w = s.write(board("aaa111", "配置図 v2"), Some(1)).unwrap();
        assert_eq!(w.folder, "配置図_v2__aaa111");
        assert!(s.read("aaa111").unwrap().is_some());
    }

    #[test]
    fn names_folders_as_the_command_line_does() {
        // What server/store.ts's slug gives for each (worked out there).
        for (title, want) in [
            ("展示システム系統図（サンプル）", "展示システム系統図（サンプル）"),
            ("monolith_ensemble 系統図", "monolith_ensemble_系統図"),
            (" a. b ", "a_b"),
            ("__x__", "x"),
            ("...", "board"),
            ("", "board"),
            ("v1.2/final?", "v1_2_final"),
            ("tab\there", "tab_here"),
        ] {
            assert_eq!(slug(title), want, "{title:?}");
        }
        assert_eq!(slug(&"あ".repeat(70)).chars().count(), 60);
    }

    #[test]
    fn waits_for_the_lock_and_takes_over_one_left_behind() {
        let s = temp();
        let file = s.root.join(LOCK);
        fs::write(&file, "").unwrap();
        assert_eq!(lock(&s.root, Duration::from_millis(60)).err().as_deref(), Some(BUSY));
        // A lock older than STALE was left by a writer that died.
        let old = SystemTime::now() - Duration::from_secs(60);
        fs::File::options().write(true).open(&file).unwrap().set_modified(old).unwrap();
        drop(lock(&s.root, Duration::from_millis(60)).unwrap());
        assert!(!file.exists());
    }

    #[test]
    fn loses_no_change_when_several_write_one_board_at_once() {
        let s = temp();
        s.write(board("shared1", "共有"), None).unwrap();
        let root = s.root.clone();
        let writers: Vec<_> = (0..4)
            .map(|w| {
                let root = root.clone();
                std::thread::spawn(move || {
                    // A store of its own, as another process would have.
                    let s = Store::new(root);
                    for i in 0..15 {
                        loop {
                            let mut doc: Value = serde_json::from_str(&s.read("shared1").unwrap().unwrap()).unwrap();
                            let base = serial_of(&doc);
                            doc["nodes"].as_array_mut().unwrap().push(json!(format!("{w}-{i}")));
                            match s.write(doc, Some(base)) {
                                Ok(_) => break,
                                Err(WriteError::Conflict(_)) => continue,
                                Err(WriteError::Other(e)) if e == BUSY => continue,
                                Err(e) => panic!("{e:?}"),
                            }
                        }
                    }
                })
            })
            .collect();
        for w in writers {
            w.join().unwrap();
        }
        let doc: Value = serde_json::from_str(&s.read("shared1").unwrap().unwrap()).unwrap();
        assert_eq!(doc["nodes"].as_array().unwrap().len(), 60);
        assert_eq!(serial_of(&doc), 61);
        assert!(!s.root.join(LOCK).exists());
    }

    #[test]
    fn refuses_ids_and_keys_that_reach_outside() {
        let s = temp();
        assert!(s.write(board("a__b", "x"), None).is_err());
        assert!(s.write(board("../x", "x"), None).is_err());
        assert!(s.restore("../x").is_err());
        assert!(s.asset_file("aaa111", "../board.json").is_none());
        assert!(!valid_id("スタジオ"));
        assert_eq!(slug("展示 系統図: v2/最終?"), "展示_系統図_v2_最終");
    }
}
