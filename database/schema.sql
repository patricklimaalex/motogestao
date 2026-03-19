-- ═══════════════════════════════════════════════════════════════
-- MOTO GESTÃO — Setup completo do banco de dados
-- Execute TUDO de uma vez no SQL Editor do Supabase
-- ═══════════════════════════════════════════════════════════════

-- 1. EXTENSÕES
-- ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. LIMPAR TABELAS ANTIGAS (se existirem com tipo errado)
-- ─────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS historico_status  CASCADE;
DROP TABLE IF EXISTS multas_detran     CASCADE;
DROP TABLE IF EXISTS custos            CASCADE;
DROP TABLE IF EXISTS notas_fiscais     CASCADE;
DROP TABLE IF EXISTS locacoes          CASCADE;
DROP TABLE IF EXISTS motos             CASCADE;
DROP TABLE IF EXISTS periodos          CASCADE;
DROP TABLE IF EXISTS empresas          CASCADE;

-- 3. CRIAR TABELAS (todas com UUID)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE empresas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        TEXT NOT NULL,
  cnpj        TEXT,
  arrendante  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE periodos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID REFERENCES empresas(id),
  ano             INTEGER NOT NULL,
  mes             INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  total_motos     INTEGER,
  total_repassar  NUMERIC(12,2) DEFAULT 0,
  total_liquido   NUMERIC(12,2) DEFAULT 0,
  observacoes     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(empresa_id, ano, mes)
);

CREATE TABLE motos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID REFERENCES empresas(id),
  placa       TEXT NOT NULL UNIQUE,
  renavam     TEXT,
  modelo      TEXT NOT NULL DEFAULT 'START',
  fabricacao  TEXT,
  modelo_ano  TEXT,
  ativo       BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE locacoes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo_id          UUID REFERENCES periodos(id) ON DELETE CASCADE,
  moto_id             UUID REFERENCES motos(id),
  placa               TEXT NOT NULL,
  modelo              TEXT NOT NULL DEFAULT 'START',
  fabricacao          TEXT,
  renavam             TEXT,
  semanas             INTEGER DEFAULT 0,
  valor_repassar      NUMERIC(12,2) DEFAULT 0,
  valor_preparacao    NUMERIC(12,2) DEFAULT 0,
  valor_distrato      NUMERIC(12,2) DEFAULT 0,
  valor_liquido       NUMERIC(12,2) DEFAULT 0,
  status              TEXT NOT NULL CHECK (status IN ('ativo','nova_locacao','distrato','sem_locacao','manutencao')),
  observacao          TEXT,
  especificacoes_preparacao TEXT,
  numero_nota         TEXT,
  data_nota           DATE,
  tem_distrato        BOOLEAN DEFAULT FALSE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE notas_fiscais (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo_id  UUID REFERENCES periodos(id),
  numero_nota TEXT NOT NULL,
  data_emissao DATE NOT NULL,
  valor_total  NUMERIC(12,2) DEFAULT 0,
  tipo         TEXT DEFAULT 'locacao',
  descricao    TEXT,
  arquivo_url  TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE custos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID REFERENCES empresas(id),
  periodo_id  UUID REFERENCES periodos(id),
  moto_id     UUID REFERENCES motos(id),
  placa       TEXT,
  categoria   TEXT NOT NULL,
  descricao   TEXT NOT NULL,
  valor       NUMERIC(12,2) NOT NULL,
  data_custo  DATE NOT NULL,
  numero_nota TEXT,
  fornecedor  TEXT,
  observacao  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE historico_status (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  moto_id         UUID REFERENCES motos(id),
  placa           TEXT NOT NULL,
  periodo_id      UUID REFERENCES periodos(id),
  status_anterior TEXT,
  status_novo     TEXT NOT NULL,
  observacao      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE multas_detran (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  placa         TEXT NOT NULL,
  renavam       TEXT,
  ait           TEXT,
  motivo        TEXT,
  data_infracao TEXT,
  vencimento    TEXT,
  valor_original TEXT,
  valor_a_pagar  TEXT,
  boleto_url    TEXT,
  possui_multas BOOLEAN DEFAULT FALSE,
  erro          TEXT,
  consultado_em TIMESTAMPTZ DEFAULT NOW()
);

-- 4. ÍNDICES
-- ─────────────────────────────────────────────────────────────
CREATE INDEX idx_locacoes_periodo ON locacoes(periodo_id);
CREATE INDEX idx_locacoes_placa   ON locacoes(placa);
CREATE INDEX idx_custos_periodo   ON custos(periodo_id);
CREATE INDEX idx_multas_placa     ON multas_detran(placa);
CREATE INDEX idx_motos_placa      ON motos(placa);

-- 5. RLS (Row Level Security) — DESABILITADO para acesso direto
-- ─────────────────────────────────────────────────────────────
ALTER TABLE empresas          DISABLE ROW LEVEL SECURITY;
ALTER TABLE periodos          DISABLE ROW LEVEL SECURITY;
ALTER TABLE motos             DISABLE ROW LEVEL SECURITY;
ALTER TABLE locacoes          DISABLE ROW LEVEL SECURITY;
ALTER TABLE notas_fiscais     DISABLE ROW LEVEL SECURITY;
ALTER TABLE custos            DISABLE ROW LEVEL SECURITY;
ALTER TABLE historico_status  DISABLE ROW LEVEL SECURITY;
ALTER TABLE multas_detran     DISABLE ROW LEVEL SECURITY;

-- 6. EMPRESA PADRÃO
-- ─────────────────────────────────────────────────────────────
INSERT INTO empresas (nome, arrendante) VALUES ('BAMA', 'ALEXCO');

-- 7. IMPORTAR 50 MOTOS COM RENAVAMS
-- ─────────────────────────────────────────────────────────────
INSERT INTO motos (placa, renavam, modelo, fabricacao, empresa_id) VALUES
('THN0D46', '01466309196', 'START', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THN1E86', '01466309838', 'START', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THN7E76', '01466310615', 'START', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THN8E65', '01450036519', 'FACTOR', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THO7B56', '01469290879', 'START', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THP1G96', '01469291603', 'START', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THP5J26', '01469292235', 'START', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THQ3E06', '01469289862', 'START', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THQ4J26', '01469270991', 'START', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THQ6C56', '01469548752', 'START', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THQ7E96', '01469549678', 'START', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THQ8C26', '01469550277', 'START', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THQ8I56', '01469613473', 'START', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THR2A46', '01469604938', 'START', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THR2B75', '01450037728', 'FACTOR', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THS7H76', '01469269187', 'START', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THS8J86', '01469605071', 'START', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THT1F26', '01469605136', 'START', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THT1H96', '01469270150', 'START', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THT2E86', '01466308165', 'START', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THT3F56', '01466310550', 'START', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THT4G65', '01449215499', 'START', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THT6E05', '01449216460', 'START', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THV1H96', '01469296826', 'START', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THV5C16', '01469297270', 'START', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THV7H56', '01469296346', 'START', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THX1J86', '01469293053', 'START', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THX3E76', '01469295765', 'START', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THX5H16', '01469295153', 'START', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THZ5I86', '01469547730', 'START', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('THZ8E16', '01469546229', 'START', '2022', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('TIA0F36', '01469297911', 'START', '2023', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('TIB2I06', '01466308556', 'START', '2023', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('TIB6J85', '01450040508', 'FACTOR', '2023', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('TIB9D46', '01466310526', 'START', '2023', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('TIC1J26', '01466307886', 'START', '2023', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('TIG6A96', '01466307053', 'START', '2023', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('TIH4D76', '01466306120', 'START', '2023', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('TII3E85', '01449270287', 'START', '2023', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('TII7D95', '01449272247', 'START', '2023', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('TIJ1D66', '01469265939', 'START', '2023', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('TIJ5F26', '01469253485', 'START', '2023', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('TIJ7G26', '01469299507', 'START', '2023', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('TIK3B65', '01450035385', 'FACTOR', '2023', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('TIK5G96', '01469552016', 'START', '2023', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('TIK7H16', '01469551559', 'START', '2023', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('TIL1G56', '01469551028', 'START', '2023', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('TIM5D85', '01450042721', 'FACTOR', '2023', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('TIN6F96', '01466307568', 'START', '2023', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1)),
('TIN6G15', '01447440223', 'START', '2023', (SELECT id FROM empresas WHERE nome = 'BAMA' LIMIT 1))
ON CONFLICT (placa) DO UPDATE SET renavam = EXCLUDED.renavam, modelo = EXCLUDED.modelo;

-- 8. VERIFICAR
-- ─────────────────────────────────────────────────────────────
SELECT 
  (SELECT COUNT(*) FROM empresas) AS empresas,
  (SELECT COUNT(*) FROM motos)    AS motos,
  (SELECT COUNT(*) FROM periodos) AS periodos;

-- Mostrar motos importadas:
SELECT placa, renavam, modelo, fabricacao FROM motos ORDER BY placa;
