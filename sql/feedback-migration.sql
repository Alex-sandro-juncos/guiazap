-- Rode no SQL Editor do Supabase

-- 1. Mensagens de visitante PRA UMA EMPRESA específica (reclamação ou sugestão) — só a empresa vê
create table mensagens_empresa (
  id uuid default gen_random_uuid() primary key,
  profissional_id uuid references profissionais(id) on delete cascade not null,
  tipo text not null check (tipo in ('reclamacao', 'sugestao')),
  mensagem text not null,
  remetente_email text,
  created_at timestamp default now()
);

alter table mensagens_empresa enable row level security;

create policy "Qualquer um pode mandar mensagem pra empresa" on mensagens_empresa
  for insert with check (true);

create policy "Dono ve as proprias mensagens" on mensagens_empresa
  for select using (
    exists (
      select 1 from profissionais
      where id = profissional_id
      and user_id = auth.uid()
    )
  );

-- 2. Feedback geral sobre o GUIAZAP (reclamação ou sugestão do site) — só o admin (você) vê,
-- direto pelo painel do Supabase. Não existe policy de select pública de propósito.
create table feedback_site (
  id uuid default gen_random_uuid() primary key,
  tipo text not null check (tipo in ('reclamacao', 'sugestao')),
  mensagem text not null,
  remetente_email text,
  created_at timestamp default now()
);

alter table feedback_site enable row level security;

create policy "Qualquer um pode mandar feedback do site" on feedback_site
  for insert with check (true);