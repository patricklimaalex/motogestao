/**
 * Extrai cert.pem + key.pem do arquivo .pfx do ICP-Brasil
 * Execute UMA VEZ: node extrair_cert.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PFX    = path.join(__dirname, 'ALEXCO TREINAMENTO Certificado2 e-CNPJ A1 2025-2026 Senha Al@57019.pfx');
const SENHA  = 'Al@57019';
const CONF   = path.join(__dirname, 'openssl_legacy.cnf');
const CERT   = path.join(__dirname, 'cert_alexco.pem');
const KEY    = path.join(__dirname, 'cert_alexco_key.pem');

// openssl.cnf com provider legacy ativado (necessário para certificados ICP-Brasil)
fs.writeFileSync(CONF, `
openssl_conf = openssl_init
[openssl_init]
providers = provider_sect
[provider_sect]
default = default_sect
legacy = legacy_sect
[default_sect]
activate = 1
[legacy_sect]
activate = 1
`);

const env = { ...process.env, OPENSSL_CONF: CONF };
const base = `openssl pkcs12 -in "${PFX}" -passin "pass:${SENHA}" -legacy`;

try {
  // Extrai certificado
  process.stdout.write('Extraindo certificado... ');
  const cert = execSync(`${base} -nokeys`, { env }).toString();
  fs.writeFileSync(CERT, cert);
  console.log('✅');

  // Extrai chave privada (sem senha)
  process.stdout.write('Extraindo chave privada... ');
  const key = execSync(`${base} -nocerts -nodes`, { env }).toString();
  fs.writeFileSync(KEY, key);
  console.log('✅');

  // Testa
  process.stdout.write('Testando no Node.js... ');
  const tls = require('tls');
  tls.createSecureContext({ cert, key });
  console.log('✅');

  // Limpa config temporária
  fs.unlinkSync(CONF);

  console.log('\n✅ Pronto! Arquivos gerados:');
  console.log('   cert_alexco.pem');
  console.log('   cert_alexco_key.pem');
  console.log('\nReinicie o servidor: node multas_server.js');

} catch(e) {
  console.log('❌', e.message);
  process.exit(1);
}
