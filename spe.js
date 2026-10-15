// SPE 2.x: single rectangular ROI, little-endian. Never clamp scientific data.
export function parseSpe(buffer) {
  if (buffer.byteLength < 4100) throw new Error('SPE 헤더가 잘렸습니다 (4100 bytes 필요).');
  const view = new DataView(buffer);
  const version = view.getFloat32(1992, true);
  if (version >= 3) throw new Error('SPE 3.x XML/다중 ROI 형식은 지원하지 않습니다. SPE 2.x로 내보내 주세요.');
  const width = view.getUint16(42, true), height = view.getUint16(656, true);
  const count = view.getInt32(1446, true), type = view.getInt16(108, true);
  const formats = {0: [4, 'getFloat32'], 1: [4, 'getInt32'], 2: [2, 'getInt16'], 3: [2, 'getUint16'], 8: [4, 'getUint32']};
  if (!formats[type]) throw new Error(`지원하지 않는 SPE 데이터 타입: ${type}`);
  if (width !== 1024 || height < 1 || count < 1) throw new Error('1024 X 픽셀과 1개 이상의 프레임이 필요합니다.');
  const [bytes, getter] = formats[type], size = width * height;
  if (4100 + size * count * bytes > buffer.byteLength) throw new Error('SPE 프레임 데이터가 잘렸습니다.');
  const frames = [];
  for (let f = 0; f < count; f++) {
    const frame = new Float64Array(size);
    for (let p = 0; p < size; p++) {
      const value = view[getter](4100 + (f * size + p) * bytes, true);
      if (!Number.isFinite(value)) throw new Error('SPE에 유효하지 않은 픽셀 값이 있습니다.');
      frame[p] = value;
    }
    frames.push(frame);
  }
  return {width, height, frames};
}
export function averageFrames(spe, indices) {
  if (!indices.length) throw new Error('프레임을 하나 이상 선택하세요.');
  const out = new Float64Array(spe.width * spe.height);
  for (const i of indices) {
    if (!spe.frames[i]) throw new Error('프레임 번호가 잘못되었습니다.');
    for (let p = 0; p < out.length; p++) out[p] += spe.frames[i][p] / indices.length;
  }
  return out;
}
export function subtract(signal, background) {
  if (signal.width !== background.width || signal.height !== background.height) throw new Error('Rayleigh와 Background의 이미지 크기가 다릅니다.');
  return signal.data.map((v, i) => v - background.data[i]);
}
export function binRows(data, width, height, from, to, step) {
  if (![from,to,step].every(Number.isInteger) || from < 0 || to > height || from >= to || step < 1) throw new Error('Y 범위와 step을 확인하세요 (from 포함, to 제외).');
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
    throw new Error('Rayleigh SPE 4개는 모두 같은 이미지 크기여야 합니다.');
  }
  return a.map((value, i) => (value + b[i]) / 2);
}
