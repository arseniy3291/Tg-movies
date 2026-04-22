const puppeteer = require('puppeteer-core');

(async () => {
    // try to connect to the subagent's chrome if it's running? No.
    // I can just try to run puppeteer-core using local Chrome!
    // Mac chrome path:
    const browser = await puppeteer.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: false // run visible bypassing simple bot checks?
    });
    const page = await browser.newPage();
    await page.goto('https://codepen.io/jh3y/pen/LYgjpYZ', {waitUntil: 'networkidle2'});
    await new Promise(r => setTimeout(r, 6000));
    
    // get text
    let data = await page.evaluate(() => {
        let els = document.querySelectorAll('.CodeMirror-code');
        return els.length ? els[0].innerText + "\n--CSS--\n" + els[1].innerText : "NOT FOUND";
    });
    
    require('fs').writeFileSync('pen_source.txt', data);
    console.log("Saved.");
    await browser.close();
})();
