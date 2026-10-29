// Rows rerank in place: wrap a synchronous DOM update in a view transition
// when the browser has one (Chrome, Safari 18+). Elsewhere it just runs.
// Reduced-motion users get the update without the animation (see styles.css).

type DocWithVT = Document & { startViewTransition?: (update: () => void) => { finished: Promise<void> } };

export function withViewTransition(update: () => void): void {
  const doc = document as DocWithVT;
  if (typeof doc.startViewTransition !== 'function') {
    update();
    return;
  }
  try {
    doc.startViewTransition(update);
  } catch {
    update();
  }
}
