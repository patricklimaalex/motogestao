const http = require('http');
const fs = require('fs');

const locacoes = [
    // Page 3
    { placa: 'THS8J86', renavam: '01469605071' },
    { placa: 'THV7H56', renavam: '01469296346' },
    { placa: 'THO7B56', renavam: '01469290879' },
    { placa: 'THS7H76', renavam: '01469269187' },
    { placa: 'THP5J26', renavam: '01469292235' },
    { placa: 'THT1F26', renavam: '01469605136' },
    { placa: 'THT3F56', renavam: '01466310550' },
    { placa: 'THNOD46', renavam: '01466309196' },
    { placa: 'THX5H16', renavam: '01469295153' },
    { placa: 'THZ5I86', renavam: '01469547730' },
    { placa: 'TIAOF36', renavam: '01469297911' },
    { placa: 'THN1E86', renavam: '01466309838' },
    // Page 4
    { placa: 'THV5C16', renavam: '01469297270' },
    { placa: 'THQ6C56', renavam: '01469548752' },
    { placa: 'THN7E76', renavam: '01466310615' },
    { placa: 'TIJ5F26', renavam: '01469253485' },
    { placa: 'THQ8C26', renavam: '01469550277' },
    { placa: 'THQ7E96', renavam: '01469549678' },
    { placa: 'THT1H96', renavam: '01469270150' },
    { placa: 'THP1G96', renavam: '01469291603' },
    { placa: 'THV1H96', renavam: '01469296826' },
    { placa: 'TIL1G56', renavam: '01469551028' },
    { placa: 'THQ3E06', renavam: '01469289862' },
    { placa: 'TIJ7G26', renavam: '01469299507' }
];

const payload = JSON.stringify({ placas: locacoes });

const options = {
    hostname: 'localhost',
    port: 2222,
    path: '/multas/lote',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
    }
};

const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        try {
            const parsed = JSON.parse(data);
            fs.writeFileSync('resultado_lote_24.json', JSON.stringify(parsed, null, 2));
            console.log('Finalizado, salvo em resultado_lote_24.json');
        } catch (e) {
            fs.writeFileSync('resultado_lote_24.txt', data);
            console.log('Finalizado com erro no parser, salvo em txt');
        }
    });
});

req.write(payload);
req.end();
