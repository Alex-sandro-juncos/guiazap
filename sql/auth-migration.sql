alter table profissionais add column if not exists user_id uuid references auth.users(id) default auth.uid();

drop policy if exists "Insercao publica" on profissionais;
drop policy if exists "Atualizacao publica" on profissionais;
drop policy if exists "Exclusao publica" on profissionais;

create policy "Insercao autenticada" on profissionais
  for insert with check (auth.uid() = user_id);

create policy "Atualizacao pelo dono" on profissionais
  for update using (auth.uid() = user_id);

create policy "Exclusao pelo dono" on profissionais
  for delete using (auth.uid() = user_id);