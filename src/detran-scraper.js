'use strict';
const puppeteer = require('puppeteer');

async function consultarDetranCE_Puppeteer(placa, renavam) {
    const pup = puppeteer;
    if (!pup) throw new Error('puppeteer não instalado — execute: cd ~/motos && npm install puppeteer');

    const log = (msg) => console.log(msg);
    log(`  → [Puppeteer] iniciando consulta Angular — placa=${placa}`);

    // Helper: digitar como humano (Angular reactive forms precisam de keyboard events)
    async function typeAngular(page, selector, value) {
        await page.focus(selector);
        await page.evaluate((sel, val) => {
            const el = document.querySelector(sel);
            if (!el) return;
            el.value = '';
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(el, val);
            ['input', 'change', 'keyup', 'blur'].forEach(ev =>
                el.dispatchEvent(new Event(ev, { bubbles: true })));
        }, selector, value);
        // Também digita via teclado para garantir detecção pelo Angular
        await page.click(selector, { clickCount: 3 });
        await page.type(selector, value, { delay: 30 });
    }

    // Helper: aguardar Angular carregar completamente
    async function waitAngular(page, timeout = 15000) {
        try {
            await page.waitForFunction(() => {
                // Angular 2+ expõe getAllAngularRootElements quando bootstrapped
                if (typeof window.getAllAngularRootElements === 'function') {
                    const roots = window.getAllAngularRootElements();
                    return roots.length > 0;
                }
                // Fallback: verificar se o DOM tem conteúdo Angular (atributos ng-)
                return document.querySelectorAll('[_nghost-]').length > 0 ||
                    document.querySelectorAll('[ng-version]').length > 0 ||
                    document.querySelectorAll('router-outlet').length > 0;
            }, { timeout });
            log(`  → [Puppeteer] Angular detectado ✅`);
        } catch (e) {
            log(`  ⚠️  [Puppeteer] Angular não detectado (${e.message}) — continuando`);
        }
    }

    // Helper: aguardar input aparecer com múltiplos seletores
    async function waitInput(page, timeout = 20000) {
        const selectors = [
            'input.mat-input-element',
            'input[formcontrolname]',
            'input[matinput]',
            'mat-form-field input',
            'input[id*="placa"]',
            'input[name*="placa"]',
            'input[placeholder*="laca"]',
            'input[placeholder*="Placa"]',
            'input:not([type="hidden"]):not([type="search"]):not([type="email"])',
            'input',
        ];
        for (const sel of selectors) {
            try {
                await page.waitForSelector(sel, { timeout: timeout / selectors.length, visible: true });
                const count = await page.$$eval(sel, els => els.filter(e => !e.hidden && e.offsetParent !== null).length);
                if (count > 0) { log(`  → [Puppeteer] input encontrado: ${sel} (${count} visíveis)`); return sel; }
            } catch (e) { /* próximo */ }
        }
        throw new Error('Nenhum input visível encontrado após aguardar Angular');
    }

    const browser = await pup.launch({
        headless: 'new',
        args: [
            '--no-sandbox', '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', '--disable-gpu',
            '--disable-web-security',
            '--window-size=1366,768',
        ],
        timeout: 30000,
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 768 });
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        page.setDefaultTimeout(30000);

        // Interceptar console do browser para debug
        page.on('console', msg => {
            if (msg.type() === 'error') log(`  [Browser Error] ${msg.text().substring(0, 100)}`);
        });

        // ── 1. Carregar portal base
        log(`  → [Puppeteer] carregando portal central...`);
        await page.goto('https://sistemas.detran.ce.gov.br/central', {
            waitUntil: 'domcontentloaded', timeout: 30000,
        });
        await waitAngular(page, 12000);

        // Pausa extra para Angular router completar
        await new Promise(r => setTimeout(r, 2000));

        // ── 2. Navegar para Taxas/Multas
        // Angular usa hash routing (#/) ou HTML5 routing — tentar ambos
        const multasRoutes = [
            // Hash routing (mais comum em Angular antigo)
            { url: 'https://sistemas.detran.ce.gov.br/central/#/veiculos/taxas_multas', tipo: 'hash' },
            { url: 'https://sistemas.detran.ce.gov.br/central/#/veiculos/taxas-multas', tipo: 'hash' },
            { url: 'https://sistemas.detran.ce.gov.br/central/#/veiculo/taxas_multas', tipo: 'hash' },
            // HTML5 routing
            { url: 'https://sistemas.detran.ce.gov.br/central/veiculos/taxas_multas', tipo: 'html5' },
            { url: 'https://sistemas.detran.ce.gov.br/central/veiculos/taxas-multas', tipo: 'html5' },
            // Página de veículos geral
            { url: 'https://sistemas.detran.ce.gov.br/central/#/veiculo', tipo: 'hash' },
        ];

        let achouInput = false;
        let inputSel = 'input';

        for (const rota of multasRoutes) {
            try {
                log(`  → [Puppeteer] tentando: ${rota.url}`);
                await page.goto(rota.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
                await waitAngular(page, 5000);
                await new Promise(r => setTimeout(r, 2500));

                // Forçar clique no menu lateral se os inputs estiverem escondidos (novo comportamento do DETRAN-CE)
                await page.evaluate(() => {
                    const mnu = document.getElementById('taxas_multas');
                    if (mnu) mnu.click();
                });
                await new Promise(r => setTimeout(r, 1500));

                // Verificar se há formulário/input relevante
                const temInput = await page.evaluate(() => {
                    const inputs = document.querySelectorAll('input:not([type="hidden"])');
                    const bodyTxt = (document.body?.innerText || '').toLowerCase();
                    const temPlacaForm = bodyTxt.includes('placa') || bodyTxt.includes('renavam');
                    return {
                        count: inputs.length, temPlacaForm,
                        bodyFragment: bodyTxt.substring(0, 200)
                    };
                });
                log(`  → [Puppeteer] URL ${rota.url}: ${temInput.count} inputs, placa/renavam=${temInput.temPlacaForm}`);

                if (temInput.count > 0 && temInput.temPlacaForm) {
                    try {
                        inputSel = await waitInput(page, 8000);
                        achouInput = true;
                        log(`  ✅ [Puppeteer] formulário encontrado em ${rota.url}`);
                        break;
                    } catch (e) { log(`  ⚠️  [Puppeteer] input não visível ainda: ${e.message}`); }
                }
            } catch (e) {
                log(`  ⚠️  [Puppeteer] ${rota.url}: ${e.message}`);
            }
        }

        // ── 3. Se URL direta falhou → navegar pelo menu da página
        if (!achouInput) {
            log(`  → [Puppeteer] nenhuma URL direta funcionou — tentando menu clicável`);

            await page.goto('https://sistemas.detran.ce.gov.br/central', {
                waitUntil: 'domcontentloaded', timeout: 25000,
            });
            await waitAngular(page, 10000);
            await new Promise(r => setTimeout(r, 3000));

            // Capturar snapshot da página para diagnóstico
            const snapshot = await page.evaluate(() => ({
                url: window.location.href,
                title: document.title,
                links: Array.from(document.querySelectorAll('a[href]')).slice(0, 20).map(a => ({
                    text: a.textContent.trim().substring(0, 40),
                    href: a.getAttribute('href')
                })),
                navItems: Array.from(document.querySelectorAll('nav a, mat-nav-list a, .sidebar a, [routerlink]')).slice(0, 20).map(el => ({
                    text: el.textContent.trim().substring(0, 40),
                    href: el.getAttribute('href') || el.getAttribute('routerlink')
                })),
                menuTexts: Array.from(document.querySelectorAll('li, a, button, mat-list-item')).slice(0, 50).map(el => el.textContent.trim().substring(0, 30)).filter(t => t.length > 2),
            }));
            log(`  → [Puppeteer] página: "${snapshot.title}" | URL: ${snapshot.url}`);
            log(`  → [Puppeteer] itens de menu: ${JSON.stringify(snapshot.menuTexts.slice(0, 15))}`);

            // Procurar e clicar em item de menu relacionado a multas/taxas
            const clicou = await page.evaluate(() => {
                const termos = [/taxas.*multa|multas.*taxa/i, /multa/i, /taxa/i, /infra/i, /veiculo|veículo/i];
                const sels = ['a', 'button', 'mat-list-item', 'mat-nav-list a', 'li a', '[routerlink]', 'span'];
                for (const termo of termos) {
                    for (const sel of sels) {
                        const els = Array.from(document.querySelectorAll(sel));
                        for (const el of els) {
                            if (termo.test(el.textContent) && el.textContent.trim().length < 60) {
                                el.click();
                                return { ok: true, clicou: el.textContent.trim().substring(0, 40) };
                            }
                        }
                    }
                }
                return { ok: false };
            });

            log(`  → [Puppeteer] menu click: ${JSON.stringify(clicou)}`);
            if (clicou.ok) {
                await new Promise(r => setTimeout(r, 4000));
                await waitAngular(page, 8000);
                try {
                    inputSel = await waitInput(page, 10000);
                    achouInput = true;
                } catch (e) {
                    log(`  ⚠️  [Puppeteer] após click menu: ${e.message}`);
                }
            }
        }

        // ── 4. Preencher formulário
        if (!achouInput) {
            // Última tentativa: verificar se há qualquer input na página agora
            const anyInput = await page.evaluate(() => {
                const inputs = document.querySelectorAll('input:not([type="hidden"])');
                return {
                    count: inputs.length, url: window.location.href,
                    html: document.body.innerHTML.substring(0, 500)
                };
            });
            throw new Error(`Formulário DETRAN CE não encontrado. URL: ${anyInput.url} | Inputs: ${anyInput.count} | HTML: ${anyInput.html.substring(0, 200)}`);
        }

        log(`  → [Puppeteer] preenchendo formulário placa=${placa} usando seletor "${inputSel}"`);

        // Obter todos os inputs visíveis e preencher
        const preencheu = await page.evaluate((placa, renavam) => {
            // Seletores em ordem de prioridade para Angular Material
            const sels = [
                'input.mat-input-element',
                'input[formcontrolname]',
                'input[matinput]',
                'input:not([type="hidden"]):not([type="search"]):not([type="email"]):not([type="checkbox"]):not([type="radio"])',
            ];

            const setAngularInput = (el, val) => {
                el.focus();
                // Método 1: Native setter (React/Angular)
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(el, val);
                // Disparar todos os eventos que Angular escuta
                ['focus', 'click', 'input', 'keydown', 'keypress', 'keyup', 'change', 'blur'].forEach(ev =>
                    el.dispatchEvent(new Event(ev, { bubbles: true, cancelable: true })));
                return el.value;
            };

            let allInputs = [];
            for (const sel of sels) {
                const found = Array.from(document.querySelectorAll(sel))
                    .filter(el => !el.hidden && el.offsetParent !== null && el.type !== 'hidden');
                if (found.length > 0) { allInputs = found; break; }
            }

            if (!allInputs.length) return { ok: false, erro: 'Nenhum input visível na página', count: 0 };

            let placaInput = null, renavamInput = null;

            // Estratégia 1: por atributos diretos (formcontrolname, placeholder, name, id)
            for (const inp of allInputs) {
                const fc = (inp.getAttribute('formcontrolname') || '').toLowerCase();
                const ph = (inp.placeholder || '').toLowerCase();
                const nm = (inp.name || '').toLowerCase();
                const id = (inp.id || '').toLowerCase();
                const all = fc + ' ' + ph + ' ' + nm + ' ' + id;
                if (!placaInput && /placa/.test(all)) placaInput = inp;
                if (!renavamInput && /renavam/.test(all)) renavamInput = inp;
            }

            // Estratégia 2: por label associada
            if (!placaInput || !renavamInput) {
                const labels = Array.from(document.querySelectorAll('label, mat-label'));
                for (const lbl of labels) {
                    const txt = (lbl.textContent || '').toLowerCase();
                    const forId = lbl.getAttribute('for');
                    const inp = forId ? document.getElementById(forId)
                        : lbl.closest('mat-form-field')?.querySelector('input')
                        || lbl.parentElement?.querySelector('input');
                    if (!inp) continue;
                    if (!placaInput && /placa/.test(txt)) placaInput = inp;
                    if (!renavamInput && /renavam/.test(txt)) renavamInput = inp;
                }
            }

            // Estratégia 3: por mat-form-field com hint ou label interna
            if (!placaInput || !renavamInput) {
                const fields = Array.from(document.querySelectorAll('mat-form-field'));
                for (const field of fields) {
                    const txt = (field.textContent || '').toLowerCase();
                    const inp = field.querySelector('input');
                    if (!inp) continue;
                    if (!placaInput && /placa/.test(txt)) placaInput = inp;
                    if (!renavamInput && /renavam/.test(txt)) renavamInput = inp;
                }
            }

            // Estratégia 4: por ordem (primeiro=placa, segundo=renavam)
            if (!placaInput && allInputs.length >= 1) placaInput = allInputs[0];
            if (!renavamInput && allInputs.length >= 2) renavamInput = allInputs[1];

            if (!placaInput) return { ok: false, erro: 'Campo placa não encontrado', count: allInputs.length };

            const r1 = setAngularInput(placaInput, placa);
            let r2 = null;
            if (renavamInput && renavam) r2 = setAngularInput(renavamInput, renavam);

            return {
                ok: true,
                placaVal: r1,
                renavamVal: r2,
                placaSel: (placaInput.formControlName || placaInput.id || placaInput.placeholder || '').substring(0, 30),
                inputCount: allInputs.length
            };
        }, placa.toUpperCase(), renavam || '');

        if (!preencheu.ok) throw new Error(preencheu.erro || `Formulário não preenchido (${preencheu.count} inputs)`);
        log(`  → [Puppeteer] preenchido: placa="${preencheu.placaVal}" renavam="${preencheu.renavamVal}" (${preencheu.inputCount} inputs)`);

        // Aguardar Angular processar os valores
        await new Promise(r => setTimeout(r, 1500));

        // ── 5. Clicar Consultar
        log(`  → [Puppeteer] clicando Consultar...`);
        const clicouBtn = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll(
                'button, input[type="submit"], button[mat-flat-button], button[mat-raised-button], button[mat-button]'
            ));
            const submitBtns = btns.filter(btn => {
                const txt = (btn.textContent || btn.value || '').trim().toLowerCase();
                return /consultar|pesquisar|buscar|enviar|submit|ok|confirmar/i.test(txt);
            });
            if (submitBtns.length > 0) { submitBtns[0].click(); return { ok: true, btn: submitBtns[0].textContent.trim().substring(0, 30) }; }

            // Tentar qualquer botão não-cancelar, não-fechar
            const anyBtn = btns.find(btn => {
                const txt = (btn.textContent || '').trim().toLowerCase();
                return txt.length > 0 && !/cancel|fechar|limpar|sair|login|entrar|cadastr/i.test(txt) && btn.type !== 'reset';
            });
            if (anyBtn) { anyBtn.click(); return { ok: true, btn: anyBtn.textContent.trim().substring(0, 30) + ' (fallback)' }; }

            // Submit form
            const form = document.querySelector('form');
            if (form) { form.submit(); return { ok: true, btn: 'form.submit()' }; }
            return { ok: false };
        });

        if (!clicouBtn.ok) throw new Error('Botão Consultar não encontrado na página');
        log(`  → [Puppeteer] clicou: "${clicouBtn.btn}"`);

        // ── 6. Aguardar resultado
        log(`  → [Puppeteer] aguardando resultado...`);
        await new Promise(r => setTimeout(r, 3000));

        try {
            await page.waitForFunction(() => {
                const body = (document.body.innerText || '').toLowerCase();
                return /ait|auto\s+de\s+infr|não\s+possui|sem\s+multa|nenhuma\s+infr|sem\s+débit|débito|descri[cç]|r\$/i.test(body);
            }, { timeout: 25000 });
        } catch (e) {
            log(`  ⚠️  [Puppeteer] timeout resultado — coletando o que tem`);
        }

        // ── 7. Extrair dados
        const dadosExtraidos = await page.evaluate(() => {
            const result = { multas: [], semMulta: false, erro: null, _html_fragment: '' };
            const bodyTxt = document.body.innerText || '';
            result._html_fragment = document.body.innerHTML.substring(0, 1000);

            if (/não\s+possui|sem\s+multa|nenhuma\s+infr|sem\s+pend|sem\s+débit|sem\s+infr|veículo sem/i.test(bodyTxt))
                result.semMulta = true;
            if (/placa.*inv|renavam.*inv|veículo.*não\s*encontr|dados.*inválid|não\s+encontr/i.test(bodyTxt))
                result.erro = 'Placa/RENAVAM inválidos ou veículo não encontrado';

            // Extrair de tabelas
            const tables = Array.from(document.querySelectorAll('table, mat-table'));
            for (const tbl of tables) {
                const rows = Array.from(tbl.querySelectorAll('tr, mat-row'));
                if (rows.length < 2) continue;
                const headerRow = tbl.querySelector('thead tr, mat-header-row');
                const headers = headerRow
                    ? Array.from(headerRow.querySelectorAll('th, td, mat-header-cell')).map(c => c.textContent.trim().toLowerCase())
                    : Array.from(rows[0].querySelectorAll('th, td, mat-cell')).map(c => c.textContent.trim().toLowerCase());

                const hasAit = headers.some(h => /ait|auto|nº\s*proc/i.test(h));
                const hasVal = headers.some(h => /valor/i.test(h));
                if (!hasAit && !hasVal) continue;

                const ci = (...pats) => {
                    for (let i = 0; i < headers.length; i++)
                        for (const p of pats) if (new RegExp(p, 'i').test(headers[i])) return i;
                    return -1;
                };

                const dataRows = rows.filter(r => r !== (headerRow || rows[0]));
                for (const row of dataRows) {
                    const cells = Array.from(row.querySelectorAll('td, mat-cell')).map(c => c.textContent.trim());
                    if (!cells.length) continue;
                    const g = j => (j >= 0 && j < cells.length ? cells[j] : '');
                    const iAit = ci('ait', 'auto', 'nº\s*proc', 'proc');
                    const iDesc = ci('descr', 'motivo', 'infr', 'artigo', 'classific');
                    const iData = ci('data\s*infr', 'data\s*auto', 'data');
                    const iOrig = ci('original', 'r\$', 'valor');
                    const iPag = ci('pagar', 'cobr', 'atual', 'total');
                    const entry = {
                        ait: g(iAit), motivo: g(iDesc) || 'Infração de trânsito',
                        data_infracao: g(iData), valor_original: g(iOrig),
                        valor_a_pagar: g(iPag) || g(iOrig),
                    };
                    if (entry.ait || entry.valor_original) result.multas.push(entry);
                }
                if (result.multas.length) break;
            }

            // Fallback: mat-card ou divs com dados de multa
            if (!result.multas.length && !result.semMulta) {
                const cards = Array.from(document.querySelectorAll('mat-card, .multa-item, .infraction-card'));
                for (const card of cards) {
                    const txt = card.innerText || '';
                    const ait = txt.match(/AIT[:\s]*([A-Z0-9-]+)/i)?.[1];
                    const valor = txt.match(/R\$\s*([\d.,]+)/)?.[0];
                    const motivo = txt.match(/artigo[:\s]*(.{5,60})/i)?.[1] || txt.substring(0, 60);
                    if (ait || valor) result.multas.push({ ait: ait || '', motivo, valor_a_pagar: valor || '' });
                }
            }

            // Fallback: detecção direta de texto "O veículo possui X multas"
            if (!result.multas.length && !result.semMulta) {
                const matchQtd = bodyTxt.match(/o\s*ve[íi]culo\s*possui\s+(\d+)\s*multa/i);
                if (matchQtd) {
                    const qtd = parseInt(matchQtd[1], 10);
                    if (qtd === 0) {
                        result.semMulta = true;
                    } else {
                        for (let i = 0; i < qtd; i++) {
                            result.multas.push({ ait: `AIT-PENDENTE-${i + 1}`, motivo: 'Infração de trânsito DETRAN-CE', valor_a_pagar: 'Pendente' });
                        }
                    }
                }
            }

            // Fallback final: regex no texto
            if (!result.multas.length && !result.semMulta) {
                const vals = bodyTxt.match(/R\$\s*[\d.,]+/g) || [];
                const aits = bodyTxt.match(/ [A-Z]{2}\d{8,} | AIT[:\s]*[A-Z0-9-]+/gi) || [];
                if (vals.length) {
                    for (let i = 0; i < Math.max(vals.length, aits.length, 1); i++) {
                        result.multas.push({
                            ait: (aits[i] || '').replace(/AIT[:\s]*/i, '').trim(),
                            motivo: 'Infração via texto bruto',
                            valor_a_pagar: (vals[i] || '').trim()
                        });
                    }
                }
            }
            return result;
        });

        log(`  → [Puppeteer] resultado: ${dadosExtraidos.multas.length} multa(s), semMulta=${dadosExtraidos.semMulta}`);
        if (dadosExtraidos.erro) log(`  ⚠️  [Puppeteer] erro: ${dadosExtraidos.erro}`);

        return dadosExtraidos;

    } finally {
        await browser.close();
    }
}

module.exports = { consultarDetranCE_Puppeteer };
