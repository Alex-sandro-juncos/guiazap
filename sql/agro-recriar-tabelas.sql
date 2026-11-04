-- ============================================================
-- Meu Agro — recria as tabelas, as regras de segurança (RLS) e o
-- bucket de documentos. Pode rodar mais de uma vez sem estragar nada
-- (usa "if not exists" e recria as policies).
-- Onde rodar: painel do Supabase -> SQL Editor -> colar tudo -> Run.
-- ============================================================

-- ---------- 1. Tabelas ----------

create table if not exists public.agro_propriedades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null default 'Minha Propriedade',
  area_hectares numeric,
  created_at timestamptz not null default now()
);

create table if not exists public.agro_safras (
  id uuid primary key default gen_random_uuid(),
  propriedade_id uuid not null references public.agro_propriedades(id) on delete cascade,
  nome text not null,
  cultura text,
  created_at timestamptz not null default now()
);

create table if not exists public.agro_talhoes (
  id uuid primary key default gen_random_uuid(),
  propriedade_id uuid not null references public.agro_propriedades(id) on delete cascade,
  nome text not null,
  area_hectares numeric,
  latitude double precision,
  longitude double precision,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.agro_lancamentos (
  id uuid primary key default gen_random_uuid(),
  propriedade_id uuid not null references public.agro_propriedades(id) on delete cascade,
  safra_id uuid references public.agro_safras(id) on delete set null,
  tipo text not null,
  descricao text,
  valor numeric not null default 0,
  categoria text,
  data date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.agro_producao (
  id uuid primary key default gen_random_uuid(),
  safra_id uuid not null references public.agro_safras(id) on delete cascade,
  cultura text,
  quantidade numeric,
  unidade text,
  created_at timestamptz not null default now()
);

create table if not exists public.agro_patrimonio (
  id uuid primary key default gen_random_uuid(),
  propriedade_id uuid not null references public.agro_propriedades(id) on delete cascade,
  tipo text,
  descricao text,
  valor_aquisicao numeric,
  data_aquisicao date,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.agro_documentos (
  id uuid primary key default gen_random_uuid(),
  propriedade_id uuid not null references public.agro_propriedades(id) on delete cascade,
  categoria text,
  nome text,
  url text,
  ano_referencia integer,
  created_at timestamptz not null default now()
);

-- Se alguma tabela já existia mas faltava coluna, isso completa (não mexe no que já tem).
alter table public.agro_propriedades add column if not exists area_hectares numeric;
alter table public.agro_talhoes add column if not exists latitude double precision;
alter table public.agro_talhoes add column if not exists longitude double precision;
alter table public.agro_talhoes add column if not exists ativo boolean not null default true;
alter table public.agro_patrimonio add column if not exists data_aquisicao date;
alter table public.agro_patrimonio add column if not exists ativo boolean not null default true;
alter table public.agro_documentos add column if not exists ano_referencia integer;

create index if not exists agro_propriedades_user_idx on public.agro_propriedades(user_id);
create index if not exists agro_safras_prop_idx on public.agro_safras(propriedade_id);
create index if not exists agro_talhoes_prop_idx on public.agro_talhoes(propriedade_id);
create index if not exists agro_lancamentos_prop_idx on public.agro_lancamentos(propriedade_id, data);
create index if not exists agro_lancamentos_safra_idx on public.agro_lancamentos(safra_id);
create index if not exists agro_producao_safra_idx on public.agro_producao(safra_id);
create index if not exists agro_patrimonio_prop_idx on public.agro_patrimonio(propriedade_id);
create index if not exists agro_documentos_prop_idx on public.agro_documentos(propriedade_id);

-- ---------- 2. Segurança (RLS): cada pessoa só enxerga o que é dela ----------

alter table public.agro_propriedades enable row level security;
alter table public.agro_safras enable row level security;
alter table public.agro_talhoes enable row level security;
alter table public.agro_lancamentos enable row level security;
alter table public.agro_producao enable row level security;
alter table public.agro_patrimonio enable row level security;
alter table public.agro_documentos enable row level security;

-- Propriedades: dono = user_id
drop policy if exists agro_prop_select on public.agro_propriedades;
drop policy if exists agro_prop_insert on public.agro_propriedades;
drop policy if exists agro_prop_update on public.agro_propriedades;
drop policy if exists agro_prop_delete on public.agro_propriedades;
create policy agro_prop_select on public.agro_propriedades for select to authenticated
  using (user_id = auth.uid());
create policy agro_prop_insert on public.agro_propriedades for insert to authenticated
  with check (user_id = auth.uid());
create policy agro_prop_update on public.agro_propriedades for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy agro_prop_delete on public.agro_propriedades for delete to authenticated
  using (user_id = auth.uid());

-- Tabelas filhas diretas da propriedade: safras, talhões, patrimônio, documentos
drop policy if exists agro_safras_dono on public.agro_safras;
create policy agro_safras_dono on public.agro_safras for all to authenticated
  using (exists (select 1 from public.agro_propriedades p where p.id = agro_safras.propriedade_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.agro_propriedades p where p.id = agro_safras.propriedade_id and p.user_id = auth.uid()));

drop policy if exists agro_talhoes_dono on public.agro_talhoes;
create policy agro_talhoes_dono on public.agro_talhoes for all to authenticated
  using (exists (select 1 from public.agro_propriedades p where p.id = agro_talhoes.propriedade_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.agro_propriedades p where p.id = agro_talhoes.propriedade_id and p.user_id = auth.uid()));

drop policy if exists agro_patrimonio_dono on public.agro_patrimonio;
create policy agro_patrimonio_dono on public.agro_patrimonio for all to authenticated
  using (exists (select 1 from public.agro_propriedades p where p.id = agro_patrimonio.propriedade_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.agro_propriedades p where p.id = agro_patrimonio.propriedade_id and p.user_id = auth.uid()));

drop policy if exists agro_documentos_dono on public.agro_documentos;
create policy agro_documentos_dono on public.agro_documentos for all to authenticated
  using (exists (select 1 from public.agro_propriedades p where p.id = agro_documentos.propriedade_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.agro_propriedades p where p.id = agro_documentos.propriedade_id and p.user_id = auth.uid()));

-- Lançamentos: dono da propriedade; e a safra (se tiver) tem que ser da MESMA propriedade
drop policy if exists agro_lancamentos_dono on public.agro_lancamentos;
create policy agro_lancamentos_dono on public.agro_lancamentos for all to authenticated
  using (exists (select 1 from public.agro_propriedades p where p.id = agro_lancamentos.propriedade_id and p.user_id = auth.uid()))
  with check (
    exists (select 1 from public.agro_propriedades p where p.id = agro_lancamentos.propriedade_id and p.user_id = auth.uid())
    and (agro_lancamentos.safra_id is null or exists (
      select 1 from public.agro_safras s where s.id = agro_lancamentos.safra_id and s.propriedade_id = agro_lancamentos.propriedade_id))
  );

-- Produção: dona da safra -> dona da propriedade
drop policy if exists agro_producao_dono on public.agro_producao;
create policy agro_producao_dono on public.agro_producao for all to authenticated
  using (exists (
    select 1 from public.agro_safras s join public.agro_propriedades p on p.id = s.propriedade_id
    where s.id = agro_producao.safra_id and p.user_id = auth.uid()))
  with check (exists (
    select 1 from public.agro_safras s join public.agro_propriedades p on p.id = s.propriedade_id
    where s.id = agro_producao.safra_id and p.user_id = auth.uid()));

-- Permissões básicas das tabelas (o RLS acima é quem limita de verdade)
grant select, insert, update, delete on
  public.agro_propriedades, public.agro_safras, public.agro_talhoes, public.agro_lancamentos,
  public.agro_producao, public.agro_patrimonio, public.agro_documentos
  to authenticated;
grant all on
  public.agro_propriedades, public.agro_safras, public.agro_talhoes, public.agro_lancamentos,
  public.agro_producao, public.agro_patrimonio, public.agro_documentos
  to service_role;

-- ---------- 3. Bucket privado dos documentos (notas, contratos, etc.) ----------
-- O caminho dos arquivos é  <id_da_propriedade>/<arquivo>, então a regra confere
-- se a primeira pasta é de uma propriedade que pertence a quem está logado.

insert into storage.buckets (id, name, public)
values ('documentos-agro', 'documentos-agro', false)
on conflict (id) do nothing;

drop policy if exists agro_docs_storage_select on storage.objects;
drop policy if exists agro_docs_storage_insert on storage.objects;
drop policy if exists agro_docs_storage_delete on storage.objects;

create policy agro_docs_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'documentos-agro' and exists (
    select 1 from public.agro_propriedades p
    where p.id::text = (storage.foldername(name))[1] and p.user_id = auth.uid()));

create policy agro_docs_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos-agro' and exists (
    select 1 from public.agro_propriedades p
    where p.id::text = (storage.foldername(name))[1] and p.user_id = auth.uid()));

create policy agro_docs_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documentos-agro' and exists (
    select 1 from public.agro_propriedades p
    where p.id::text = (storage.foldername(name))[1] and p.user_id = auth.uid()));

-- ---------- 4. Avisa o Supabase pra enxergar as tabelas novas ----------
notify pgrst, 'reload schema';