/**
 * Hands the splash drawn by index.html over to the app.
 *
 * The logo animation plays only on the first open in a tab: the splash stays until the wordmark
 * has been revealed (INTRO_MS, about a second; keep it in step with the animation delays in
 * index.html), then fades away over the app. Every later reload (F5) shows no logo at all, just
 * the paper colour until the app has its first real screen, then it is removed.
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
  window.setTimeout(() => whenIdle(() => requestAnimationFrame(() => leave(el))), wait);
}

/** How long the flight may wait for a quiet moment before it goes anyway. */
const IDLE_WAIT_MS = 500;

/**
 * Runs `fn` when the main thread has nothing queued (or after IDLE_WAIT_MS at the latest). The app's
 * first real screen has just been committed, and its follow-up work (tasks arriving, the plan drawing)
 * is what a flight started right now would queue behind: the animation then has no frame to start on,
 * the mark sits still and jumps. Starting on an idle moment lets it begin at once.
 */
function whenIdle(fn: () => void): void {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(fn, { timeout: IDLE_WAIT_MS });
  } else {
    window.setTimeout(fn, 50);
  }
}

function leave(el: HTMLElement) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // A reload shows no logo (index.html hides it), so there is nothing to fade but the paper.
  if (reduced || typeof el.animate !== "function" || el.classList.contains("is-quick")) {
    el.remove();
    return;
  }
  const logo = el.querySelector<HTMLElement>(".sp-logo");
  const finish = () => el.remove();
  // Opacity and transform only: this runs over a busy page and must stay off the main thread.
  logo?.animate([{ transform: "none" }, { transform: "scale(.96)" }], { duration: 260, fill: "forwards", easing: "ease-out" });
  el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, delay: 60, fill: "forwards", easing: "ease-out" }).finished.then(finish, finish);
}
