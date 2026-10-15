import {parseSpe, averageFrames, averageRayleigh, rayleighPairComparison, binRows} from './spe.js?v=__CTS_BUILD__';
import {SignalPreview} from './preview.js?v=__CTS_BUILD__';
const $ = id => document.getElementById(id);
const state = {r:null, b:null, r2:null, b2:null, t:null, reference:null, thomson:null, result:null, worker:null, busy:false};
const fileKeys = ['r','b','r2','b2','t'];
const rayleighKeys = fileKeys.slice(0, 4);
const previews = Object.fromEntries(['r','t'].map(key => [key, new SignalPreview(
  $(key+'-preview'), $(key+'-pixel'),
  () => ({from:Number($('y-from').value), to:Number($('y-to').value), n1:Number($('n1').value), n2:Number($('n2').value)})
)]));
const message = (text, error=false) => { $('status').textContent=text; $('status').classList.toggle('error',error); };
function invalidate(){ state.result=null; $('results').hidden=true; $('run-errors').replaceChildren(); $('run-errors').hidden=true; }
function clearImage(key){if(key==='r'){$('rayleigh-comparison').hidden=true;$('rayleigh-range-comparison').hidden=true;}previews[key].setImage(null);$(key+'-empty').hidden=false;$(key+'-dim').textContent='1024 × Y';}
function selected(key){return [...$(key+'-frames').querySelectorAll('input:checked')].map(el=>Number(el.value));}
function averaged(key){const s=state[key];if(!s)throw new Error(`${key.toUpperCase()} SPE file is required.`);return {...s,data:averageFrames(s,selected(key))};}
function syncSelectAll() {
  for (const key of fileKeys) {
    const all = $(key+'-all'), boxes = [...$(key+'-frames').querySelectorAll('input')];
    const count = boxes.filter(box => box.checked).length;
    all.disabled = state.busy || boxes.length === 0;
    all.checked = boxes.length > 0 && count === boxes.length;
    all.indeterminate = count > 0 && count < boxes.length;
  }
  const boxes = rayleighKeys.flatMap(key => [...$(key+'-frames').querySelectorAll('input')]);
  const count = boxes.filter(box => box.checked).length, all = $('rayleigh-all');
  all.disabled = state.busy || boxes.length === 0;
  all.checked = boxes.length > 0 && count === boxes.length;
  all.indeterminate = count > 0 && count < boxes.length;
}
for (const key of fileKeys) $(key+'-all').addEventListener('change', event => {
  for (const box of $(key+'-frames').querySelectorAll('input')) box.checked = event.target.checked;
  framesChanged(key);
});
$('rayleigh-all').addEventListener('change', event => {
  for (const key of rayleighKeys) for (const box of $(key+'-frames').querySelectorAll('input')) box.checked = event.target.checked;
  framesChanged('r');
});
async function loadFile(key, file){
  invalidate();
  if(key==='t'){state.thomson=null;clearImage('t');}else{state.reference=null;clearImage('r');}
  state[key]=null;$(key+'-frames').replaceChildren();syncSelectAll();$(key+'-name').textContent='Loading…';
  try{
    const spe=parseSpe(await file.arrayBuffer());state[key]=spe;
    $(key+'-name').textContent=`${file.name} · ${spe.width}×${spe.height} · ${spe.frames.length} frames`;
    spe.frames.forEach((_,i)=>{const label=document.createElement('label'),cb=document.createElement('input');cb.type='checkbox';cb.value=i;cb.checked=i===0;label.append(cb,`Frame ${i+1}`);$(key+'-frames').append(label);cb.addEventListener('change',()=>framesChanged(key));});
    framesChanged(key);
    message(`${file.name} loaded. ${key==='t'?'Check the Y range and experimental parameters.':'Select frames and apply subtraction & averaging.'}`);
  }catch(e){$(key+'-name').textContent='Failed to load';message(e.message,true);}
}
function framesChanged(key){
  syncSelectAll();
  invalidate();
  if(key==='t'){
    state.thomson=null;clearImage('t');
    try{state.thomson=averaged('t');renderImage('t',state.thomson);}catch(e){message(e.message,true);}
  }else{state.reference=null;clearImage('r');message('Rayleigh files/frames changed. Reapply four-file subtraction & averaging.');}
}
for(const key of ['r','b','r2','b2','t'])$(key+'-file').addEventListener('change',e=>{if(e.target.files[0])loadFile(key,e.target.files[0]);});
function showRayleighComparison(comparison, prefix='rayleigh', scope='') {
  const format=value=>value.toLocaleString('en-US',{maximumSignificantDigits:8});
  const difference=comparison.differencePercent===null
    ? 'Total-intensity difference: N/A (both totals are zero)'
    : `Total-intensity difference: ${comparison.differencePercent.toFixed(2)}%`;
  $(prefix+'-difference').textContent=difference+(scope?` · ${scope}`:'');
  $(prefix+'-totals').textContent=`Pair 1 total (ΣA): ${format(comparison.firstTotal)} · Pair 2 total (ΣB): ${format(comparison.secondTotal)}`;
  $(prefix+'-comparison').hidden=false;
}
$('compare-rayleigh-range').addEventListener('click',()=>{
  $('rayleigh-range-comparison').hidden=true;
  try {
    const r=averaged('r'), b=averaged('b'), r2=averaged('r2'), b2=averaged('b2');
    if(['y-from','y-to'].some(id=>$(id).value.trim()===''))throw new Error('Enter both comparison Y bounds.');
    const from=Number($('y-from').value), to=Number($('y-to').value);
    const comparison=rayleighPairComparison(r,b,r2,b2,{from,to});
    showRayleighComparison(comparison,'rayleigh-range',`Y [${from}, ${to}) · X [0, 1024)`);
    message(`Compared Rayleigh pairs over Y [${from}, ${to}) and X [0, 1024).`);
  } catch(e) { message(e.message,true); }
});
for(const id of ['y-from','y-to'])$(id).addEventListener('input',()=>{$('rayleigh-range-comparison').hidden=true;});
$('subtract').addEventListener('click',()=>{
  try {
    const r=averaged('r'), b=averaged('b'), r2=averaged('r2'), b2=averaged('b2');
    state.reference={...r,data:averageRayleigh(r,b,r2,b2)};
    const comparison=rayleighPairComparison(r,b,r2,b2);
    showRayleighComparison(comparison);
    invalidate();renderImage('r',state.reference);
    message('Applied R = (max(1 − 2, 0) + max(3 − 4, 0)) / 2 for preview, text export and fitting.');
  } catch(e) { message(e.message,true); }
});

function renderImage(key, image){
  if (!image) return;
  try {
    previews[key].setImage(image, Number($(key+'-min').value), Number($(key+'-max').value));
    $(key+'-empty').hidden = true;
    $(key+'-dim').textContent = `${image.width} × ${image.height}`;
  } catch (error) { message(error.message, true); }
}
for (const key of ['r','t']) {
  for (const bound of ['min','max']) $(key+'-'+bound).addEventListener('input', () => renderImage(key, key==='r'?state.reference:state.thomson));
  $(key+'-reset').addEventListener('click', () => previews[key].fit());
}
for(const input of document.querySelectorAll('.settings-grid input')) input.addEventListener('input',()=>{invalidate();renderImage('r',state.reference);renderImage('t',state.thomson);});
$('fwhm').addEventListener('input', () => {
  const value = Number($('fwhm').value);
  $('fwhm-display').textContent = Number.isFinite(value) && value > 0 ? `Instrument FWHM: ${value} px` : 'Instrument FWHM: not set';
});
function binRange(index, metadata) {
  return [metadata.from + index * metadata.step, Math.min(metadata.from + (index+1) * metadata.step, metadata.to)];
}
function appendBinError(index, error, metadata) {
  const [from,to] = binRange(index,metadata), item = document.createElement('li');
  item.textContent = `Skipped bin #${index+1} · Y [${from}, ${to}) · ${error.stage}: ${error.message}`;
  $('run-errors').append(item);
  $('run-errors').hidden = false;
}
function prepare(){
  if(!state.reference||!state.thomson)throw new Error('First apply four-file Rayleigh averaging and select Thomson frames.');
  const from=Number($('y-from').value),to=Number($('y-to').value),step=Number($('y-step').value);
  if([...document.querySelectorAll('.settings-grid input')].some(el=>el.value.trim()===''))throw new Error('Complete all analysis parameters.');
  const options=Object.fromEntries(['n1','n2','ELR','ELT','shot_R','shot_T','fwhm','model_oversample'].map(k=>[k,Number($(k).value)]));
  if(!Object.values(options).every(Number.isFinite)||!Number.isInteger(options.n1)||!Number.isInteger(options.n2)||options.n1<0||options.n2>1023||options.n1>=options.n2)throw new Error('Check the notch pixel range (0 <= from < to < 1024).');
  if(options.ELR<=0||options.ELT<=0||![options.shot_R,options.shot_T].every(v=>Number.isInteger(v)&&v>0))throw new Error('Laser energies must be positive and shot counts must be positive integers.');
  if(options.fwhm<=0)throw new Error('Instrument FWHM must be a positive value in pixels.');
  if(!Number.isInteger(options.model_oversample)||options.model_oversample<1)throw new Error('Model oversampling must be a positive integer (e.g. 16, 32 or 64).');
  const R=binRows(state.reference.data,1024,state.reference.height,from,to,step),T=binRows(state.thomson.data,1024,state.thomson.height,from,to,step);
  const metadata={from,to,step,rayleigh_formula:'(max(file1 - file2, 0) + max(file3 - file4, 0)) / 2',files:Object.fromEntries(['r','b','r2','b2','t'].map(k=>[k,{name:$(k+'-file').files[0].name,frames:selected(k).map(i=>i+1)}])),pixel_nm:.002266,probe_nm:532,angle_deg:135,fwhm_px:options.fwhm,model_oversample:options.model_oversample};
  return {R,T,options,metadata};
}
function download(name,text,type='text/plain'){
  const url=URL.createObjectURL(new Blob([text],{type})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('export-signals').addEventListener('click',()=>{try{const p=prepare();for(const key of ['R','T'])download(key+'.txt',p[key].flat().join('\n')+'\n');message('R/T exported: 1024 values per Y bin.');}catch(e){message(e.message,true);}});
function busy(value){state.busy=value;for(const input of document.querySelectorAll('input, #subtract, #compare-rayleigh-range, #run, #export-signals'))input.disabled=value;$('cancel').hidden=!value;syncSelectAll();}
$('run').addEventListener('click',()=>{
  try{
    const payload=prepare();invalidate();busy(true);message('Preparing the fitting engine…');
    state.worker ||= new Worker(new URL('./worker.js?v=__CTS_BUILD__',import.meta.url));
    state.worker.onmessage=({data})=>{
      if(data.type==='status')message(data.message);
      if(data.type==='progress'){const [from,to]=binRange(data.index,payload.metadata);message(`Fitting bin ${data.index+1} / ${data.total} · Y [${from}, ${to})…`);}
      if(data.type==='bin_error')appendBinError(data.index,data,payload.metadata);
      if(data.type==='result'){
        busy(false);state.result={...data.result,metadata:payload.metadata};showResults();
        const failed=data.result.rows.filter(row=>row.status==='failed').length;
        message(`Analysis complete · ${data.result.rows.length-failed} succeeded, ${failed} failed / skipped. Original Y positions are preserved.`,failed>0);
      }
      if(data.type==='error'){busy(false);message(data.message,true);state.worker.terminate();state.worker=null;}
    };
    state.worker.onerror=e=>{busy(false);message(`Fitting engine error: ${e.message}`,true);state.worker.terminate();state.worker=null;};
    state.worker.postMessage(payload);
  }catch(e){busy(false);message(e.message,true);}
});
$('cancel').addEventListener('click',()=>{state.worker?.terminate();state.worker=null;busy(false);message('Analysis cancelled. You can run it again.');});
// Scientific plots with explicit numerical axes; no external chart dependency.
function chart(id, series, {xLabel='Y pixel',yLabel='',log=false,shade=null,markers=false}={}){
  const canvas=$(id),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
  const l=120,r=52,t=42,b=70;ctx.clearRect(0,0,w,h);
  const points=series.flatMap(s=>s.points).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1])&&(!log||p[1]>0));if(!points.length){ctx.fillStyle='#728482';ctx.font='20px monospace';ctx.textAlign='center';ctx.fillText('No valid bins to plot',w/2,h/2);return;}
  const xs=series.flatMap(s=>s.points.map(p=>p[0])).filter(Number.isFinite);
  let xmin=Math.min(...xs),xmax=Math.max(...xs);
  let ymin=Math.min(...points.map(p=>log?Math.log10(p[1]):p[1])),ymax=Math.max(...points.map(p=>log?Math.log10(p[1]):p[1]));
  if(xmin===xmax){xmin-=.5;xmax+=.5;}if(ymin===ymax){ymin-=.5;ymax+=.5;}const pad=(ymax-ymin)*.08;ymin-=pad;ymax+=pad;
  const X=x=>l+(x-xmin)/(xmax-xmin)*(w-l-r),Y=y=>h-b-((log?Math.log10(y):y)-ymin)/(ymax-ymin)*(h-t-b);
  ctx.font='20px monospace';
  for(let i=0;i<=4;i++){const x=xmin+(xmax-xmin)*i/4,y=ymin+(ymax-ymin)*i/4,cy=h-b-(h-t-b)*i/4;ctx.strokeStyle='#e6ece7';ctx.beginPath();ctx.moveTo(l,cy);ctx.lineTo(w-r,cy);ctx.stroke();ctx.fillStyle='#728482';ctx.textAlign='right';ctx.fillText(log?(10**y).toExponential(1):Number(y.toPrecision(4)).toString(),l-10,cy+7);ctx.textAlign='center';ctx.fillText(Number(x.toFixed(3)).toString(),X(x),h-b+20);}
  if(shade){ctx.fillStyle='#dae2de88';ctx.fillRect(X(shade[0]),t,X(shade[1])-X(shade[0]),h-t-b);}
  for(const s of series){ctx.strokeStyle=s.color;ctx.fillStyle=s.color;ctx.lineWidth=2;ctx.beginPath();let first=true;for(const [x,y] of s.points){if(!Number.isFinite(y)||(log&&y<=0)){first=true;continue;}if(first){ctx.moveTo(X(x),Y(y));first=false;}else ctx.lineTo(X(x),Y(y));}ctx.stroke();if(markers||s.points.length===1){for(const [x,y] of s.points){if(!Number.isFinite(y)||(log&&y<=0))continue;ctx.beginPath();ctx.arc(X(x),Y(y),4,0,Math.PI*2);ctx.fill();}}}
  ctx.fillStyle='#728482';ctx.textAlign='center';ctx.fillText(xLabel,(w+l-r)/2,h-8);ctx.textAlign='left';ctx.fillText(yLabel,8,22);
}
function showResults(){
  const {rows,metadata:m}=state.result;$('results').hidden=false;$('result-body').replaceChildren();$('spectra-list').replaceChildren();
  $('run-errors').replaceChildren();$('run-errors').hidden=true;
  const failed=rows.filter(row=>row.status==='failed').length;
  $('result-meta').textContent=`${rows.length} Y bins · [${m.from}, ${m.to}), step ${m.step} · ${rows.length-failed} succeeded, ${failed} skipped · FWHM ${state.result.options.fwhm} px · Model oversampling ${state.result.options.model_oversample}×. Failed bins remain empty; curves do not bridge them. Velocity uses the original symmetry center. Parameters are included in JSON.`;
  rows.forEach((row,i)=>{
    const y=m.from+i*m.step,label=`${y}–${Math.min(y+m.step,m.to)}`;
    const failed = row.status === 'failed';
    const format = (value,digits=3) => Number.isFinite(value) ? value.toFixed(digits) : '—';
    const status = failed ? 'Failed / skipped' : row.converged ? 'Converged' : 'Not converged';
    const explanation = failed ? `${row.error.stage}: ${row.error.message}` : (row.warnings||[]).join(' ');
    const tr=document.createElement('tr');tr.classList.toggle('failed-bin',failed);
    for(const value of [label,Number.isFinite(row.ne)?row.ne.toExponential(4):'—',format(row.Te),format(row.Ti),format(row.Z),Number.isFinite(row.velocity)?(row.velocity/1000).toFixed(3):'—',status,explanation]){
      const td=document.createElement('td');td.textContent=value;tr.append(td);
    }
    tr.lastChild.className='bin-error';
    tr.onclick=()=>{$('spectrum-row-'+i).scrollIntoView({behavior:'smooth',block:'start'});};$('result-body').append(tr);
    const card = document.createElement('article');
    card.className = 'chart-card spectrum-card';
    card.id = 'spectrum-row-'+i;
    const heading = document.createElement('h3');
    heading.textContent = `Y [${y}, ${Math.min(y+m.step,m.to)}) — Thomson spectrum`;
    if (failed) {
      card.classList.add('failed-bin');
      heading.textContent = `Y [${y}, ${Math.min(y+m.step,m.to)}) — Failed / skipped (bin #${i+1})`;
      const reason = document.createElement('p');reason.className='bin-error';reason.textContent=explanation;
      const note = document.createElement('p');note.textContent='No fitted values for this bin. Later bins keep their original Y coordinates.';
      const details = document.createElement('details'), summary = document.createElement('summary'), trace = document.createElement('pre');
      summary.textContent='Python traceback';trace.textContent=row.error.traceback||'No traceback available.';
      details.append(summary,trace);card.append(heading,reason,note,details);$('spectra-list').append(card);
      appendBinError(i,row.error,m);
      return;
    }
    const legend = document.createElement('p');
    legend.className = 'help';
    legend.textContent = 'Gray: measured signal · Teal: fitted model · Shaded: notch';
    const spectrum = document.createElement('canvas');
    spectrum.id = 'spectrum-'+i; spectrum.width = 1200; spectrum.height = 360;
    spectrum.setAttribute('aria-label', heading.textContent);
    const calibrationTitle = document.createElement('h3');
    calibrationTitle.textContent = 'Rayleigh calibration · Gray: signal · Teal: linear background';
    const calibration = document.createElement('canvas');
    calibration.id = 'calibration-'+i; calibration.width = 1200; calibration.height = 300;
    calibration.setAttribute('aria-label', `Rayleigh calibration for Y [${y}, ${Math.min(y+m.step,m.to)})`);
    card.append(heading, legend, spectrum, calibrationTitle, calibration);
    if(row.warnings?.length){const warning=document.createElement('p');warning.className='bin-warning';warning.textContent=row.warnings.join(' ');legend.after(warning);}
    $('spectra-list').append(card);
  });
  const points=key=>rows.map((r,i)=>[m.from+i*m.step,r[key]]);
  chart('density',[{color:'#147d73',points:points('ne')}],{log:true,yLabel:'ne [m^-3]',markers:true});
  chart('temperature',[{color:'#147d73',points:points('Te')},{color:'#ce8659',points:points('Ti')}],{yLabel:'Te (teal), Ti (orange) [eV]',markers:true});
  rows.forEach((row,i)=>{if(row.status!=='failed')drawSpectrum(row,i);});
}
function drawSpectrum(row, index) {
  const {wavelengths:x, options} = state.result;
  chart('spectrum-'+index, [
    {color:'#9aa5a1', points:x.map((value,i)=>[value,row.signal[i]])},
    {color:'#147d73', points:x.map((value,i)=>[value,row.fit[i]])}
  ], {xLabel:'Wavelength [nm]',yLabel:'Normalized intensity',shade:[x[options.n1],x[options.n2]]});
  chart('calibration-'+index, [
    {color:'#9aa5a1',points:row.rayleigh.map((value,i)=>[i,value])},
    {color:'#147d73',points:row.rayleigh_background.map((value,i)=>[i,value])}
  ], {xLabel:'X pixel',yLabel:'Intensity'});
}
$('export-results').addEventListener('click',()=>{
  if(!state.result)return;const {rows,metadata:m}=state.result;
  const fields=['ne','Te','Ti','Z','velocity','center','fitted_center','width','rayleigh_integral','thomson_integral','converged','iterations','redchi','status'];
  const csvCell = value => '"'+String(value??'').replaceAll('"','""')+'"';
  const header=['bin_number','y_from','y_to','fwhm_px','model_oversample',...fields,'error_stage','error_message','warning'];
  const records=rows.map((row,i)=>[i+1,...binRange(i,m),m.fwhm_px,state.result.options.model_oversample,...fields.map(key=>row[key]),row.error?.stage,row.error?.message,(row.warnings||[]).join(' ')]);
  const csv=[header,...records].map(record=>record.map(csvCell).join(',')).join('\n');
  download('CTS_results.csv',csv,'text/csv');download('CTS_results.json',JSON.stringify(state.result,null,2),'application/json');
});
