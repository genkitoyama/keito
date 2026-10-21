//! What the web app asks of the boards folder (the desktop counterpart of server/boards.ts), the
//! `keito-asset:` scheme its pictures are shown from, and the news of boards written elsewhere.

use crate::store::{BoardInfo, Store, Trashed, WriteError, Written};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, RwLock, RwLockReadGuard, mpsc};
use std::time::Duration;
use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Emitter, Manager, State};

/// The folder, and who wrote each board last from this app (so a page knows its own writes).
pub struct Boards {
    store: RwLock<Store>,
    /// Where the folder was named: fixed outside the app (environment, the command line's config),
    /// chosen in the app, or not yet (the documents folder, until the user says).
    source: RwLock<Source>,
    /// One write at a time: the version check and the write must not interleave.
    lock: Mutex<()>,
    ours: Mutex<HashMap<String, (u64, String)>>,
    /// Which watcher is the current one: a folder chosen anew starts another, and the old one stops.
    watching: AtomicUsize,
}

#[derive(Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Env,
    Config,
    Chosen,
    Default,
}

impl Boards {
    pub fn new(root: PathBuf, source: Source) -> Self {
        Boards { store: RwLock::new(Store::new(root)), source: RwLock::new(source), lock: Mutex::new(()), ours: Mutex::new(HashMap::new()), watching: AtomicUsize::new(0) }
    }

    fn store(&self) -> RwLockReadGuard<'_, Store> {
        self.store.read().unwrap_or_else(|e| e.into_inner())
    }
}

/// The app's own settings (the folder chosen for boards).
fn settings_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
}

/// Where the boards live, and who said so: KEITO_BOARDS, else the folder named in
/// ~/.config/keito/config.json (as the command line reads it), else the one chosen in the app,
/// else "keito" in the user's documents (until the user chooses).
pub fn boards_root(app: &AppHandle) -> (PathBuf, Source) {
    if let Ok(dir) = std::env::var("KEITO_BOARDS") {
        if !dir.is_empty() {
            return (PathBuf::from(dir), Source::Env);
        }
    }
    let home = app.path().home_dir().ok();
    let named = |file: PathBuf| std::fs::read_to_string(file).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).and_then(|v| v.get("boards")?.as_str().map(String::from)).filter(|d| !d.is_empty());
    let expand = |dir: String| match (&home, dir.strip_prefix("~/")) {
        (Some(home), Some(rest)) => home.join(rest),
        (Some(home), None) if dir == "~" => home.clone(),
        _ => PathBuf::from(dir),
    };
    if let Some(dir) = home.as_ref().and_then(|h| named(h.join(".config").join("keito").join("config.json"))) {
        return (expand(dir), Source::Config);
    }
    if let Some(dir) = settings_file(app).and_then(named) {
        return (expand(dir), Source::Chosen);
    }
    (app.path().document_dir().map(|d| d.join("keito")).unwrap_or_else(|_| PathBuf::from("keito")), Source::Default)
}

#[derive(Serialize)]
pub struct Folder {
    path: String,
    source: Source,
}

/// The boards folder, and whether it was chosen (or set outside the app) or is still the default.
#[tauri::command]
pub fn boards_folder(boards: State<Boards>) -> Folder {
    Folder { path: boards.store().root.to_string_lossy().into_owned(), source: *boards.source.read().unwrap_or_else(|e| e.into_inner()) }
}

/// Keep boards in this folder from now on (made if need be), and watch it.
#[tauri::command]
pub fn set_boards_folder(app: AppHandle, boards: State<Boards>, path: String) -> Result<(), String> {
    let source = *boards.source.read().unwrap_or_else(|e| e.into_inner());
    if matches!(source, Source::Env | Source::Config) {
        return Err("保存場所は KEITO_BOARDS か ~/.config/keito/config.json で決められています".into());
    }
    let root = PathBuf::from(&path);
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let file = settings_file(&app).ok_or("no settings folder")?;
    std::fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&file, serde_json::to_string_pretty(&serde_json::json!({ "boards": path })).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    *boards.store.write().unwrap_or_else(|e| e.into_inner()) = Store::new(root);
    *boards.source.write().unwrap_or_else(|e| e.into_inner()) = Source::Chosen;
    watch(app.clone());
    Ok(())
}

#[tauri::command]
pub fn list_boards(boards: State<Boards>) -> Vec<BoardInfo> {
    boards.store().list()
}

/// The board's file as it is (the page reads it the way it reads any stored board).
#[tauri::command]
pub fn load_board(boards: State<Boards>, id: String) -> Result<Option<String>, String> {
    boards.store().read(&id)
}

/// Write a board made on version `base` (none: write regardless). Refusals come back as
/// "conflict:<serial>" or "gone", which the page turns into its own errors.
#[tauri::command]
pub fn save_board(boards: State<Boards>, doc: Value, base: Option<u64>, writer: String) -> Result<Written, String> {
    let _held = boards.lock.lock().map_err(|e| e.to_string())?;
    let id = doc.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
    match boards.store().write(doc, base) {
        Ok(done) => {
            boards.ours.lock().map_err(|e| e.to_string())?.insert(id, (done.serial, writer));
            Ok(done)
        }
        Err(WriteError::Conflict(serial)) => Err(format!("conflict:{serial}")),
        Err(WriteError::Gone) => Err("gone".into()),
        Err(WriteError::Other(e)) => Err(e),
    }
}

#[tauri::command]
pub fn remove_board(boards: State<Boards>, id: String) -> Result<(), String> {
    let _held = boards.lock.lock().map_err(|e| e.to_string())?;
    boards.store().remove(&id)
}

#[tauri::command]
pub fn trashed_boards(boards: State<Boards>) -> Vec<Trashed> {
    boards.store().trashed()
}

#[tauri::command]
pub fn restore_board(boards: State<Boards>, key: String) -> Result<String, String> {
    let _held = boards.lock.lock().map_err(|e| e.to_string())?;
    boards.store().restore(&key)
}

#[tauri::command]
pub fn load_revision(boards: State<Boards>, board: String, id: String) -> Option<String> {
    boards.store().read_revision(&board, &id)
}

#[tauri::command]
pub fn save_revision(boards: State<Boards>, board: String, id: String, doc: Value) -> Result<(), String> {
    boards.store().write_revision(&board, &id, &doc)
}

#[tauri::command]
pub fn remove_revision(boards: State<Boards>, board: String, id: String) {
    boards.store().remove_revision(&board, &id)
}

/// A picture for a board's folder: its bytes as the request body, the board and name in headers.
#[tauri::command]
pub fn put_asset(boards: State<Boards>, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).map(String::from).ok_or_else(|| format!("missing {k}"));
    let (board, name) = (header("board")?, header("name")?);
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("expected the picture's bytes".into()) };
    boards.store().write_asset(&board, &name, bytes)
}

#[tauri::command]
pub fn load_presets(boards: State<Boards>) -> String {
    boards.store().read_presets()
}

#[tauri::command]
pub fn save_presets(boards: State<Boards>, list: Value) -> Result<(), String> {
    boards.store().write_presets(&list)
}

/// Write a file where the user chose in a save dialog: its bytes as the body, the place in a header.
#[tauri::command]
pub fn write_file(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let path = request.headers().get("path").and_then(|v| v.to_str().ok()).ok_or("missing path")?;
    let path = percent_decode(path);
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("expected the file's bytes".into()) };
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}

/// A page made for print, opened in the user's browser (the app's own webview cannot print on macOS).
#[tauri::command]
pub fn open_for_print(app: AppHandle, html: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = std::env::temp_dir().join("keito-print");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // Earlier pages are let go once a newer one is made.
    if let Ok(old) = std::fs::read_dir(&dir) {
        for f in old.flatten() {
            let _ = std::fs::remove_file(f.path());
        }
    }
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let file = dir.join(format!("keito-{stamp}.html"));
    std::fs::write(&file, html).map_err(|e| e.to_string())?;
    app.opener().open_path(file.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

/// Read a file the user picked in an open dialog.
#[tauri::command]
pub fn read_file(path: String) -> Result<tauri::ipc::Response, String> {
    std::fs::read(path).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
}

/// A header carries a path percent-encoded (it may hold any character a file name can).
pub(crate) fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// `keito-asset://localhost/<board>/<name>`: a picture from a board's folder.
pub fn serve_asset(app: &AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let not_found = || Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).unwrap();
    let path = request.uri().path().trim_start_matches('/').to_string();
    let Some((board, name)) = path.split_once('/') else { return not_found() };
    let boards = app.state::<Boards>();
    let Some(file) = boards.store().asset_file(board, name) else { return not_found() };
    let Ok(bytes) = std::fs::read(&file) else { return not_found() };
    let mime = match file.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    };
    // Names are content hashes: a given URL never changes. Exports read pictures back with fetch.
    Response::builder()
        .header("Content-Type", mime)
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .header("Access-Control-Allow-Origin", "*")
        .body(bytes)
        .unwrap()
}

/// News of a board written elsewhere (the command line, an edit by hand, another window).
#[derive(Serialize, Clone)]
struct BoardNews {
    id: String,
    serial: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    writer: Option<String>,
}

/// Watch the folder and tell the page of every board written, with who wrote it when it was this app.
pub fn watch(app: AppHandle) {
    use notify::{RecursiveMode, Watcher};
    let boards = app.state::<Boards>();
    let root = boards.store().root.clone();
    let mine = boards.watching.fetch_add(1, Ordering::SeqCst) + 1;
    if !root.is_dir() {
        return;
    }
    std::thread::spawn(move || {
        let (tx, rx) = mpsc::channel();
        let Ok(mut watcher) = notify::recommended_watcher(tx) else { return };
        if watcher.watch(&root, RecursiveMode::Recursive).is_err() {
            return;
        }
        loop {
            // A write lands as several events: gather them, then look once things have settled.
            let Ok(first) = rx.recv() else { return };
            let mut folders = std::collections::HashSet::new();
            let mut take = |event: notify::Result<notify::Event>| {
                for p in event.map(|e| e.paths).unwrap_or_default() {
                    if let Some(folder) = board_folder(&root, &p) {
                        folders.insert(folder);
                    }
                }
            };
            take(first);
            std::thread::sleep(Duration::from_millis(120));
            while let Ok(more) = rx.try_recv() {
                take(more);
            }
            let boards = app.state::<Boards>();
            // A folder chosen since: this watcher is no longer the one, and stops.
            if boards.watching.load(Ordering::SeqCst) != mine {
                return;
            }
            for folder in folders {
                let Some(v) = std::fs::read_to_string(folder.join("board.json")).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) else { continue };
                let Some(id) = v.get("id").and_then(Value::as_str).map(String::from) else { continue };
                let serial = v.get("serial").and_then(Value::as_u64).unwrap_or(0);
                let writer = boards.ours.lock().ok().and_then(|o| o.get(&id).filter(|(s, _)| *s == serial).map(|(_, w)| w.clone()));
                let _ = app.emit("board-changed", BoardNews { id, serial, writer });
            }
        }
    });
}

/// The board folder a changed file belongs to (its board.json), if any; the trash is not news.
fn board_folder(root: &Path, p: &Path) -> Option<PathBuf> {
    let rel = p.strip_prefix(root).ok()?;
    let first = rel.components().next()?.as_os_str().to_str()?;
    if first.starts_with('.') || rel.file_name()?.to_str()? != "board.json" {
        return None;
    }
    Some(root.join(first))
}

#[cfg(test)]
mod tests {
    use super::percent_decode;

    #[test]
    fn decodes_a_path_sent_in_a_header() {
        assert_eq!(percent_decode("%2FUsers%2F%E5%B1%95%E7%A4%BA.xlsx"), "/Users/展示.xlsx");
        assert_eq!(percent_decode("plain"), "plain");
        assert_eq!(percent_decode("50%"), "50%");
    }
}
