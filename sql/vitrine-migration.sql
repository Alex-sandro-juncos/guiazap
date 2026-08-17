-- Rode no SQL Editor do Supabase QUANDO for lançar a Vitrine (não antes)

create table produtos (
  id uuid default gen_random_uuid() primary key,
  profissional_id uuid references profissionais(id) on delete cascade not null,
  nome text not null,
  descricao text,
  preco text,
  foto text,
  created_at timestamp default now()
);

alter table produtos enable row level security;

create policy "Leitura publica de produtos" on produtos
  for select using (true);

create policy "Insercao pelo dono do cadastro" on produtos
  for insert with check (
    exists (select 1 from profissionais where id = profissional_id and user_id = auth.uid())
  );

create policy "Atualizacao pelo dono do cadastro" on produtos
  for update using (
    exists (select 1 from profissionais where id = profissional_id and user_id = auth.uid())
  );

create policy "Exclusao pelo dono do cadastro" on produtos
  for delete using (
    exists (select 1 from profissionais where id = profissional_id and user_id = auth.uid())
  );

-- Reforço de segurança: só quem tem plano "completo" pode inserir produtos,
-- mesmo que alguém tente pular a interface e mandar direto pela API.
drop policy if exists "Insercao pelo dono do cadastro" on produtos;

create policy "Insercao pelo dono do cadastro com plano completo" on produtos
  for insert with check (
    exists (
      select 1 from profissionais
      where id = profissional_id
      and user_id = auth.uid()
      and plano = 'completo'
    )
  );

-- Campos de medida do produto (peso, litro ou unidade) + quantidade
alter table produtos add column if not exists unidade_medida text default 'unidade';
alter table produtos add column if not exists quantidade numeric default 1;

-- Campo de marca
alter table produtos add column if not exists marca text;

-- Campo de marca do produto
alter table produtos add column if not exists marca text;