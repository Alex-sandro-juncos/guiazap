-- Rode no SQL Editor do Supabase
-- Impede que qualquer usuário (mesmo mandando requisições diretas, pulando o site)
-- consiga marcar o próprio cadastro como "ativo" sem passar pelo pagamento de verdade.
-- Só o webhook do Mercado Pago (que usa a chave secreta/service_role) pode ativar.

create or replace function protect_status_pagamento()
returns trigger as $$
begin
  if auth.role() <> 'service_role' then
    if TG_OP = 'INSERT' then
      NEW.status_pagamento := 'pendente';
    elsif TG_OP = 'UPDATE' then
      NEW.status_pagamento := OLD.status_pagamento;
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_protect_status_pagamento on profissionais;

create trigger trg_protect_status_pagamento
before insert or update on profissionais
for each row execute function protect_status_pagamento();