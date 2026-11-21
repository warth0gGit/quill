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
  Menu, line spacing, pages, print and the window buttons. **F11** is full screen.
- **Ctrl+N** starts a new page. Saving is automatic.

## The library

Press **Ctrl+L**, click **Library** on the top shelf, or move the mouse to the left
edge to bring in the tree.

- Click a document to open it. Click a folder to open or close it.
- **+** makes a new folder. Double-click a folder's name (or press **F2**) to rename it.
- Drag documents and folders onto another folder to move them.
- The bin moves things to the Trash. Every move and delete can be undone from the
  note at the bottom of the tree, and the Trash keeps things for 30 days.

## Pictures

Paste a picture (**Ctrl+V**), drag one in from File Explorer, or choose **Picture**
on the bottom shelf. Pictures always go between paragraphs: a pasted one goes in
below the paragraph you're in, and a dropped one where the glowing line shows.

- Click a picture for the image bar: wrap left, centre, wrap right or wide; sizes
  S, M, L and Full; a caption; replace; remove.
- Drag a picture to move it. Drop it on the left or right to wrap text around it.
- A wrapped picture stays exactly where you put it on the page. Text you add
  above it flows around it instead of pushing it down. Centred and wide pictures
  sit between paragraphs and move with the text.
- Drag a corner to resize. Sizes snap between the four widths, or past Full into Wide.
- With a picture clicked: **←** **→** change the layout, **↑** **↓** the size,
  **Delete** removes it, and **Enter** or **Esc** goes back to writing.

## Quick capture

Press **Ctrl+Alt+Q** from anywhere and a small Quill window floats over
whatever you're doing. Type and press **Enter**, and it's saved to the Quick Capture folder.
To file it straight away, press **Tab**, start typing a folder name, and press
**Enter**. **Shift+Enter** starts a new line. **Esc**, or clicking somewhere else,
puts the window away and keeps what you typed for next time.

The shortcut works whenever Quill is open, even minimised. Closing Quill's window
quits it, and the shortcut with it. **Quick capture** is also in the Menu. If
another app already uses Ctrl+Alt+Q, Quill tells you when it starts.

## Autocorrect

Type lazily and Quill tidies up as you go. When you finish a word (a space,
punctuation or Enter), it fixes obvious typos (teh, recieve, becuase), puts
back dropped apostrophes (dont, im, youre), makes "i" a capital I, and gives
each sentence a capital letter. A faint blue underline shows a fix, then fades.

Didn't want that fix? Press **Ctrl+Z** straight away and the word goes back to
how you typed it. Quill leaves that word alone from then on. Switch autocorrect
off or on with **Autocorrect** in the top shelf. It all happens on your PC, with
no internet needed.

## Dictation

Press **Ctrl+Shift+D** (or **Dictate** on the top shelf) and speak; press it
again, or **Esc**, to stop. While Quill listens, the cursor swells with your
voice, and each phrase appears a moment after you pause, faint at first, then
settling into ink. Dictated words take the Shelf's style, like typed ones, and
**Ctrl+Z** takes back a whole phrase.

You can say **new paragraph**, **new line**, **scratch that** (removes the last
phrase) and **stop listening**. Dictation works in quick capture too.

It all happens on your PC: the first time, Quill offers to download its speech
model (Whisper base.en, about 148 MB) into its app data folder, and from then on
dictation works offline and no sound leaves the computer. If Quill hears only
silence, check Windows **Settings > Privacy > Microphone**.

## Where your writing lives

Everything is saved in `Documents\Quill`, in the folders you make in the library.
New pages go to `Documents\Quill\Inbox`, and quick captures to `Documents\Quill\Quick Capture`. Deleted things wait in a hidden `.trash`
folder there for 30 days.
Each document is one ordinary `.html` file that opens in any web browser, so your
writing is never locked inside the app. A document's pictures are ordinary image
files in a folder beside it with the same name plus "images" (the tree hides these
folders). They move with their document and go to the Trash with it.

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
