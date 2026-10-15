"""Serve the site first, then run with CTS_TEST_URL pointing at that server."""
import os
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
                                args=['--no-sandbox'])
    page = browser.new_page()
    errors, stale_requests = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))

    def stale_script(route):
        stale_requests.append(route.request.url)
        route.fulfill(status=200, content_type='text/javascript', body=
                      "document.getElementById('comparison-single').addEventListener('change',()=>{});")

    # Simulate an older unversioned JS response left in the browser cache.
    page.route('**/script.js', stale_script)
    page.goto(os.environ.get('CTS_TEST_URL', 'http://127.0.0.1:8000'))
    assert '?v=' in page.locator('script[type=module]').get_attribute('src')
    page.locator('#run').click()
    assert 'First apply' in page.locator('#status').inner_text()
    page.locator('#subtract').click()
    assert 'SPE file is required' in page.locator('#status').inner_text()
    page.locator('#fwhm').fill('8')
    assert '8 px' in page.locator('#fwhm-display').inner_text()
    assert page.locator('#comparison-single').count() == 0
    assert not stale_requests, stale_requests
    assert not errors, errors
    browser.close()
    print('PASS stale JS bypassed; Apply, Run and input handlers initialize without removed Y controls')
