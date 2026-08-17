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
  const { data, error } = await supabaseClient.from('profissionais').select('*').order('name', { ascending: true });
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

async function loadAvaliacoes(){
  const { data, error } = await supabaseClient.from('avaliacoes').select('profissional_id, nota');
  if(error){ console.error(error); return; }

  avaliacoesMap = {};
  data.forEach(a => {
    if(!avaliacoesMap[a.profissional_id]) avaliacoesMap[a.profissional_id] = { soma: 0, count: 0 };
    avaliacoesMap[a.profissional_id].soma += a.nota;
    avaliacoesMap[a.profissional_id].count += 1;
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
    datalistEl.innerHTML = cidades.map(c => `<option value="${escapeHtml(c.nome)}">`).join('');
  } catch(e){
    console.error('erro ao buscar cidades do IBGE', e);
  }
}

function onEstadoCadastroChange(){
  const uf = document.getElementById('f-estado').value;
  buscarCidadesIBGE(uf, document.getElementById('cidades-cadastro-list'));
}

function onEstadoFiltroChange(){
  const uf = document.getElementById('filter-estado').value;
  buscarCidadesIBGE(uf, document.getElementById('cidades-filtro-list'));
  document.getElementById('filter-cidade').value = '';
  onCidadeFiltroChange();
}

function onCidadeFiltroChange(){
  populateBairrosFiltro();
  render();
}

function populateBairrosFiltro(){
  const estado = document.getElementById('filter-estado').value;
  const cidade = document.getElementById('filter-cidade').value;
  const bairroSel = document.getElementById('filter-bairro');
  const bairros = [...new Set(entries.filter(e => (!estado || e.estado === estado) && (!cidade || e.cidade === cidade)).map(e => e.bairro))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  bairroSel.innerHTML = '<option value="">Bairro</option>' + bairros.map(b => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
}

async function buscarCepFiltro(){
  const cepInput = document.getElementById('filter-cep');
  const msg = document.getElementById('filter-cep-msg');
  const cep = cepInput.value.replace(/\D/g,'');
  if(cep.length !== 8){ msg.textContent = cep.length > 0 ? 'CEP deve ter 8 números' : ''; return; }

  msg.textContent = 'buscando...';
  try{
    const resp = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const data = await resp.json();
    if(data.erro){ msg.textContent = 'CEP não encontrado'; return; }

    document.getElementById('filter-estado').value = data.uf || '';
    await buscarCidadesIBGE(data.uf, document.getElementById('cidades-filtro-list'));
    document.getElementById('filter-cidade').value = data.localidade || '';
    populateBairrosFiltro();
    document.getElementById('filter-bairro').value = data.bairro || '';
    msg.textContent = 'filtro aplicado';
    render();
  } catch(e){
    msg.textContent = 'erro ao buscar CEP';
  }
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

function openForm(entry){
  if(!currentUser) return;
  const form = document.getElementById('cadastro-form');
  form.classList.add('open');
  document.getElementById('form-msg').textContent = '';
  document.getElementById('edit-id').value = entry ? entry.id : '';
  document.getElementById('f-name').value = entry ? entry.name : '';
  document.getElementById('f-documento').value = entry ? (entry.documento || '') : '';
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
    const { data: existentes } = await supabaseClient
      .from('profissionais')
      .select('id, name')
      .eq('documento', payload.documento)
      .eq('estado', payload.estado)
      .eq('cidade', payload.cidade)
      .eq('bairro', payload.bairro);

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
  if(!confirm('Tem certeza que deseja cancelar sua assinatura? Seu cadastro deixará de aparecer na busca até você assinar novamente.')) return;

  const { data: { session } } = await supabaseClient.auth.getSession();
  if(!session){ alert('Sessão expirada, faça login novamente.'); return; }

  try{
    const resp = await fetch('/.netlify/functions/cancelar-assinatura', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
    const data = await resp.json();
    if(!resp.ok){
      alert('Erro ao cancelar: ' + (data.error || 'tente novamente'));
      return;
    }
    alert('Assinatura cancelada. Seu cadastro ficou pendente até uma nova assinatura.');
    await loadEntries();
  } catch(e){
    alert('Erro ao cancelar assinatura. Tente novamente.');
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

function abrirDenuncia(id){
  const box = document.getElementById('denuncia-box-' + id);
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
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

async function loadProdutosDestaque(){
  const container = document.getElementById('destaque-produtos-lista');
  if(!container) return;

  const { data, error } = await supabaseClient
    .from('produtos')
    .select('*, profissionais(name, whatsapp, status_pagamento)')
    .order('created_at', { ascending: false })
    .limit(20);

  if(error || !data){
    container.innerHTML = '';
    document.querySelector('.destaque-vitrine').style.display = 'none';
    return;
  }

  const produtosAtivos = data.filter(p => p.profissionais && p.profissionais.status_pagamento === 'ativo');

  if(produtosAtivos.length === 0){
    document.querySelector('.destaque-vitrine').style.display = 'none';
    return;
  }

  // Embaralha um pouco e limita a 10, pra dar visibilidade variada entre empresas diferentes
  const embaralhados = produtosAtivos.sort(() => Math.random() - 0.5).slice(0, 10);

  container.innerHTML = embaralhados.map(p => `
    <div class="destaque-card">
      <img src="${p.foto ? escapeHtml(p.foto) : 'https://api.dicebear.com/7.x/shapes/svg?seed=' + encodeURIComponent(p.nome)}" alt="${escapeHtml(p.nome)}">
      <div class="destaque-info">
        <div class="destaque-nome">${escapeHtml(p.nome)}</div>
        ${p.preco ? `<div class="destaque-preco">R$ ${escapeHtml(p.preco)}</div>` : ''}
        <div class="destaque-empresa">${p.profissionais ? escapeHtml(p.profissionais.name) : ''}</div>
        <a href="vitrine.html?produto=${p.id}" class="destaque-btn">Ver produto</a>
      </div>
    </div>
  `).join('');
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

function render(){
  const list = document.getElementById('list');
  const query = document.getElementById('search').value.toLowerCase();
  const estado = document.getElementById('filter-estado').value;
  const cidade = document.getElementById('filter-cidade').value;
  const bairro = document.getElementById('filter-bairro').value;

  const cidadeBusca = cidade.toLowerCase();
  const filtered = cadastroCompartilhadoId
    ? entries.filter(e => e.id === cadastroCompartilhadoId && e.status_pagamento === 'ativo')
    : entries
    .filter(e => currentUser ? e.user_id === currentUser.id : e.status_pagamento === 'ativo')
    .filter(e => e.name.toLowerCase().includes(query) || e.cat.toLowerCase().includes(query) || (e.categorias_extra || '').toLowerCase().includes(query))
    .filter(e => !estado || e.estado === estado)
    .filter(e => !cidadeBusca || e.cidade.toLowerCase().includes(cidadeBusca))
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
    return `
    <div class="card-profissional${pendente ? ' card-pendente' : ''}">
      ${isOwner && pendente ? `<div class="badge-pendente">Pagamento pendente — só você vê este cadastro
        <a href="${linkDoPlano(e.plano)}" class="link-pagar">Pagar agora</a>
        <div class="cupom-row">
          <input type="text" id="cupom-input-${e.id}" placeholder="Tem um cupom?" class="cupom-input">
          <button type="button" class="btn-cupom" onclick="aplicarCupom('${e.id}')">Aplicar</button>
        </div>
        <span class="cupom-msg" id="cupom-msg-${e.id}"></span>
      </div>` : ''}
      <img class="avatar" src="${e.foto ? escapeHtml(e.foto) : 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(e.name)}" alt="${escapeHtml(e.name)}">
      <div class="info">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <h3>${escapeHtml(e.name)}</h3>
          ${isOwner ? `<span class="owner-actions">
            <button class="icon-btn" title="Editar" onclick="editEntry('${e.id}')">✎</button>
            <button class="icon-btn" title="Excluir" onclick="deleteEntry('${e.id}')">✕</button>
          </span>` : ''}
        </div>
        <div class="categoria">${escapeHtml(e.cat)}${e.categorias_extra ? ' · ' + e.categorias_extra.split('\n').map(c=>escapeHtml(c.trim())).filter(Boolean).join(', ') : ''}</div>
        <div class="local">${escapeHtml(e.cidade)} · ${escapeHtml(e.bairro)}</div>
        <div class="stars">
          ${count > 0 ? `${starString(media)} <span class="num">${media.toFixed(1)}</span> <span class="review-count">(${count} avaliação${count > 1 ? 'ões' : ''})</span>` : '<span class="sem-avaliacao">Ainda sem avaliações</span>'}
          ${jaAvaliou(e.id) ? '<span class="ja-avaliou">Você já avaliou</span>' : `<button type="button" class="link-avaliar" onclick="abrirAvaliacao('${e.id}')">Avaliar</button>`}
        </div>
        ${isOwner && !pendente ? `<button type="button" class="link-cancelar" onclick="cancelarAssinatura()">Cancelar assinatura</button>` : ''}
        ${isOwner && !pendente && e.plano !== 'completo' ? `<a href="${LINK_ASSINATURA_COMPLETO}" class="link-migrar">✨ Migrar para o Pacote Completo (R$10/mês) e anunciar na Vitrine</a>` : ''}
        <div class="card-acoes-extra">
          <button type="button" class="link-compartilhar" onclick="toggleMenuCompartilharCadastro('${e.id}', '${escapeHtml(e.name).replace(/'/g, "\\'")}')">Compartilhar</button>
          <div class="menu-compartilhar" id="menu-compartilhar-cad-${e.id}" style="display:none;"></div>
          ${!isOwner ? `<button type="button" class="link-denunciar" onclick="abrirDenuncia('${e.id}')">Denunciar</button>` : ''}
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
      </div>
    </div>
  `; }).join('');
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

if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(err => console.error('erro ao registrar service worker', err));
  });
}