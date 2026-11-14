/* Zoom & pan of the preview. Zooming only changes the view, never the exported file. */
export interface ZoomState { scale: number; fit: boolean; canZoomIn: boolean; canZoomOut: boolean }

export class Viewport {
  private view = { width: 0, height: 0, areaWidth: 0, areaHeight: 0, media: '' as string | null, scale: 1, fit: true, x: 0, y: 0 };
  private key = '';
  private drag: { id: number; x: number; y: number; panX: number; panY: number } | null = null;
  private cleanup: (() => void)[] = [];

  constructor(private stage: HTMLElement, private wrap: HTMLElement, private onZoom: (z: ZoomState) => void, private onChange: () => void) {
    const wheel = (event: WheelEvent) => {
      if (!this.view.width || (event.target as Element).closest('button,.fs-controls')) return;
      event.preventDefault();
      const box = stage.getBoundingClientRect();
      this.zoom(Math.exp(-event.deltaY * (event.deltaMode ? 0.05 : 0.002)), { x: event.clientX - box.left - box.width / 2, y: event.clientY - box.top - box.height / 2 });
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || (event.target as Element).closest('button,.comparison-line,.fs-controls') || !stage.classList.contains('can-pan')) return;
      event.preventDefault(); stage.focus({ preventScroll: true });
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: this.view.x, panY: this.view.y };
      stage.setPointerCapture(event.pointerId); stage.classList.add('panning');
    };
    const move = (event: PointerEvent) => {
      if (!this.drag || event.pointerId !== this.drag.id) return;
      this.view.x = this.drag.panX + event.clientX - this.drag.x; this.view.y = this.drag.panY + event.clientY - this.drag.y; this.paint();
    };
    const stop = (event: PointerEvent) => {
      if (this.drag?.id !== event.pointerId) return;
      this.drag = null; stage.classList.remove('panning');
      if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    };
    const key = (event: KeyboardEvent) => {
      if (event.target !== stage) return;
      if (['+', '=', '-', '0', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) event.preventDefault();
      if (event.key === '+' || event.key === '=') this.zoom(1.25);
      if (event.key === '-') this.zoom(1 / 1.25);
      if (event.key === '0') this.reset();
      if (event.key.startsWith('Arrow')) {
        const amount = event.shiftKey ? 80 : 25;
        if (event.key === 'ArrowLeft') this.view.x += amount; if (event.key === 'ArrowRight') this.view.x -= amount;
        if (event.key === 'ArrowUp') this.view.y += amount; if (event.key === 'ArrowDown') this.view.y -= amount;
        this.paint();
      }
    };
    stage.addEventListener('wheel', wheel, { passive: false });
    stage.addEventListener('pointerdown', down); stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', stop); stage.addEventListener('pointercancel', stop); stage.addEventListener('keydown', key);
    this.cleanup.push(() => {
      stage.removeEventListener('wheel', wheel); stage.removeEventListener('pointerdown', down); stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', stop); stage.removeEventListener('pointercancel', stop); stage.removeEventListener('keydown', key);
    });
  }

  private fitScale() { return Math.min(this.view.areaWidth / this.view.width, this.view.areaHeight / this.view.height); }
  private minScale() { return Math.min(0.1, this.fitScale()); }

  private paint() {
    const v = this.view;
    if (!v.width || !v.areaWidth || !v.areaHeight) return;
    if (v.fit) { v.scale = this.fitScale(); v.x = 0; v.y = 0; }
    const maxX = Math.max(0, (v.width * v.scale - v.areaWidth) / 2), maxY = Math.max(0, (v.height * v.scale - v.areaHeight) / 2);
    v.x = Math.max(-maxX, Math.min(maxX, v.x)); v.y = Math.max(-maxY, Math.min(maxY, v.y));
    const next = [v.width, v.height, v.scale, v.x, v.y, v.fit].join(':');
    if (next === this.key) return;
    this.key = next;
    this.wrap.style.width = `${v.width * v.scale}px`; this.wrap.style.height = `${v.height * v.scale}px`; this.wrap.style.transform = `translate(${v.x}px,${v.y}px)`;
    this.stage.classList.toggle('can-pan', maxX > 0 || maxY > 0);
    this.onZoom({ scale: v.scale, fit: v.fit, canZoomIn: v.scale < 4 - 0.001, canZoomOut: v.scale > this.minScale() + 0.001 });
  }

  zoom(factor: number, anchor = { x: 0, y: 0 }) {
    const v = this.view;
    if (!v.width) return;
    const old = v.scale, next = Math.max(this.minScale(), Math.min(4, old * factor));
    if (Math.abs(next - old) < 0.00001) return;
    v.fit = false; v.scale = next; v.x = anchor.x - ((anchor.x - v.x) * next) / old; v.y = anchor.y - ((anchor.y - v.y) * next) / old;
    this.paint(); this.onChange();
  }
  reset() { this.view.fit = true; this.key = ''; this.paint(); this.onChange(); }
  layout(width: number, height: number, areaWidth: number, areaHeight: number, media: string | null) {
    if (media !== this.view.media) { this.view.fit = true; this.view.x = 0; this.view.y = 0; this.view.media = media; this.key = ''; }
    Object.assign(this.view, { width, height, areaWidth, areaHeight });
    this.paint();
  }
  get scale() { return this.view.scale; }
  get isFit() { return this.view.fit; }
  dispose() { for (const fn of this.cleanup) fn(); }
}
