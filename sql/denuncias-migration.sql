-- Rode no SQL Editor do Supabase

create table denuncias (
  id uuid default gen_random_uuid() primary key,
  profissional_id uuid references profissionais(id) on delete cascade not null,
  motivo text not null,
  descricao text,
  denunciante_email text,
  status text default 'pendente',
  created_at timestamp default now()
);

alter table denuncias enable row level security;

-- Qualquer um pode denunciar
create policy "Qualquer um pode denunciar" on denuncias
  for insert with check (true);

-- Só você (via service_role, no painel do Supabase) consegue ver as denúncias.
-- Não existe policy de "select" para usuários comuns de propósito -- assim ninguém
-- além de você (usando a chave secreta / painel do Supabase) consegue ler a lista.