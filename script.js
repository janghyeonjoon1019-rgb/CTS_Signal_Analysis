import {parseSpe, averageFrames, averageRayleigh, binRows} from './spe.js';
import {SignalPreview} from './preview.js';
const $ = id => document.getElementById(id);
const state = {r:null, b:null, r2:null, b2:null, t:null, reference:null, thomson:null, result:null, worker:null, busy:false};
const fileKeys = ['r','b','r2','b2','t'];
const rayleighKeys = fileKeys.slice(0, 4);
const previews = Object.fromEntries(['r','t'].map(key => [key, new SignalPreview(
  $(key+'-preview'), $(key+'-pixel'),
  () => ({from:Number($('y-from').value), to:Number($('y-to').value), n1:Number($('n1').value), n2:Number($('n2').value)})
)]));
const message = (text, error=false) => { $('status').textContent=text; $('status').classList.toggle('error',error); };
function invalidate(){ state.result=null; $('results').hidden=true; }
function clearImage(key){previews[key].setImage(null);$(key+'-empty').hidden=false;$(key+'-dim').textContent='1024 × Y';}
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
$('subtract').addEventListener('click',()=>{
  try{const r=averaged('r'), b=averaged('b'), r2=averaged('r2'), b2=averaged('b2');state.reference={...r,data:averageRayleigh(r,b,r2,b2)};invalidate();renderImage('r',state.reference);message('Applied R = ((1 − 2) + (3 − 4)) / 2 for preview, text export and fitting.');}catch(e){message(e.message,true);}
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
function prepare(){
  if(!state.reference||!state.thomson)throw new Error('First apply four-file Rayleigh averaging and select Thomson frames.');
  const from=Number($('y-from').value),to=Number($('y-to').value),step=Number($('y-step').value);
  if([...document.querySelectorAll('.settings-grid input')].some(el=>el.value.trim()===''))throw new Error('Complete all analysis parameters.');
  const options=Object.fromEntries(['n1','n2','ELR','ELT','shot_R','shot_T'].map(k=>[k,Number($(k).value)]));
  if(!Object.values(options).every(Number.isFinite)||!Number.isInteger(options.n1)||!Number.isInteger(options.n2)||options.n1<0||options.n2>1023||options.n1>=options.n2)throw new Error('Check the notch pixel range (0 <= from < to < 1024).');
  if(options.ELR<=0||options.ELT<=0||![options.shot_R,options.shot_T].every(v=>Number.isInteger(v)&&v>0))throw new Error('Laser energies must be positive and shot counts must be positive integers.');
  const R=binRows(state.reference.data,1024,state.reference.height,from,to,step),T=binRows(state.thomson.data,1024,state.thomson.height,from,to,step);
  const metadata={from,to,step,rayleigh_formula:'((file1 - file2) + (file3 - file4)) / 2',files:Object.fromEntries(['r','b','r2','b2','t'].map(k=>[k,{name:$(k+'-file').files[0].name,frames:selected(k).map(i=>i+1)}])),pixel_nm:.002266,probe_nm:532,angle_deg:135,fwhm_px:8};
  return {R,T,options,metadata};
}
function download(name,text,type='text/plain'){
  const url=URL.createObjectURL(new Blob([text],{type})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('export-signals').addEventListener('click',()=>{try{const p=prepare();for(const key of ['R','T'])download(key+'.txt',p[key].flat().join('\n')+'\n');message('R/T exported: 1024 values per Y bin.');}catch(e){message(e.message,true);}});
function busy(value){state.busy=value;for(const input of document.querySelectorAll('input, #subtract, #run, #export-signals'))input.disabled=value;$('cancel').hidden=!value;syncSelectAll();}
$('run').addEventListener('click',()=>{
  try{
    const payload=prepare();invalidate();busy(true);message('Preparing the fitting engine…');
    state.worker ||= new Worker(new URL('./worker.js',import.meta.url));
    state.worker.onmessage=({data})=>{
      if(data.type==='status')message(data.message);
      if(data.type==='progress')message(`Fitting Y bin ${data.index+1} / ${data.total}… This may take a while.`);
      if(data.type==='result'){busy(false);state.result={...data.result,metadata:payload.metadata};showResults();const failures=data.result.rows.filter(r=>!r.converged).length;message(failures?`Finished · ${failures} bins reached the iteration limit. Check convergence.`:`Analysis complete · ${data.result.rows.length} Y bins converged.`,failures>0);}
      if(data.type==='error'){busy(false);message(data.message,true);state.worker.terminate();state.worker=null;}
    };
    state.worker.onerror=e=>{busy(false);message(`Fitting engine error: ${e.message}`,true);state.worker.terminate();state.worker=null;};
    state.worker.postMessage(payload);
  }catch(e){busy(false);message(e.message,true);}
});
$('cancel').addEventListener('click',()=>{state.worker?.terminate();state.worker=null;busy(false);message('Analysis cancelled. You can run it again.');});
// Scientific plots with explicit numerical axes; no external chart dependency.
function chart(id, series, {xLabel='Y pixel',yLabel='',log=false,shade=null}={}){
  const canvas=$(id),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
  const l=78,r=36,t=22,b=48;ctx.clearRect(0,0,w,h);
  const points=series.flatMap(s=>s.points).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1])&&(!log||p[1]>0));if(!points.length)return;
  let xmin=Math.min(...points.map(p=>p[0])),xmax=Math.max(...points.map(p=>p[0]));
  let ymin=Math.min(...points.map(p=>log?Math.log10(p[1]):p[1])),ymax=Math.max(...points.map(p=>log?Math.log10(p[1]):p[1]));
  if(xmin===xmax){xmin-=.5;xmax+=.5;}if(ymin===ymax){ymin-=.5;ymax+=.5;}const pad=(ymax-ymin)*.08;ymin-=pad;ymax+=pad;
  const X=x=>l+(x-xmin)/(xmax-xmin)*(w-l-r),Y=y=>h-b-((log?Math.log10(y):y)-ymin)/(ymax-ymin)*(h-t-b);
  ctx.font='12px monospace';
  for(let i=0;i<=4;i++){const x=xmin+(xmax-xmin)*i/4,y=ymin+(ymax-ymin)*i/4,cy=h-b-(h-t-b)*i/4;ctx.strokeStyle='#e6ece7';ctx.beginPath();ctx.moveTo(l,cy);ctx.lineTo(w-r,cy);ctx.stroke();ctx.fillStyle='#728482';ctx.textAlign='right';ctx.fillText(log?(10**y).toExponential(1):Number(y.toPrecision(4)).toString(),l-10,cy+4);ctx.textAlign='center';ctx.fillText(Number(x.toFixed(3)).toString(),X(x),h-b+20);}
  if(shade){ctx.fillStyle='#dae2de88';ctx.fillRect(X(shade[0]),t,X(shade[1])-X(shade[0]),h-t-b);}
  for(const s of series){ctx.strokeStyle=s.color;ctx.fillStyle=s.color;ctx.lineWidth=2;ctx.beginPath();let first=true;for(const [x,y] of s.points){if(!Number.isFinite(y)||(log&&y<=0)){first=true;continue;}if(first){ctx.moveTo(X(x),Y(y));first=false;}else ctx.lineTo(X(x),Y(y));}ctx.stroke();if(s.points.length===1){ctx.beginPath();ctx.arc(X(s.points[0][0]),Y(s.points[0][1]),4,0,Math.PI*2);ctx.fill();}}
  ctx.fillStyle='#728482';ctx.textAlign='center';ctx.fillText(xLabel,(w+l-r)/2,h-8);ctx.textAlign='left';ctx.fillText(yLabel,8,12);
}
function showResults(){
  const {rows,metadata:m}=state.result;$('results').hidden=false;$('result-body').replaceChildren();$('spectra-list').replaceChildren();
  $('result-meta').textContent=`${rows.length} Y bins · [${m.from}, ${m.to}), step ${m.step} · All spectra are shown below. Velocity uses the original symmetry center. Parameters are included in JSON.`;
  rows.forEach((row,i)=>{
    const y=m.from+i*m.step,label=`${y}–${Math.min(y+m.step,m.to)}`;
    const tr=document.createElement('tr');for(const value of [label,row.ne.toExponential(4),row.Te.toFixed(3),row.Ti.toFixed(3),row.Z.toFixed(3),(row.velocity/1000).toFixed(3),row.converged?'Converged':'Not converged']){const td=document.createElement('td');td.textContent=value;tr.append(td);}tr.onclick=()=>{$('spectrum-row-'+i).scrollIntoView({behavior:'smooth',block:'start'});};$('result-body').append(tr);
    const card = document.createElement('article');
    card.className = 'chart-card spectrum-card';
    card.id = 'spectrum-row-'+i;
    const heading = document.createElement('h3');
    heading.textContent = `Y [${y}, ${Math.min(y+m.step,m.to)}) — Thomson spectrum`;
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
    $('spectra-list').append(card);
  });
  const points=key=>rows.map((r,i)=>[m.from+i*m.step,r[key]]);
  chart('density',[{color:'#147d73',points:points('ne')}],{log:true,yLabel:'ne [m^-3]'});
  chart('temperature',[{color:'#147d73',points:points('Te')},{color:'#ce8659',points:points('Ti')}],{yLabel:'Te (teal), Ti (orange) [eV]'});
  rows.forEach((row,i)=>drawSpectrum(row,i));
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
  const fields=['ne','Te','Ti','Z','velocity','center','fitted_center','width','rayleigh_integral','thomson_integral','converged','iterations','redchi'];
  const csv=['y_from,y_to,'+fields.join(','),...rows.map((row,i)=>[m.from+i*m.step,Math.min(m.from+(i+1)*m.step,m.to),...fields.map(k=>row[k])].join(','))].join('\n');
  download('CTS_results.csv',csv,'text/csv');download('CTS_results.json',JSON.stringify(state.result,null,2),'application/json');
});
