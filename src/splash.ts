/**
 * The start-up splash (from the logo work): after a 120 ms pause the feather
 * rises in (420 ms), the ink line writes itself from 70% of the rise (340 ms),
 * the feather breathes once (300 ms), and after a 60 ms hold the splash fades
 * (140 ms) to the page. About 1.25 s in all. If Quill isn't ready by then,
 * the feather waits. With reduced motion on, it simply appears and fades.
 */
export async function runSplash(appReady: Promise<unknown> = Promise.resolve()) {
  const splash = document.getElementById("q-splash");
  if (!splash) return;
  const mark = splash.querySelector<SVGElement>(".q-mark");
  const ink = splash.querySelector<SVGPathElement>("#ink-line");
  const finish = () => splash.remove();
  if (!mark || !ink || typeof splash.animate !== "function") return finish();

  const go = (el: Element, kf: Keyframe[], o: KeyframeAnimationOptions) =>
    el.animate(kf, { fill: "forwards", ...o }).finished;
  const LEAD = 120, RISE = 420, INK = 340, PULSE = 300, HOLD = 60, FADE = 140;
  try {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      ink.style.strokeDashoffset = "0";
      await go(mark, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: LEAD });
    } else {
      await Promise.all([
        go(mark, [{ opacity: 0, transform: "translateY(8%) scale(.94)" }, { opacity: 1, transform: "none" }], {
          duration: RISE,
          delay: LEAD,
          easing: "cubic-bezier(.2,.8,.2,1)",
        }),
        go(ink, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
          duration: INK,
          delay: LEAD + RISE * 0.7,
          easing: "cubic-bezier(.45,.1,.3,1)",
        }),
      ]);
      await go(mark, [{ transform: "none" }, { transform: "scale(1.08)", offset: 0.45 }, { transform: "none" }], {
        duration: PULSE,
        easing: "ease-in-out",
      });
    }
    await appReady;
    await go(splash, [{ opacity: 1 }, { opacity: 0 }], { duration: FADE, delay: HOLD, easing: "ease-in" });
  } finally {
    finish();
  }
}
