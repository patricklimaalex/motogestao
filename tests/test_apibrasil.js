const apibrasil = require('./apibrasil_multas.js');

(async () => {
    console.log('Testing APIBrasil...');
    apibrasil.setConfig('http://localhost:3333', 'multas-token');
    console.log('Status:', apibrasil.getStatus());

    const res = await apibrasil.consultarInfracoes('THN0D46', '');
    console.log('Result:', JSON.stringify(res, null, 2));
})();
