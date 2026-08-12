create table avaliacoes (
  id uuid default gen_random_uuid() primary key,
  profissional_id uuid references profissionais(id) on delete cascade not null,
  nome text not null,
  nota int not null check (nota between 1 and 5),
  comentario text,
  created_at timestamp default now()
);

alter table avaliacoes enable row level security;

create policy "Leitura publica de avaliacoes" on avaliacoes
  for select using (true);

create policy "Qualquer um pode avaliar" on avaliacoes
  for insert with check (true);