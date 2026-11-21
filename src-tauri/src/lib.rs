//! Quill's native side: owns the library folder on disk.
//!
//! The library lives in `Documents\Quill`. Every document is one readable
//! `.html` file, in folders you arrange yourself. New pages land in
//! `Documents\Quill\Inbox`. Deleted things wait in a hidden `.trash` folder
//! for 30 days, so Undo always works. Pictures live in a folder beside their
//! document and are shown in the window through the `qimg:` address scheme.

mod desktop;
mod dictation;
mod library;

use library::Entry;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

fn library_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let docs = app
        .path()
        .document_dir()
        .map_err(|e| format!("Couldn't find your Documents folder: {e}"))?;
    Ok(docs.join("Quill"))
}

fn ensure_library(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = library_root(app)?;
    fs::create_dir_all(root.join(library::INBOX))
        .map_err(|e| format!("Couldn't create the Quill library folder: {e}"))?;
    Ok(root)
}

// Commands are async so disk work never holds up the window.

#[tauri::command]
async fn library_path(app: tauri::AppHandle) -> Result<String, String> {
    Ok(ensure_library(&app)?.to_string_lossy().into_owned())
}

#[tauri::command]
async fn list_library(app: tauri::AppHandle) -> Result<Entry, String> {
    Ok(library::list(&ensure_library(&app)?))
}

/// Saves a document and returns its full path on disk.
#[tauri::command]
async fn save_document(app: tauri::AppHandle, path: String, contents: String) -> Result<String, String> {
    let saved = library::save(&ensure_library(&app)?, &path, &contents)?;
    Ok(saved.to_string_lossy().into_owned())
}

#[tauri::command]
async fn read_document(app: tauri::AppHandle, path: String) -> Result<String, String> {
    library::read(&ensure_library(&app)?, &path)
}

#[tauri::command]
async fn full_path(app: tauri::AppHandle, path: String) -> Result<String, String> {
    Ok(library::resolve(&ensure_library(&app)?, &path)?.to_string_lossy().into_owned())
}

#[tauri::command]
async fn create_folder(app: tauri::AppHandle, parent: String, name: String) -> Result<String, String> {
    library::create_folder(&ensure_library(&app)?, &parent, &name)
}

#[tauri::command]
async fn rename_folder(app: tauri::AppHandle, path: String, name: String) -> Result<String, String> {
    library::rename_folder(&ensure_library(&app)?, &path, &name)
}

#[tauri::command]
async fn move_item(app: tauri::AppHandle, path: String, into: String) -> Result<String, String> {
    library::move_item(&ensure_library(&app)?, &path, &into)
}

#[tauri::command]
async fn trash_item(app: tauri::AppHandle, path: String) -> Result<String, String> {
    library::trash(&ensure_library(&app)?, &path)
}

#[tauri::command]
async fn restore_item(app: tauri::AppHandle, id: String) -> Result<String, String> {
    library::restore(&ensure_library(&app)?, &id)
}

/// Keeps a picture for a document. The picture's bytes arrive as the raw
/// request body (no JSON), with the document's path and the picture's
/// original name in percent-encoded headers. Returns the document-relative
/// path to write into the page, e.g. `On slowness images/photo.png`.
#[tauri::command]
async fn save_image(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("The picture didn't arrive".into());
    };
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(library::decode_component)
            .unwrap_or_default()
    };
    library::save_image(&ensure_library(&app)?, &header("x-doc"), &header("x-name"), bytes)
}

#[tauri::command]
async fn copy_image(app: tauri::AppHandle, from: String, doc: String) -> Result<String, String> {
    library::copy_image(&ensure_library(&app)?, &from, &doc)
}

#[tauri::command]
async fn discard_unsaved_images(app: tauri::AppHandle, doc: String) -> Result<(), String> {
    library::discard_unsaved_images(&ensure_library(&app)?, &doc)
}

#[tauri::command]
fn show_main(app: tauri::AppHandle) {
    desktop::show_main(&app);
}

/// Whether Quill got its quick capture shortcut, set once at start-up.
struct ShortcutClaimed(bool);

/// The quick capture shortcut as the menu shows it, and whether Quill has it.
#[tauri::command]
fn capture_shortcut(claimed: tauri::State<'_, ShortcutClaimed>) -> (String, bool) {
    (desktop::SHORTCUT_LABEL.to_string(), claimed.0)
}

#[tauri::command]
fn open_capture(app: tauri::AppHandle) {
    desktop::toggle_capture(&app);
}

/// Serves pictures to the window: `qimg://localhost/<library path>` (on
/// Windows, `http://qimg.localhost/<library path>`), percent-encoded. Only
/// picture files inside the library can be fetched.
fn serve_image(app: &tauri::AppHandle, uri_path: &str) -> tauri::http::Response<Vec<u8>> {
    let rel = library::decode_component(uri_path.trim_start_matches('/'));
    let found = ensure_library(app).and_then(|root| library::read_image(&root, &rel));
    let builder = tauri::http::Response::builder();
    match found {
        Ok((bytes, mime)) => builder
            .status(200)
            .header("Content-Type", mime)
            .header("Cache-Control", "no-cache")
            .body(bytes),
        Err(e) => builder.status(404).header("Content-Type", "text/plain").body(e.into_bytes()),
    }
    .expect("a valid response")
}

/* ------------------------------------------------------------ dictation */

/// Whether the speech model is on this PC yet, and its download size in MB.
#[tauri::command]
fn dictation_ready(app: tauri::AppHandle) -> (bool, u32) {
    (dictation::has_model(&app), dictation::MODEL_MB)
}

#[tauri::command]
fn dictation_download(app: tauri::AppHandle, window: tauri::Window) {
    dictation::download(app, window.label().to_string());
}

/// Starts listening for this window. Fails with "model-missing" until the
/// speech model has been downloaded.
#[tauri::command]
fn dictation_start(app: tauri::AppHandle, window: tauri::Window) -> Result<(), String> {
    dictation::start(app, window.label().to_string())
}

#[tauri::command]
fn dictation_stop(app: tauri::AppHandle) {
    dictation::stop(&app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // A second launch (say, from the Start menu while Quill is minimised)
        // brings the running Quill to the front instead.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| desktop::show_main(app)))
        .plugin(desktop::shortcut_plugin())
        .plugin(tauri_plugin_opener::init())
        .manage(dictation::Dictation::default())
        .register_asynchronous_uri_scheme_protocol("qimg", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let path = request.uri().path().to_string();
            // Read the file off the main thread.
            std::thread::spawn(move || responder.respond(serve_image(&app, &path)));
        })
        .setup(|app| {
            let root = ensure_library(app.handle()).map_err(Box::<dyn std::error::Error>::from)?;
            let handle = app.handle();
            app.manage(ShortcutClaimed(desktop::register_shortcut(handle)));
            desktop::prepare_capture(handle);
            std::thread::spawn(move || {
                library::empty_old_trash(&root);
                library::hide_trash(&root);
            });
            Ok(())
        })
        // The capture window waits hidden, so Quill quits when its main window closes.
        .on_window_event(|window, event| {
            if window.label() == desktop::MAIN && matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            library_path,
            list_library,
            save_document,
            read_document,
            full_path,
            create_folder,
            rename_folder,
            move_item,
            trash_item,
            restore_item,
            save_image,
            copy_image,
            discard_unsaved_images,
            show_main,
            open_capture,
            capture_shortcut,
            dictation_ready,
            dictation_download,
            dictation_start,
            dictation_stop
        ])
        .run(tauri::generate_context!())
        .expect("error while running Quill");
}
