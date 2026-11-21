/** Small helpers for Quill's toolbars and icons. */

export function bar(className: string, label: string, parent: HTMLElement = document.body) {
  const el = document.createElement("div");
  el.className = `tb ${className}`;
  el.setAttribute("role", "toolbar");
  el.setAttribute("aria-label", label);
  parent.appendChild(el);
  const button = (html: string, title: string, run: (b: HTMLButtonElement) => void, into: HTMLElement = el) => {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = html;
    b.title = title;
    b.setAttribute("aria-label", title);
    // Keep the text selection and focus in the editor when a button is pressed.
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => run(b));
    into.appendChild(b);
    return b;
  };
  const sep = (into: HTMLElement = el) => into.appendChild(Object.assign(document.createElement("span"), { className: "sep" }));
  const tag = (t: string, into: HTMLElement = el) =>
    into.appendChild(Object.assign(document.createElement("span"), { className: "lbl", textContent: t }));
  const group = (className = "grp") => {
    const g = document.createElement("div");
    g.className = className;
    el.appendChild(g);
    return g;
  };
  return { el, button, sep, tag, group };
}

export const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "Cmd" : "Ctrl";

const svg = (body: string, extra = 'fill="none" stroke="currentColor" stroke-width="1.3"') =>
  `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" ${extra}>${body}</svg>`;

export const icons = {
  file: svg('<path d="M4 1.5h5.5L12.5 4.5V14.5H4z"/><path d="M9.5 1.5v3h3"/>'),
  library: svg('<circle cx="4" cy="3.5" r="1.8"/><circle cx="10.5" cy="8" r="1.8" fill="currentColor"/><circle cx="10.5" cy="13" r="1.8"/><path d="M4 5.3v2.2c0 .3.2.5.5.5h4.2M4 7.5v5c0 .3.2.5.5.5h4.2" stroke-linecap="round"/>'),
  pages: svg('<rect x="3" y="1.5" width="10" height="13" rx="1"/><path d="M5.5 5h5M5.5 7.5h5M5.5 10h3" stroke-linecap="round"/>'),
  print: svg('<path d="M4.5 5.5V1.5h7v4"/><rect x="1.5" y="5.5" width="13" height="6" rx="1.2"/><path d="M4.5 9.5h7v5h-7z"/>', 'fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"'),
  bullets: svg('<circle cx="2.5" cy="4" r="1.2"/><circle cx="2.5" cy="8" r="1.2"/><circle cx="2.5" cy="12" r="1.2"/><path d="M6 3.4h8.5v1.2H6zM6 7.4h8.5v1.2H6zM6 11.4h8.5v1.2H6z"/>', 'fill="currentColor"'),
  numbers: svg('<path d="M1.6 2.6 2.8 2v4M1.6 6h2.4M1.5 9.6c0-.6.5-1 1.1-1s1.1.4 1.1 1c0 .9-2.2 1.6-2.2 2.9h2.3M6 3.4h8.5M6 8h8.5M6 12.6h8.5" stroke-linecap="round" stroke-linejoin="round"/>', 'fill="none" stroke="currentColor" stroke-width="1.2"'),
  picture: svg('<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><circle cx="5.5" cy="6.5" r="1.3"/><path d="M2 12l4-3.6 2.6 2.2L11 8.5l3.5 3" stroke-linejoin="round"/>'),
  min: svg('<path d="M3 8.5h10"/>', 'fill="none" stroke="currentColor" stroke-width="1.1"'),
  max: svg('<rect x="3.5" y="3.5" width="9" height="9"/>', 'fill="none" stroke="currentColor" stroke-width="1.1"'),
  restore: svg('<rect x="3.5" y="5.5" width="7" height="7"/><path d="M5.5 5.5v-2h7v7h-2"/>', 'fill="none" stroke="currentColor" stroke-width="1.1"'),
  close: svg('<path d="M4 4l8 8M12 4l-8 8"/>', 'fill="none" stroke="currentColor" stroke-width="1.1"'),
};
