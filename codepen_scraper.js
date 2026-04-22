const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('https://codepen.io/jh3y/pen/LYgjpYZ?editors=1100', { waitUntil: 'networkidle2' });
  
  // wait for the editors to load
  await page.waitForTimeout(2000);
  
  const content = await page.evaluate(() => {
    // The editors are inside CodeMirror
    const els = document.querySelectorAll('.CodeMirror-code');
    return {
       html: els[0] ? els[0].innerText : '',
       css: els[1] ? els[1].innerText : '',
       js: els[2] ? els[2].innerText : ''
    };
  });
  
  console.log("HTML:", content.html.length);
  require('fs').writeFileSync('cp_html.txt', content.html);
  require('fs').writeFileSync('cp_css.txt', content.css);
  require('fs').writeFileSync('cp_js.txt', content.js);
  
  await browser.close();
})();
