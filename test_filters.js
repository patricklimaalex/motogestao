const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ARTIFACT_DIR = '/Users/patrickalex/.gemini/antigravity/brain/8ff4e5f6-8dab-45b3-828c-159592f77c14';

async function testFilters() {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    console.log("-> Acessando MOTOS app.html");
    await page.goto('http://localhost:2222');

    // 1. Aguarda carregamento inicial
    await page.waitForTimeout(2000);

    // 2. Vai para a aba de Multas
    console.log("-> Clicando na aba de Multas DETRAN");
    await page.click('button:has-text("Multas DETRAN")');
    await page.waitForTimeout(1000);

    // 3. Injeta dados mockados no MULTAS.resultados para teste sem esperar scrap
    console.log("-> Injetando dados de teste em MULTAS.resultados");
    await page.evaluate(() => {
        // Simula duas motos, uma com multa de velocidade, outra com estacionamento
        window.MULTAS.resultados = [
            {
                placa: "ABC1D23",
                renavam: "000000001",
                possui_multas: true,
                quantidade_multas: 1,
                erro: null,
                consultado_em: new Date().toISOString(),
                detalhes_multas: [{ ait: "AT123", motivo: "Transitar em velocidade", vencimento: "10/10/2026", valor_original: "130,16", valor_a_pagar: "130,16" }]
            },
            {
                placa: "XYZ9W87",
                renavam: "000000002",
                possui_multas: true,
                quantidade_multas: 1,
                erro: null,
                consultado_em: new Date().toISOString(),
                detalhes_multas: [{ ait: "XY456", motivo: "Estacionar em local proibido", vencimento: "15/12/2026", valor_original: "195,23", valor_a_pagar: "195,23" }]
            }
        ];
        // Simula as locacoes para testar modelo e condutor
        window.STATE.locacoes = [
            { placa: "ABC1D23", modelo: "START", observacao: "Condutor João da Silva" },
            { placa: "XYZ9W87", modelo: "FACTOR", observacao: "Condutora Maria Oliveira" }
        ];
        // Força re-render para mostrar as multas injetadas
        window.render();
    });
    await page.waitForTimeout(1000);

    // Captura estado sem filtros
    console.log("-> Capturando screenshot sem filtros");
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'motos_multas_nofilter.png') });

    // 4. Testa filtro de Moto (Placa)
    console.log("-> Testando filtro de Moto: 'XYZ'");
    await page.fill('input[placeholder="🔍 Moto (Placa/Modelo)..."]', 'XYZ');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'motos_multas_filter_moto.png') });

    // Limpa filtro
    await page.click('button:has-text("Limpar")');
    await page.waitForTimeout(500);

    // 5. Testa filtro de Condutor
    console.log("-> Testando filtro de Condutor: 'João'");
    await page.fill('input[placeholder="👤 Condutor (Observação)..."]', 'João');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'motos_multas_filter_condutor.png') });

    // Limpa filtro
    await page.click('button:has-text("Limpar")');
    await page.waitForTimeout(500);

    // 6. Testa filtro de Tipo
    console.log("-> Testando filtro de Tipo: 'Estacionar'");
    await page.fill('input[placeholder="🚨 Tipo de Infração..."]', 'Estacionar');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'motos_multas_filter_tipo.png') });

    console.log("-> Testes de filtro concluidos! Verifica as imagens no diretorio de artifacts.");
    await browser.close();
}

testFilters().catch(console.error);
