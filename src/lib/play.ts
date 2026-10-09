// Plays each [data-play] block's animation once, the first time its top edge is
// well inside the viewport, by setting data-play="on". Blocks that mount later
// (a Suspense boundary resolving, a client-rendered section) are picked up too;
// otherwise they would stay paused at their first frame, clipped out of sight.
// Returns a function that stops watching.
type Observers = { IntersectionObserver?: typeof IntersectionObserver; MutationObserver?: typeof MutationObserver };

export function watchPlayBlocks(root: Document | HTMLElement, win: Observers = window): () => void {
  const SELECTOR = "[data-play]:not([data-play='on'])";
  const find = (node: Node): HTMLElement[] => {
    if (!(node as Element).querySelectorAll) return [];
    const el = node as HTMLElement;
    const inside = Array.from(el.querySelectorAll<HTMLElement>(SELECTOR));
    return el.matches?.(SELECTOR) ? [el, ...inside] : inside;
  };

  let watch: (el: HTMLElement) => void;
  let io: IntersectionObserver | undefined;
  if (!win.IntersectionObserver) {
    watch = (el) => (el.dataset.play = "on");
  } else {
    io = new win.IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          // Blocks already scrolled past (a reload halfway down) play too.
          if (!e.isIntersecting && e.boundingClientRect.top > 0) continue;
          (e.target as HTMLElement).dataset.play = "on";
          io!.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -18% 0px" },
    );
    watch = (el) => io!.observe(el);
  }

  find(root).forEach(watch);
  const mo = win.MutationObserver
    ? new win.MutationObserver((records) => {
        for (const r of records) r.addedNodes.forEach((n) => find(n).forEach(watch));
      })
    : undefined;
  mo?.observe(root, { childList: true, subtree: true });

  return () => {
    mo?.disconnect();
    io?.disconnect();
  };
}
