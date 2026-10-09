// The bottom sheet on phones: drag the handle (or tap it) to snap between three heights.
// On wider screens CSS turns it into a side panel and dragging is switched off.

const isPhone = () => window.matchMedia('(max-width: 767px)').matches;

// Visible height of the sheet for each snap point, in pixels.
const SNAPS = {
  peek: () => 196,
  half: () => Math.round(window.innerHeight * 0.52),
  full: () => Math.round(window.innerHeight * 0.88),
};

export function initSheet(sheet, grab, onChange = () => {}) {
  let snap = 'half';
  let dragging = null;

  const visibleNow = () => (isPhone() ? SNAPS[snap]() : 0);
  const place = (visible, animate) => {
    if (!isPhone()) {
      sheet.style.transform = '';
      return;
    }
    sheet.style.transition = animate ? '' : 'none';
    sheet.style.transform = `translateY(${SNAPS.full() - visible}px)`;
  };
  const setSnap = (name) => {
    snap = name;
    sheet.dataset.snap = name;
    place(SNAPS[name](), true);
    onChange(visibleNow());
  };

  grab.addEventListener('pointerdown', (ev) => {
    if (!isPhone()) return;
    dragging = { y: ev.clientY, visible: SNAPS[snap](), moved: false, t: performance.now() };
    grab.setPointerCapture(ev.pointerId);
  });
  grab.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const dy = ev.clientY - dragging.y;
    if (Math.abs(dy) > 4) dragging.moved = true;
    const visible = Math.min(SNAPS.full(), Math.max(SNAPS.peek() - 40, dragging.visible - dy));
    place(visible, false);
  });
  grab.addEventListener('pointerup', (ev) => {
    if (!dragging) return;
    const dy = ev.clientY - dragging.y;
    const { moved } = dragging;
    const visible = dragging.visible - dy;
    const speed = dy / Math.max(1, performance.now() - dragging.t); // px per ms, + = down
    dragging = null;
    if (!moved) {
      // A tap on the handle steps up, or back down from full.
      setSnap(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'half');
      return;
    }
    // A quick flick goes one step in that direction; otherwise snap to the closest height.
    const order = ['peek', 'half', 'full'];
    if (Math.abs(speed) > 0.6) {
      const i = order.indexOf(snap) + (speed > 0 ? -1 : 1);
      setSnap(order[Math.max(0, Math.min(2, i))]);
    } else {
      setSnap(order.reduce((a, b) => (Math.abs(SNAPS[b]() - visible) < Math.abs(SNAPS[a]() - visible) ? b : a)));
    }
  });

  window.addEventListener('resize', () => {
    place(SNAPS[snap](), false);
    onChange(visibleNow());
  });
  setSnap(snap);

  return {
    set: setSnap,
    get: () => snap,
    visibleHeight: visibleNow,
  };
}
