const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('https://codepen.io/jh3y/pen/LYgjpYZ', { waitUntil: 'networkidle2' });
  
  // Wait for the editors
  await new Promise(r => setTimeout(r, 4000));
  
  const content = await page.evaluate(() => {
    // try to get the raw iframe source if it exists
    const iframe = document.querySelector('#result');
    if(iframe) {
        return {
           src: iframe.src || '',
           html: document.querySelector('#box-html') ? document.querySelector('#box-html').innerText : '',
           css: document.querySelector('#box-css') ? document.querySelector('#box-css').innerText : '',
           js: document.querySelector('#box-js') ? document.querySelector('#box-js').innerText : ''
        };
    }
    const els = document.querySelectorAll('.CodeMirror-code');
    return {
       html: els[0] ? els[0].innerText : '',
       css: els[1] ? els[1].innerText : '',
       js: els[2] ? els[2].innerText : ''
    };
  });
  
  require('fs').writeFileSync('cp_html.txt', content.html);
  require('fs').writeFileSync('cp_css.txt', content.css);
  require('fs').writeFileSync('cp_js.txt', content.js);
  
  await browser.close();
})();
