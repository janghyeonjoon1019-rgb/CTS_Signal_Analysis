"""Start the static server first; requires CPython scientific deps and Playwright.
Set CTS_BROWSER_SYSTEM_PROXY=1 only for proxy-managed cloud test runners.
"""
from playwright.sync_api import sync_playwright
from pathlib import Path
import json,struct,urllib.request,urllib.error,hashlib,time,sys,os
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
sys.path.insert(0,str(Path(__file__).resolve().parent))
from test_analysis import synthetic, OPTIONS
r,t=synthetic()
# A reproducible 0.1%-of-peak noise floor exercises realistic browser fitting.
# Perfect zero-residual data make relative DE convergence needlessly expensive.
t[0] = t[0] + np.random.default_rng(42).normal(0, .5, 1024)
payload={'R':[row.tolist() for row in r],'T':[row.tolist() for row in t],'options':OPTIONS}
output=Path('test-results');output.mkdir(exist_ok=True)
def spe(row, second=None, bad_y=None):
 header=bytearray(4100);struct.pack_into('<H',header,42,1024);struct.pack_into('<H',header,656,64);struct.pack_into('<i',header,1446,2);struct.pack_into('<h',header,108,0);struct.pack_into('<f',header,1992,2.5)
 first=row*64;other=(row if second is None else second)*64
 if bad_y is not None:
  first[bad_y*1024:(bad_y+1)*1024]=[100.]*1024;other[bad_y*1024:(bad_y+1)*1024]=[100.]*1024
 return bytes(header)+struct.pack('<131072f',*(first+other))
fixtures={'r':spe([7.5-.25*v for v in payload['R'][0]], [7.5-.75*v for v in payload['R'][0]]),'b':spe([7.5]*1024),'r2':spe([2*v+30.25 for v in payload['R'][0]]),'b2':spe([30.25]*1024),'t':spe(payload['T'][0],bad_y=1)}
cache=Path('/tmp/cts-network-cache');cache.mkdir(exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 context=browser.new_context(viewport={'width':1440,'height':1080},accept_downloads=True)
 # This machine's browser does not inherit its HTTPS proxy/CA setup.
 # urllib uses the system CA bundle and HTTPS proxy with verification enabled.
 def proxy(route):
  url=route.request.url; key=hashlib.sha256(url.encode()).hexdigest(); path=cache/key
  try:
   if path.exists(): data=path.read_bytes();ctype=(cache/(key+'.type')).read_text()
   else:
    for attempt in range(3):
     try:
      with urllib.request.urlopen(url,timeout=90) as r:data=r.read();ctype=r.headers.get('content-type','application/octet-stream')
      break
     except urllib.error.HTTPError as e:
      if e.code not in [502,503,504] or attempt==2:raise
    path.write_bytes(data);(cache/(key+'.type')).write_text(ctype)
   route.fulfill(status=200,body=data,headers={'content-type':ctype,'access-control-allow-origin':'*'})
  except Exception as e:print('NETWORK',url,str(e),flush=True);route.abort()
 if os.environ.get('CTS_BROWSER_SYSTEM_PROXY')=='1':
  context.route('https://**/*',proxy)
 page=context.new_page();errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('console',lambda m:print('console',m.text,flush=True) if m.type=='error' else None)
 page.goto(os.environ.get('CTS_TEST_URL','http://127.0.0.1:8000'))
 page.screenshot(path=str(output/'desktop.png'),full_page=True)
 page.locator('#run').click();assert 'First' in page.locator('#status').inner_text()
 page.locator('#r-file').set_input_files({'name':'bad.spe','mimeType':'application/octet-stream','buffer':b'bad'})
 page.wait_for_function("document.querySelector('#status').textContent.includes('header')")
 for key in ['r','b','r2','b2','t']:
  page.locator('#'+key+'-file').set_input_files({'name':key+'.spe','mimeType':'application/octet-stream','buffer':fixtures[key]})
  page.wait_for_function(f"document.querySelectorAll('#{key}-frames input').length===2")
 assert page.locator('html').get_attribute('lang')=='en'
 assert page.locator('input[type=number]').evaluate_all('(els)=>els.every(el=>el.value==="0")')
 assert not __import__('re').search('[가-힣]',page.locator('body').inner_text())
 for key in ['r','b','r2','b2','t']:
  assert page.locator('#'+key+'-all').evaluate('(el)=>el.indeterminate')
 page.locator('#r-all').check()
 assert page.locator('#r-frames input:checked').count()==2
 assert page.locator('#b-frames input:checked').count()==1
 page.locator('#rayleigh-all').check()
 for key in ['r','b','r2','b2']:
  assert page.locator('#'+key+'-frames input:checked').count()==2
 page.locator('#rayleigh-all').uncheck()
 for key in ['r','b','r2','b2']:
  assert page.locator('#'+key+'-frames input:checked').count()==0
 page.locator('#rayleigh-all').check()
 page.locator('#t-all').check()
 page.locator('#subtract').click()
 page.locator('#b2-all').uncheck()
 page.locator('#run').click();assert 'First' in page.locator('#status').inner_text()
 page.locator('#b2-all').check()
 page.locator('#subtract').click()
 for key,value in {'y-from':4,'y-to':60,'y-step':1,'n1':475,'n2':485,'ELR':1,'ELT':1,'shot_R':6,'shot_T':1,'fwhm':8}.items():
  page.locator('#'+key).fill(str(value))
 for key in ['r','t']:
  canvas=page.locator('#'+key+'-preview')
  assert page.locator('#'+key+'-empty').evaluate('(el)=>el.hidden')
  colors=canvas.evaluate("""el=>{const data=el.getContext('2d').getImageData(0,0,el.width,el.height).data;let blue=0,red=0;for(let i=0;i<data.length;i+=4){if(data[i]<100&&data[i+1]>80&&data[i+2]>200)blue++;if(data[i]>200&&data[i+1]<130&&data[i+2]<130)red++;}return {blue,red}}""")
  assert colors['blue']>0 and colors['red']>0, colors
  initial=canvas.evaluate('(el)=>el.toDataURL()')
  canvas.scroll_into_view_if_needed()
  rect=canvas.bounding_box();cx=round(rect['x']+rect['width']/2);cy=round(rect['y']+rect['height']/2)
  page.mouse.move(cx,cy)
  before=page.locator('#'+key+'-pixel').inner_text()
  page.mouse.wheel(0,-100)
  page.wait_for_timeout(100)
  after=page.locator('#'+key+'-pixel').inner_text()
  coords=lambda text:[int(v) for v in __import__('re').findall(r'[XY]: (\d+)',text)]
  assert len(coords(before))==2 and all(abs(a-b)<=1 for a,b in zip(coords(before),coords(after))), (key,before,after)
  assert initial!=canvas.evaluate('(el)=>el.toDataURL()')
  page.mouse.down();page.mouse.move(cx+20,cy+15,steps=4);page.mouse.up()
  dragged=page.locator('#'+key+'-pixel').inner_text()
  assert all(abs(a-b)<=1 for a,b in zip(coords(after),coords(dragged)))
  canvas_pixels=canvas.evaluate('(el)=>el.toDataURL()')
  page.locator('#'+key+'-reset').click()
  assert canvas_pixels!=canvas.evaluate('(el)=>el.toDataURL()')
  assert initial==canvas.evaluate('(el)=>el.toDataURL()')
 page.locator('#y-from').fill('0');page.locator('#y-to').fill('3');page.locator('#y-step').fill('1')
 page.locator('#fwhm').fill('0');page.locator('#run').click();assert 'FWHM' in page.locator('#status').inner_text();page.locator('#fwhm').fill('8')
 page.locator('#ELT').fill('0');page.locator('#run').click();assert 'positive' in page.locator('#status').inner_text();page.locator('#ELT').fill('1')
 with page.expect_download() as dl:page.locator('#export-signals').click()
 text=Path(dl.value.path()).read_text();assert len(text.strip().splitlines())==3072
 expected=payload['R'][0]*3 if dl.value.suggested_filename=='R.txt' else payload['T'][0]+[100.]*1024+payload['T'][0]
 assert max(abs(float(actual)-value) for actual,value in zip(text.strip().splitlines(),expected))<.001
 page.screenshot(path=str(output/'preview-overlays.png'),full_page=True)
 page.locator('#run').click();page.locator('#cancel').click();assert 'cancelled' in page.locator('#status').inner_text()
 page.locator('#run').click()
 print('Fitting started',flush=True)
 page.wait_for_function("!document.querySelector('#results').hidden || document.querySelector('#status').classList.contains('error')",timeout=900000)
 print('STATUS',page.locator('#status').inner_text(),flush=True)
 assert not page.locator('#results').evaluate('(el)=>el.hidden'), page.locator('#status').inner_text()
 assert page.locator('#result-body tr').count()==3
 cells=page.locator('#result-body tr').first.locator('td').all_text_contents();print('RESULT',cells,flush=True)
 assert abs(float(cells[2])-30)<2 and abs(float(cells[3])-15)<2 and cells[6]=='Converged'
 assert page.locator('#spectra-list .spectrum-card').count()==3
 for index in [0,2]:
  assert page.locator('#spectrum-'+str(index)).is_visible()
  assert page.locator('#calibration-'+str(index)).is_visible()
 failed=page.locator('#result-body tr').nth(1).locator('td').all_text_contents()
 assert failed[0]=='1–2' and failed[1]=='—' and failed[6]=='Failed / skipped'
 assert 'thomson_integral' in failed[7]
 assert page.locator('#run-errors li').count()==1
 assert 'Y [1, 2)' in page.locator('#run-errors').inner_text()
 assert page.locator('#spectrum-row-1 details').count()==1
 page.locator('#spectrum-row-1 summary').click()
 assert 'Traceback' in page.locator('#spectrum-row-1 pre').inner_text()
 assert 'FWHM 8 px' in page.locator('#result-meta').inner_text()
 # A missing middle bin must not be joined by a density line.
 assert page.locator('#density').evaluate("""el=>{const c=el.getContext('2d');const d=c.getImageData(el.width/2,120,1,40).data;return !Array.from({length:d.length/4},(_,i)=>d[i*4]<40&&d[i*4+1]>100&&d[i*4+1]<150&&d[i*4+2]>80&&d[i*4+2]<140).some(Boolean)}""")
 downloads=[];page.on('download',lambda d:downloads.append(d))
 with page.expect_download():page.locator('#export-results').click()
 page.wait_for_timeout(250)
 exported={d.suggested_filename:Path(d.path()).read_text() for d in downloads}
 assert set(exported)=={'CTS_results.csv','CTS_results.json'}
 data=json.loads(exported['CTS_results.json'])
 assert data['metadata']['fwhm_px']==8 and data['options']['fwhm']==8
 assert 'max(file1 - file2, 0)' in data['metadata']['rayleigh_formula']
 assert data['rows'][1]['ne'] is None and data['rows'][1]['status']=='failed'
 assert data['rows'][2]['index']==2
 import csv,io
 records=list(csv.DictReader(io.StringIO(exported['CTS_results.csv'])))
 assert records[1]['bin_number']=='2' and records[1]['y_from']=='1' and records[1]['ne']==''
 assert records[1]['error_stage']=='thomson_integral' and records[2]['status']=='ok'
 assert not __import__('re').search('[가-힣]',page.locator('body').inner_text())
 page.screenshot(path=str(output/'results.png'),full_page=True)
 # The reused worker must also handle an entirely failed run with new FWHM.
 page.locator('#t-file').set_input_files({'name':'flat.spe','mimeType':'application/octet-stream','buffer':spe([100.]*1024)})
 page.wait_for_function("document.querySelector('#t-name').textContent.includes('flat.spe')")
 page.locator('#fwhm').fill('4.8')
 page.locator('#run').click()
 page.wait_for_function("!document.querySelector('#results').hidden",timeout=30000)
 assert page.locator('#result-body tr.failed-bin').count()==3
 assert page.locator('#run-errors li').count()==3
 assert page.locator('#spectra-list .failed-bin').count()==3
 assert '0 succeeded, 3 failed' in page.locator('#status').inner_text()
 assert 'FWHM 4.8 px' in page.locator('#result-meta').inner_text()
 page.screenshot(path=str(output/'all-failed.png'),full_page=True)
 page.locator('#n1').fill('474');assert page.locator('#results').evaluate('(el)=>el.hidden')
 page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(output/'mobile.png'),full_page=True)
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 assert not errors, errors
 print('PASS zero defaults, English UI, select-all, overlays, zoom/pan/reset, four-file export, cancel, real mixed-success Python fit, preserved missing bins, FWHM, error exports, all-failed rerun, invalidation, mobile layout',flush=True)
 browser.close()
