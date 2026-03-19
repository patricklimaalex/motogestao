# MotoGestao

Sistema de gestao de frotas de motos com consulta automatizada de multas via DETRAN-CE.

## Funcionalidades

- Consulta automatizada de multas no DETRAN-CE via web scraping (Puppeteer)
- Consulta individual por placa/RENAVAM
- Consulta em lote com streaming em tempo real (SSE)
- Painel administrativo com login
- Integracao com Supabase (banco de dados e autenticacao)
- Integracao com Stripe (cobranca por moto ativa)
- Deploy via Docker/Easypanel ou VPS tradicional

## Estrutura do Projeto

```
motogestao/
├── public/                  # Frontend (HTML)
│   ├── app.html             # Aplicacao principal
│   ├── admin.html           # Painel administrativo
│   └── login.html           # Tela de login
├── src/                     # Backend
│   ├── server.js            # Servidor HTTP principal (porta 2222)
│   └── detran-scraper.js    # Modulo de scraping DETRAN-CE
├── supabase/                # Supabase Edge Functions
│   └── functions/
│       ├── create-checkout-session/  # Cria sessao Stripe Checkout
│       ├── manage-moto/              # Adiciona/remove motos
│       └── stripe-webhook/           # Webhook Stripe
├── database/                # Scripts SQL
│   ├── schema.sql           # Estrutura do banco
│   └── migrations.sql       # Migracoes
├── scripts/                 # Scripts de deploy
│   └── install-vps.sh       # Instalacao automatizada em VPS
├── tests/                   # Testes
├── .env.example             # Variaveis de ambiente (template)
├── Dockerfile               # Build Docker com Chrome/Puppeteer
└── package.json
```

## Requisitos

- Node.js 20+
- Google Chrome / Chromium (para Puppeteer)

## Instalacao Local

```bash
# Clonar o repositorio
git clone https://github.com/patricklimaalex/motogestao.git
cd motogestao

# Instalar dependencias
npm install

# Configurar variaveis de ambiente
cp .env.example .env
# Editar .env com suas chaves

# Iniciar o servidor
npm start
```

O servidor inicia na porta **2222**. Acesse `http://localhost:2222` para abrir a aplicacao.

## Deploy com Docker

```bash
docker build -t motogestao .
docker run -p 2222:2222 --env-file .env motogestao
```

## Deploy em VPS (Ubuntu/Debian)

```bash
chmod +x scripts/install-vps.sh
sudo ./scripts/install-vps.sh
```

O script instala Node.js, Chrome, Nginx (proxy reverso) e PM2 automaticamente.

## API Endpoints

| Metodo | Rota                  | Descricao                          |
|--------|-----------------------|------------------------------------|
| GET    | `/`                   | Aplicacao principal (app.html)     |
| GET    | `/status`             | Status do servidor                 |
| POST   | `/config`             | Configurar API key                 |
| GET    | `/consultar?placa=XX` | Consulta individual                |
| POST   | `/multas/ce`          | Consulta DETRAN-CE                 |
| POST   | `/multas/lote`        | Consulta em lote                   |
| GET    | `/multas/lote/stream` | Consulta em lote (SSE tempo real)  |
| GET    | `/cache/clear`        | Limpar cache                       |

## Tecnologias

- **Backend**: Node.js, HTTP nativo
- **Scraping**: Puppeteer + Chrome headless
- **Frontend**: HTML/CSS/JS (single-page)
- **Banco**: Supabase (PostgreSQL)
- **Pagamentos**: Stripe
- **Deploy**: Docker, PM2, Nginx

## Licenca

MIT
