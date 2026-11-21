// Runs before anything is drawn: puts the splash and the page on the chosen
// skin's paper straight away, so a dark skin never starts with a white flash.
(function () {
  try {
    var b = JSON.parse(localStorage.getItem("quill:skin:boot") || "null");
    if (!b) return;
    var night = b.mode === "night" || (b.mode === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
    var v = night ? b.night : b.day;
    var r = document.documentElement.style;
    r.setProperty("--paper", v[0]);
    r.setProperty("--ink", v[1]);
    r.setProperty("--desk", v[2]);
    r.colorScheme = night ? "dark" : "light";
  } catch (e) {}
})();
