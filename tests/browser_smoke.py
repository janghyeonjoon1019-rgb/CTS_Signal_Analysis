"""Start the static server first; requires CPython scientific deps and Playwright.
Set CTS_BROWSER_SYSTEM_PROXY=1 only for proxy-managed cloud test runners.
"""
from playwright.sync_api import sync_playwright
from pathlib import Path
import json,struct,urllib.request,urllib.error,hashlib,time,sys,os
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
sys.path.insert(0,str(Path(__file__).resolve().parent))
from test_analysis import synthetic, OPTIONS
r,t=synthetic()
payload={'R':[row.tolist() for row in r],'T':[row.tolist() for row in t],'options':OPTIONS}
output=Path('test-results');output.mkdir(exist_ok=True)
def spe(row, second=None):
 header=bytearray(4100);struct.pack_into('<H',header,42,1024);struct.pack_into('<H',header,656,2);struct.pack_into('<i',header,1446,2);struct.pack_into('<h',header,108,0);struct.pack_into('<f',header,1992,2.5)
 return bytes(header)+struct.pack('<4096f',*(row*2+(row if second is None else second)*2))
fixtures={'r':spe([.25*v+7.5 for v in payload['R'][0]], [.75*v+7.5 for v in payload['R'][0]]),'b':spe([7.5]*1024),'r2':spe([1.5*v+30.25 for v in payload['R'][0]]),'b2':spe([30.25]*1024),'t':spe(payload['T'][0])}
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
 page.locator('#run').click();assert '먼저' in page.locator('#status').inner_text()
 page.locator('#r-file').set_input_files({'name':'bad.spe','mimeType':'application/octet-stream','buffer':b'bad'})
 page.wait_for_function("document.querySelector('#status').textContent.includes('헤더')")
 for key in ['r','b','r2','b2','t']:
  page.locator('#'+key+'-file').set_input_files({'name':key+'.spe','mimeType':'application/octet-stream','buffer':fixtures[key]})
  page.wait_for_function(f"document.querySelectorAll('#{key}-frames input').length===2")
 page.locator('#r-frames input').nth(1).check()
 page.locator('#subtract').click()
 page.locator('#b2-frames input').first.uncheck()
 page.locator('#run').click();assert '먼저' in page.locator('#status').inner_text()
 page.locator('#b2-frames input').first.check()
 page.locator('#subtract').click()
 page.locator('#y-to').fill('2');page.locator('#y-step').fill('2')
 page.locator('#ELT').fill('0');page.locator('#run').click();assert '양수' in page.locator('#status').inner_text();page.locator('#ELT').fill('1')
 with page.expect_download() as dl:page.locator('#export-signals').click()
 text=Path(dl.value.path()).read_text();assert len(text.strip().splitlines())==1024
 expected=payload['R'][0] if dl.value.suggested_filename=='R.txt' else payload['T'][0]
 assert max(abs(float(actual)-value) for actual,value in zip(text.strip().splitlines(),expected))<.001
 canvas=page.locator('#r-preview');rect=canvas.bounding_box()
 page.mouse.move(rect['x']+rect['width']*.5,rect['y']+rect['height']*.25)
 assert 'Intensity: ' in page.locator('#r-pixel').inner_text()
 pixel_text=page.locator('#r-pixel').inner_text()
 pixel_x=int(pixel_text.split('X: ')[1].split()[0])
 assert abs(float(pixel_text.split('Intensity: ')[1])-payload['R'][0][pixel_x])<.001
 page.locator('#run').click();page.locator('#cancel').click();assert '중단' in page.locator('#status').inner_text()
 page.locator('#run').click()
 print('Fitting started',flush=True)
 page.wait_for_function("!document.querySelector('#results').hidden || document.querySelector('#status').classList.contains('error')",timeout=600000)
 print('STATUS',page.locator('#status').inner_text(),flush=True)
 assert not page.locator('#results').evaluate('(el)=>el.hidden'), page.locator('#status').inner_text()
 assert page.locator('#result-body tr').count()==1
 cells=page.locator('#result-body tr td').all_text_contents();print('RESULT',cells,flush=True)
 assert abs(float(cells[2])-30)<2 and abs(float(cells[3])-15)<2 and cells[-1]=='수렴'
 page.screenshot(path=str(output/'results.png'),full_page=True)
 page.locator('#n1').fill('474');assert page.locator('#results').evaluate('(el)=>el.hidden')
 page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(output/'mobile.png'),full_page=True)
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 assert not errors, errors
 print('PASS browser upload, frames, subtraction, validation, export, cancel, real Python fit, results, invalidation, mobile layout',flush=True)
 browser.close()
