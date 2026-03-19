const { chromium } = require('playwright');
const path = require('path');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.addInitScript(() => {
        window.localStorage.setItem('mg_anthropic_key', 'test_key_not_real');
    });

    const uri = 'file://' + path.resolve('/Users/patrickalex/MOTOS/app.html');
    console.log('Navigating to ' + uri);

    await page.goto(uri, { waitUntil: 'networkidle' });

    await page.waitForTimeout(4000);

    const dest = '/Users/patrickalex/.gemini/antigravity/brain/8ff4e5f6-8dab-45b3-828c-159592f77c14/dashboard_corporate_final.png';
    await page.screenshot({ path: dest, fullPage: true });
    console.log('Screenshot saved to ' + dest);

    await page.click('tr[onclick^="showDetail"]');
    await page.waitForTimeout(1000);
    const destModal = '/Users/patrickalex/.gemini/antigravity/brain/8ff4e5f6-8dab-45b3-828c-159592f77c14/modal_corporate_final.png';
    await page.screenshot({ path: destModal });
    console.log('Modal saved to ' + destModal);

    await browser.close();
})();
