-- Rode no SQL Editor do Supabase
-- Libera: qualquer pessoa pode VER as fotos (bucket público), mas só usuários logados podem ENVIAR

create policy "Leitura publica de fotos"
on storage.objects for select
using (bucket_id = 'fotos');

create policy "Upload de fotos para logados"
on storage.objects for insert
with check (bucket_id = 'fotos' and auth.role() = 'authenticated');

create policy "Atualizacao de fotos para logados"
on storage.objects for update
using (bucket_id = 'fotos' and auth.role() = 'authenticated');