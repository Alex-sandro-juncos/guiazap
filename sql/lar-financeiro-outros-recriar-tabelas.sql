-- ============================================================
-- Meu Lar + Financeiro + outras tabelas que o site usa e que NÃO
-- existiam no banco. Pode rodar mais de uma vez sem estragar nada.
-- Onde rodar: painel do Supabase -> SQL Editor -> colar tudo -> Run.
-- (Rode também o arquivo do Meu Agro, que é separado.)
-- ============================================================

-- =====================  MEU LAR  =====================

create table if not exists public.lar_lancamentos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tipo text not null,
  descricao text,
  valor numeric not null default 0,
  categoria text,
  data date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.lar_patrimonio (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tipo text,
  descricao text,
  valor_aquisicao numeric,
  data_aquisicao date,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.lar_patrimonio_valores_anuais (
  id uuid primary key default gen_random_uuid(),
  patrimonio_id uuid not null references public.lar_patrimonio(id) on delete cascade,
  ano integer not null,
  valor numeric,
  created_at timestamptz not null default now(),
  unique (patrimonio_id, ano)
);

create table if not exists public.lar_documentos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  categoria text,
  nome text,
  url text,
  ano_referencia integer,
  created_at timestamptz not null default now()
);

create index if not exists lar_lancamentos_user_idx on public.lar_lancamentos(user_id, data);
create index if not exists lar_patrimonio_user_idx on public.lar_patrimonio(user_id);
create index if not exists lar_patrimonio_val_idx on public.lar_patrimonio_valores_anuais(patrimonio_id);
create index if not exists lar_documentos_user_idx on public.lar_documentos(user_id);

alter table public.lar_lancamentos enable row level security;
alter table public.lar_patrimonio enable row level security;
alter table public.lar_patrimonio_valores_anuais enable row level security;
alter table public.lar_documentos enable row level security;

drop policy if exists lar_lancamentos_dono on public.lar_lancamentos;
create policy lar_lancamentos_dono on public.lar_lancamentos for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists lar_patrimonio_dono on public.lar_patrimonio;
create policy lar_patrimonio_dono on public.lar_patrimonio for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists lar_documentos_dono on public.lar_documentos;
create policy lar_documentos_dono on public.lar_documentos for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists lar_patrimonio_val_dono on public.lar_patrimonio_valores_anuais;
create policy lar_patrimonio_val_dono on public.lar_patrimonio_valores_anuais for all to authenticated
  using (exists (select 1 from public.lar_patrimonio b where b.id = lar_patrimonio_valores_anuais.patrimonio_id and b.user_id = auth.uid()))
  with check (exists (select 1 from public.lar_patrimonio b where b.id = lar_patrimonio_valores_anuais.patrimonio_id and b.user_id = auth.uid()));

grant select, insert, update, delete on
  public.lar_lancamentos, public.lar_patrimonio, public.lar_patrimonio_valores_anuais, public.lar_documentos
  to authenticated;
grant all on
  public.lar_lancamentos, public.lar_patrimonio, public.lar_patrimonio_valores_anuais, public.lar_documentos
  to service_role;

-- Bucket privado dos documentos do Lar. O caminho é  <id_do_usuario>/<arquivo>.
insert into storage.buckets (id, name, public)
values ('documentos-lar', 'documentos-lar', false)
on conflict (id) do nothing;

drop policy if exists lar_docs_storage_select on storage.objects;
drop policy if exists lar_docs_storage_insert on storage.objects;
drop policy if exists lar_docs_storage_delete on storage.objects;

create policy lar_docs_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'documentos-lar' and (storage.foldername(name))[1] = auth.uid()::text);
create policy lar_docs_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos-lar' and (storage.foldername(name))[1] = auth.uid()::text);
create policy lar_docs_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documentos-lar' and (storage.foldername(name))[1] = auth.uid()::text);

-- =====================  FINANCEIRO (da empresa)  =====================
-- Dono = quem é user_id da empresa (tabela profissionais).

create table if not exists public.financeiro_lancamentos (
  id uuid primary key default gen_random_uuid(),
  profissional_id uuid not null references public.profissionais(id) on delete cascade,
  tipo text not null,
  descricao text,
  valor numeric not null default 0,
  categoria text,
  data date not null default current_date,
  created_at timestamptz not null default now()
);

create index if not exists financeiro_lanc_prof_idx on public.financeiro_lancamentos(profissional_id, data);

alter table public.financeiro_lancamentos enable row level security;

drop policy if exists financeiro_lanc_dono on public.financeiro_lancamentos;
create policy financeiro_lanc_dono on public.financeiro_lancamentos for all to authenticated
  using (exists (select 1 from public.profissionais p where p.id = financeiro_lancamentos.profissional_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.profissionais p where p.id = financeiro_lancamentos.profissional_id and p.user_id = auth.uid()));

grant select, insert, update, delete on public.financeiro_lancamentos to authenticated;
grant all on public.financeiro_lancamentos to service_role;

-- =====================  NOTA FISCAL: token da empresa  =====================
-- A empresa grava/lê o próprio token pela tela (empresa.html).

create table if not exists public.profissionais_fiscal_config (
  profissional_id uuid primary key references public.profissionais(id) on delete cascade,
  nf_token text,
  updated_at timestamptz not null default now()
);

alter table public.profissionais_fiscal_config enable row level security;

drop policy if exists fiscal_config_dono on public.profissionais_fiscal_config;
create policy fiscal_config_dono on public.profissionais_fiscal_config for all to authenticated
  using (exists (select 1 from public.profissionais p where p.id = profissionais_fiscal_config.profissional_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.profissionais p where p.id = profissionais_fiscal_config.profissional_id and p.user_id = auth.uid()));

grant select, insert, update, delete on public.profissionais_fiscal_config to authenticated;
grant all on public.profissionais_fiscal_config to service_role;

-- =====================  TABELAS SÓ DO SERVIDOR  =====================
-- Só as funções do Netlify (chave de serviço) mexem nelas. RLS ligado e
-- NENHUMA policy = o site (navegador) não consegue ler nem escrever.

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_email text,
  acao text,
  tabela text,
  registro_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.broadcast_todos_registro (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists broadcast_todos_user_idx on public.broadcast_todos_registro(user_id, created_at);

create table if not exists public.links_ativacao (
  token uuid primary key default gen_random_uuid(),
  profissional_id uuid not null references public.profissionais(id) on delete cascade,
  usado boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.admin_audit_log enable row level security;
alter table public.broadcast_todos_registro enable row level security;
alter table public.links_ativacao enable row level security;

grant all on public.admin_audit_log, public.broadcast_todos_registro, public.links_ativacao to service_role;

-- Avisa o Supabase pra enxergar as tabelas novas
notify pgrst, 'reload schema';