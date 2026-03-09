-- Execute este script no painel SQL Editor do seu Supabase
-- Ele adicionará a coluna 'pago' para que o sistema consiga salvar o estado das multas

ALTER TABLE public.multas_detran 
ADD COLUMN IF NOT EXISTS pago boolean DEFAULT false;

-- Opcional: Se desejar limpar erros antigos ou resquícios de testes:
-- DELETE FROM public.multas_detran WHERE erro IS NOT NULL;
