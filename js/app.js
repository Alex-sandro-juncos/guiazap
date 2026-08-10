let supabase;
let entries = [];
let loaded = false;

function initSupabase(){
  if(!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes('SUA-URL') || SUPABASE_ANON_KEY.includes('SUA-CHAVE')){
    document.getElementById('config-warning').style.display = 'block';
    document.getElementById('loading').style.display = 'none';
    return false;
  }
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return true;
}

async function loadEntries(){
  const { data, error } = await supabase.from('profissionais').select('*').order('name', { ascending: true });
  if(error){
    console.error(error);
    document.getElementById('loading').textContent = 'Erro ao carregar. Confira o config.js e as políticas do Supabase.';
    return;
  }
  entries = data;
  loaded = true;
  document.getElementById('loading').style.display = 'none';
  populateEstados();
  render();
}

function populateEstados(){
  const sel = document.getElementById('filter-estado');
  const estados = [...new Set(entries.map(e => e.estado))].sort();
  sel.innerHTML = '<option value="">Estado</option>' + estados.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join('');
  onEstadoChange();
}

function onEstadoChange(){
  const estado = document.getElementById('filter-estado').value;
  const cidadeSel = document.getElementById('filter-cidade');
  const cidades = [...new Set(entries.filter(e => !estado || e.estado === estado).map(e => e.cidade))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  cidadeSel.innerHTML = '<option value="">Cidade</option>' + cidades.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  onCidadeChange();
}

function onCidadeChange(){
  const estado = document.getElementById('filter-estado').value;
  const cidade = document.getElementById('filter-cidade').value;
  const bairroSel = document.getElementById('filter-bairro');
  const bairros = [...new Set(entries.filter(e => (!estado || e.estado === estado) && (!cidade || e.cidade === cidade)).map(e => e.bairro))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  bairroSel.innerHTML = '<option value="">Bairro</option>' + bairros.map(b => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
  render();
}

function openForm(entry){
  const form = document.getElementById('cadastro-form');
  form.classList.add('open');
  document.getElementById('form-msg').textContent = '';
  document.getElementById('edit-id').value = entry ? entry.id : '';
  document.getElementById('f-name').value = entry ? entry.name : '';
  document.getElementById('f-cat').value = entry ? entry.cat : '';
  document.getElementById('f-rating').value = entry ? entry.rating : 5;
  document.getElementById('f-estado').value = entry ? entry.estado : '';
  document.getElementById('f-cidade').value = entry ? entry.cidade : '';
  document.getElementById('f-bairro').value = entry ? entry.bairro : '';
  document.getElementById('f-whatsapp').value = entry ? entry.whatsapp : '';
  document.getElementById('f-foto').value = entry ? (entry.foto || '') : '';
  document.getElementById('add-btn').style.display = 'none';
}

function closeForm(){
  document.getElementById('cadastro-form').classList.remove('open');
  document.getElementById('add-btn').style.display = 'block';
}

async function saveEntry(e){
  e.preventDefault();
  const id = document.getElementById('edit-id').value;
  const payload = {
    name: document.getElementById('f-name').value.trim(),
    cat: document.getElementById('f-cat').value.trim(),
    rating: parseFloat(document.getElementById('f-rating').value) || 0,
    estado: document.getElementById('f-estado').value.trim().toUpperCase(),
    cidade: document.getElementById('f-cidade').value.trim(),
    bairro: document.getElementById('f-bairro').value.trim(),
    whatsapp: document.getElementById('f-whatsapp').value.replace(/\D/g,''),
    foto: document.getElementById('f-foto').value.trim()
  };
  if(!payload.name || !payload.cat || !payload.estado || !payload.cidade || !payload.bairro || !payload.whatsapp) return false;

  const msg = document.getElementById('form-msg');
  msg.textContent = 'salvando...';
  let error;
  if(id){
    ({ error } = await supabase.from('profissionais').update(payload).eq('id', id));
  } else {
    ({ error } = await supabase.from('profissionais').insert(payload));
  }
  if(error){ console.error(error); msg.textContent = 'erro ao salvar'; return false; }
  closeForm();
  await loadEntries();
  return false;
}

function starString(rating){
  const full = Math.round(rating);
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}

function render(){
  const list = document.getElementById('list');
  const query = document.getElementById('search').value.toLowerCase();
  const estado = document.getElementById('filter-estado').value;
  const cidade = document.getElementById('filter-cidade').value;
  const bairro = document.getElementById('filter-bairro').value;

  const filtered = entries
    .filter(e => e.name.toLowerCase().includes(query) || e.cat.toLowerCase().includes(query))
    .filter(e => !estado || e.estado === estado)
    .filter(e => !cidade || e.cidade === cidade)
    .filter(e => !bairro || e.bairro === bairro)
    .sort((a,b) => b.rating - a.rating);

  document.getElementById('count').innerHTML = loaded ? `Profissionais próximos a você · <b>${filtered.length} resultados</b>` : '';

  if(!loaded){ list.innerHTML = ''; return; }

  if(filtered.length === 0){
    list.innerHTML = entries.length === 0
      ? '<div class="empty">Ainda não há profissionais cadastrados.<br>Seja o primeiro a cadastrar!</div>'
      : '<div class="empty">Nenhum resultado encontrado.<br>Tente outro termo ou filtro.</div>';
    return;
  }

  list.innerHTML = filtered.map(e => `
    <div class="card-profissional">
      <img class="avatar" src="${e.foto ? escapeHtml(e.foto) : 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(e.name)}" alt="${escapeHtml(e.name)}">
      <div class="info">
        <h3>${escapeHtml(e.name)}</h3>
        <div class="categoria">${escapeHtml(e.cat)}</div>
        <div class="local">${escapeHtml(e.cidade)} · ${escapeHtml(e.bairro)}</div>
        <div class="stars">${starString(e.rating)} <span class="num">${e.rating.toFixed(1)}</span></div>
        <a class="btn-zap" href="https://wa.me/55${e.whatsapp}" target="_blank">Chamar no WhatsApp</a>
      </div>
    </div>
  `).join('');
}

function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

if(initSupabase()){
  loadEntries();
}