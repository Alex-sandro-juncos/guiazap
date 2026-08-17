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