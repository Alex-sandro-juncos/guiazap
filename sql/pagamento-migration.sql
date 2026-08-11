-- Rode no SQL Editor do Supabase

alter table profissionais add column if not exists status_pagamento text default 'pendente';

-- Cadastros antigos de teste continuam visíveis (marcados como ativo manualmente).
-- Novos cadastros nascem como 'pendente' até você confirmar o pagamento.