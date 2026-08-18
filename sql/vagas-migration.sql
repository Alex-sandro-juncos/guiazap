-- Rode no SQL Editor do Supabase QUANDO for lançar o Contrata-se (não antes)

create table vagas (
  id uuid default gen_random_uuid() primary key,
  profissional_id uuid references profissionais(id) on delete cascade not null,
  titulo text not null,
  descricao text,
  requisitos text,
  tipo text default 'CLT',
  salario text,
  ativa boolean default true,
  created_at timestamp default now()
);

alter table vagas enable row level security;

create policy "Leitura publica de vagas" on vagas
  for select using (true);

create policy "Qualquer empresa ativa pode publicar vaga" on vagas
  for insert with check (
    exists (
      select 1 from profissionais
      where id = profissional_id
      and user_id = auth.uid()
      and status_pagamento = 'ativo'
    )
  );

create policy "Dono edita a propria vaga" on vagas
  for update using (
    exists (select 1 from profissionais where id = profissional_id and user_id = auth.uid())
  );

create policy "Dono exclui a propria vaga" on vagas
  for delete using (
    exists (select 1 from profissionais where id = profissional_id and user_id = auth.uid())
  );

-- Candidaturas recebidas (pra empresa ver quem se candidatou, além do WhatsApp)
create table candidaturas (
  id uuid default gen_random_uuid() primary key,
  vaga_id uuid references vagas(id) on delete cascade not null,
  nome_candidato text not null,
  contato text not null,
  mensagem text,
  created_at timestamp default now()
);

alter table candidaturas enable row level security;

create policy "Qualquer um pode se candidatar" on candidaturas
  for insert with check (true);

create policy "Dono da vaga ve as candidaturas" on candidaturas
  for select using (
    exists (
      select 1 from vagas
      join profissionais on profissionais.id = vagas.profissional_id
      where vagas.id = vaga_id
      and profissionais.user_id = auth.uid()
    )
  );