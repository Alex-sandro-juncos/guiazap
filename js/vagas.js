let supabaseClientVagas;
let vagas = [];
let meusCadastrosVagas = [];
let currentUserVagas = null;
let vagaFiltroId = null;

function initSupabaseVagas(){
  if(!SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
  supabaseClientVagas = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return true;
}

async function initAuthVagas(){
  const { data: { session } } = await supabaseClientVagas.auth.getSession();
  currentUserVagas = session ? session.user : null;
  document.getElementById('v-add-vaga-btn').style.display = currentUserVagas ? 'inline-block' : 'none';

  if(currentUserVagas){
    const { data } = await supabaseClientVagas
      .from('profissionais')
      .select('id, name')
      .eq('user_id', currentUserVagas.id)
      .eq('status_pagamento', 'ativo');
    meusCadastrosVagas = data || [];

    const sel = document.getElementById('vg-profissional');
    sel.innerHTML = meusCadastrosVagas.map(c => `<option value="${c.id}">${escapeHtmlVagas(c.name)}</option>`).join('');

    if(meusCadastrosVagas.length === 0){
      document.getElementById('v-add-vaga-btn').style.display = 'none';
    }
  }
}

function normalizarTextoVagas(str){
  return (str || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

async function loadVagas(){
  const { data, error } = await supabaseClientVagas
    .from('vagas')
    .select('*, profissionais(name, whatsapp, status_pagamento, plano)')
    .eq('ativa', true)
    .order('created_at', { ascending: false });

  if(error){ console.error(error); return; }

  vagas = (data || []).filter(v => v.profissionais && v.profissionais.status_pagamento === 'ativo');

  // Vagas de empresas Premium aparecem primeiro
  vagas.sort((a, b) => {
    const premiumA = a.profissionais && a.profissionais.plano === 'premium' ? 1 : 0;
    const premiumB = b.profissionais && b.profissionais.plano === 'premium' ? 1 : 0;
    return premiumB - premiumA;
  });

  popularFiltrosVaga();

  const params = new URLSearchParams(window.location.search);
  vagaFiltroId = params.get('vaga');

  renderVagas();
}

function popularFiltrosVaga(){
  const empresas = [...new Set(vagas.map(v => v.profissionais ? v.profissionais.name : null).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'pt-BR'));
  const tipos = [...new Set(vagas.map(v => v.tipo).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'pt-BR'));

  const selEmpresa = document.getElementById('v-filter-empresa-vaga');
  const prevEmpresa = selEmpresa.value;
  selEmpresa.innerHTML = '<option value="">Todas as empresas</option>' + empresas.map(e => `<option value="${escapeHtmlVagas(e)}">${escapeHtmlVagas(e)}</option>`).join('');
  selEmpresa.value = prevEmpresa;

  const selTipo = document.getElementById('v-filter-tipo-vaga');
  const prevTipo = selTipo.value;
  selTipo.innerHTML = '<option value="">Todos os tipos</option>' + tipos.map(t => `<option value="${escapeHtmlVagas(t)}">${escapeHtmlVagas(t)}</option>`).join('');
  selTipo.value = prevTipo;
}

function renderVagas(){
  const query = normalizarTextoVagas(document.getElementById('v-search-vaga').value);
  const empresaFiltro = document.getElementById('v-filter-empresa-vaga').value;
  const tipoFiltro = document.getElementById('v-filter-tipo-vaga').value;

  const filtradas = vagas
    .filter(v => !vagaFiltroId || v.id === vagaFiltroId)
    .filter(v => !empresaFiltro || (v.profissionais && v.profissionais.name === empresaFiltro))
    .filter(v => !tipoFiltro || v.tipo === tipoFiltro)
    .filter(v =>
      normalizarTextoVagas(v.titulo).includes(query) ||
      normalizarTextoVagas(v.tipo).includes(query) ||
      normalizarTextoVagas(v.descricao).includes(query) ||
      (v.profissionais && normalizarTextoVagas(v.profissionais.name).includes(query))
    );

  document.getElementById('v-count-vaga').textContent = `${filtradas.length} vaga${filtradas.length !== 1 ? 's' : ''}`;

  const grid = document.getElementById('v-grid-vaga');
  if(filtradas.length === 0){
    grid.innerHTML = '<div class="vazio-vagas">Nenhuma vaga encontrada no momento.</div>';
    return;
  }

  grid.innerHTML = filtradas.map(v => {
    const isDono = currentUserVagas && meusCadastrosVagas.some(m => m.id === v.profissional_id);
    return `
    <div class="card-vaga">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div class="titulo-vaga">${escapeHtmlVagas(v.titulo)}</div>
        ${isDono ? `<span class="owner-actions">
          <button class="icon-btn" title="Excluir" onclick="excluirVaga('${v.id}')">✕</button>
        </span>` : ''}
      </div>
      <span class="tipo-vaga">${escapeHtmlVagas(v.tipo)}</span>
      <div class="empresa-vaga">${v.profissionais ? escapeHtmlVagas(v.profissionais.name) : ''}${v.profissionais && v.profissionais.plano === 'premium' ? ' <span class="selo-premium">👑</span>' : ''}</div>
      ${v.descricao ? `<div class="descricao-vaga">${escapeHtmlVagas(v.descricao)}</div>` : ''}
      ${v.requisitos ? `<div class="requisitos-vaga"><b>Procuramos:</b> ${escapeHtmlVagas(v.requisitos)}</div>` : ''}
      ${v.salario ? `<div class="salario-vaga">${escapeHtmlVagas(v.salario)}</div>` : ''}
      ${v.profissionais && v.profissionais.whatsapp ? `<a class="btn-zap-mini" href="https://wa.me/55${(v.profissionais.whatsapp || '').replace(/\D/g,'')}?text=${encodeURIComponent('Olá! Vi a vaga de ' + v.titulo + ' no GuiaZap e tenho interesse.')}" target="_blank">Candidatar-se pelo WhatsApp</a>` : ''}
      <button type="button" class="link-compartilhar-vaga" onclick="toggleMenuCompartilharVaga('${v.id}', '${escapeHtmlVagas(v.titulo).replace(/'/g, "\\'")}')">📤 Compartilhar vaga</button>
      <div class="menu-compartilhar-vaga" id="menu-compartilhar-vaga-${v.id}" style="display:none;"></div>
    </div>
  `; }).join('');
}

function toggleMenuCompartilharVaga(id, titulo){
  const menu = document.getElementById('menu-compartilhar-vaga-' + id);
  if(menu.style.display === 'block'){
    menu.style.display = 'none';
    return;
  }

  const link = `${window.location.origin}${window.location.pathname}?vaga=${id}`;
  const texto = `Vaga de ${titulo} — confira no GuiaZap!`;
  const linkCodificado = encodeURIComponent(link);
  const textoCodificado = encodeURIComponent(texto);

  menu.innerHTML = `
    <a href="https://wa.me/?text=${textoCodificado}%20${linkCodificado}" target="_blank" class="opcao-rede whatsapp">WhatsApp</a>
    <a href="https://www.facebook.com/sharer/sharer.php?u=${linkCodificado}" target="_blank" class="opcao-rede facebook">Facebook</a>
    <a href="https://twitter.com/intent/tweet?text=${textoCodificado}&url=${linkCodificado}" target="_blank" class="opcao-rede twitter">X (Twitter)</a>
    <a href="https://t.me/share/url?url=${linkCodificado}&text=${textoCodificado}" target="_blank" class="opcao-rede telegram">Telegram</a>
    <button type="button" class="opcao-rede copiar" onclick="copiarLinkVaga('${id}', event)">Copiar link</button>
  `;
  menu.style.display = 'block';
}

async function copiarLinkVaga(id, event){
  event.preventDefault();
  const link = `${window.location.origin}${window.location.pathname}?vaga=${id}`;
  try{
    await navigator.clipboard.writeText(link);
    alert('Link copiado!');
  } catch(e){
    prompt('Copie o link abaixo:', link);
  }
  document.getElementById('menu-compartilhar-vaga-' + id).style.display = 'none';
}

function formatarValorVaga(event){
  const input = event.target;
  const valorAtual = input.value;

  // Se a pessoa digitou alguma letra (ex: "A combinar"), não mexe em nada, deixa livre
  if(/[a-zA-Z]/.test(valorAtual)) return;

  const somenteDigitos = valorAtual.replace(/\D/g, '');
  if(!somenteDigitos){ input.value = ''; return; }

  const numero = (parseInt(somenteDigitos, 10) / 100).toFixed(2);
  input.value = numero.replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function abrirFormVaga(){
  document.getElementById('vaga-form').classList.add('open');
  document.getElementById('vg-msg').textContent = '';
}

function fecharFormVaga(){
  document.getElementById('vaga-form').classList.remove('open');
  document.getElementById('vg-id').value = '';
  document.getElementById('vg-titulo').value = '';
  document.getElementById('vg-descricao').value = '';
  document.getElementById('vg-requisitos').value = '';
  document.getElementById('vg-salario').value = '';
}

async function salvarVaga(e){
  e.preventDefault();
  const msg = document.getElementById('vg-msg');

  const payload = {
    profissional_id: document.getElementById('vg-profissional').value,
    titulo: document.getElementById('vg-titulo').value.trim(),
    tipo: document.getElementById('vg-tipo').value,
    descricao: document.getElementById('vg-descricao').value.trim() || null,
    requisitos: document.getElementById('vg-requisitos').value.trim() || null,
    salario: document.getElementById('vg-salario').value.trim() || null
  };

  if(!payload.titulo || !payload.profissional_id){ msg.textContent = 'Preencha o cargo da vaga.'; return false; }

  msg.textContent = 'publicando...';
  const { error } = await supabaseClientVagas.from('vagas').insert(payload);
  if(error){ console.error(error); msg.textContent = 'erro ao publicar vaga'; return false; }

  msg.textContent = 'vaga publicada!';
  await loadVagas();
  setTimeout(fecharFormVaga, 1200);
  return false;
}

async function excluirVaga(id){
  if(!confirm('Excluir esta vaga?')) return;
  const { error } = await supabaseClientVagas.from('vagas').delete().eq('id', id);
  if(error){ console.error(error); alert('Erro ao excluir.'); return; }
  await loadVagas();
}

function escapeHtmlVagas(str){
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

if(initSupabaseVagas()){
  initAuthVagas().then(loadVagas);
}