-- Rode no SQL Editor do Supabase QUANDO for lançar a Vitrine (não antes)

create table produtos (
  id uuid default gen_random_uuid() primary key,
  profissional_id uuid references profissionais(id) on delete cascade not null,
  nome text not null,
  descricao text,
  preco text,
  foto text,
  marca text,
  unidade_medida text default 'unidade',
  quantidade numeric default 1,
  codigo_barras text,
  created_at timestamp default now()
);

alter table produtos enable row level security;

create policy "Leitura publica de produtos" on produtos
  for select using (true);

create policy "Insercao pelo dono do cadastro com plano completo" on produtos
  for insert with check (
    exists (
      select 1 from profissionais
      where id = profissional_id
      and user_id = auth.uid()
      and plano = 'completo'
    )
  );

create policy "Atualizacao pelo dono do cadastro" on produtos
  for update using (
    exists (select 1 from profissionais where id = profissional_id and user_id = auth.uid())
  );

create policy "Exclusao pelo dono do cadastro" on produtos
  for delete using (
    exists (select 1 from profissionais where id = profissional_id and user_id = auth.uid())
  );

-- Catálogo colaborativo: quando uma empresa cadastra um produto com código de barras,
-- as informações gerais (nome, marca, foto, descrição) ficam guardadas aqui também.
-- Assim, quando OUTRA empresa escanear o mesmo código, o sistema já preenche sozinho,
-- mesmo que o produto não esteja na base pública (Open Food Facts) — útil pra produtos
-- regionais, artesanais ou que a primeira empresa cadastrou na mão.

create table produtos_catalogo_barcode (
  codigo_barras text primary key,
  nome text,
  marca text,
  foto text,
  descricao text,
  updated_at timestamp default now()
);

alter table produtos_catalogo_barcode enable row level security;

create policy "Leitura publica do catalogo" on produtos_catalogo_barcode
  for select using (true);

create policy "Qualquer logado pode contribuir com o catalogo" on produtos_catalogo_barcode
  for insert with check (auth.role() = 'authenticated');

create policy "Qualquer logado pode atualizar o catalogo" on produtos_catalogo_barcode
  for update using (auth.role() = 'authenticated');