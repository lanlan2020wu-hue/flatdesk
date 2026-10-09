// [data-play] entrance animations. Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { watchPlayBlocks } from "./play";

// Just enough DOM: elements with data-play, and observers we can fire by hand.
class El {
  dataset: Record<string, string> = {};
  children: El[] = [];
  constructor(play?: string) {
    if (play !== undefined) this.dataset.play = play;
  }
  matches() {
    return this.dataset.play !== undefined && this.dataset.play !== "on";
  }
  querySelectorAll() {
    const out: El[] = [];
    const walk = (e: El) => e.children.forEach((c) => (c.matches() && out.push(c), walk(c)));
    walk(this);
    return out;
  }
}

function fakeWindow() {
  const observed: El[] = [];
  let ioCb: (entries: unknown[]) => void = () => {};
  let moCb: (records: unknown[]) => void = () => {};
  const win = {
    IntersectionObserver: class {
      constructor(cb: typeof ioCb) {
        ioCb = cb;
      }
      observe(el: El) {
        observed.push(el);
      }
      unobserve() {}
      disconnect() {}
    },
    MutationObserver: class {
      constructor(cb: typeof moCb) {
        moCb = cb;
      }
      observe() {}
      disconnect() {}
    },
  };
  const show = (el: El) => ioCb([{ target: el, isIntersecting: true, boundingClientRect: { top: 0 } }]);
  const mount = (parent: El, el: El) => (parent.children.push(el), moCb([{ addedNodes: [el] }]));
  return { win: win as never, observed, show, mount };
}

test("blocks already on the page play when they scroll into view", () => {
  const root = new El();
  const block = new El("");
  root.children.push(block);
  const { win, observed, show } = fakeWindow();
  watchPlayBlocks(root as never, win);
  assert.deepEqual(observed, [block]);
  show(block);
  assert.equal(block.dataset.play, "on");
});

test("a block that mounts later (the calculator after its Suspense swap) still plays", () => {
  const root = new El();
  const { win, observed, show, mount } = fakeWindow();
  watchPlayBlocks(root as never, win);
  assert.equal(observed.length, 0);

  const wrapper = new El();
  const calculator = new El("");
  wrapper.children.push(calculator);
  mount(root, wrapper);
  assert.deepEqual(observed, [calculator]);
  show(calculator);
  assert.equal(calculator.dataset.play, "on");
});

test("without IntersectionObserver every block plays at once, including late ones", () => {
  const root = new El();
  const early = new El("");
  root.children.push(early);
  const { win, mount } = fakeWindow();
  const noIo = { MutationObserver: (win as { MutationObserver: unknown }).MutationObserver } as never;
  watchPlayBlocks(root as never, noIo);
  assert.equal(early.dataset.play, "on");
  const late = new El("");
  mount(root, late);
  assert.equal(late.dataset.play, "on");
});
