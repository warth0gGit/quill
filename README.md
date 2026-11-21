# Quill

A calm, distraction-free writing app for Windows. A Mac version will follow. Most of the time the screen
shows nothing but your words and a softly glowing blue cursor.

## Install

1. Open the [Build workflow](../../actions/workflows/build.yml) and click the latest green run.
2. Download **Quill-Windows-installer** from the bottom of the page and unzip it.
3. Run the `.exe` installer. It installs for your user only, so no admin rights are needed.

Windows may warn that the installer is from an unknown publisher, because it isn't
code-signed yet. Choose **More info**, then **Run anyway**.

## Using it

- Quill opens straight to a fresh page. Just type.
- Select words to bring up the formatting pill: bold, italic, strike-through,
  four sizes (Small, Body, Large, Title) and five colours.
- Move the mouse to the bottom edge of the window for the Shelf. It sets the text
  size of the whole document, and the style of the next words you type.
- Move the mouse to the top edge (or press **Alt**) for the top shelf: the Library,
  File menu, line spacing, pages, print and the window buttons. **F11** is full screen.
- **Ctrl+N** starts a new page. Saving is automatic.

## The library

Press **Ctrl+L**, click **Library** on the top shelf, or move the mouse to the left
edge to bring in the tree.

- Click a document to open it. Click a folder to open or close it.
- **+** makes a new folder. Double-click a folder's name (or press **F2**) to rename it.
- Drag documents and folders onto another folder to move them.
- The bin moves things to the Trash. Every move and delete can be undone from the
  note at the bottom of the tree, and the Trash keeps things for 30 days.

## Where your writing lives

Everything is saved in `Documents\Quill`, in the folders you make in the library.
New pages go to `Documents\Quill\Inbox`. Deleted things wait in a hidden `.trash`
folder there for 30 days.
Each document is one ordinary `.html` file that opens in any web browser, so your
writing is never locked inside the app.

## Development

Requires Node 22 and Rust (stable). On Linux, also the Tauri system libraries
(`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev`).

```sh
npm install
npm run tauri dev      # run the app with live reload
npm run build          # type check and build the web front end
cd src-tauri && cargo test
npx tauri build        # build the installer for the current platform
```

The front end (`src/`) is TypeScript with the TipTap editor. The native side
(`src-tauri/`) is Tauri 2 in Rust and owns the library folder on disk.
