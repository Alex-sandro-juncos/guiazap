-- Rode no SQL Editor do Supabase QUANDO for lançar os pacotes (não antes)
alter table profissionais add column if not exists plano text default 'basico';

-- Trava de segurança: impede que o próprio usuário mude seu campo "plano" sozinho
-- (evita migrar pro Pacote Completo sem pagar a diferença). Só o webhook
-- (que roda com a chave secreta) consegue mudar isso de verdade.

create or replace function protect_plano()
returns trigger as $$
begin
  if auth.role() <> 'service_role' then
    NEW.plano := OLD.plano;
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_protect_plano on profissionais;

create trigger trg_protect_plano
before update on profissionais
for each row execute function protect_plano();

-- Contador de visualizações (para o dono ver estatísticas do próprio cadastro)
alter table profissionais add column if not exists visualizacoes integer default 0;

create or replace function incrementar_visualizacao(pid uuid)
returns void as $$
begin
  update profissionais set visualizacoes = visualizacoes + 1 where id = pid;
end;
$$ language plpgsql security definer;

grant execute on function incrementar_visualizacao(uuid) to anon, authenticated;

-- Links de ativação por e-mail (token único, a empresa clica e se auto-ativa)
create table links_ativacao (
  token uuid default gen_random_uuid() primary key,
  profissional_id uuid references profissionais(id) on delete cascade not null,
  usado boolean default false,
  created_at timestamp default now()
);

alter table links_ativacao enable row level security;
-- Sem nenhuma policy pública de propósito: só as Netlify Functions (com a chave secreta) mexem aqui.

-- Selo de verificado (confirmado manualmente pelo admin)
alter table profissionais add column if not exists verificado boolean default false;

-- Resposta da empresa à avaliação recebida
alter table avaliacoes add column if not exists resposta_empresa text;

create policy "Dono responde avaliacoes" on avaliacoes
  for update using (
    exists (select 1 from profissionais where id = profissional_id and user_id = auth.uid())
  );