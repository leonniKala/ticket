/*
 * Pan & pinch-zoom for the board SVG (by changing its viewBox).
 *   const pz = TTRPanZoom.attach(svg, { onTap(x, y, pxPerUnit) {} });
 * onTap receives board coordinates of a tap that was not part of a drag.
 * The viewBox always has the element's aspect ratio, so a zoomed-in board fills the whole area.
 */
(function (root) {
  'use strict';

  function attach(svg, opts = {}) {
    const { width: W, height: H } = root.TTR_MAP.BOARD;
    const maxZoom = opts.maxZoom || 7;
    const pointers = new Map();
    let gesture = null, moved = false;
    let vb = { x: 0, y: 0, w: W, h: H };

    svg.style.touchAction = 'none';

    const rect = () => svg.getBoundingClientRect();
    const aspect = () => { const r = rect(); return r.width && r.height ? r.height / r.width : H / W; };
    const fitWidth = () => Math.max(W, H / aspect());
    const scale = () => rect().width / vb.w;

    function toBoard(cx, cy) {
      const r = rect(), s = r.width / vb.w;
      return [vb.x + (cx - r.left) / s, vb.y + (cy - r.top) / s];
    }
    function clamp() {
      const a = aspect();
      vb.w = Math.min(fitWidth(), Math.max(W / maxZoom, vb.w));
      vb.h = vb.w * a;
      vb.x = vb.w >= W ? (W - vb.w) / 2 : Math.min(Math.max(0, vb.x), W - vb.w);
      vb.y = vb.h >= H ? (H - vb.h) / 2 : Math.min(Math.max(0, vb.y), H - vb.h);
    }
    function apply() {
      clamp();
      svg.setAttribute('viewBox', `${vb.x.toFixed(1)} ${vb.y.toFixed(1)} ${vb.w.toFixed(1)} ${vb.h.toFixed(1)}`);
    }
    // Zoom so that board point (bx, by) stays under screen point (cx, cy).
    function zoomTo(width, bx, by, cx, cy) {
      const r = rect();
      vb.w = Math.min(fitWidth(), Math.max(W / maxZoom, width));
      const s = r.width / vb.w;
      vb.x = bx - (cx - r.left) / s;
      vb.y = by - (cy - r.top) / s;
      apply();
    }
    function zoomBy(factor, cx, cy) {
      const [bx, by] = toBoard(cx, cy);
      zoomTo(vb.w / factor, bx, by, cx, cy);
    }

    svg.addEventListener('pointerdown', (e) => {
      svg.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) { moved = false; gesture = { x: e.clientX, y: e.clientY, vb: { ...vb } }; }
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const [bx, by] = toBoard((a.x + b.x) / 2, (a.y + b.y) / 2);
        gesture = { pinch: true, dist: Math.hypot(a.x - b.x, a.y - b.y), bx, by, w: vb.w };
        moved = true;
      }
    });
    svg.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId) || !gesture) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gesture.pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const factor = Math.hypot(a.x - b.x, a.y - b.y) / gesture.dist;
        zoomTo(gesture.w / factor, gesture.bx, gesture.by, (a.x + b.x) / 2, (a.y + b.y) / 2);
      } else if (!gesture.pinch) {
        const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
        if (Math.hypot(dx, dy) > 8) moved = true;
        if (moved) {
          const s = scale();
          vb = { ...gesture.vb, x: gesture.vb.x - dx / s, y: gesture.vb.y - dy / s };
          apply();
        }
      }
    });
    function up(e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size === 1 && gesture && gesture.pinch) {
        const [p] = [...pointers.values()];
        gesture = { x: p.x, y: p.y, vb: { ...vb } };
        return;
      }
      if (pointers.size === 0) {
        if (!moved && e.type === 'pointerup' && opts.onTap) {
          const [bx, by] = toBoard(e.clientX, e.clientY);
          opts.onTap(bx, by, scale());
        }
        gesture = null;
      }
    }
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.25 : 0.8, e.clientX, e.clientY);
    }, { passive: false });
    if (root.ResizeObserver) new ResizeObserver(apply).observe(svg);

    function center() { const r = rect(); return [r.left + r.width / 2, r.top + r.height / 2]; }
    function reset() { vb = { x: 0, y: 0, w: fitWidth(), h: 0 }; apply(); }
    function focus(points, pad = 90) {
      if (!points.length) return;
      const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
      const w = Math.max(Math.max(...xs) - Math.min(...xs) + 2 * pad, (Math.max(...ys) - Math.min(...ys) + 2 * pad) / aspect(), 260);
      const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
      vb.w = w;
      vb.x = cx - w / 2;
      vb.y = cy - (w * aspect()) / 2;
      apply();
    }

    reset();
    return {
      reset, focus,
      zoomIn() { zoomBy(1.6, ...center()); },
      zoomOut() { zoomBy(1 / 1.6, ...center()); },
    };
  }

  root.TTRPanZoom = { attach };
})(window);
