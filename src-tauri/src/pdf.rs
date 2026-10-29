//! A page made for print, written straight to a PDF by a hidden web view of the app's own: no print
//! dialog, no browser, no header or footer of a browser's.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc;
use std::time::Duration;
use tauri::http::{Request, Response, StatusCode};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Pages waiting to be printed, by the label of the window that shows them: the page, and the
/// nonce its own script runs by.
#[derive(Default)]
pub struct Pages(Mutex<HashMap<String, (String, String)>>);

/// Cuts long tables a page each, with their header rows (see the file).
const SPLIT_TABLES: &str = include_str!("print.js");

/// The page's margin, as the page made for print has it (MARGIN in src/export/exporters.tsx).
const MARGIN_MM: f64 = 10.0;

static NEXT: AtomicUsize = AtomicUsize::new(0);

/// The `keito-print:` scheme: a waiting page, by its window's label. It runs no script but the one
/// added here, and reaches nothing but its inline pictures and the boards' own.
pub fn serve(app: &AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let label = request.uri().path().trim_start_matches('/');
    let page = app.state::<Pages>().0.lock().unwrap_or_else(|e| e.into_inner()).get(label).cloned();
    match page {
        Some((html, nonce)) => Response::builder()
            .header("Content-Type", "text/html; charset=utf-8")
            .header("Content-Security-Policy", format!("default-src 'none'; script-src 'nonce-{nonce}'; style-src 'unsafe-inline'; img-src data: keito-asset: http://keito-asset.localhost"))
            .body(html.into_bytes())
            .unwrap(),
        None => Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).unwrap(),
    }
}

/// Points to the millimetre.
const MM: f64 = 72.0 / 25.4;

/// Paper in points, portrait (the page is laid out across it, landscape).
fn paper_size(paper: &str) -> (f64, f64) {
    match paper {
        "A3" => (297.0 * MM, 420.0 * MM),
        _ => (210.0 * MM, 297.0 * MM),
    }
}

/// Print `html` on `paper` (A4 or A3, landscape) into the PDF at `path`.
pub async fn write(app: AppHandle, html: String, paper: String, path: std::path::PathBuf) -> Result<(), String> {
    let label = format!("print-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let (w, h) = paper_size(&paper);
    let nonce = format!("{:x}{label}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)).replace('-', "");
    // WebKit prints a CSS pixel as 0.8 pt, not the 0.75 pt it is: the page is zoomed back to size,
    // so that millimetres come out as millimetres and the pages break where the page laid them out.
    let page_mm = w / MM - MARGIN_MM * 2.0;
    let added = format!("<style>@media print{{html{{zoom:0.9375}}}}</style><script nonce=\"{nonce}\">const PAGE_MM={page_mm};{SPLIT_TABLES}</script></body>");
    let html = match html.rfind("</body>") {
        Some(at) => format!("{}{added}{}", &html[..at], &html[at + "</body>".len()..]),
        None => html + &added,
    };
    app.state::<Pages>().0.lock().unwrap_or_else(|e| e.into_inner()).insert(label.clone(), (html, nonce));
    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    let sent = Mutex::new(Some(tx));
    let url = format!("keito-print://localhost/{label}").parse::<tauri::Url>().map_err(|e| e.to_string())?;
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::CustomProtocol(url))
        .visible(false)
        .inner_size(h, w)
        .on_page_load(move |window, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            let Some(tx) = sent.lock().unwrap_or_else(|e| e.into_inner()).take() else { return };
            let path = path.clone();
            let failed = tx.clone();
            if let Err(e) = window.with_webview(move |view| print(view, (w, h), &path, tx)) {
                let _ = failed.send(Err(e.to_string()));
            }
        })
        .build()
        .map_err(|e| e.to_string())?;
    let done = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(120)).unwrap_or_else(|_| Err("PDF を書き出せませんでした（時間切れ）".into())))
        .await
        .map_err(|e| e.to_string())?;
    app.state::<Pages>().0.lock().unwrap_or_else(|e| e.into_inner()).remove(&label);
    let _ = window.destroy();
    done
}

#[cfg(target_os = "macos")]
fn print(view: tauri::webview::PlatformWebview, (w, h): (f64, f64), path: &std::path::Path, tx: mpsc::Sender<Result<(), String>>) {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{AnyThread, MainThreadMarker, sel};
    use objc2_app_kit::{NSPaperOrientation, NSPrintInfo, NSPrintJobSavingURL, NSPrintSaveJob, NSWindow};
    use objc2_foundation::{NSSize, NSString, NSURL};
    use objc2_web_kit::WKWebView;

    let Some(mtm) = MainThreadMarker::new() else {
        let _ = tx.send(Err("not on the main thread".into()));
        return;
    };
    // Safety: the pointers are the live web view and window of this webview, handed over on the main thread.
    let (web, window) = unsafe { (&*(view.inner() as *const WKWebView), &*(view.ns_window() as *const NSWindow)) };
    let info = NSPrintInfo::init(NSPrintInfo::alloc());
    info.setPaperSize(NSSize::new(w, h));
    info.setOrientation(NSPaperOrientation::Landscape);
    // The page's own @page margins place it (WebKit takes no margins from here).
    info.setTopMargin(0.0);
    info.setBottomMargin(0.0);
    info.setLeftMargin(0.0);
    info.setRightMargin(0.0);
    info.setHorizontallyCentered(false);
    info.setVerticallyCentered(false);
    unsafe {
        info.setJobDisposition(NSPrintSaveJob);
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
        info.dictionary().insert(NSPrintJobSavingURL, &*url as &AnyObject);
    }
    let op = unsafe { web.printOperationWithPrintInfo(&info) };
    op.setShowsPrintPanel(false);
    op.setShowsProgressPanel(false);
    let delegate = Printed::new(mtm, tx);
    // WebKit draws the pages only when run modally for a window; `runOperation` gives blank ones.
    unsafe {
        op.runOperationModalForWindow_delegate_didRunSelector_contextInfo(window, Some(&delegate), Some(sel!(printOperationDidRun:success:contextInfo:)), std::ptr::null_mut());
    }
    // Kept until the operation has run: AppKit does not hold its delegate.
    let _ = Retained::into_raw(delegate);
}

#[cfg(not(target_os = "macos"))]
fn print(_view: tauri::webview::PlatformWebview, _paper: (f64, f64), _path: &std::path::Path, tx: mpsc::Sender<Result<(), String>>) {
    let _ = tx.send(Err("この OS では PDF を直接書き出せません".into()));
}

#[cfg(target_os = "macos")]
mod delegate {
    use objc2::rc::Retained;
    use objc2::runtime::{Bool, NSObject};
    use objc2::{DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send};
    use objc2_app_kit::NSPrintOperation;
    use std::cell::RefCell;
    use std::ffi::c_void;
    use std::sync::mpsc::Sender;

    pub struct Ivars {
        tx: RefCell<Option<Sender<Result<(), String>>>>,
    }

    define_class!(
        // Hears that the print operation has run, and says so to whoever waits.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[ivars = Ivars]
        pub struct Printed;

        impl Printed {
            #[unsafe(method(printOperationDidRun:success:contextInfo:))]
            fn did_run(&self, _op: &NSPrintOperation, success: Bool, _context: *mut c_void) {
                if let Some(tx) = self.ivars().tx.borrow_mut().take() {
                    let _ = tx.send(if success.as_bool() { Ok(()) } else { Err("PDF を書き出せませんでした".into()) });
                }
                // Let go of the hold taken when the operation started, once AppKit is done with it.
                // Safety: that hold was taken with `into_raw` on this very object, and is let go once.
                unsafe { let _ = Retained::autorelease_ptr(Retained::from_raw(self as *const Self as *mut Self).unwrap()); }
            }
        }
    );

    impl Printed {
        pub fn new(mtm: MainThreadMarker, tx: Sender<Result<(), String>>) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(Ivars { tx: RefCell::new(Some(tx)) });
            unsafe { msg_send![super(this), init] }
        }
    }
}

#[cfg(target_os = "macos")]
use delegate::Printed;
