import {parseSpe, averageFrames, averageRayleigh, binRows} from './spe.js';
const $ = id => document.getElementById(id);
const state = {r:null, b:null, r2:null, b2:null, t:null, reference:null, thomson:null, result:null, worker:null, busy:false};
const message = (text, error=false) => { $('status').textContent=text; $('status').classList.toggle('error',error); };
function invalidate(){ state.result=null; $('results').hidden=true; }
function clearImage(key){$(key+'-preview').getContext('2d').clearRect(0,0,1024,600);$(key+'-empty').hidden=false;$(key+'-dim').textContent='1024 × Y';}
function selected(key){return [...$(key+'-frames').querySelectorAll('input:checked')].map(el=>Number(el.value));}
function averaged(key){const s=state[key];if(!s)throw new Error(`${key.toUpperCase()} SPE 파일을 선택하세요.`);return {...s,data:averageFrames(s,selected(key))};}
async function loadFile(key, file){
  invalidate();
  if(key==='t'){state.thomson=null;clearImage('t');}else{state.reference=null;clearImage('r');}
  state[key]=null;$(key+'-frames').replaceChildren();$(key+'-name').textContent='불러오는 중…';
  try{
    const spe=parseSpe(await file.arrayBuffer());state[key]=spe;
    $(key+'-name').textContent=`${file.name} · ${spe.width}×${spe.height} · ${spe.frames.length} frames`;
    spe.frames.forEach((_,i)=>{const label=document.createElement('label'),cb=document.createElement('input');cb.type='checkbox';cb.value=i;cb.checked=i===0;label.append(cb,`Frame ${i+1}`);$(key+'-frames').append(label);cb.addEventListener('change',()=>framesChanged(key));});
    if(key==='t'){$('y-to').value=Math.min(spe.height,state.r?.height??spe.height);}
    framesChanged(key);
    message(`${file.name} 로드 완료. ${key==='t'?'Y 구간과 실험 조건을 확인하세요.':'프레임을 선택하고 차감을 적용하세요.'}`);
  }catch(e){$(key+'-name').textContent='불러오기 실패';message(e.message,true);}
}
function framesChanged(key){
  invalidate();
  if(key==='t'){
    state.thomson=null;clearImage('t');
    try{state.thomson=averaged('t');renderImage('t',state.thomson);}catch(e){message(e.message,true);}
  }else{state.reference=null;clearImage('r');message('Rayleigh 파일/프레임이 변경되었습니다. 4개 파일의 차감·평균을 다시 적용하세요.');}
}
for(const key of ['r','b','r2','b2','t'])$(key+'-file').addEventListener('change',e=>{if(e.target.files[0])loadFile(key,e.target.files[0]);});
$('subtract').addEventListener('click',()=>{
  try{const r=averaged('r'), b=averaged('b'), r2=averaged('r2'), b2=averaged('b2');state.reference={...r,data:averageRayleigh(r,b,r2,b2)};invalidate();renderImage('r',state.reference);message('최종 R = ((1 − 2) + (3 − 4)) / 2 적용 완료. 미리보기·텍스트·피팅에 동일하게 사용합니다.');}catch(e){message(e.message,true);}
});
function renderImage(key, image){
  if(!image)return;
  const min=Number($(key+'-min').value),max=Number($(key+'-max').value);
  if(!Number.isFinite(min)||!Number.isFinite(max)||max<=min){message('Intensity max는 min보다 커야 합니다.',true);return;}
  const canvas=$(key+'-preview');canvas.width=image.width;canvas.height=image.height;
  const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(image.width,image.height);
  for(let p=0;p<image.data.length;p++){const value=Math.max(0,Math.min(255,(image.data[p]-min)/(max-min)*255));pixels.data[p*4]=value;pixels.data[p*4+1]=value;pixels.data[p*4+2]=value;pixels.data[p*4+3]=255;}
  ctx.putImageData(pixels,0,0);$(key+'-empty').hidden=true;$(key+'-dim').textContent=`${image.width} × ${image.height}`;
  const from=Number($('y-from').value),to=Number($('y-to').value);
  ctx.strokeStyle='#5fd0b1';ctx.lineWidth=Math.max(1,image.height/250);ctx.strokeRect(0,from,image.width,to-from);
}
for(const key of ['r','t']){
  for(const bound of ['min','max'])$(key+'-'+bound).addEventListener('input',()=>renderImage(key,key==='r'?state.reference:state.thomson));
  $(key+'-preview').addEventListener('mousemove',e=>{const s=key==='r'?state.reference:state.thomson;if(!s)return;const rect=e.target.getBoundingClientRect(),x=Math.floor((e.clientX-rect.left)/rect.width*s.width),y=Math.floor((e.clientY-rect.top)/rect.height*s.height);if(x>=0&&y>=0&&x<s.width&&y<s.height)$(key+'-pixel').textContent=`X: ${x}  Y: ${y}  Intensity: ${s.data[y*s.width+x].toFixed(3)}`;});
}
for(const input of document.querySelectorAll('.settings-grid input')) input.addEventListener('input',()=>{invalidate();renderImage('r',state.reference);renderImage('t',state.thomson);});
function prepare(){
  if(!state.reference||!state.thomson)throw new Error('Rayleigh SPE 4개의 차감·평균과 Thomson 프레임 선택을 먼저 완료하세요.');
  const from=Number($('y-from').value),to=Number($('y-to').value),step=Number($('y-step').value);
  if([...document.querySelectorAll('.settings-grid input')].some(el=>el.value.trim()===''))throw new Error('분석 조건을 모두 입력하세요.');
  const options=Object.fromEntries(['n1','n2','ELR','ELT','shot_R','shot_T'].map(k=>[k,Number($(k).value)]));
  if(!Object.values(options).every(Number.isFinite)||!Number.isInteger(options.n1)||!Number.isInteger(options.n2)||options.n1<0||options.n2>1023||options.n1>=options.n2)throw new Error('Notch 픽셀 범위를 확인하세요.');
  if(options.ELR<=0||options.ELT<=0||![options.shot_R,options.shot_T].every(v=>Number.isInteger(v)&&v>0))throw new Error('에너지는 양수, shot 수는 양의 정수여야 합니다.');
  const R=binRows(state.reference.data,1024,state.reference.height,from,to,step),T=binRows(state.thomson.data,1024,state.thomson.height,from,to,step);
  const metadata={from,to,step,rayleigh_formula:'((file1 - file2) + (file3 - file4)) / 2',files:Object.fromEntries(['r','b','r2','b2','t'].map(k=>[k,{name:$(k+'-file').files[0].name,frames:selected(k).map(i=>i+1)}])),pixel_nm:.002266,probe_nm:532,angle_deg:135,fwhm_px:8};
  return {R,T,options,metadata};
}
function download(name,text,type='text/plain'){
  const url=URL.createObjectURL(new Blob([text],{type})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('export-signals').addEventListener('click',()=>{try{const p=prepare();for(const key of ['R','T'])download(key+'.txt',p[key].flat().join('\n')+'\n');message('R/T 저장 완료. 각 Y 구간마다 1024개 값입니다.');}catch(e){message(e.message,true);}});
function busy(value){state.busy=value;for(const input of document.querySelectorAll('input, #subtract, #run, #export-signals'))input.disabled=value;$('cancel').hidden=!value;}
$('run').addEventListener('click',()=>{
  try{
    const payload=prepare();invalidate();busy(true);message('피팅 엔진을 준비합니다…');
    state.worker ||= new Worker(new URL('./worker.js',import.meta.url));
    state.worker.onmessage=({data})=>{
      if(data.type==='status')message(data.message);
      if(data.type==='progress')message(`Y 구간 ${data.index+1} / ${data.total} 피팅 중… 계산량에 따라 시간이 걸릴 수 있습니다.`);
      if(data.type==='result'){busy(false);state.result={...data.result,metadata:payload.metadata};showResults();const failures=data.result.rows.filter(r=>!r.converged).length;message(failures?`계산 완료 · ${failures}개 구간이 반복 상한에 도달했습니다. 수렴 상태를 확인하세요.`:`분석 완료 · ${data.result.rows.length}개 Y 구간이 수렴했습니다.`,failures>0);}
      if(data.type==='error'){busy(false);message(data.message,true);state.worker.terminate();state.worker=null;}
    };
    state.worker.onerror=e=>{busy(false);message(`피팅 엔진 오류: ${e.message}`,true);state.worker.terminate();state.worker=null;};
    state.worker.postMessage(payload);
  }catch(e){busy(false);message(e.message,true);}
});
$('cancel').addEventListener('click',()=>{state.worker?.terminate();state.worker=null;busy(false);message('분석을 중단했습니다. 다시 실행할 수 있습니다.');});
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
  const {rows,metadata:m}=state.result;$('results').hidden=false;$('result-body').replaceChildren();$('result-row').replaceChildren();
  $('result-meta').textContent=`${rows.length} Y 구간 · ${m.from}–${m.to} (to 제외), step ${m.step} · v는 원본 코드의 대칭 중심 기준 · 분석 조건은 JSON에 포함됩니다.`;
  rows.forEach((row,i)=>{
    const y=m.from+i*m.step,label=`${y}–${Math.min(y+m.step,m.to)}`;
    const tr=document.createElement('tr');for(const value of [label,row.ne.toExponential(4),row.Te.toFixed(3),row.Ti.toFixed(3),row.Z.toFixed(3),(row.velocity/1000).toFixed(3),row.converged?'수렴':'미수렴']){const td=document.createElement('td');td.textContent=value;tr.append(td);}tr.onclick=()=>{$('result-row').value=i;detail();};$('result-body').append(tr);
    const option=document.createElement('option');option.value=i;option.textContent=label;$('result-row').append(option);
  });
  const points=key=>rows.map((r,i)=>[m.from+i*m.step,r[key]]);
  chart('density',[{color:'#147d73',points:points('ne')}],{log:true,yLabel:'ne [m^-3]'});
  chart('temperature',[{color:'#147d73',points:points('Te')},{color:'#ce8659',points:points('Ti')}],{yLabel:'Te (teal), Ti (orange) [eV]'});detail();
}
function detail(){const {rows,wavelengths:x,options}=state.result,r=rows[Number($('result-row').value)];chart('spectrum',[{color:'#9aa5a1',points:x.map((v,i)=>[v,r.signal[i]])},{color:'#147d73',points:x.map((v,i)=>[v,r.fit[i]])}],{xLabel:'Wavelength [nm]',yLabel:'Normalized intensity',shade:[x[options.n1],x[options.n2]]});chart('calibration',[{color:'#9aa5a1',points:r.rayleigh.map((v,i)=>[i,v])},{color:'#147d73',points:r.rayleigh_background.map((v,i)=>[i,v])}],{xLabel:'X pixel',yLabel:'Intensity'});}
$('result-row').addEventListener('change',detail);
$('export-results').addEventListener('click',()=>{
  if(!state.result)return;const {rows,metadata:m}=state.result;
  const fields=['ne','Te','Ti','Z','velocity','center','fitted_center','width','rayleigh_integral','thomson_integral','converged','iterations','redchi'];
  const csv=['y_from,y_to,'+fields.join(','),...rows.map((row,i)=>[m.from+i*m.step,Math.min(m.from+(i+1)*m.step,m.to),...fields.map(k=>row[k])].join(','))].join('\n');
  download('CTS_results.csv',csv,'text/csv');download('CTS_results.json',JSON.stringify(state.result,null,2),'application/json');
});
