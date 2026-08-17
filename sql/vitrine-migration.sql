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

-- Avaliações de produtos individuais (mesma lógica das avaliações de empresa, mas por produto)
create table avaliacoes_produtos (
  id uuid default gen_random_uuid() primary key,
  produto_id uuid references produtos(id) on delete cascade not null,
  nota int not null check (nota between 1 and 5),
  comentario text,
  created_at timestamp default now()
);

alter table avaliacoes_produtos enable row level security;

create policy "Leitura publica de avaliacoes de produtos" on avaliacoes_produtos
  for select using (true);

create policy "Qualquer um pode avaliar produto" on avaliacoes_produtos
  for insert with check (true);

-- Categoria do produto (pra filtrar na Vitrine)
alter table produtos add column if not exists categoria text;

-- Contador de visualizações de produto
alter table produtos add column if not exists visualizacoes integer default 0;

create or replace function incrementar_visualizacao_produto(pid uuid)
returns void as $$
begin
  update produtos set visualizacoes = visualizacoes + 1 where id = pid;
end;
$$ language plpgsql security definer;

grant execute on function incrementar_visualizacao_produto(uuid) to anon, authenticated;

-- Denúncias de produtos (mesma lógica das denúncias de empresa, mas por produto)
create table denuncias_produtos (
  id uuid default gen_random_uuid() primary key,
  produto_id uuid references produtos(id) on delete cascade not null,
  motivo text not null,
  descricao text,
  denunciante_email text,
  status text default 'pendente',
  created_at timestamp default now()
);

alter table denuncias_produtos enable row level security;

create policy "Qualquer um pode denunciar produto" on denuncias_produtos
  for insert with check (true);

-- Só o dono do produto (via empresa) consegue ver as denúncias dele
create policy "Dono ve as denuncias do proprio produto" on denuncias_produtos
  for select using (
    exists (
      select 1 from produtos
      join profissionais on profissionais.id = produtos.profissional_id
      where produtos.id = produto_id
      and profissionais.user_id = auth.uid()
    )
  );