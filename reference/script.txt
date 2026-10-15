// --- DOM 요소 가져오기 ---
const fileInput = document.getElementById('fileInput');
const frameListContainer = document.getElementById('frame-list-container');
const rangeMinInput = document.getElementById('rangeMinInput');
const rangeMaxInput = document.getElementById('rangeMaxInput');
const pixelInfo = document.getElementById('pixel-info');
const previewCanvas = document.getElementById('previewCanvas');
const pCtx = previewCanvas.getContext('2d');
const profileCanvas = document.getElementById('profileCanvas');
const pfCtx = profileCanvas.getContext('2d');
const setPeak1Btn = document.getElementById('setPeak1');
const setPeak2Btn = document.getElementById('setPeak2');
const peakDeltaDisplay = document.getElementById('peakDelta');
const peakCenterDisplay = document.getElementById('peakCenter');
const setBg1Btn = document.getElementById('setBg1Btn');
const setBg2Btn = document.getElementById('setBg2Btn');
const setIntegral1Btn = document.getElementById('setIntegral1');
const setIntegral2Btn = document.getElementById('setIntegral2');
const integralValueDisplay = document.getElementById('integralValue');
const cropXFrom = document.getElementById('cropXFrom');
const cropXTo = document.getElementById('cropXTo');
const cropXStep = document.getElementById('cropXStep');
const cropYFrom = document.getElementById('cropYFrom');
const cropYTo = document.getElementById('cropYTo');
const cropYStep = document.getElementById('cropYStep');
const calculateAndPlotBtn = document.getElementById('calculateAndPlotBtn');
const saveAvgDataBtn = document.getElementById('saveAvgDataBtn');

// --- 전역 상태 변수 ---
let speFrames = [], currentDisplayData = null, plottedData = null;
let imageWidth = 0, imageHeight = 0, selectedRowY = -1;
let settingPeakLine = 0, peakLine1X = -1, peakLine2X = -1;
let settingIntegralLine = 0, integralLine1X = -1, integralLine2X = -1;
let settingBgPoint = 0, bgPoint1 = null, bgPoint2 = null;
let zoom = 1, panOffset = { x: 0, y: 0 };
let isPanning = false, panStartMousePos = { x: 0, y: 0 };
let panTimeout;

// --- 초기화 ---
function initialize() {
    pCtx.clearRect(0,0,previewCanvas.width, previewCanvas.height);
    pCtx.font = '20px sans-serif'; pCtx.fillStyle = '#aaa'; pCtx.textAlign = 'center';
    pCtx.fillText('Select or Drop SPE file here', previewCanvas.width / 2, previewCanvas.height / 2);
    initializeProfileCanvas();
}
function initializeProfileCanvas() {
    pfCtx.clearRect(0, 0, profileCanvas.width, profileCanvas.height);
    pfCtx.font = '16px sans-serif'; pfCtx.fillStyle = '#aaa'; pfCtx.textAlign = 'center';
    pfCtx.fillText('Use "Data Cropping" to generate and plot data', profileCanvas.width / 2, profileCanvas.height / 2);
}
initialize();

// --- 파일 처리 ---
async function handleFileSelect(input) { if (input.files.length) await parseSpeFile(input.files[0]); }
async function parseSpeFile(file) {
    try {
        const buffer = await file.arrayBuffer();
        const dataView = new DataView(buffer);
        const HEADER_SIZE = 4100;
        imageWidth = dataView.getUint16(42, true);
        imageHeight = dataView.getUint16(656, true);
        let numFrames = dataView.getUint32(1446, true);
        const dataTypeCode = dataView.getInt16(108, true); //수정
        if (imageWidth === 0 || imageHeight === 0 || numFrames === 0) return alert('유효한 SPE 파일이 아닙니다.');
        //
        let bytesPerPixel = 2;
        if (dataTypeCode === 0 || dataTypeCode === 1) {
            bytesPerPixel = 4;
        }
        //0520 수정
        speFrames = [];
        const pixelsPerFrame = imageWidth * imageHeight, bytesPerFrame = pixelsPerFrame * bytesPerPixel; //2->bytesPerPixel 0520 수정
        for (let i = 0; i < numFrames; i++) {
            const frameOffset = HEADER_SIZE + (i * bytesPerFrame);
            if (frameOffset + bytesPerFrame > buffer.byteLength) {
                console.warn(`파일 끝 도달: 프레임 ${i + 1}부터 읽을 수 없습니다.`);
                numFrames = i;
                break;
            }
            //
            let rawFrame;
            switch (dataTypeCode) {
                case 0: // Float (32-bit)
                    rawFrame = new Float32Array(buffer, frameOffset, pixelsPerFrame);
                    break;
                case 1: // Long (32-bit Signed)
                    rawFrame = new Int32Array(buffer, frameOffset, pixelsPerFrame);
                    break;
                case 2: // Int (16-bit Signed)
                    rawFrame = new Int16Array(buffer, frameOffset, pixelsPerFrame);
                    break;
                case 3: // Unsigned Int (16-bit)
                default:
                    rawFrame = new Uint16Array(buffer, frameOffset, pixelsPerFrame);
                    break;
            }
            const processedFrame = new Uint16Array(pixelsPerFrame);
            for (let j = 0; j < pixelsPerFrame; j++) {
                let val = rawFrame[j];
                
                // 1. 반올림 처리 (실수형 대응)
                val = Math.round(val);
                
                // 2. 음수일 경우 0으로 치환 및 오버플로우 방지 (Clamping)
                // Uint16Array에 넣으므로 65535를 넘지 않게 처리할 수도 있습니다.
                processedFrame[j] = val < 0 ? 0 : (val > 65535 ? 65535 : val);
            }
            speFrames.push(processedFrame);
            //여기까지 수정. 0520
            //speFrames.push(new Uint16Array(buffer, frameOffset, pixelsPerFrame));
        }
        if (speFrames.length === 0) return alert('파일에서 유효한 프레임을 불러오지 못했습니다.');
        updateFrameList(speFrames.length);
        const firstCheckbox = frameListContainer.querySelector('input[type=checkbox]');
        if (firstCheckbox) { firstCheckbox.checked = true; updateDisplay(); }
    } catch (error) {
        console.error("파일 파싱 오류:", error);
        alert("파일을 읽는 중 오류가 발생했습니다. 개발자 콘솔을 확인해주세요.");
    }
}

// --- UI 업데이트 및 상태 관리 ---
function updateFrameList(numFrames) {
    frameListContainer.innerHTML = '';
    for (let i = 0; i < numFrames; i++) {
        const label = document.createElement('label'), checkbox = document.createElement('input');
        label.className = 'frame-item'; checkbox.type = 'checkbox'; checkbox.dataset.index = i;
        checkbox.addEventListener('change', updateDisplay);
        label.append(checkbox, ` Frame ${i + 1}`);
        frameListContainer.appendChild(label);
    }
}
function updateDisplay() {
    const checkedIndexes = [...document.querySelectorAll('#frame-list-container input:checked')].map(cb => parseInt(cb.dataset.index));
    if (checkedIndexes.length === 0) { currentDisplayData = null; initialize(); return; }
    else if (checkedIndexes.length === 1) { currentDisplayData = speFrames[checkedIndexes[0]]; }
    else {
        const frameSize = imageWidth * imageHeight;
        const avgData = new Float32Array(frameSize).fill(0);
        for (const index of checkedIndexes) {
            for (let i = 0; i < frameSize; i++) avgData[i] += speFrames[index][i];
        }
        for (let i = 0; i < frameSize; i++) avgData[i] /= checkedIndexes.length;
        currentDisplayData = avgData;
    }
    zoom = 1; panOffset = { x: 0, y: 0 };
    drawImage();
    plottedData = null; saveAvgDataBtn.style.display = 'none';
    bgPoint1 = null; bgPoint2 = null;
    initializeProfileCanvas();
}

// --- 캔버스 드로잉 ---
function drawImage() {
    if (!currentDisplayData) return;
    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = imageWidth; offscreenCanvas.height = imageHeight;
    const offscreenCtx = offscreenCanvas.getContext('2d');
    const imageData = offscreenCtx.createImageData(imageWidth, imageHeight);
    const data = imageData.data;
    const min = parseFloat(rangeMinInput.value), max = parseFloat(rangeMaxInput.value);
    const range = max - min;
    if (range > 0) {
        for (let i = 0; i < currentDisplayData.length; i++) {
            let value = Math.max(0, Math.min(255, (currentDisplayData[i] - min) / range * 255));
            const j = i * 4; data[j] = data[j + 1] = data[j + 2] = value; data[j + 3] = 255;
        }
    }
    offscreenCtx.putImageData(imageData, 0, 0);
    pCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    pCtx.save();
    pCtx.translate(panOffset.x, panOffset.y);
    pCtx.scale(zoom, zoom);
    pCtx.drawImage(offscreenCanvas, 0, 0);
    pCtx.restore();
    if (selectedRowY !== -1) {
        const screenY = selectedRowY * zoom + panOffset.y;
        pCtx.fillStyle = 'rgba(255, 0, 0, 0.5)';
        pCtx.fillRect(0, screenY, previewCanvas.width, 1);
    }
}
function drawProfileGraph() {
    if (!plottedData) return initializeProfileCanvas();
    pfCtx.clearRect(0, 0, profileCanvas.width, profileCanvas.height);
    let minVal = plottedData[0], maxVal = plottedData[0];
    plottedData.forEach(v => { if (v < minVal) minVal = v; if (v > maxVal) maxVal = v; });
    const range = maxVal - minVal === 0 ? 1 : maxVal - minVal;
    const toCanvasY = (dataY) => (1 - (dataY - minVal) / range) * (profileCanvas.height - 20) + 10;
    pfCtx.beginPath(); pfCtx.strokeStyle = 'green'; pfCtx.lineWidth = 2;
    for (let x = 0; x < plottedData.length; x++) {
        const canvasX = (x / (plottedData.length - 1)) * profileCanvas.width;
        const canvasY = toCanvasY(plottedData[x]);
        x === 0 ? pfCtx.moveTo(canvasX, canvasY) : pfCtx.lineTo(canvasX, canvasY);
    }
    pfCtx.stroke();
    if (bgPoint1 && bgPoint2) {
        const bgLine = getBackgroundLine();
        const startY = bgLine.slope * 0 + bgLine.intercept;
        const endY = bgLine.slope * (plottedData.length - 1) + bgLine.intercept;
        pfCtx.beginPath(); pfCtx.strokeStyle = 'red'; pfCtx.lineWidth = 1; pfCtx.setLineDash([5, 3]);
        pfCtx.moveTo(0, toCanvasY(startY)); pfCtx.lineTo(profileCanvas.width, toCanvasY(endY));
        pfCtx.stroke(); pfCtx.setLineDash([]);
    }
    const drawLine = (x, color) => {
        if (x === -1) return;
        const canvasX = (x / (plottedData.length - 1)) * profileCanvas.width;
        pfCtx.beginPath(); pfCtx.strokeStyle = color; pfCtx.lineWidth = 1;
        pfCtx.moveTo(canvasX, 0); pfCtx.lineTo(canvasX, profileCanvas.height);
        pfCtx.stroke();
    };
    drawLine(peakLine1X, 'blue'); drawLine(peakLine2X, 'orange');
    drawLine(integralLine1X, 'gold'); drawLine(integralLine2X, 'gold');
}

// --- 이벤트 리스너 및 헬퍼 ---
rangeMinInput.addEventListener('input', drawImage);
rangeMaxInput.addEventListener('input', drawImage);

function getCanvasCoords(e) { const rect = previewCanvas.getBoundingClientRect(); return { x: (e.clientX - rect.left) * (previewCanvas.width / rect.width), y: (e.clientY - rect.top) * (previewCanvas.height / rect.height) }; }
function getImageCoords(canvasPos) { return { x: (canvasPos.x - panOffset.x) / zoom, y: (canvasPos.y - panOffset.y) / zoom }; }

function showPixelInfo(e) {
    if (!currentDisplayData) return;
    const imagePos = getImageCoords(getCanvasCoords(e));
    const x = Math.floor(imagePos.x), y = Math.floor(imagePos.y);
    if (x >= 0 && x < imageWidth && y >= 0 && y < imageHeight) {
        const pixelValue = currentDisplayData[y * imageWidth + x];
        pixelInfo.style.display = 'block';
        pixelInfo.textContent = `X:${x}, Y:${y}, Val:${pixelValue.toFixed(2)}`;
    } else { pixelInfo.style.display = 'none'; }
}

previewCanvas.addEventListener('mousedown', (e) => {
    if (!currentDisplayData) return;
    panStartMousePos = { x: e.clientX, y: e.clientY };
    panTimeout = setTimeout(() => { isPanning = true; previewCanvas.style.cursor = 'grabbing'; }, 150);
});

previewCanvas.addEventListener('mouseup', (e) => {
    clearTimeout(panTimeout);
    if (!isPanning) {
        const imagePos = getImageCoords(getCanvasCoords(e));
        const y = Math.round(imagePos.y);
        if (y >= 0 && y < imageHeight) { selectedRowY = y; drawImage(); }
    }
    isPanning = false;
    previewCanvas.style.cursor = 'crosshair';
});

previewCanvas.addEventListener('mouseleave', () => { isPanning = false; previewCanvas.style.cursor = 'crosshair'; });

previewCanvas.addEventListener('mousemove', (e) => {
    showPixelInfo(e);
    if (isPanning) {
        const dx = e.clientX - panStartMousePos.x;
        const dy = e.clientY - panStartMousePos.y;
        panOffset.x += dx;
        panOffset.y += dy;
        panStartMousePos = { x: e.clientX, y: e.clientY };
        drawImage();
    }
});

previewCanvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!currentDisplayData) return;
    const canvasPos = getCanvasCoords(e);
    const zoomFactor = 1.1;
    const oldZoom = zoom;
    if (e.deltaY < 0) zoom *= zoomFactor; else zoom /= zoomFactor;
    zoom = Math.max(0.1, Math.min(20, zoom));
    panOffset.x = canvasPos.x - (canvasPos.x - panOffset.x) / oldZoom * zoom;
    panOffset.y = canvasPos.y - (canvasPos.y - panOffset.y) / oldZoom * zoom;
    drawImage();
});

profileCanvas.addEventListener('click', (e) => {
    if (!plottedData) return;
    const rect = profileCanvas.getBoundingClientRect(), x = Math.round((e.clientX - rect.left) * (plottedData.length - 1) / rect.width);
    if (settingPeakLine === 1) peakLine1X = x; else if (settingPeakLine === 2) peakLine2X = x;
    if (settingIntegralLine === 1) integralLine1X = x; else if (settingIntegralLine === 2) integralLine2X = x;
    if (settingBgPoint === 1) bgPoint1 = { x, y: plottedData[x] }; else if (settingBgPoint === 2) bgPoint2 = { x, y: plottedData[x] };
    settingPeakLine = 0; settingIntegralLine = 0; settingBgPoint = 0;
    updateAnalysis(); drawProfileGraph();
});

calculateAndPlotBtn.addEventListener('click', () => {
    if (!currentDisplayData) return alert("먼저 파일을 불러오세요.");
    const xFrom = parseInt(cropXFrom.value), xTo = parseInt(cropXTo.value), yFrom = parseInt(cropYFrom.value), yTo = parseInt(cropYTo.value);
    if ([xFrom, xTo, yFrom, yTo].some(isNaN)) return alert("모든 X, Y Range 값을 입력해주세요.");
    plottedData = [];
    for (let x = xFrom; x < xTo; x++) {
        let ySum = 0;
        for (let y = yFrom; y < yTo; y++) ySum += currentDisplayData[y * imageWidth + x];
        plottedData.push(ySum / (yTo - yFrom));
    }
    bgPoint1 = null; bgPoint2 = null;
    drawProfileGraph();
    saveAvgDataBtn.style.display = 'inline-block';
});

saveAvgDataBtn.addEventListener('click', () => {
    if (!currentDisplayData) return alert("먼저 파일을 불러오세요.");
    const xFrom = parseInt(cropXFrom.value), xTo = parseInt(cropXTo.value), xStep = parseInt(cropXStep.value), yFrom = parseInt(cropYFrom.value), yTo = parseInt(cropYTo.value), yStep = parseInt(cropYStep.value);
    if ([xFrom, xTo, xStep, yFrom, yTo, yStep].some(isNaN)) return alert("모든 From, To, Step 값을 입력해주세요.");
    let textContent = "";
    for (let y = yFrom; y < yTo; y += yStep) for (let x = xFrom; x < xTo; x += xStep) {
        let sum = 0, count = 0;
        for (let j = y; j < y + yStep && j < yTo && j < imageHeight; j++) for (let i = x; i < x + xStep && i < xTo && i < imageWidth; i++) { sum += currentDisplayData[j * imageWidth + i]; count++; }
        if (count > 0) textContent += `${Math.round(sum / count)}\n`;
    }
    downloadTextFile("cropped_average_data.txt", textContent);
});

setPeak1Btn.addEventListener('click', () => settingPeakLine = 1);
setPeak2Btn.addEventListener('click', () => settingPeakLine = 2);
setBg1Btn.addEventListener('click', () => settingBgPoint = 1);
setBg2Btn.addEventListener('click', () => settingBgPoint = 2);
setIntegral1Btn.addEventListener('click', () => settingIntegralLine = 1);
setIntegral2Btn.addEventListener('click', () => settingIntegralLine = 2);

// --- 분석 계산 ---
function getBackgroundLine() { if (!bgPoint1 || !bgPoint2) return null; if (bgPoint1.x === bgPoint2.x) return { slope: 0, intercept: bgPoint1.y }; const slope = (bgPoint2.y - bgPoint1.y) / (bgPoint2.x - bgPoint1.x); const intercept = bgPoint1.y - slope * bgPoint1.x; return { slope, intercept }; }
function updateAnalysis() { if (!plottedData) { peakDeltaDisplay.textContent = "N/A"; peakCenterDisplay.textContent = "N/A"; integralValueDisplay.textContent = "N/A"; return; } if (peakLine1X !== -1 && peakLine2X !== -1) { peakDeltaDisplay.textContent = Math.abs(peakLine1X - peakLine2X); peakCenterDisplay.textContent = ((peakLine1X + peakLine2X) / 2).toFixed(2); } else { peakDeltaDisplay.textContent = "N/A"; peakCenterDisplay.textContent = "N/A"; } if (integralLine1X !== -1 && integralLine2X !== -1) { const start = Math.min(integralLine1X, integralLine2X), end = Math.max(integralLine1X, integralLine2X); let sum = 0; const bgLine = getBackgroundLine(); for (let i = start; i <= end; i++) { const signal = plottedData[i]; if (bgLine) { const background = bgLine.slope * i + bgLine.intercept; sum += (signal - background); } else { sum += signal; } } integralValueDisplay.textContent = sum.toExponential(3); } else { integralValueDisplay.textContent = "N/A"; } }

// --- 헬퍼 함수 및 드래그 앤 드롭 ---
function downloadTextFile(filename, text) { const a = document.createElement('a'); a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(text); a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); }
document.body.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
document.body.addEventListener('drop', async (e) => { e.preventDefault(); if (e.dataTransfer.files.length > 0 && e.dataTransfer.files[0].name.toLowerCase().endsWith('.spe')) await parseSpeFile(e.dataTransfer.files[0]); });
