"""Serve the site, then set CTS_TEST_URL to test the independent Y-range comparison."""
import os
import struct
from playwright.sync_api import sync_playwright


def spe(first, second):
    header = bytearray(4100)
    struct.pack_into('<H', header, 42, 1024)
    struct.pack_into('<H', header, 656, 3)
    struct.pack_into('<i', header, 1446, 2)
    struct.pack_into('<h', header, 108, 0)
    struct.pack_into('<f', header, 1992, 2.5)
    values = [value for frame in [first, second] for row in frame for value in [row]*1024]
    return bytes(header) + struct.pack('<6144f', *values)


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
                                args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1400, 'height': 1000})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(os.environ.get('CTS_TEST_URL', 'http://127.0.0.1:8000'))
    page.locator('#compare-rayleigh-range').click()
    assert 'SPE file is required' in page.locator('#status').inner_text()
    fixtures = dict(r=([20,30,5],[24,34,5]), b=([10,10,10],[10,10,10]),
                    r2=([15,30,10],[19,34,10]), b2=([10,10,10],[10,10,10]))
    for key, frames in fixtures.items():
        page.locator('#'+key+'-file').set_input_files(
            {'name': key+'.spe', 'mimeType': 'application/octet-stream', 'buffer': spe(*frames)})
        page.wait_for_function('(key)=>document.querySelectorAll("#"+key+"-frames input").length===2', arg=key)

    def compare(start, end, expected):
        page.locator('#y-from').fill(str(start))
        page.locator('#y-to').fill(str(end))
        assert page.locator('#rayleigh-range-comparison').is_hidden()
        page.locator('#compare-rayleigh-range').click()
        text = page.locator('#rayleigh-range-difference').inner_text()
        assert expected in text and f'Y [{start}, {end})' in text, text

    # Requires neither Apply nor Thomson nor other experimental settings.
    compare(0, 1, '66.67%')
    assert page.locator('#r-empty').is_visible()
    page.locator('#rayleigh-all').check()
    assert page.locator('#rayleigh-range-comparison').is_hidden()
    compare(0, 1, '52.63%')
    compare(1, 3, '0.00%')
    page.locator('#y-step').fill('13')
    assert page.locator('#rayleigh-range-comparison').is_visible()
    compare(2, 3, 'N/A')
    for start, end in [(-1,1),(0,4),(1,1),(2,1),(.5,2),('',2)]:
        page.locator('#y-from').fill(str(start))
        page.locator('#y-to').fill(str(end))
        page.locator('#compare-rayleigh-range').click()
        assert page.locator('#rayleigh-range-comparison').is_hidden()
        assert 'comparison y' in page.locator('#status').inner_text().lower()
    compare(0, 1, '52.63%')
    page.locator('#subtract').click()
    assert page.locator('#rayleigh-comparison').is_visible()
    assert '15.87%' in page.locator('#rayleigh-difference').inner_text()
    assert '52.63%' in page.locator('#rayleigh-range-difference').inner_text()
    page.locator('#r-frames input').nth(1).uncheck()
    assert page.locator('#rayleigh-comparison').is_hidden()
    assert page.locator('#rayleigh-range-comparison').is_hidden()
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    assert not errors, errors
    browser.close()
    print('PASS independent range comparison, frame averaging, clipping, bounds, step independence, Apply and mobile layout')
