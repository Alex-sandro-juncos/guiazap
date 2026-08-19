let supabaseClient;
let entries = [];
let loaded = false;
let currentUser = null;
let avaliacoesMap = {};

function initSupabase(){
  if(!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes('SUA-URL') || SUPABASE_ANON_KEY.includes('SUA-CHAVE')){
    document.getElementById('config-warning').style.display = 'block';
    document.getElementById('loading').style.display = 'none';
    return false;
  }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return true;
}

// ---------- AUTENTICAÇÃO ----------

async function initAuth(){
  const { data: { session } } = await supabaseClient.auth.getSession();
  currentUser = session ? session.user : null;
  updateAuthUI();

  supabaseClient.auth.onAuthStateChange((event, session) => {
    currentUser = session ? session.user : null;
    updateAuthUI();
    render();
  });
}

function toggleAuthForm(){
  const box = document.getElementById('auth-form-fields');

  if(box.style.display === 'none'){
    box.innerHTML = `
      <form autocomplete="on" onsubmit="return false;">
        <div class="auth-row">
          <input id="auth-email" type="email" placeholder="Seu e-mail" autocomplete="email">
          <input id="auth-password" type="password" placeholder="Senha" autocomplete="current-password">
        </div>
        <label class="termos-check">
          <input type="checkbox" id="aceite-termos">
          <span>Li e aceito os <a href="termos.html" target="_blank">Termos de Uso</a> e a <a href="privacidade.html" target="_blank">Política de Privacidade</a></span>
        </label>
        <div class="auth-actions">
          <button type="button" class="btn-auth" onclick="signIn()">Entrar</button>
          <button type="button" class="btn-auth-outline" onclick="signUp()">Criar conta</button>
          <span class="auth-msg" id="auth-msg"></span>
        </div>
        <a href="#" class="forgot-link" onclick="forgotPassword(); return false;">Esqueci minha senha</a>
      </form>
    `;
    box.style.display = 'block';
  } else {
    box.style.display = 'none';
    box.innerHTML = '';
  }
}

function updateAuthUI(){
  const loggedOutBox = document.getElementById('auth-logged-out');
  const loggedInBox = document.getElementById('auth-logged-in');
  const addBtn = document.getElementById('add-btn');

  if(currentUser){
    loggedOutBox.style.display = 'none';
    loggedInBox.style.display = 'flex';
    document.getElementById('auth-email-display').textContent = currentUser.email;
    addBtn.style.display = 'block';
    abrirCadastroSePendente();
  } else {
    loggedOutBox.style.display = 'block';
    loggedInBox.style.display = 'none';
    addBtn.style.display = 'none';
    document.getElementById('trocar-senha-box').style.display = 'none';
    closeForm();
  }
}

async function signUp(){
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const msg = document.getElementById('auth-msg');
  const aceitou = document.getElementById('aceite-termos').checked;

  if(!email || !password){ msg.textContent = 'preencha e-mail e senha'; return; }
  if(!aceitou){ msg.textContent = 'você precisa aceitar os Termos de Uso e a Política de Privacidade'; return; }

  msg.textContent = 'criando conta...';
  const { error } = await supabaseClient.auth.signUp({
    email, password,
    options: { data: { termos_aceitos_em: new Date().toISOString() } }
  });
  if(error){ msg.textContent = error.message; return; }
  msg.textContent = 'conta criada! verifique seu e-mail se for solicitado, ou já pode entrar.';
  localStorage.setItem('abrirCadastroAposLogin', '1');
}

async function signIn(){
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const msg = document.getElementById('auth-msg');
  if(!email || !password){ msg.textContent = 'preencha e-mail e senha'; return; }

  msg.textContent = 'entrando...';
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if(error){ msg.textContent = error.message; return; }
  msg.textContent = '';
}

async function signOut(){
  await supabaseClient.auth.signOut();
  document.getElementById('auth-email').value = '';
  document.getElementById('auth-password').value = '';
  document.getElementById('auth-msg').textContent = '';
}

async function forgotPassword(){
  const email = document.getElementById('auth-email').value.trim();
  const msg = document.getElementById('auth-msg');
  if(!email){ msg.textContent = 'digite seu e-mail no campo acima primeiro'; return; }

  msg.textContent = 'enviando e-mail...';
  const redirectTo = window.location.origin + '/reset-password.html';
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
  if(error){ msg.textContent = error.message; return; }
  msg.textContent = 'e-mail enviado! verifique sua caixa de entrada.';
}

function toggleTrocarSenha(){
  const box = document.getElementById('trocar-senha-box');
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
  document.getElementById('trocar-senha-msg').textContent = '';
}

async function trocarSenha(){
  const pass1 = document.getElementById('nova-senha').value;
  const pass2 = document.getElementById('confirmar-nova-senha').value;
  const msg = document.getElementById('trocar-senha-msg');

  if(!pass1 || pass1.length < 6){ msg.textContent = 'a senha precisa ter pelo menos 6 caracteres'; return; }
  if(pass1 !== pass2){ msg.textContent = 'as senhas não coincidem'; return; }

  msg.textContent = 'salvando...';
  const { error } = await supabaseClient.auth.updateUser({ password: pass1 });
  if(error){ msg.textContent = error.message; return; }

  msg.textContent = 'senha alterada com sucesso!';
  document.getElementById('nova-senha').value = '';
  document.getElementById('confirmar-nova-senha').value = '';
  setTimeout(() => { toggleTrocarSenha(); }, 1500);
}

// ---------- DADOS ----------

async function loadEntries(){
  const { data, error } = await supabaseClient
    .from('profissionais')
    .select('id, name, cat, categorias_extra, estado, cidade, bairro, whatsapp, contatos_extra, foto, status_pagamento, plano, verificado, visualizacoes, created_at, user_id')
    .order('name', { ascending: true });
  if(error){
    console.error(error);
    document.getElementById('loading').textContent = 'Erro ao carregar. Confira o config.js e as políticas do Supabase.';
    return;
  }
  entries = data;
  loaded = true;
  document.getElementById('loading').style.display = 'none';
  populateEstados();
  await loadAvaliacoes();
  loadProdutosDestaque();

  const params = new URLSearchParams(window.location.search);
  cadastroCompartilhadoId = params.get('p');

  const planoParam = params.get('plano');
  if(planoParam === 'basico' || planoParam === 'completo'){
    planoEscolhido = planoParam;
    localStorage.setItem('planoEscolhido', planoEscolhido);
    localStorage.setItem('abrirCadastroAposLogin', '1');
    // Limpa o "?plano=..." da URL, senão ele fica sendo lido de novo a cada recarregamento
    // e reabre o formulário sozinho toda vez (inclusive depois de já ter salvo).
    window.history.replaceState({}, '', window.location.pathname);
  }

  abrirCadastroSePendente();
  render();
}

function abrirCadastroSePendente(){
  if(currentUser && localStorage.getItem('abrirCadastroAposLogin') === '1'){
    localStorage.removeItem('abrirCadastroAposLogin');
    setTimeout(() => openForm(), 300);
  }
}

let avaliacoesDetalhadas = {};

async function loadAvaliacoes(){
  const { data, error } = await supabaseClient.from('avaliacoes').select('id, profissional_id, nota, comentario, resposta_empresa, created_at').order('created_at', { ascending: false });
  if(error){ console.error(error); return; }

  avaliacoesMap = {};
  avaliacoesDetalhadas = {};
  data.forEach(a => {
    if(!avaliacoesMap[a.profissional_id]) avaliacoesMap[a.profissional_id] = { soma: 0, count: 0 };
    avaliacoesMap[a.profissional_id].soma += a.nota;
    avaliacoesMap[a.profissional_id].count += 1;

    if(!avaliacoesDetalhadas[a.profissional_id]) avaliacoesDetalhadas[a.profissional_id] = [];
    avaliacoesDetalhadas[a.profissional_id].push(a);
  });
}

function mediaDe(id){
  const dados = avaliacoesMap[id];
  if(!dados || dados.count === 0) return { media: 0, count: 0 };
  return { media: dados.soma / dados.count, count: dados.count };
}

function abrirAvaliacao(id){
  const box = document.getElementById('review-box-' + id);
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

let notaSelecionada = {};

function selecionarNota(id, nota){
  notaSelecionada[id] = nota;
  const stars = document.querySelectorAll('#review-stars-' + id + ' span');
  stars.forEach((s, i) => { s.textContent = (i < nota) ? '★' : '☆'; });
}

function jaAvaliou(id){
  return localStorage.getItem('avaliado_' + id) === '1';
}

function toggleVerAvaliacoes(profissionalId){
  const box = document.getElementById('lista-avaliacoes-' + profissionalId);
  if(box.style.display === 'block'){
    box.style.display = 'none';
    return;
  }

  const isOwnerDesse = currentUser && entries.find(e => e.id === profissionalId)?.user_id === currentUser.id;
  const lista = avaliacoesDetalhadas[profissionalId] || [];

  box.innerHTML = lista.map(a => `
    <div class="avaliacao-item">
      <div class="avaliacao-estrelas">${starString(a.nota)}</div>
      ${a.comentario ? `<div class="avaliacao-comentario">${escapeHtml(a.comentario)}</div>` : ''}
      <div class="avaliacao-data">${new Date(a.created_at).toLocaleDateString('pt-BR')}</div>
      ${a.resposta_empresa
        ? `<div class="resposta-empresa"><b>Resposta da empresa:</b> ${escapeHtml(a.resposta_empresa)}</div>`
        : isOwnerDesse
          ? `<button type="button" class="link-avaliar" onclick="abrirResponderAvaliacao('${a.id}')">Responder</button>
             <div class="responder-box" id="responder-box-${a.id}" style="display:none;">
               <textarea id="responder-texto-${a.id}" class="review-input" rows="2" placeholder="Escreva sua resposta pública"></textarea>
               <div class="review-actions">
                 <button type="button" class="btn-auth" onclick="responderAvaliacao('${a.id}', '${profissionalId}')">Enviar resposta</button>
                 <span class="review-msg" id="responder-msg-${a.id}"></span>
               </div>
             </div>`
          : ''}
    </div>
  `).join('') || '<div class="avaliacao-item">Nenhuma avaliação com detalhes ainda.</div>';

  box.style.display = 'block';
}

function abrirResponderAvaliacao(avaliacaoId){
  const box = document.getElementById('responder-box-' + avaliacaoId);
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

async function responderAvaliacao(avaliacaoId, profissionalId){
  const texto = document.getElementById('responder-texto-' + avaliacaoId).value.trim();
  const msg = document.getElementById('responder-msg-' + avaliacaoId);

  if(!texto){ msg.textContent = 'Escreva uma resposta.'; return; }

  msg.textContent = 'enviando...';
  const { error } = await supabaseClient.from('avaliacoes').update({ resposta_empresa: texto }).eq('id', avaliacaoId);
  if(error){ console.error(error); msg.textContent = 'erro ao responder'; return; }

  msg.textContent = 'resposta publicada!';
  await loadAvaliacoes();
  toggleVerAvaliacoes(profissionalId);
  toggleVerAvaliacoes(profissionalId);
}

async function enviarAvaliacao(id){
  const comentarioInput = document.getElementById('review-comentario-' + id);
  const msg = document.getElementById('review-msg-' + id);

  if(jaAvaliou(id)){ msg.textContent = 'Você já avaliou este cadastro neste dispositivo.'; return; }

  const nota = notaSelecionada[id];
  const comentario = comentarioInput.value.trim();

  if(!nota){ msg.textContent = 'Escolha uma nota.'; return; }

  msg.textContent = 'enviando...';
  const { error } = await supabaseClient.from('avaliacoes').insert({
    profissional_id: id, nota, comentario: comentario || null
  });
  if(error){ console.error(error); msg.textContent = 'erro ao enviar avaliação'; return; }

  localStorage.setItem('avaliado_' + id, '1');
  comentarioInput.value = '';
  delete notaSelecionada[id];
  msg.textContent = 'avaliação enviada, obrigado!';
  await loadAvaliacoes();
  render();
}

const UFS = [
  {sigla:'AC',nome:'Acre'},{sigla:'AL',nome:'Alagoas'},{sigla:'AP',nome:'Amapá'},{sigla:'AM',nome:'Amazonas'},
  {sigla:'BA',nome:'Bahia'},{sigla:'CE',nome:'Ceará'},{sigla:'DF',nome:'Distrito Federal'},{sigla:'ES',nome:'Espírito Santo'},
  {sigla:'GO',nome:'Goiás'},{sigla:'MA',nome:'Maranhão'},{sigla:'MT',nome:'Mato Grosso'},{sigla:'MS',nome:'Mato Grosso do Sul'},
  {sigla:'MG',nome:'Minas Gerais'},{sigla:'PA',nome:'Pará'},{sigla:'PB',nome:'Paraíba'},{sigla:'PR',nome:'Paraná'},
  {sigla:'PE',nome:'Pernambuco'},{sigla:'PI',nome:'Piauí'},{sigla:'RJ',nome:'Rio de Janeiro'},{sigla:'RN',nome:'Rio Grande do Norte'},
  {sigla:'RS',nome:'Rio Grande do Sul'},{sigla:'RO',nome:'Rondônia'},{sigla:'RR',nome:'Roraima'},{sigla:'SC',nome:'Santa Catarina'},
  {sigla:'SP',nome:'São Paulo'},{sigla:'SE',nome:'Sergipe'},{sigla:'TO',nome:'Tocantins'}
];

function preencherSelectUF(selectEl){
  selectEl.innerHTML = '<option value="">Selecione</option>' +
    UFS.map(u => `<option value="${u.sigla}">${u.sigla} - ${u.nome}</option>`).join('');
}

async function buscarCidadesIBGE(uf, datalistEl){
  datalistEl.innerHTML = '';
  if(!uf) return;
  try{
    const resp = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`);
    const cidades = await resp.json();
    datalistEl.innerHTML = cidades.map(c => `<option value="${escapeHtml(c.nome)}">${escapeHtml(c.nome)}</option>`).join('');
  } catch(e){
    console.error('erro ao buscar cidades do IBGE', e);
  }
}

function onEstadoCadastroChange(){
  const uf = document.getElementById('f-estado').value;
  buscarCidadesIBGE(uf, document.getElementById('cidades-cadastro-list'));
}

async function popularSelectCidadesFiltro(uf){
  const sel = document.getElementById('gz-localidade-busca');
  sel.innerHTML = '<option value="">Cidade</option>';
  if(!uf) return;
  try{
    const resp = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`);
    const cidades = await resp.json();
    sel.innerHTML += cidades.map(c => `<option value="${escapeHtml(c.nome)}">${escapeHtml(c.nome)}</option>`).join('');
  } catch(e){
    console.error('erro ao buscar cidades do IBGE', e);
  }
}

function onEstadoFiltroChange(){
  const uf = document.getElementById('filter-estado').value;
  popularSelectCidadesFiltro(uf);
  onCidadeFiltroChange();
}

function onCidadeFiltroChange(){
  populateBairrosFiltro();
  render();
}

function populateBairrosFiltro(){
  const estado = document.getElementById('filter-estado').value;
  const cidade = document.getElementById('gz-localidade-busca').value;
  const bairroSel = document.getElementById('filter-bairro');
  const cidadeNorm = normalizarTexto(cidade);
  const bairros = [...new Set(entries.filter(e => (!estado || e.estado === estado) && (!cidadeNorm || normalizarTexto(e.cidade).includes(cidadeNorm))).map(e => e.bairro))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  bairroSel.innerHTML = '<option value="">Bairro</option>' + bairros.map(b => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
}

function populateEstados(){
  preencherSelectUF(document.getElementById('filter-estado'));
  preencherSelectUF(document.getElementById('f-estado'));
  populateBairrosFiltro();
}

const LINK_ASSINATURA_BASICO = "https://mpago.la/1Ddksty"; // hoje sem uso: Pacote 1 é grátis e ativa sozinho
const LINK_ASSINATURA_COMPLETO = "https://mpago.la/1Ddksty"; // mesmo plano do Mercado Pago, editado para cobrar R$10 (Pacote Completo)
const LINK_ASSINATURA = LINK_ASSINATURA_COMPLETO; // mantém compatibilidade com o código já existente

let planoEscolhido = localStorage.getItem('planoEscolhido') || 'basico';

function linkDoPlano(plano){
  return plano === 'completo' ? LINK_ASSINATURA_COMPLETO : LINK_ASSINATURA_BASICO;
}

async function openForm(entry){
  if(!currentUser) return;
  const form = document.getElementById('cadastro-form');
  form.classList.add('open');
  document.getElementById('form-msg').textContent = '';
  document.getElementById('edit-id').value = entry ? entry.id : '';
  document.getElementById('f-name').value = entry ? entry.name : '';
  document.getElementById('f-documento').value = '';
  if(entry){
    // O documento não vem mais junto do cadastro por segurança — busca separado, só o dono consegue
    const { data: doc } = await supabaseClient.rpc('obter_meu_documento', { pid: entry.id });
    document.getElementById('f-documento').value = doc || '';
  }
  document.getElementById('f-cat').value = entry ? entry.cat : '';
  document.getElementById('f-estado').value = entry ? entry.estado : '';
  if(entry && entry.estado) buscarCidadesIBGE(entry.estado, document.getElementById('cidades-cadastro-list'));
  document.getElementById('f-cidade').value = entry ? entry.cidade : '';
  document.getElementById('f-bairro').value = entry ? entry.bairro : '';
  document.getElementById('f-whatsapp').value = entry ? entry.whatsapp : '';
  document.getElementById('f-foto').value = entry ? (entry.foto || '') : '';
  document.getElementById('foto-msg').textContent = '';
  const preview = document.getElementById('foto-preview');
  if(entry && entry.foto){ preview.src = entry.foto; preview.style.display = 'block'; }
  else { preview.style.display = 'none'; }
  carregarContatosExtra(entry ? (entry.contatos_extra || '') : '');
  carregarCategoriasExtra(entry ? (entry.categorias_extra || '') : '');
  document.getElementById('add-btn').style.display = 'none';
}

function adicionarLinhaCategoria(nome){
  const container = document.getElementById('categorias-extra-list');
  const linha = document.createElement('div');
  linha.className = 'contato-extra-linha';
  linha.innerHTML = `
    <input type="text" class="cat-extra-nome" placeholder="Ex: Manicure" value="${nome ? escapeHtml(nome) : ''}">
    <button type="button" class="ce-remover" onclick="this.parentElement.remove()">✕</button>
  `;
  container.appendChild(linha);
}

function carregarCategoriasExtra(texto){
  document.getElementById('categorias-extra-list').innerHTML = '';
  if(!texto) return;
  texto.split('\n').map(l => l.trim()).filter(Boolean).forEach(nome => adicionarLinhaCategoria(nome));
}

function coletarCategoriasExtra(){
  const linhas = document.querySelectorAll('#categorias-extra-list .contato-extra-linha');
  const partes = [];
  linhas.forEach(linha => {
    const nome = linha.querySelector('.cat-extra-nome').value.trim();
    if(nome) partes.push(nome);
  });
  return partes.join('\n');
}

function adicionarLinhaContato(rotulo, numero){
  const container = document.getElementById('contatos-extra-list');
  const linha = document.createElement('div');
  linha.className = 'contato-extra-linha';
  linha.innerHTML = `
    <input type="text" class="ce-rotulo" placeholder="Ex: Vendas" value="${rotulo ? escapeHtml(rotulo) : ''}">
    <input type="text" class="ce-numero" placeholder="Ex: 11912345678" value="${numero ? escapeHtml(numero) : ''}">
    <button type="button" class="ce-remover" onclick="this.parentElement.remove()">✕</button>
  `;
  container.appendChild(linha);
}

function limparLinhasContato(){
  document.getElementById('contatos-extra-list').innerHTML = '';
}

function carregarContatosExtra(texto){
  limparLinhasContato();
  if(!texto) return;
  texto.split('\n').map(l => l.trim()).filter(Boolean).forEach(linha => {
    const [rotulo, numero] = linha.split(':');
    if(rotulo && numero) adicionarLinhaContato(rotulo.trim(), numero.trim());
  });
}

function coletarContatosExtra(){
  const linhas = document.querySelectorAll('#contatos-extra-list .contato-extra-linha');
  const partes = [];
  linhas.forEach(linha => {
    const rotulo = linha.querySelector('.ce-rotulo').value.trim();
    const numero = linha.querySelector('.ce-numero').value.replace(/\D/g,'');
    if(rotulo && numero) partes.push(`${rotulo}: ${numero}`);
  });
  return partes.join('\n');
}

async function enviarFoto(event){
  const file = event.target.files[0];
  const msg = document.getElementById('foto-msg');
  if(!file) return;

  msg.textContent = 'enviando foto...';
  const nomeArquivo = `${currentUser.id}/${Date.now()}.jpg`;

  const { error } = await supabaseClient.storage.from('fotos').upload(nomeArquivo, file, { upsert: true });
  if(error){
    console.error(error);
    msg.textContent = 'erro ao enviar foto: ' + error.message;
    return;
  }

  const { data } = supabaseClient.storage.from('fotos').getPublicUrl(nomeArquivo);
  document.getElementById('f-foto').value = data.publicUrl;

  const preview = document.getElementById('foto-preview');
  preview.src = data.publicUrl;
  preview.style.display = 'block';
  msg.textContent = 'foto enviada!';
}

function onFotoLinkChange(){
  const url = document.getElementById('f-foto').value.trim();
  const preview = document.getElementById('foto-preview');
  if(url){ preview.src = url; preview.style.display = 'block'; }
  else { preview.style.display = 'none'; }
}

async function buscarCep(){
  const cepInput = document.getElementById('f-cep');
  const msg = document.getElementById('cep-msg');
  const cep = cepInput.value.replace(/\D/g,'');

  if(cep.length !== 8){
    msg.textContent = cep.length > 0 ? 'CEP deve ter 8 números' : '';
    return;
  }

  msg.textContent = 'buscando...';
  try{
    const resp = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const data = await resp.json();
    if(data.erro){
      msg.textContent = 'CEP não encontrado';
      return;
    }
    document.getElementById('f-estado').value = data.uf || '';
    document.getElementById('f-cidade').value = data.localidade || '';
    document.getElementById('f-bairro').value = data.bairro || '';
    msg.textContent = 'endereço preenchido';
  } catch(e){
    msg.textContent = 'erro ao buscar CEP, preencha manualmente';
  }
}

function closeForm(){
  document.getElementById('cadastro-form').classList.remove('open');
  if(currentUser) document.getElementById('add-btn').style.display = 'block';
}

async function saveEntry(e){
  e.preventDefault();
  if(!currentUser){ alert('Você precisa entrar na sua conta para cadastrar.'); return false; }

  const id = document.getElementById('edit-id').value;
  const payload = {
    name: document.getElementById('f-name').value.trim(),
    documento: document.getElementById('f-documento').value.replace(/\D/g,''),
    cat: document.getElementById('f-cat').value.trim(),
    estado: document.getElementById('f-estado').value.trim().toUpperCase(),
    cidade: document.getElementById('f-cidade').value.trim(),
    bairro: document.getElementById('f-bairro').value.trim(),
    whatsapp: document.getElementById('f-whatsapp').value.replace(/\D/g,''),
    foto: document.getElementById('f-foto').value.trim(),
    contatos_extra: coletarContatosExtra(),
    categorias_extra: coletarCategoriasExtra()
  };
  if(!payload.name || !payload.documento || !payload.cat || !payload.estado || !payload.cidade || !payload.bairro || !payload.whatsapp) return false;

  const msg = document.getElementById('form-msg');
  msg.textContent = 'salvando...';
  let error;
  let novoCadastroId = null;
  if(id){
    ({ error } = await supabaseClient.from('profissionais').update(payload).eq('id', id));
  } else {
    const { data: existentes } = await supabaseClient.rpc('verificar_documento_duplicado', {
      doc: payload.documento,
      uf: payload.estado,
      cid: payload.cidade,
      bai: payload.bairro
    });

    if(existentes && existentes.length > 0){
      msg.textContent = 'Ja existe um cadastro com esse CNPJ/CPF neste endereco (' + existentes[0].name + '). Edite esse cadastro e adicione o contato em "Outros contatos", em vez de criar um novo.';
      return false;
    }

    payload.user_id = currentUser.id;
    payload.user_email = currentUser.email;
    payload.status_pagamento = 'pendente';
    payload.plano = planoEscolhido;
    const { data: inserido, error: errInsert } = await supabaseClient.from('profissionais').insert(payload).select('id').single();
    error = errInsert;
    novoCadastroId = inserido ? inserido.id : null;
  }
  if(error){ console.error(error); msg.textContent = 'erro ao salvar'; return false; }
  closeForm();
  await loadEntries();
  populateBairrosFiltro();

  if(!id){
    if(planoEscolhido === 'basico'){
      msg.textContent = 'ativando seu cadastro gratuito...';
      try{
        const { data: { session } } = await supabaseClient.auth.getSession();
        const respAtivar = await fetch('/.netlify/functions/ativar-basico', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ profissionalId: novoCadastroId })
        });
        if(respAtivar.ok){
          alert("Cadastro gratuito ativado! Já está visível para todos.");
        } else {
          alert("Cadastro salvo, mas houve um problema na ativação automática. Fale com o suporte.");
        }
      } catch(e){
        alert("Cadastro salvo, mas houve um problema na ativação automática. Fale com o suporte.");
      }
      await loadEntries();
    } else {
      alert("Cadastro salvo! Ele fica visível só para você até o pagamento ser confirmado (ou até você aplicar um cupom, se tiver um). Role para baixo para ver seu cadastro.");
    }
  }
  return false;
}

async function cancelarAssinatura(){
  if(!confirm('Tem certeza que deseja desativar este cadastro? Ele deixará de aparecer na busca pública até ser reativado.')) return;

  const { data: { session } } = await supabaseClient.auth.getSession();
  if(!session){ alert('Sessão expirada, faça login novamente.'); return; }

  try{
    const resp = await fetch('/.netlify/functions/cancelar-assinatura', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
    const data = await resp.json();
    if(!resp.ok){
      alert('Erro ao desativar: ' + (data.error || 'tente novamente'));
      return;
    }
    alert('Cadastro desativado. Você pode reativar (grátis ou pago) quando quiser.');
    await loadEntries();
  } catch(e){
    alert('Erro ao desativar cadastro. Tente novamente.');
  }
}

function verTodos(){
  cadastroCompartilhadoId = null;
  window.history.replaceState({}, '', window.location.pathname);
  render();
}

function toggleMenuCompartilharCadastro(id, nome){
  const menu = document.getElementById('menu-compartilhar-cad-' + id);
  if(menu.style.display === 'block'){
    menu.style.display = 'none';
    return;
  }

  const link = `${window.location.origin}${window.location.pathname}?p=${id}`;
  const texto = `Confira ${nome} no GuiaZap!`;
  const linkCodificado = encodeURIComponent(link);
  const textoCodificado = encodeURIComponent(texto);

  menu.innerHTML = `
    <a href="https://wa.me/?text=${textoCodificado}%20${linkCodificado}" target="_blank" class="opcao-rede whatsapp">WhatsApp</a>
    <a href="https://www.facebook.com/sharer/sharer.php?u=${linkCodificado}" target="_blank" class="opcao-rede facebook">Facebook</a>
    <a href="https://twitter.com/intent/tweet?text=${textoCodificado}&url=${linkCodificado}" target="_blank" class="opcao-rede twitter">X (Twitter)</a>
    <a href="https://t.me/share/url?url=${linkCodificado}&text=${textoCodificado}" target="_blank" class="opcao-rede telegram">Telegram</a>
    <button type="button" class="opcao-rede copiar" onclick="copiarLinkCadastro('${id}', event)">Copiar link</button>
  `;
  menu.style.display = 'block';
}

async function copiarLinkCadastro(id, event){
  event.preventDefault();
  const link = `${window.location.origin}${window.location.pathname}?p=${id}`;
  try{
    await navigator.clipboard.writeText(link);
    alert('Link copiado!');
  } catch(e){
    prompt('Copie o link abaixo:', link);
  }
  document.getElementById('menu-compartilhar-cad-' + id).style.display = 'none';
}

let cadastroCompartilhadoId = null;

// ---------- FAVORITOS (salvos no navegador, sem precisar de login) ----------

let favoritosEmpresas = new Set(JSON.parse(localStorage.getItem('favoritos_empresas') || '[]'));
let mostrandoSoFavoritos = false;

function toggleFavorito(id, event){
  if(event) event.stopPropagation();
  if(favoritosEmpresas.has(id)) favoritosEmpresas.delete(id);
  else favoritosEmpresas.add(id);
  localStorage.setItem('favoritos_empresas', JSON.stringify([...favoritosEmpresas]));
  render();
}

const CAMPOS_COM_LIMPAR = ['search', 'filter-estado', 'gz-localidade-busca', 'filter-bairro'];

function atualizarBotoesLimpar(){
  CAMPOS_COM_LIMPAR.forEach(id => {
    const campo = document.getElementById(id);
    const botao = document.getElementById('limpar-' + id);
    if(!campo || !botao) return;
    botao.style.display = campo.value ? 'block' : 'none';
  });
}

function limparCampoFiltro(id){
  const campo = document.getElementById(id);
  if(!campo) return;
  campo.value = '';

  if(id === 'filter-estado'){ onEstadoFiltroChange(); }
  else if(id === 'gz-localidade-busca'){ onCidadeFiltroChange(); }
  else { render(); }

  atualizarBotoesLimpar();
}

function toggleFiltroFavoritos(){
  mostrandoSoFavoritos = !mostrandoSoFavoritos;
  const btn = document.getElementById('btn-favoritos');
  if(btn) btn.classList.toggle('ativo', mostrandoSoFavoritos);
  render();
}

function abrirDenuncia(id){
  const box = document.getElementById('denuncia-box-' + id);
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

function abrirMensagemEmpresa(id){
  const box = document.getElementById('mensagem-box-' + id);
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

async function enviarMensagemEmpresa(id){
  const tipo = document.getElementById('mensagem-tipo-' + id).value;
  const mensagem = document.getElementById('mensagem-texto-' + id).value.trim();
  const msg = document.getElementById('mensagem-msg-' + id);

  if(!mensagem){ msg.textContent = 'Escreva sua mensagem.'; return; }

  msg.textContent = 'enviando...';
  const { error } = await supabaseClient.from('mensagens_empresa').insert({
    profissional_id: id,
    tipo,
    mensagem,
    remetente_email: currentUser ? currentUser.email : null
  });
  if(error){ console.error(error); msg.textContent = 'erro ao enviar mensagem'; return; }

  msg.textContent = 'mensagem enviada!';
  document.getElementById('mensagem-texto-' + id).value = '';
  setTimeout(() => { document.getElementById('mensagem-box-' + id).style.display = 'none'; }, 2000);
}

async function toggleMensagensRecebidas(profissionalId){
  const box = document.getElementById('mensagens-recebidas-' + profissionalId);
  if(box.style.display === 'block'){
    box.style.display = 'none';
    return;
  }

  box.style.display = 'block';
  box.innerHTML = '<div class="denuncia-carregando">carregando...</div>';

  const { data, error } = await supabaseClient
    .from('mensagens_empresa')
    .select('tipo, mensagem, created_at')
    .eq('profissional_id', profissionalId)
    .order('created_at', { ascending: false });

  if(error){ box.innerHTML = '<div class="denuncia-carregando">erro ao carregar mensagens</div>'; return; }

  if(!data || data.length === 0){
    box.innerHTML = '<div class="denuncia-carregando">Nenhuma mensagem recebida ainda.</div>';
    return;
  }

  box.innerHTML = data.map(m => `
    <div class="denuncia-item">
      <div class="denuncia-motivo">${m.tipo === 'reclamacao' ? '⚠️ Reclamação' : '💡 Sugestão'}</div>
      <div class="denuncia-descricao">${escapeHtml(m.mensagem)}</div>
      <div class="denuncia-data">${new Date(m.created_at).toLocaleDateString('pt-BR')}</div>
    </div>
  `).join('');
}

async function toggleDenunciasRecebidas(profissionalId){
  const box = document.getElementById('denuncias-recebidas-' + profissionalId);
  if(box.style.display === 'block'){
    box.style.display = 'none';
    return;
  }

  box.style.display = 'block';
  box.innerHTML = '<div class="denuncia-carregando">carregando...</div>';

  const { data, error } = await supabaseClient
    .from('denuncias')
    .select('motivo, descricao, created_at')
    .eq('profissional_id', profissionalId)
    .order('created_at', { ascending: false });

  if(error){ box.innerHTML = '<div class="denuncia-carregando">erro ao carregar denúncias</div>'; return; }

  if(!data || data.length === 0){
    box.innerHTML = '<div class="denuncia-carregando">Nenhuma denúncia recebida. 🎉</div>';
    return;
  }

  box.innerHTML = data.map(d => `
    <div class="denuncia-item">
      <div class="denuncia-motivo">${escapeHtml(d.motivo)}</div>
      ${d.descricao ? `<div class="denuncia-descricao">${escapeHtml(d.descricao)}</div>` : ''}
      <div class="denuncia-data">${new Date(d.created_at).toLocaleDateString('pt-BR')}</div>
    </div>
  `).join('');
}

async function enviarDenuncia(id){
  const motivo = document.getElementById('denuncia-motivo-' + id).value;
  const descricao = document.getElementById('denuncia-descricao-' + id).value.trim();
  const msg = document.getElementById('denuncia-msg-' + id);

  if(!motivo){ msg.textContent = 'Selecione um motivo.'; return; }

  msg.textContent = 'enviando...';
  const { error } = await supabaseClient.from('denuncias').insert({
    profissional_id: id,
    motivo,
    descricao: descricao || null,
    denunciante_email: currentUser ? currentUser.email : null
  });
  if(error){ console.error(error); msg.textContent = 'erro ao enviar denúncia'; return; }

  msg.textContent = 'denúncia enviada, obrigado por ajudar a manter o GuiaZap seguro.';
  setTimeout(() => { document.getElementById('denuncia-box-' + id).style.display = 'none'; }, 2500);

  // Verifica se essa empresa bateu o limite de denúncias (sem travar a tela esperando)
  fetch('/.netlify/functions/verificar-limite-denuncias', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profissionalId: id })
  }).catch(e => console.error('erro ao verificar limite de denúncias', e));
}

async function reativarGratis(profissionalId){
  const msg = document.getElementById('reativar-msg-' + profissionalId);
  msg.textContent = 'reativando...';

  const { data: { session } } = await supabaseClient.auth.getSession();
  if(!session){ msg.textContent = 'Sessão expirada, faça login novamente.'; return; }

  try{
    const resp = await fetch('/.netlify/functions/ativar-basico', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ profissionalId })
    });
    if(!resp.ok){
      const data = await resp.json();
      msg.textContent = data.error || 'erro ao reativar';
      return;
    }
    msg.textContent = 'Reativado! Já está visível pra todos.';
    await loadEntries();
  } catch(e){
    msg.textContent = 'erro ao reativar, tente novamente';
  }
}

async function aplicarCupom(profissionalId){
  const codigo = document.getElementById('cupom-input-' + profissionalId).value.trim();
  const msg = document.getElementById('cupom-msg-' + profissionalId);

  if(!codigo){ msg.textContent = 'Digite um código de cupom.'; return; }

  const { data: { session } } = await supabaseClient.auth.getSession();
  if(!session){ msg.textContent = 'Sessão expirada, faça login novamente.'; return; }

  msg.textContent = 'aplicando cupom...';
  try{
    const resp = await fetch('/.netlify/functions/resgatar-cupom', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ codigo, profissionalId })
    });
    const data = await resp.json();
    if(!resp.ok){
      msg.textContent = data.error || 'cupom inválido';
      return;
    }
    msg.textContent = 'Cupom aplicado! Seu cadastro já está ativo.';
    await loadEntries();
  } catch(e){
    msg.textContent = 'erro ao aplicar cupom, tente novamente';
  }
}

let produtosDestaqueTodos = [];

async function loadProdutosDestaque(){
  const container = document.getElementById('destaque-produtos-lista');
  if(!container) return;

  const { data, error } = await supabaseClient
    .from('produtos')
    .select('*, profissionais(name, whatsapp, status_pagamento, plano, user_id)')
    .order('created_at', { ascending: false })
    .limit(50);

  if(error || !data){
    container.innerHTML = '';
    document.querySelector('.destaque-vitrine').style.display = 'none';
    return;
  }

  produtosDestaqueTodos = data
    .filter(p => p.profissionais && p.profissionais.status_pagamento === 'ativo' && p.profissionais.plano === 'completo')
    .filter(p => !currentUser || (p.profissionais && p.profissionais.user_id === currentUser.id));

  const titulo = document.querySelector('.destaque-header h2');
  if(titulo) titulo.textContent = currentUser ? '🛍️ Seus produtos' : '🛍️ Produtos em destaque';

  renderProdutosDestaque();
}

function renderProdutosDestaque(){
  const container = document.getElementById('destaque-produtos-lista');
  const secao = document.querySelector('.destaque-vitrine');
  if(!container || !secao) return;

  const query = normalizarTexto(document.getElementById('search').value);

  const filtrados = produtosDestaqueTodos.filter(p =>
    normalizarTexto(p.nome).includes(query) ||
    normalizarTexto(p.marca).includes(query) ||
    normalizarTexto(p.descricao).includes(query) ||
    normalizarTexto(p.codigo_barras).includes(query) ||
    (p.profissionais && normalizarTexto(p.profissionais.name).includes(query))
  );

  if(produtosDestaqueTodos.length === 0){
    secao.style.display = 'none';
    return;
  }
  if(filtrados.length === 0){
    secao.style.display = query ? 'block' : 'none';
    container.innerHTML = query ? '<div class="destaque-carregando">Nenhum produto encontrado para essa busca.</div>' : '';
    return;
  }

  secao.style.display = 'block';

  const cardHtml = p => `
    <div class="destaque-card">
      <img src="${p.foto ? escapeHtml(p.foto) : 'https://api.dicebear.com/7.x/shapes/svg?seed=' + encodeURIComponent(p.nome)}" alt="${escapeHtml(p.nome)}">
      <div class="destaque-info">
        <div class="destaque-nome">${escapeHtml(p.nome)}</div>
        ${p.preco ? `<div class="destaque-preco">R$ ${escapeHtml(p.preco)}</div>` : ''}
        <div class="destaque-empresa">${p.profissionais ? escapeHtml(p.profissionais.name) : ''}</div>
        <a href="vitrine.html?produto=${p.id}" class="destaque-btn">Ver produto</a>
      </div>
    </div>
  `;

  if(query){
    // Com busca ativa: mostra todos os resultados numa fileira só, sem embaralhar
    container.innerHTML = `<div class="destaque-scroll">${filtrados.map(cardHtml).join('')}</div>`;
    return;
  }

  // Sem busca: embaralha e divide em até 3 fileiras (uma embaixo da outra), pra dar mais destaque à Vitrine
  const embaralhados = [...filtrados].sort(() => Math.random() - 0.5).slice(0, 15);
  const fileiras = [];
  for(let i = 0; i < embaralhados.length; i += 5){
    fileiras.push(embaralhados.slice(i, i + 5));
  }

  container.innerHTML = fileiras.map(fileira => `<div class="destaque-scroll">${fileira.map(cardHtml).join('')}</div>`).join('');
}

function editEntry(id){
  const en = entries.find(x => x.id === id);
  if(en) openForm(en);
}

async function deleteEntry(id){
  if(!confirm('Excluir este cadastro?')) return;
  const { error } = await supabaseClient.from('profissionais').delete().eq('id', id);
  if(error){ console.error(error); alert('Erro ao excluir.'); return; }
  await loadEntries();
}

function renderContatosExtra(texto){
  if(!texto) return '';
  const linhas = texto.split('\n').map(l => l.trim()).filter(Boolean);
  return linhas.map(linha => {
    const [label, numeroRaw] = linha.split(':');
    if(!numeroRaw) return '';
    const numero = numeroRaw.replace(/\D/g,'');
    if(!numero) return '';
    return `<a class="btn-zap btn-zap-extra" href="https://wa.me/55${numero}" target="_blank">${escapeHtml(label.trim())}</a>`;
  }).join('');
}

function starString(rating){
  const full = Math.round(rating);
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}

let visualizacoesContadas = new Set();

function contarVisualizacao(id, isOwner){
  if(isOwner) return; // não conta o dono vendo o próprio cadastro
  if(visualizacoesContadas.has(id)) return; // já contou nessa sessão, não conta de novo
  visualizacoesContadas.add(id);
  supabaseClient.rpc('incrementar_visualizacao', { pid: id }).then(({ error }) => {
    if(error) console.error('erro ao contar visualização', error);
  });
}

// ---------- HISTÓRICO DE BUSCA RECENTE (salvo no navegador) ----------

function salvarHistoricoBusca(){
  const valor = document.getElementById('search').value.trim();
  if(!valor) return;

  let historico = JSON.parse(localStorage.getItem('historico_busca') || '[]');
  historico = historico.filter(h => h.toLowerCase() !== valor.toLowerCase());
  historico.unshift(valor);
  historico = historico.slice(0, 5);
  localStorage.setItem('historico_busca', JSON.stringify(historico));
  renderHistoricoBusca();
}

function buscarDoHistorico(termo){
  document.getElementById('search').value = termo;
  render();
}

function limparHistoricoBusca(event){
  event.stopPropagation();
  localStorage.removeItem('historico_busca');
  renderHistoricoBusca();
}

function renderHistoricoBusca(){
  const container = document.getElementById('historico-busca-lista');
  if(!container) return;

  const historico = JSON.parse(localStorage.getItem('historico_busca') || '[]');
  if(historico.length === 0){ container.innerHTML = ''; return; }

  container.innerHTML = `
    <span class="historico-label">Buscas recentes:</span>
    ${historico.map(h => `<button type="button" class="chip-historico" onclick="buscarDoHistorico('${h.replace(/'/g, "\\'")}')">${escapeHtml(h)}</button>`).join('')}
    <button type="button" class="chip-historico-limpar" onclick="limparHistoricoBusca(event)">Limpar</button>
  `;
}

function render(){
  renderProdutosDestaque();
  const list = document.getElementById('list');
  const query = normalizarTexto(document.getElementById('search').value);
  const estado = document.getElementById('filter-estado').value;
  const cidade = document.getElementById('gz-localidade-busca').value;
  const bairro = document.getElementById('filter-bairro').value;

  const cidadeBusca = normalizarTexto(cidade);
  const filtered = cadastroCompartilhadoId
    ? entries.filter(e => e.id === cadastroCompartilhadoId && e.status_pagamento === 'ativo')
    : entries
    .filter(e => currentUser ? e.user_id === currentUser.id : e.status_pagamento === 'ativo')
    .filter(e => !mostrandoSoFavoritos || favoritosEmpresas.has(e.id))
    .filter(e => normalizarTexto(e.name).includes(query) || normalizarTexto(e.cat).includes(query) || normalizarTexto(e.categorias_extra).includes(query))
    .filter(e => !estado || e.estado === estado)
    .filter(e => !cidadeBusca || normalizarTexto(e.cidade).includes(cidadeBusca))
    .filter(e => !bairro || e.bairro === bairro)
    .sort((a,b) => a.name.localeCompare(b.name, 'pt-BR'));

  document.getElementById('count').innerHTML = loaded
    ? (cadastroCompartilhadoId
        ? `Cadastro compartilhado <button type="button" class="link-voltar-busca" onclick="verTodos()">Ver busca completa</button>`
        : currentUser
          ? `Seus cadastros · <b>${filtered.length} resultado${filtered.length !== 1 ? 's' : ''}</b>`
          : `Profissionais próximos a você · <b>${filtered.length} resultados</b>`)
    : '';

  if(!loaded){ list.innerHTML = ''; return; }

  if(filtered.length === 0){
    list.innerHTML = entries.length === 0
      ? '<div class="empty">Ainda não há profissionais cadastrados.<br>Seja o primeiro a cadastrar!</div>'
      : '<div class="empty">Nenhum resultado encontrado.<br>Tente outro termo ou filtro.</div>';
    return;
  }

  list.innerHTML = filtered.map(e => {
    const isOwner = currentUser && e.user_id === currentUser.id;
    const pendente = e.status_pagamento !== 'ativo';
    const { media, count } = mediaDe(e.id);
    contarVisualizacao(e.id, isOwner);
    return `
    <div class="card-profissional${pendente ? ' card-pendente' : ''}">
      ${isOwner && pendente ? `<div class="badge-pendente">Cadastro inativo — só você vê este cadastro
        <button type="button" class="link-pagar" onclick="reativarGratis('${e.id}')">🎁 Ativar Pacote Grátis agora</button>
        <a href="${linkDoPlano('completo')}" class="link-pagar">💳 Pagar Pacote Completo (R$10/mês)</a>
        <div class="cupom-row">
          <input type="text" id="cupom-input-${e.id}" placeholder="Tem um cupom?" class="cupom-input">
          <button type="button" class="btn-cupom" onclick="aplicarCupom('${e.id}')">Aplicar</button>
        </div>
        <span class="cupom-msg" id="cupom-msg-${e.id}"></span>
        <span class="cupom-msg" id="reativar-msg-${e.id}"></span>
        <div class="aviso-espera">⏳ Já pagou pelo Pacote Completo? Pode levar até 15 minutos pra ativar sozinho. Não precisa pagar de novo nem criar outro cadastro — só aguardar.</div>
      </div>` : ''}
      <img class="avatar" src="${e.foto ? escapeHtml(e.foto) : 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(e.name)}" alt="${escapeHtml(e.name)}">
      <div class="info">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <h3>${escapeHtml(e.name)}${e.verificado ? ' <span title="Verificado pelo GuiaZap" class="selo-verificado">✅</span>' : ''}</h3>
          <div style="display:flex; align-items:center; gap:4px;">
            <button class="icon-btn-favorito" title="Favoritar" onclick="toggleFavorito('${e.id}', event)">${favoritosEmpresas.has(e.id) ? '❤️' : '🤍'}</button>
            ${isOwner ? `<span class="owner-actions">
              <button class="icon-btn" title="Editar" onclick="editEntry('${e.id}')">✎</button>
              <button class="icon-btn" title="Excluir" onclick="deleteEntry('${e.id}')">✕</button>
            </span>` : ''}
          </div>
        </div>
        <div class="categoria">${escapeHtml(e.cat)}${e.categorias_extra ? ' · ' + e.categorias_extra.split('\n').map(c=>escapeHtml(c.trim())).filter(Boolean).join(', ') : ''}</div>
        <div class="local">${escapeHtml(e.cidade)} · ${escapeHtml(e.bairro)}</div>
        <div class="stars">
          ${count > 0 ? `${starString(media)} <span class="num">${media.toFixed(1)}</span> <span class="review-count">(${count} avaliação${count > 1 ? 'ões' : ''})</span>` : '<span class="sem-avaliacao">Ainda sem avaliações</span>'}
          ${jaAvaliou(e.id) ? '<span class="ja-avaliou">Você já avaliou</span>' : `<button type="button" class="link-avaliar" onclick="abrirAvaliacao('${e.id}')">Avaliar</button>`}
          ${count > 0 ? `<button type="button" class="link-avaliar" onclick="toggleVerAvaliacoes('${e.id}')">Ver avaliações</button>` : ''}
        </div>
        <div class="lista-avaliacoes" id="lista-avaliacoes-${e.id}" style="display:none;"></div>
        ${isOwner ? `<div class="stat-visualizacoes">👁️ ${e.visualizacoes || 0} visualizaç${(e.visualizacoes || 0) === 1 ? 'ão' : 'ões'}</div>` : ''}
        ${isOwner && !pendente ? `<button type="button" class="link-cancelar" onclick="cancelarAssinatura()">Desativar cadastro</button>` : ''}
        ${isOwner ? `<button type="button" class="link-ver-denuncias" onclick="toggleDenunciasRecebidas('${e.id}')">🚩 Ver denúncias recebidas</button>
        <div class="denuncias-recebidas-box" id="denuncias-recebidas-${e.id}" style="display:none;"></div>` : ''}
        ${isOwner && !pendente && e.plano !== 'completo' ? `<a href="${LINK_ASSINATURA_COMPLETO}" class="link-migrar">✨ Migrar para o Pacote Completo (R$10/mês) e anunciar na Vitrine</a>` : ''}
        <div class="card-acoes-extra">
          <button type="button" class="link-compartilhar" onclick="toggleMenuCompartilharCadastro('${e.id}', '${escapeHtml(e.name).replace(/'/g, "\\'")}')">Compartilhar</button>
          <div class="menu-compartilhar" id="menu-compartilhar-cad-${e.id}" style="display:none;"></div>
          ${!isOwner ? `<button type="button" class="link-denunciar" onclick="abrirDenuncia('${e.id}')">Denunciar</button>` : ''}
          ${!isOwner ? `<button type="button" class="link-mensagem" onclick="abrirMensagemEmpresa('${e.id}')">💬 Reclamar/Sugerir pra empresa</button>` : ''}
          ${isOwner ? `<button type="button" class="link-ver-denuncias" onclick="toggleMensagensRecebidas('${e.id}')">💬 Ver mensagens recebidas</button>` : ''}
        </div>
        ${isOwner ? `<div class="mensagens-recebidas-box" id="mensagens-recebidas-${e.id}" style="display:none;"></div>` : ''}
        <div class="mensagem-box" id="mensagem-box-${e.id}" style="display:none;">
          <select id="mensagem-tipo-${e.id}" class="review-input">
            <option value="reclamacao">Reclamação</option>
            <option value="sugestao">Sugestão</option>
          </select>
          <textarea id="mensagem-texto-${e.id}" class="review-input" rows="3" placeholder="Escreva sua mensagem para a empresa"></textarea>
          <div class="review-actions">
            <button type="button" class="btn-auth" onclick="enviarMensagemEmpresa('${e.id}')">Enviar</button>
            <span class="review-msg" id="mensagem-msg-${e.id}"></span>
          </div>
        </div>
        <div class="denuncia-box" id="denuncia-box-${e.id}" style="display:none;">
          <select id="denuncia-motivo-${e.id}" class="review-input">
            <option value="">Selecione o motivo</option>
            <option value="Golpe ou fraude suspeita">Golpe ou fraude suspeita</option>
            <option value="Cadastro falso">Cadastro falso</option>
            <option value="Conteudo ofensivo">Conteúdo ofensivo</option>
            <option value="Categoria incorreta">Categoria incorreta</option>
            <option value="Outro">Outro</option>
          </select>
          <textarea id="denuncia-descricao-${e.id}" class="review-input" rows="2" placeholder="Descreva o problema (opcional)"></textarea>
          <div class="review-actions">
            <button type="button" class="btn-auth" onclick="enviarDenuncia('${e.id}')">Enviar denúncia</button>
            <span class="review-msg" id="denuncia-msg-${e.id}"></span>
          </div>
        </div>
        <div class="review-box" id="review-box-${e.id}" style="display:none;">
          <div class="review-stars" id="review-stars-${e.id}">
            ${[1,2,3,4,5].map(n => `<span onclick="selecionarNota('${e.id}', ${n})">☆</span>`).join('')}
          </div>
          <textarea id="review-comentario-${e.id}" placeholder="Comentário (opcional)" class="review-input" rows="2"></textarea>
          <div class="review-actions">
            <button type="button" class="btn-auth" onclick="enviarAvaliacao('${e.id}')">Enviar avaliação</button>
            <span class="review-msg" id="review-msg-${e.id}"></span>
          </div>
        </div>
        <div class="contatos-row">
          <a class="btn-zap" href="https://wa.me/55${e.whatsapp}" target="_blank">Chamar no WhatsApp</a>
          ${renderContatosExtra(e.contatos_extra)}
        </div>
        ${e.plano === 'completo' ? `<a href="vitrine.html?empresa=${e.id}" class="link-ver-produtos">🛍️ Ver produtos desta empresa</a>` : ''}
        ${isOwner && e.plano === 'completo' ? `<a href="talentos.html" class="link-ver-produtos" style="background:#6b46c1;">🎯 Consultar Banco de Talentos</a>` : ''}
      </div>
    </div>
  `; }).join('');
}

function normalizarTexto(str){
  return (str || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

if(initSupabase()){
  initAuth();
  loadEntries();
}

renderHistoricoBusca();

if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(err => console.error('erro ao registrar service worker', err));
  });
}