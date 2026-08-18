-- Rode no SQL Editor do Supabase QUANDO for lançar o Banco de Talentos (não antes)

create table banco_curriculos (
  id uuid default gen_random_uuid() primary key,
  nome text not null,
  telefone text not null,
  email text,
  cidade text,
  objetivo text,
  experiencia text,
  formacao text,
  habilidades text,
  created_at timestamp default now()
);

alter table banco_curriculos enable row level security;

-- Qualquer pessoa pode enviar o próprio currículo pro banco
create policy "Qualquer um pode enviar curriculo" on banco_curriculos
  for insert with check (true);

-- Só empresas com Pacote Completo ativo conseguem CONSULTAR o banco
create policy "Empresas com pacote completo veem o banco" on banco_curriculos
  for select using (
    exists (
      select 1 from profissionais
      where user_id = auth.uid()
      and plano = 'completo'
      and status_pagamento = 'ativo'
    )
  );

-- Trava de segurança: exige login pra enviar currículo, e só o dono edita/exclui o próprio
alter table banco_curriculos add column if not exists user_id uuid references auth.users(id);

drop policy if exists "Qualquer um pode enviar curriculo" on banco_curriculos;

create policy "Usuario logado envia o proprio curriculo" on banco_curriculos
  for insert with check (auth.uid() = user_id);

create policy "Dono edita o proprio curriculo" on banco_curriculos
  for update using (auth.uid() = user_id);

create policy "Dono exclui o proprio curriculo" on banco_curriculos
  for delete using (auth.uid() = user_id);

create policy "Dono ve o proprio curriculo mesmo sem ser empresa" on banco_curriculos
  for select using (auth.uid() = user_id);