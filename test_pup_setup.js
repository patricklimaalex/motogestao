const ms = require('./multas_server.js');
// We need to extract the function inside since it might not be exported, wait, let's do this:
const fs = require('fs');
let code = fs.readFileSync('multas_server.js', 'utf8');

// just evaluate the puppeteer function:
const match = code.match(/async function consultarDetranCE_Puppeteer.*?finally\s*\{\s*await browser\.close\(\);\s*\}/s);

if (match) {
    const funcCode = match[0];
    const evalCode = `
    const puppeteer = require('puppeteer');
    function getPuppeteer() { return puppeteer; }
    ${funcCode}
    
    (async () => {
      console.log("Starting Puppeteer test for THN0D46...");
      const res = await consultarDetranCE_Puppeteer("THN0D46", "");
      console.log(JSON.stringify(res, null, 2));
    })();
  `;
    fs.writeFileSync('test_pup.js', evalCode);
} else {
    console.log("Function not found");
}

