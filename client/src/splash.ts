/**
 * Hands the splash drawn by index.html over to the app.
 *
 * The logo animation plays only on the first open in a tab: the splash stays until the mark has
 * finished drawing (INTRO_MS, about a second; keep it in step with the animation delays in
 * index.html), then flies into the rail's mark, which it is drawn identically to, so the logo is
 * never seen twice. Every later reload (F5) shows no logo at all, just the paper colour until the
 * app has its first real screen, then it is removed.
 */
const INTRO_MS = 1100;
const SEEN_KEY = "gms.splash";

let done = false;

export function dismissSplash(): void {
  if (done) return;
  done = true;
  const el = document.getElementById("gms-splash");
  if (!el) return;
  const intro = el.classList.contains("is-intro");
  try {
    sessionStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* private mode: the intro plays again next time, which is harmless */
  }
  const wait = intro ? Math.max(0, INTRO_MS - performance.now()) : 0;
  window.setTimeout(() => requestAnimationFrame(() => leave(el)), wait);
}

function leave(el: HTMLElement) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // A reload shows no logo (index.html hides it), so there is nothing to fly or fade.
  if (reduced || typeof el.animate !== "function" || el.classList.contains("is-quick")) {
    el.remove();
    return;
  }
  const mark = el.querySelector<SVGElement>(".sp-mark");
  const word = el.querySelector<HTMLElement>(".sp-word");
  const target = document.querySelector<SVGElement>(".rail-mark .brand-mark");
  const targetBox = target?.getBoundingClientRect();
  const from = mark?.getBoundingClientRect();
  const finish = () => {
    if (target) target.style.opacity = "";
    el.remove();
  };

  // Stop the waiting pulse so the dot does not jump mid-flight.
  el.querySelectorAll<SVGElement>(".sp-dot").forEach((d) => (d.style.animation = "none"));

  if (mark && from && target && targetBox && targetBox.width > 0) {
    target.style.opacity = "0";
    const dx = targetBox.left + targetBox.width / 2 - (from.left + from.width / 2);
    const dy = targetBox.top + targetBox.height / 2 - (from.top + from.height / 2);
    const s = targetBox.width / from.width;
    word?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: "forwards", easing: "ease-out" });
    el.animate([{ backgroundColor: getComputedStyle(el).backgroundColor }, { backgroundColor: "transparent" }], {
      duration: 260,
      delay: 60,
      fill: "forwards",
      easing: "ease-out",
    });
    mark
      .animate([{ transform: "none" }, { transform: `translate(${dx}px, ${dy}px) scale(${s})` }], {
        duration: 520,
        fill: "forwards",
        easing: "cubic-bezier(.2, 0, 0, 1)",
      })
      .finished.then(finish, finish);
    return;
  }

  el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: "forwards", easing: "ease-out" }).finished.then(finish, finish);
  mark?.animate([{ transform: "none" }, { transform: "scale(.94)" }], { duration: 200, fill: "forwards", easing: "ease-out" });
}
