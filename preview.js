// Image coordinates remain independent of contrast, device pixels and viewport.
export class SignalPreview {
  constructor(canvas, info, getRegions) {
    this.canvas = canvas;
    this.info = info;
    this.getRegions = getRegions;
    this.scale = 1;
    this.offset = {x: 0, y: 0};
    this.image = null;
    this.drag = null;
    this.observer = new ResizeObserver(() => this.fit());
    this.observer.observe(canvas);
    canvas.addEventListener('wheel', event => {
      if (!this.image) return;
      event.preventDefault();
      const point = this.point(event);
      const factor = Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * .003);
      const next = Math.max(this.fitScale * .1, Math.min(this.fitScale * 100, this.scale * factor));
      this.offset.x = point.x - (point.x - this.offset.x) * next / this.scale;
      this.offset.y = point.y - (point.y - this.offset.y) * next / this.scale;
      this.scale = next;
      this.draw();
      this.showPixel(event);
    }, {passive: false});
    canvas.addEventListener('pointerdown', event => {
      if (!this.image || event.button !== 0) return;
      this.drag = {id: event.pointerId, point: this.point(event)};
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', event => {
      if (this.drag?.id === event.pointerId) {
        const point = this.point(event);
        this.offset.x += point.x - this.drag.point.x;
        this.offset.y += point.y - this.drag.point.y;
        this.drag.point = point;
        this.draw();
      }
      this.showPixel(event);
    });
    const endDrag = event => {
      if (this.drag?.id !== event.pointerId) return;
      this.drag = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      canvas.style.cursor = 'grab';
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('lostpointercapture', endDrag);
  }
  point(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {x: event.clientX - rect.left, y: event.clientY - rect.top};
  }
  showPixel(event) {
    if (!this.image) return;
    const point = this.point(event);
    const x = Math.floor((point.x - this.offset.x) / this.scale);
    const y = Math.floor((point.y - this.offset.y) / this.scale);
    this.info.textContent = x >= 0 && y >= 0 && x < this.image.width && y < this.image.height
      ? `X: ${x}  Y: ${y}  Intensity: ${this.image.data[y * this.image.width + x].toFixed(3)}`
      : 'X: —  Y: —  Intensity: —';
  }
  setImage(image, min, max) {
    if (!image) {
      this.image = null;
      this.raster = null;
      this.info.textContent = 'X: —  Y: —  Intensity: —';
      this.draw();
      return;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || (max <= min && !(min === 0 && max === 0))) {
      throw new Error('Intensity max must exceed min, or set both to 0 for automatic contrast.');
    }
    const reset = image !== this.image;
    if (reset || min !== this.min || max !== this.max) {
      this.image = image;
      this.min = min;
      this.max = max;
      let low = min, high = max;
      if (min === 0 && max === 0) {
        low = Infinity; high = -Infinity;
        for (const value of image.data) { low = Math.min(low, value); high = Math.max(high, value); }
      }
      const span = high - low || 1;
      this.raster = document.createElement('canvas');
      this.raster.width = image.width;
      this.raster.height = image.height;
      const ctx = this.raster.getContext('2d');
      const pixels = ctx.createImageData(image.width, image.height);
      for (let i = 0; i < image.data.length; i++) {
        const v = Math.max(0, Math.min(255, (image.data[i] - low) / span * 255));
        pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = v;
        pixels.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(pixels, 0, 0);
    }
    if (reset) this.fit();
    else this.draw();
  }
  fit() {
    if (this.image) {
      const rect = this.canvas.getBoundingClientRect();
      this.fitScale = Math.min(rect.width / this.image.width, rect.height / this.image.height) || 1;
      this.scale = this.fitScale;
      this.offset = {x: (rect.width - this.image.width * this.scale) / 2,
                     y: (rect.height - this.image.height * this.scale) / 2};
    }
    this.draw();
  }
  draw() {
    const canvas = this.canvas, rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (!this.image || !this.raster) return;
    ctx.save();
    ctx.translate(this.offset.x, this.offset.y);
    ctx.scale(this.scale, this.scale);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.raster, 0, 0);
    const {from, to, n1, n2} = this.getRegions();
    const top = Math.max(0, from), bottom = Math.min(this.image.height, to);
    if ([from, to].every(Number.isFinite) && bottom > top) {
      ctx.lineWidth = 2 / this.scale;
      ctx.strokeStyle = '#308cff';
      ctx.strokeRect(0, top, this.image.width, bottom - top);
      const left = Math.max(0, n1), right = Math.min(this.image.width, n2 + 1);
      if ([n1, n2].every(Number.isFinite) && n1 >= 0 && n2 >= n1 && right > left) {
        ctx.strokeStyle = '#ed4d4d';
        ctx.strokeRect(left, top, right - left, bottom - top);
      }
    }
    ctx.restore();
  }
}
