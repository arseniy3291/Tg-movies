const puppeteer = require('puppeteer-core');

(async () => {
    const browser = await puppeteer.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true
    });
    const page = await browser.newPage();
    
    // HTML
    await page.goto('https://codepen.io/jh3y/pen/LYgjpYZ.html', {waitUntil: 'networkidle2'});
    const htmlSrc = await page.evaluate(() => document.body.innerText);
    require('fs').writeFileSync('bear_html.txt', htmlSrc);
    
    // CSS
    await page.goto('https://codepen.io/jh3y/pen/LYgjpYZ.css', {waitUntil: 'networkidle2'});
    const cssSrc = await page.evaluate(() => document.body.innerText);
    require('fs').writeFileSync('bear_css.txt', cssSrc);
    
    // JS
    await page.goto('https://codepen.io/jh3y/pen/LYgjpYZ.js', {waitUntil: 'networkidle2'});
    const jsSrc = await page.evaluate(() => document.body.innerText);
    require('fs').writeFileSync('bear_js.txt', jsSrc);
    
    console.log("DONE FETCHING RAW");
    await browser.close();
})();
