// SPE 2.x: single rectangular ROI, little-endian. Never clamp scientific data.
export function parseSpe(buffer) {
  if (buffer.byteLength < 4100) throw new Error('Truncated SPE header (4100 bytes required).');
  const view = new DataView(buffer);
  const version = view.getFloat32(1992, true);
  if (version >= 3) throw new Error('SPE 3.x XML/multiple ROI files are not supported. Export as SPE 2.x.');
  const width = view.getUint16(42, true), height = view.getUint16(656, true);
  const count = view.getInt32(1446, true), type = view.getInt16(108, true);
  const formats = {0: [4, 'getFloat32'], 1: [4, 'getInt32'], 2: [2, 'getInt16'], 3: [2, 'getUint16'], 8: [4, 'getUint32']};
  if (!formats[type]) throw new Error(`Unsupported SPE data type: ${type}`);
  if (width !== 1024 || height < 1 || count < 1) throw new Error('An image width of 1024 pixels and at least one frame are required.');
  const [bytes, getter] = formats[type], size = width * height;
  if (4100 + size * count * bytes > buffer.byteLength) throw new Error('Truncated SPE frame data.');
  const frames = [];
  for (let f = 0; f < count; f++) {
    const frame = new Float64Array(size);
    for (let p = 0; p < size; p++) {
      const value = view[getter](4100 + (f * size + p) * bytes, true);
      if (!Number.isFinite(value)) throw new Error('SPE contains a non-finite pixel value.');
      frame[p] = value;
    }
    frames.push(frame);
  }
  return {width, height, frames};
}
export function averageFrames(spe, indices) {
  if (!indices.length) throw new Error('Select at least one frame.');
  const out = new Float64Array(spe.width * spe.height);
  for (const i of indices) {
    if (!spe.frames[i]) throw new Error('Invalid frame index.');
    for (let p = 0; p < out.length; p++) out[p] += spe.frames[i][p] / indices.length;
  }
  return out;
}
export function subtract(signal, background) {
  if (signal.width !== background.width || signal.height !== background.height) throw new Error('Rayleigh and Background image dimensions must match.');
  return signal.data.map((v, i) => v - background.data[i]);
}
export function binRows(data, width, height, from, to, step) {
  if (![from,to,step].every(Number.isInteger) || from < 0 || to > height || from >= to || step < 1) throw new Error('Check the Y range and step (from inclusive, to exclusive).');
  const rows = [];
  for (let y = from; y < to; y += step) {
    const end = Math.min(y+step, to), row = Array(width).fill(0);
    for (let j = y; j < end; j++) for (let x = 0; x < width; x++) row[x] += data[j*width+x] / (end-y);
    rows.push(row);
  }
  return rows;
}

// Each pair contributes equally, regardless of how many frames it contains.
export function averageRayleigh(first, second, third, fourth) {
  const a = subtract(first, second);
  const b = subtract(third, fourth);
  if (first.width !== third.width || first.height !== third.height) {
    throw new Error('All four Rayleigh SPE files must have matching image dimensions.');
  }
  return a.map((value, i) => (Math.max(value, 0) + Math.max(b[i], 0)) / 2);
}

// Symmetric percentage difference of the same clipped signals used in final R.
export function rayleighPairComparison(first, second, third, fourth, range = null) {
  const a = subtract(first, second), b = subtract(third, fourth);
  if (first.width !== third.width || first.height !== third.height) {
    throw new Error('All four Rayleigh SPE files must have matching image dimensions.');
  }
  const from = range === null ? 0 : range.from;
  const to = range === null ? first.height : range.to;
  if (![from,to].every(Number.isInteger) || from < 0 || from >= to || to > first.height) {
    throw new Error(`Comparison Y range must satisfy 0 <= from < to <= ${first.height} (to exclusive).`);
  }
  let firstTotal = 0, secondTotal = 0;
  for (let i = from * first.width; i < to * first.width; i++) {
    firstTotal += Math.max(a[i], 0);
    secondTotal += Math.max(b[i], 0);
  }
  const mean = (firstTotal + secondTotal) / 2;
  return {firstTotal, secondTotal,
    differencePercent: mean > 0 ? Math.abs(firstTotal - secondTotal) / mean * 100 : null};
}
