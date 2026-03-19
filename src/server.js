/**
 * Servidor Multas — v9.0
 * DETRAN-CE: Puppeteer → sistemas.detran.ce.gov.br/central (novo portal SPA)
 *            Fallback HTTP → erenavam.detran.ce.gov.br (legado, pode estar offline)
 * SENATRAN: Portal gov.br + APIBRASIL: api-multas open-source
 */
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const pathMod = require('path');
const { URL } = require('url');
const { exec } = require('child_process');

// ── Scraping Engines ────────────────────────────────────────────────

const PORT = process.env.PORT || 30001;
const CACHE_TTL = 3600 * 1000;
const DELAY_LOTE = 3000;
const BASE_URL = 'https://sistemas.detran.ce.gov.br/central'; // novo portal SPA
const BASE_URL_LEGADO = 'https://erenavam.detran.ce.gov.br/getran/emissao.do'; // legado
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

const _cache = new Map();
const cacheGet = k => { const e = _cache.get(k); return (e && Date.now() - e.ts < CACHE_TTL) ? e.d : null; };
const cacheSet = (k, d) => _cache.set(k, { d, ts: Date.now() });
const cacheClear = () => _cache.clear();

let ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';

// ── Core: Consulta DETRAN-CE via Puppeteer (novo portal SPA) ─────────
// Portal: https://sistemas.detran.ce.gov.br/central → Taxas / Multas
// Fallback: erenavam.detran.ce.gov.br (antigo, pode timeout)
// ─────────────────────────────────────────────────────────────────────

// Lazy-load puppeteer para não quebrar se não instalado
let _puppeteer = null;
function getPuppeteer() {
  if (_puppeteer) return _puppeteer;
  try { _puppeteer = require('puppeteer'); return _puppeteer; } catch (e) { }
  try { _puppeteer = require('puppeteer-core'); return _puppeteer; } catch (e) { }
  return null;
}

// ── Puppeteer: novo portal sistemas.detran.ce.gov.br (Angular) ─────────
// Portal Angular Material — requer estratégias específicas para:
//  1. Aguardar Angular inicializar (não só networkidle)
//  2. Navegar via router Angular (#/ routes)
//  3. Usar seletores mat-input-element ou input.mat-input-element
//  4. Simular teclado para Angular reactive forms
async function consultarDetranCE_Puppeteer(placa, renavam) {
  const pup = getPuppeteer();
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
    log(`  → [Puppeteer] aguardando resultado do painel do veículo...`);
    await new Promise(r => setTimeout(r, 4000));

    try {
      await page.waitForFunction(() => {
        const bodyTxt = (document.body.innerText || '').toLowerCase();
        return /veículo possui \d+ multas?, clique|não possui multas|nada consta/i.test(bodyTxt);
      }, { timeout: 15000 });

      const clickBox = await page.evaluate(() => {
        const boxes = Array.from(document.querySelectorAll('*'));

        // Achar todos que tem a mensagem de multas
        const hasFinesBoxes = boxes.filter(b => {
          const t = (b.innerText || '').toLowerCase();
          return /possui \d+ multas?, clique aqui/i.test(t) || /veículo possui multas/i.test(t);
        });

        if (hasFinesBoxes.length > 0) {
          // Pegar o elemento com o texto mais curto (mais específico/profundo)
          const bestBox = hasFinesBoxes.reduce((a, b) => (a.innerText.length <= b.innerText.length ? a : b));
          bestBox.click();
          return { achou: true, txt: bestBox.innerText.substring(0, 50).trim().replace(/\n/g, ' ') };
        }

        // Verificar se diz que não tem multas
        const noFines = boxes.filter(b => {
          const t = (b.innerText || '').toLowerCase();
          return /não possui multas|nada consta/i.test(t);
        });
        if (noFines.length > 0) {
          const bestNoFines = noFines.reduce((a, b) => (a.innerText.length <= b.innerText.length ? a : b));
          return { achou: false, semMulta: true, txt: bestNoFines.innerText.substring(0, 50).trim().replace(/\n/g, ' ') };
        }
        return { achou: false };
      });

      if (clickBox.achou) {
        log(`  → [Puppeteer] Achou botão de multas: "${clickBox.txt}", clicando...`);
        await new Promise(r => setTimeout(r, 4000)); // aguardar tabela carregar
      } else if (clickBox.semMulta) {
        log(`  → [Puppeteer] Painel diz sem multas: "${clickBox.txt}"`);
        return { multas: [], semMulta: true, erro: null, _html_fragment: '' };
      }
    } catch (e) {
      log(`  ⚠️  [Puppeteer] erro aguardando painel do veículo: ${e.message}`);
    }

    log(`  → [Puppeteer] aguardando tabela final...`);
    await new Promise(r => setTimeout(r, 3000));

    try {
      await page.waitForFunction(() => {
        const body = (document.body.innerText || '').toLowerCase();
        return /ait|auto\s+de\s+infr|não\s+possui|sem\s+multa|nenhuma\s+infr|sem\s+débit|débito|descri[cç]|r\$/i.test(body);
      }, { timeout: 15000 });
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

// ── Orquestrador principal ────────────────────────────────────────────
async function consultarDetranCE(placa, renavam) {
  const key = `${placa}|${renavam || ''}`;
  const hit = cacheGet(key);
  if (hit) { console.log(`  📦 [cache] ${placa}`); return { ...hit, _cache: true }; }

  return new Promise(async (resolve) => {
    console.log(`\n  🔍 ${placa}${renavam ? ' / ' + renavam : ''}`);

    console.log(`  → [Puppeteer] Iniciando extração...`);
    try {
      const pupRes = await consultarDetranCE_Puppeteer(placa, renavam);
      if (pupRes.erro) throw new Error(pupRes.erro);

      const result = {
        placa, renavam: renavam || null,
        possui_multas: pupRes.multas.length > 0,
        quantidade_multas: pupRes.multas.length,
        detalhes_multas: pupRes.multas,
        erro: null,
        consultado_em: new Date().toISOString(),
        fonte: 'https://sistemas.detran.ce.gov.br/central via Puppeteer',
        _metodo: 'puppeteer',
      };
      cacheSet(key, result);
      return resolve(result);
    } catch (ePup) {
      console.log(`  ❌ Puppeteer falhou: ${ePup.message}`);
      resolve({
        placa, renavam: renavam || null,
        possui_multas: false, quantidade_multas: 0, detalhes_multas: [],
        erro: `Falha na extração de dados: ${ePup.message}`,
        consultado_em: new Date().toISOString(),
        _metodo: 'failed'
      });
    }
  });
}

// ── Servidor HTTP ──────────────────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function reply(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj, null, 2));
}
function readBody(req) {
  return new Promise((ok, fail) => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } });
    req.on('error', fail);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const path = u.pathname;
  const meth = req.method;
  console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${meth} ${path}`);

  // ── Servir arquivos estáticos da pasta public/ ──
  if (meth === 'GET') {
    const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
    const staticFile = path === '/' ? '/app.html' : path;
    const ext = pathMod.extname(staticFile);
    if (MIME[ext]) {
      const f = pathMod.join(__dirname, '..', 'public', staticFile);
      if (fs.existsSync(f)) { cors(res); res.writeHead(200, { 'Content-Type': MIME[ext] + '; charset=utf-8' }); return res.end(fs.readFileSync(f)); }
    }
  }

  if (path === '/status' && meth === 'GET')
    return reply(res, 200, {
      ok: true, versao: '9.1',
      detran_ce: {
        modo: getPuppeteer() ? 'Puppeteer → sistemas.detran.ce.gov.br/central' : 'sem puppeteer',
        puppeteer: !!getPuppeteer(),
        fallback_captcha: !!ANTHROPIC_KEY,
        ok: !!getPuppeteer() || !!ANTHROPIC_KEY,
      },
      cache_total: _cache.size, porta: PORT,
    });

  if (path === '/config' && meth === 'POST') {
    const b = await readBody(req);
    if (b.apiKey && b.apiKey.startsWith('sk-ant')) { ANTHROPIC_KEY = b.apiKey; console.log('  ✓ Chave API configurada'); }
    return reply(res, 200, { ok: true, captcha_solver: !!ANTHROPIC_KEY });
  }

  if (path === '/cache/clear' && meth === 'GET') {
    const n = _cache.size; cacheClear();
    return reply(res, 200, { ok: true, removidos: n });
  }

  if (path === '/consultar' && meth === 'GET') {
    const p = (u.searchParams.get('placa') || '').toUpperCase();
    if (!p) return reply(res, 400, { erro: 'placa obrigatória' });
    return reply(res, 200, await consultarDetranCE(p, u.searchParams.get('renavam') || ''));
  }

  if (path === '/multas/ce' && meth === 'POST') {
    const b = await readBody(req);
    const p = (b.placa || '').toUpperCase();
    if (!p) return reply(res, 400, { erro: '"placa" obrigatório' });
    return reply(res, 200, await consultarDetranCE(p, b.renavam, b.apiKey));
  }

  if (path === '/multas/lote' && meth === 'POST') {
    const b = await readBody(req);
    const placas = Array.isArray(b.placas) ? b.placas : [];
    if (!placas.length) return reply(res, 400, { erro: '"placas" obrigatório' });
    const ak = b.apiKey || ANTHROPIC_KEY;
    const resultados = [];
    for (let i = 0; i < placas.length; i++) {
      const item = typeof placas[i] === 'string' ? { placa: placas[i] } : placas[i];
      const placa = (item.placa || '').toUpperCase();
      if (!placa) continue;
      console.log(`  [lote] ${i + 1}/${placas.length} — ${placa}`);
      resultados.push(await consultarDetranCE(placa, item.renavam, ak));
      if (i < placas.length - 1) await sleep(DELAY_LOTE);
    }
    return reply(res, 200, {
      ok: true, total: resultados.length,
      com_multas: resultados.filter(r => r.possui_multas).length,
      sem_multas: resultados.filter(r => !r.possui_multas && !r.erro).length,
      erros: resultados.filter(r => r.erro).length,
      resultados,
    });
  }

  // ══════════════════════════════════════════════════════════════════
  //  SSE — GET /multas/lote/stream
  //  Transmite resultados em tempo real via Server-Sent Events
  //  ?placas=P1,P2,P3  &renavams=R1,R2,R3  &fonte=detran_ce
  //
  //  Eventos emitidos:
  //    inicio     { total, fonte }
  //    progresso  { idx, total, placa, pct }
  //    resultado  { idx, total, pct, placa, possui_multas, quantidade_multas, detalhes_multas, erro }
  //    log        { msg }   — logs internos do scraper
  //    concluido  { total, com_multas, sem_multas, erros, duracao_ms }
  // ══════════════════════════════════════════════════════════════════
  if (path === '/multas/lote/stream' && meth === 'GET') {
    const placasStr = u.searchParams.get('placas') || '';
    const fonte = (u.searchParams.get('fonte') || 'detran_ce').toLowerCase();
    const renavLst = (u.searchParams.get('renavams') || '').split(',');
    const placas = placasStr.split(',').map(p => p.trim().toUpperCase()).filter(Boolean);
    // API key pode vir por query param (GET) ou já estar setada via POST /config
    const qApiKey = u.searchParams.get('apiKey') || u.searchParams.get('apikey') || '';
    if (qApiKey && qApiKey.startsWith('sk-ant')) { ANTHROPIC_KEY = qApiKey; }

    if (!placas.length) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ erro: '?placas=P1,P2,... obrigatório' }));
    }

    cors(res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (evt, data) =>
      res.write(`event: ${evt}\ndata: ${JSON.stringify(data)}\n\n`);

    const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => clearInterval(keepAlive));

    const t0 = Date.now();
    let comMult = 0, semMult = 0, erros = 0;

    send('inicio', { total: placas.length, fonte });

    for (let i = 0; i < placas.length; i++) {
      const placa = placas[i];
      const renavam = (renavLst[i] || '').trim();
      const pct = Math.round((i + 1) / placas.length * 100);

      send('progresso', { idx: i + 1, total: placas.length, placa, pct });

      let res2;
      try {
        const logger = msg => send('log', { msg: String(msg).trim() });
        res2 = await consultarDetranCE(placa, renavam, ANTHROPIC_KEY);
      } catch (e) {
        res2 = {
          placa, renavam, possui_multas: false, quantidade_multas: 0,
          detalhes_multas: [], erro: e.message, consultado_em: new Date().toISOString()
        };
      }

      if (res2.erro) erros++;
      else if (res2.possui_multas) comMult++;
      else semMult++;

      // Save é feito pelo frontend via SSE resultado

      send('resultado', {
        idx: i + 1, total: placas.length, pct,
        placa: res2.placa,
        renavam: res2.renavam || renavam,
        fonte: res2.fonte || fonte,
        possui_multas: res2.possui_multas,
        quantidade_multas: res2.quantidade_multas,
        detalhes_multas: res2.detalhes_multas,
        erro: res2.erro,
        consultado_em: res2.consultado_em,
      });

      if (i < placas.length - 1) await sleep(DELAY_LOTE);
    }

    send('concluido', { total: placas.length, com_multas: comMult, sem_multas: semMult, erros, duracao_ms: Date.now() - t0 });
    clearInterval(keepAlive);
    res.end();
    return;
  }

  // POST /multas/auto is removed as well as it depends on SENATRAN

  return reply(res, 404, { erro: `${meth} ${path} não encontrado` });

}).listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║  Moto Gestão — Servidor Multas  v9.0                          ║
╠════════════════════════════════════════════════════════════════╣
║  DETRAN-CE  │ POST /multas/ce           {placa,renavam}       ║
║             │ POST /multas/lote         {placas:[...]}        ║
║             │ GET  /multas/lote/stream  ← SSE TEMPO REAL      ║
╚════════════════════════════════════════════════════════════════╝
DETRAN-CE : ${getPuppeteer() ? '✅ Puppeteer OK → sistemas.detran.ce.gov.br/central' : '⚠️  Puppeteer não instalado → cd ~/motos && npm install puppeteer'}
  Fallback : ${ANTHROPIC_KEY ? '✅ Claude Vision HTTP (legado)' : '⚠️  sem key API → POST /config {"apiKey":"sk-ant-..."}'}
Porta ${PORT} — aguardando...`);
}).on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`❌ Porta ${PORT} em uso.`);
  else console.error('Erro:', e.message);
  process.exit(1);
});
