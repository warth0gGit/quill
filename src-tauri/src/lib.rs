//! Quill's native side: owns the library folder on disk.
//!
//! The library lives in `Documents\Quill`. Every document is one readable
//! `.html` file, in folders you arrange yourself. New pages land in
//! `Documents\Quill\Inbox`. Deleted things wait in a hidden `.trash` folder
//! for 30 days, so Undo always works.

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let root = ensure_library(app.handle()).map_err(Box::<dyn std::error::Error>::from)?;
            std::thread::spawn(move || {
                library::empty_old_trash(&root);
                library::hide_trash(&root);
            });
            Ok(())
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
            restore_item
        ])
        .run(tauri::generate_context!())
        .expect("error while running Quill");
}
