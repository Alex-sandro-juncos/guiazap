create table profissionais (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  cat text not null,
  rating numeric default 5,
  estado text not null,
  cidade text not null,
  bairro text not null,
  whatsapp text not null,
  foto text,
  created_at timestamp default now()
);

alter table profissionais enable row level security;

create policy "Leitura publica" on profissionais
  for select using (true);

create policy "Insercao publica" on profissionais
  for insert with check (true);

create policy "Atualizacao publica" on profissionais
  for update using (true);

create policy "Exclusao publica" on profissionais
  for delete using (true);