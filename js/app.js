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

function toggleVerSenha(inputId, botao){
  const campo = document.getElementById(inputId);
  if(!campo) return;
  const escondida = campo.type === 'password';
  campo.type = escondida ? 'text' : 'password';
  botao.textContent = escondida ? '🙈' : '👁️';
}

function toggleAuthForm(){
  const box = document.getElementById('auth-form-fields');

  if(box.style.display === 'none'){
    box.innerHTML = `
      <form autocomplete="on" onsubmit="return false;">
        <div class="auth-row">
          <input id="auth-nome" type="text" placeholder="Seu nome (só pra criar conta nova)" autocomplete="name">
        </div>
        <div class="auth-row">
          <input id="auth-email" type="email" placeholder="Seu e-mail" autocomplete="email">
          <div class="campo-com-olho">
            <input id="auth-password" type="password" placeholder="Senha" autocomplete="current-password">
            <button type="button" class="btn-ver-senha" onclick="toggleVerSenha('auth-password', this)">👁️</button>
          </div>
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

async function toggleStatusDisponibilidade(profissionalId){
  const cadastro = entries.find(e => e.id === profissionalId);
  if(!cadastro) return;

  const novoStatus = cadastro.status_disponibilidade === 'atendimento' ? 'disponivel' : 'atendimento';
  const { error } = await supabaseClient.from('profissionais').update({ status_disponibilidade: novoStatus }).eq('id', profissionalId);
  if(error){ console.error(error); alert('Erro ao trocar o status. Tente de novo.'); return; }

  cadastro.status_disponibilidade = novoStatus;
  render();
}

function gerarCodigoGuiaZapAleatorio(){
  let codigo = 'GZ';
  for(let i = 0; i < 8; i++){ codigo += Math.floor(Math.random() * 10); }
  return codigo;
}

let meuCodigoGuiaZapAtual = null;

async function descobrirNomeParaExibicao(user){
  if(user.user_metadata?.nome) return user.user_metadata.nome;

  // Sem nome salvo no cadastro — tenta usar o nome da empresa dela, se for dona de alguma
  const { data: minhaEmpresa } = await supabaseClient.from('profissionais').select('name').eq('user_id', user.id).limit(1).maybeSingle();
  if(minhaEmpresa) return minhaEmpresa.name;

  return user.email.split('@')[0];
}

async function garantirCodigoGuiaZap(){
  if(!currentUser) return null;
  if(meuCodigoGuiaZapAtual) return meuCodigoGuiaZapAtual;

  const { data: perfilExistente } = await supabaseClient.from('perfis_usuario').select('codigo_guiazap, nome_exibicao').eq('user_id', currentUser.id).maybeSingle();
  if(perfilExistente){
    meuCodigoGuiaZapAtual = perfilExistente.codigo_guiazap;
    // Se por algum motivo o perfil existe mas ainda não tem nome salvo, completa agora
    if(!perfilExistente.nome_exibicao){
      const nomeDoCadastro = await descobrirNomeParaExibicao(currentUser);
      supabaseClient.from('perfis_usuario').update({ nome_exibicao: nomeDoCadastro }).eq('user_id', currentUser.id).then(() => {});
    }
    return meuCodigoGuiaZapAtual;
  }

  const nomeDoCadastro = await descobrirNomeParaExibicao(currentUser);

  // Primeira vez — gera um código novo e tenta salvar (tenta de novo se, por
  // pouquíssima chance, o código sortido já existir em outra pessoa)
  let codigoNovo = gerarCodigoGuiaZapAleatorio();
  let tentativas = 0;
  let salvo = false;

  while(!salvo && tentativas < 5){
    const { error } = await supabaseClient.from('perfis_usuario').insert({ user_id: currentUser.id, codigo_guiazap: codigoNovo, nome_exibicao: nomeDoCadastro });
    if(!error){ salvo = true; } else { codigoNovo = gerarCodigoGuiaZapAleatorio(); tentativas++; }
  }

  meuCodigoGuiaZapAtual = salvo ? codigoNovo : null;
  return meuCodigoGuiaZapAtual;
}

async function exibirBadgeMeuCodigoGuiaZap(){
  const codigo = await garantirCodigoGuiaZap();
  const badge = document.getElementById('meu-codigo-inline-box');
  const valor = document.getElementById('meu-codigo-inline-valor');
  if(!badge || !valor) return;
  if(codigo){
    valor.textContent = codigo;
    badge.style.display = 'block';
  }
}

async function mostrarMeuCodigoGuiaZap(){
  if(!currentUser) return;
  const box = document.getElementById('codigo-guiazap-box');
  const jaAberto = box.style.display === 'block';
  box.style.display = jaAberto ? 'none' : 'block';
  if(jaAberto) return;

  const input = document.getElementById('codigo-guiazap-input');
  input.value = 'carregando...';
  const codigo = await garantirCodigoGuiaZap();
  input.value = codigo || 'erro ao gerar, tente de novo';
}

function copiarCodigoGuiaZap(){
  const input = document.getElementById('codigo-guiazap-input');
  navigator.clipboard.writeText(input.value).then(() => {
    alert('Código copiado! Compartilhe com quem você quer que te encontre no chat.');
  }).catch(() => {
    input.select();
    alert('Selecione e copie manualmente (Ctrl+C).');
  });
}

function mostrarLinkIndicacao(){
  if(!currentUser) return;
  const box = document.getElementById('indicacao-box');
  const jaAberto = box.style.display === 'block';
  box.style.display = jaAberto ? 'none' : 'block';
  if(!jaAberto){
    const link = `${window.location.origin}/index.html?ref=${currentUser.id}`;
    document.getElementById('indicacao-link-input').value = link;
  }
}

async function copiarLinkIndicacao(){
  const input = document.getElementById('indicacao-link-input');
  try{
    await navigator.clipboard.writeText(input.value);
    alert('Link copiado! Compartilhe com outras empresas.');
  } catch(e){
    input.select();
    alert('Selecione e copie manualmente (Ctrl+C).');
  }
}

async function atualizarUltimoLogin(){
  if(!currentUser) return;
  const { error } = await supabaseClient.from('profissionais').update({ ultimo_login: new Date().toISOString() }).eq('user_id', currentUser.id);
  if(error){ console.error(error); return; }

  entries.forEach(e => { if(e.user_id === currentUser.id) e.ultimo_login = new Date().toISOString(); });
}

let _notifJaIniciado = false;

function tentarIniciarNotificacoes(){
  if(!currentUser){ _notifJaIniciado = false; return; }
  if(_notifJaIniciado || !loaded) return;
  _notifJaIniciado = true;
  const meusIds = entries.filter(e => e.user_id === currentUser.id).map(e => e.id);
  if(typeof initNotificacoes === 'function'){
    initNotificacoes({ supabaseClient, userId: currentUser.id, empresaIds: meusIds, escutarChamadas: true });
  }
}

async function updateAuthUI(){
  const loggedOutBox = document.getElementById('auth-logged-out');
  const loggedInBox = document.getElementById('auth-logged-in');
  const addBtn = document.getElementById('add-btn');

  await loadSeguindo();
  await loadContagemSeguidores();
  await carregarAgendaContatos();

  if(currentUser){
    loggedOutBox.style.display = 'none';
    loggedInBox.style.display = 'flex';
    document.getElementById('auth-email-display').textContent = currentUser.email;
    addBtn.style.display = 'block';
    abrirCadastroSePendente();
    abrirStorySeVindoDoProduto();
    abrirLoginSeVeioDoPapo();
    abrirFormVideoSePendente();
    atualizarUltimoLogin();
    atualizarVisibilidadeBotaoPush();
    exibirBadgeMeuCodigoGuiaZap();
    const btnChatFlutuante = document.getElementById('btn-chat-flutuante');
    if(btnChatFlutuante) btnChatFlutuante.style.display = 'flex';
  } else {
    loggedOutBox.style.display = 'block';
    loggedInBox.style.display = 'none';
    addBtn.style.display = 'none';
    document.getElementById('trocar-senha-box').style.display = 'none';
    closeForm();
    abrirStorySeVindoDoProduto();
    const btnChatFlutuante = document.getElementById('btn-chat-flutuante');
    if(btnChatFlutuante) btnChatFlutuante.style.display = 'none';
    abrirLoginSeVeioDoPapo();
    const btnPush = document.getElementById('btn-ativar-push');
    if(btnPush) btnPush.style.display = 'none';
  }
  render();
  renderStoriesLinha();
  tentarIniciarNotificacoes();
  atualizarVisibilidadeBotaoPush();
}

async function signUp(){
  const nome = document.getElementById('auth-nome').value.trim();
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const msg = document.getElementById('auth-msg');
  const aceitou = document.getElementById('aceite-termos').checked;

  if(!nome || !email || !password){ msg.textContent = 'preencha nome, e-mail e senha'; return; }
  if(!aceitou){ msg.textContent = 'você precisa aceitar os Termos de Uso e a Política de Privacidade'; return; }

  msg.textContent = 'criando conta...';
  const { error } = await supabaseClient.auth.signUp({
    email, password,
    options: { data: { nome, termos_aceitos_em: new Date().toISOString() } }
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
  modoGerenciarAtivo = false;
  meuCodigoGuiaZapAtual = null;
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

let denunciasPorEmpresa = {};

async function loadDenunciasPorEmpresa(){
  const { data, error } = await supabaseClient.rpc('empresas_com_denuncia');
  if(error){ console.error(error); return; }
  denunciasPorEmpresa = {};
  (data || []).forEach(d => { denunciasPorEmpresa[d.profissional_id] = true; });
  render();
}

async function loadContadorPlataforma(){
  const container = document.getElementById('contador-plataforma');
  if(!container) return;

  const [{ count: totalCadastros }, { count: totalProdutos }] = await Promise.all([
    supabaseClient.from('profissionais').select('id', { count: 'exact', head: true }).eq('status_pagamento', 'ativo'),
    supabaseClient.from('produtos').select('id', { count: 'exact', head: true })
  ]);

  if(totalCadastros === null && totalProdutos === null) return;

  container.textContent = `${totalCadastros ?? 0} profissionais e empresas cadastradas 🤝 ${totalProdutos ?? 0} produtos na Vitrine`;
}

async function loadEntries(){
  const { data, error } = await supabaseClient
    .from('profissionais')
    .select('id, name, cat, categorias_extra, estado, cidade, bairro, whatsapp, contatos_extra, foto, status_pagamento, plano, verificado, visualizacoes, created_at, user_id, notificar_seguidores, verificacao_pago, verificacao_status, verificacao_documento_url, verificacao_email_confirmado, verificacao_whatsapp_confirmado, latitude, longitude, horario_dias, horario_abre, horario_fecha, ultimo_login, status_disponibilidade, impulsionado_ate, veiculo_modelo, veiculo_placa, localizacao_confirmada_manualmente')
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

  // Carrega o status de conexão do Mercado Pago só pras empresas do
  // próprio usuário (é uma tabela separada e protegida por segurança)
  if(currentUser){
    const { data: conexoes } = await supabaseClient.from('mp_conexoes').select('profissional_id, conectado');
    if(conexoes){
      conexoes.forEach(c => {
        const entry = entries.find(e => e.id === c.profissional_id);
        if(entry) entry.mpConectado = c.conectado;
      });
    }
  }

  // As avaliações (estrelinhas) e produtos em destaque são só um "acabamento"
  // visual — não precisam travar a lista principal aparecendo. Rodam em
  // paralelo, e a tela atualiza sozinha assim que cada uma terminar.
  loadAvaliacoes().then(render);
  loadProdutosDestaque();

  const params = new URLSearchParams(window.location.search);
  cadastroCompartilhadoId = params.get('p');

  const mpConectadoStatus = params.get('mp_conectado');
  if(mpConectadoStatus === 'sucesso'){
    alert('✅ Mercado Pago conectado com sucesso! Os pagamentos dos pedidos dessa empresa agora vão direto pra sua conta.');
    window.history.replaceState({}, '', window.location.pathname);
  } else if(mpConectadoStatus === 'erro'){
    alert('⚠️ Não foi possível conectar sua conta do Mercado Pago. Tenta de novo, ou fala com a gente se continuar dando erro.');
    window.history.replaceState({}, '', window.location.pathname);
  }

  // Salva quem indicou (se veio de um link de indicação), pra usar quando a
  // pessoa cadastrar uma empresa nova. Nunca sobrescreve um "ref" já salvo
  // antes, senão o último link clicado sempre "roubaria" a indicação.
  const refParam = params.get('ref');
  if(refParam && !localStorage.getItem('indicado_por')){
    localStorage.setItem('indicado_por', refParam);
  }

  const planoParam = params.get('plano');
  if(planoParam === 'basico' || planoParam === 'completo' || planoParam === 'premium' || planoParam === 'vendas' || planoParam === 'entregador'){
    planoEscolhido = planoParam;
    localStorage.setItem('planoEscolhido', planoEscolhido);
    localStorage.setItem('abrirCadastroAposLogin', '1');
    // Limpa o "?plano=..." da URL, senão ele fica sendo lido de novo a cada recarregamento
    // e reabre o formulário sozinho toda vez (inclusive depois de já ter salvo).
    window.history.replaceState({}, '', window.location.pathname);
  }

  abrirCadastroSePendente();
  abrirStorySeVindoDoProduto();
  loadContagemSeguidores().then(render);
  render();
  tentarIniciarNotificacoes();
  atualizarVisibilidadeBotaoPush();

  const btnPedidos = document.getElementById('btn-meus-pedidos');
  if(btnPedidos){
    const temEmpresaVendas = currentUser && entries.some(e => e.user_id === currentUser.id && e.plano === 'vendas');
    btnPedidos.style.display = temEmpresaVendas ? 'block' : 'none';
  }

  const btnMinhasCompras = document.getElementById('btn-minhas-compras');
  if(btnMinhasCompras){
    btnMinhasCompras.style.display = currentUser ? 'block' : 'none';
  }
}

function abrirCadastroSePendente(){
  if(currentUser && localStorage.getItem('abrirCadastroAposLogin') === '1'){
    localStorage.removeItem('abrirCadastroAposLogin');
    setTimeout(() => openForm(), 300);
  }
}

function abrirFormVideoSePendente(){
  if(!currentUser) return;
  const pendente = localStorage.getItem('abrirFormVideoAoCarregar');
  if(!pendente) return;
  localStorage.removeItem('abrirFormVideoAoCarregar');

  try{
    const { profissionalId, plano } = JSON.parse(pendente);
    if(profissionalId) setTimeout(() => abrirFormVideo(profissionalId, plano), 400);
  } catch(e){ console.error(e); }
}

function abrirLoginSeVeioDoPapo(){
  if(localStorage.getItem('abrirCadastroPapoAoCarregar') !== '1') return;

  if(currentUser){
    localStorage.removeItem('abrirCadastroPapoAoCarregar');
    window.location.href = 'chat.html';
    return;
  }

  const authBox = document.getElementById('auth-form-fields');
  if(authBox.style.display === 'none') toggleAuthForm();

  const msg = document.getElementById('auth-msg');
  if(msg) msg.textContent = '🔒 Crie uma conta (ou entre na sua) pra poder usar o Papo';

  setTimeout(() => {
    document.getElementById('auth-logged-out').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 300);
}

function abrirStorySeVindoDoProduto(){
  const produtoId = localStorage.getItem('criarStoryProdutoId');
  const empresaId = localStorage.getItem('criarStoryEmpresaId');
  if(!produtoId || !empresaId) return;

  if(!currentUser){
    // Ainda não logado: mostra a área de login com uma mensagem clara, sem apagar
    // os dados salvos — assim que a pessoa logar, a gente continua de onde parou.
    const authBox = document.getElementById('auth-form-fields');
    if(authBox.style.display === 'none') toggleAuthForm();
    const msg = document.getElementById('auth-msg');
    if(msg) msg.textContent = '📸 Faça login pra colocar esse produto no seu Story';
    document.getElementById('auth-logged-out').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const minhaEmpresa = entries.find(e => e.id === empresaId && e.user_id === currentUser.id);
  if(!minhaEmpresa) return; // ainda não carregou a lista de cadastros — tenta de novo na próxima chamada

  // Só apaga o "lembrete" DEPOIS de confirmar que vai conseguir abrir de verdade
  localStorage.removeItem('criarStoryProdutoId');
  localStorage.removeItem('criarStoryEmpresaId');

  abrirFormStory(minhaEmpresa.id, minhaEmpresa.plano);
  setTimeout(() => {
    const selectProduto = document.getElementById('story-produto-id');
    if(selectProduto){
      selectProduto.value = produtoId;
      onProdutoStoryChange();
    }
  }, 600);
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
    await popularSelectCidadesFiltro(data.uf);
    document.getElementById('gz-localidade-busca').value = data.localidade || '';
    populateBairrosFiltro();
    document.getElementById('filter-bairro').value = data.bairro || '';
    msg.textContent = 'filtro aplicado';
    render();
    atualizarBotoesLimpar();
  } catch(e){
    msg.textContent = 'erro ao buscar CEP';
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
const LINK_ASSINATURA_PREMIUM = "https://mpago.la/2JLXkQM"; // Plano Premium (R$25/mês) criado no Mercado Pago
const LINK_ASSINATURA_VENDAS = "https://mpago.la/1HiQNoL"; // Plano Vendas (R$40/mês, 30 dias de teste grátis) criado no Mercado Pago
const LINK_ASSINATURA_ENTREGADOR = "https://mpago.la/2wYvctj"; // Pacote Entregador (R$10/mês) criado no Mercado Pago

// O Pacote Vendas inclui tudo do Premium — então em qualquer lugar que
// diferencia "tem Premium", o Vendas também deve contar.
function ehPremiumOuVendas(plano){
  return plano === 'premium' || plano === 'vendas';
}
const LINK_SELO_VERIFICADO = "https://mpago.la/13aLx8F"; // Selo Verificado (R$15, pagamento único) criado no Mercado Pago
const LINK_IMPULSIONAR = "https://mpago.la/2rGLFyJ"; // Impulsionamento avulso (R$5, pagamento único) criado no Mercado Pago
const WHATSAPP_ADMIN_GUIAZAP = "5546999209402"; // número do WhatsApp do GuiaZap que recebe a confirmação
const LINK_ASSINATURA = LINK_ASSINATURA_COMPLETO; // mantém compatibilidade com o código já existente

let planoEscolhido = localStorage.getItem('planoEscolhido') || 'basico';

function linkDoPlano(plano){
  if(plano === 'entregador') return LINK_ASSINATURA_ENTREGADOR;
  if(plano === 'vendas') return LINK_ASSINATURA_VENDAS;
  if(plano === 'premium') return LINK_ASSINATURA_PREMIUM;
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
  document.getElementById('f-latitude-manual').value = (entry && entry.localizacao_confirmada_manualmente) ? entry.latitude : '';
  document.getElementById('f-longitude-manual').value = (entry && entry.localizacao_confirmada_manualmente) ? entry.longitude : '';
  document.getElementById('localizacao-confirmada-msg').textContent = (entry && entry.localizacao_confirmada_manualmente) ? '✓ Localização já marcada anteriormente' : '';
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
  const planoDoFormulario = entry ? entry.plano : planoEscolhido;
  document.getElementById('campo-veiculo-entregador').style.display = planoDoFormulario === 'entregador' ? 'block' : 'none';
  document.getElementById('f-veiculo-modelo').value = entry ? (entry.veiculo_modelo || '') : '';
  document.getElementById('f-veiculo-placa').value = entry ? (entry.veiculo_placa || '') : '';
  document.getElementById('f-foto').value = entry ? (entry.foto || '') : '';
  document.getElementById('foto-msg').textContent = '';
  const preview = document.getElementById('foto-preview');
  if(entry && entry.foto){ preview.src = entry.foto; preview.style.display = 'block'; }
  else { preview.style.display = 'none'; }
  carregarContatosExtra(entry ? (entry.contatos_extra || '') : '');
  carregarCategoriasExtra(entry ? (entry.categorias_extra || '') : '');

  const diasSalvos = entry && entry.horario_dias ? entry.horario_dias.split(',') : [];
  document.querySelectorAll('.f-horario-dia').forEach(el => { el.checked = diasSalvos.includes(el.value); });
  document.getElementById('f-horario-abre').value = entry ? (entry.horario_abre || '') : '';
  document.getElementById('f-horario-fecha').value = entry ? (entry.horario_fecha || '') : '';

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

  const { error } = await supabaseClient.storage.from('fotos').upload(nomeArquivo, file);
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
  if(url && !/^https?:\/\//i.test(url)){
    preview.style.display = 'none';
    return;
  }
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

async function geocodificarCadastro(profissionalId, cidade, bairro, estado){
  try{
    const resp = await fetch(`/.netlify/functions/geocodificar-endereco?cidade=${encodeURIComponent(cidade)}&bairro=${encodeURIComponent(bairro)}&estado=${encodeURIComponent(estado)}`);
    const data = await resp.json();
    if(!data.encontrado) return;

    await supabaseClient.from('profissionais').update({ latitude: data.latitude, longitude: data.longitude }).eq('id', profissionalId);

    const cadastro = entries.find(e => e.id === profissionalId);
    if(cadastro){ cadastro.latitude = data.latitude; cadastro.longitude = data.longitude; }
  } catch(e){
    console.error('erro ao estimar localização', e);
  }
}

// ---------- MAPA DE LOCALIZAÇÃO EXATA (cadastro de empresa) ----------

let _mapaLocalizacaoCadastro = null;
let _marcadorLocalizacaoCadastro = null;

function abrirMapaLocalizacao(){
  document.getElementById('overlay-mapa-localizacao').style.display = 'flex';

  // Ponto de partida: usa a lat/lng já marcada antes (se estiver editando),
  // senão tenta pela cidade digitada, senão cai num centro genérico do Brasil
  const latAtual = parseFloat(document.getElementById('f-latitude-manual').value) || -14.235;
  const lngAtual = parseFloat(document.getElementById('f-longitude-manual').value) || -51.9253;
  const zoomInicial = document.getElementById('f-latitude-manual').value ? 17 : 4;

  setTimeout(() => {
    if(!_mapaLocalizacaoCadastro){
      _mapaLocalizacaoCadastro = L.map('mapa-localizacao-area').setView([latAtual, lngAtual], zoomInicial);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(_mapaLocalizacaoCadastro);

      _marcadorLocalizacaoCadastro = L.marker([latAtual, lngAtual], { draggable: true }).addTo(_mapaLocalizacaoCadastro);

      _mapaLocalizacaoCadastro.on('click', (e) => {
        _marcadorLocalizacaoCadastro.setLatLng(e.latlng);
      });
    } else {
      _mapaLocalizacaoCadastro.invalidateSize();
      _mapaLocalizacaoCadastro.setView([latAtual, lngAtual], zoomInicial);
      _marcadorLocalizacaoCadastro.setLatLng([latAtual, lngAtual]);
    }
  }, 100);
}

function fecharMapaLocalizacao(){
  document.getElementById('overlay-mapa-localizacao').style.display = 'none';
}

function usarMinhaLocalizacaoAtual(){
  if(!navigator.geolocation){ alert('Seu navegador não suporta GPS.'); return; }
  navigator.geolocation.getCurrentPosition((pos) => {
    const latlng = [pos.coords.latitude, pos.coords.longitude];
    _mapaLocalizacaoCadastro.setView(latlng, 18);
    _marcadorLocalizacaoCadastro.setLatLng(latlng);
  }, () => {
    alert('Não consegui pegar sua localização. Permite o acesso ao GPS, ou marca manualmente no mapa.');
  });
}

function confirmarLocalizacaoMapa(){
  const pos = _marcadorLocalizacaoCadastro.getLatLng();
  document.getElementById('f-latitude-manual').value = pos.lat;
  document.getElementById('f-longitude-manual').value = pos.lng;
  document.getElementById('localizacao-confirmada-msg').textContent = `✓ Localização marcada (${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)})`;
  fecharMapaLocalizacao();
}

async function saveEntry(e){
  e.preventDefault();
  if(!currentUser){ alert('Você precisa entrar na sua conta para cadastrar.'); return false; }

  const documentoDigitos = document.getElementById('f-documento').value.replace(/\D/g, '');
  const msgDocumento = document.getElementById('f-documento-msg');

  if(documentoDigitos.length === 11 && !validarCPF(documentoDigitos)){
    if(msgDocumento){ msgDocumento.textContent = '⚠️ Esse CPF não é válido — corrija antes de salvar'; msgDocumento.style.color = '#a4402f'; }
    document.getElementById('f-documento').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  }

  if(documentoDigitos.length === 14 && !validarCNPJ(documentoDigitos)){
    if(msgDocumento){ msgDocumento.textContent = '⚠️ Esse CNPJ não é válido — corrija antes de salvar'; msgDocumento.style.color = '#a4402f'; }
    document.getElementById('f-documento').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  }

  if(documentoDigitos.length !== 11 && documentoDigitos.length !== 14){
    if(msgDocumento){ msgDocumento.textContent = '⚠️ Digite um CPF (11 números) ou CNPJ (14 números) válido'; msgDocumento.style.color = '#a4402f'; }
    document.getElementById('f-documento').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  }

  const id = document.getElementById('edit-id').value;
  const cadastroExistente = id ? entries.find(e => e.id === id) : null;
  const planoAtualDoCadastro = cadastroExistente ? cadastroExistente.plano : planoEscolhido;

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
    categorias_extra: coletarCategoriasExtra(),
    horario_dias: Array.from(document.querySelectorAll('.f-horario-dia:checked')).map(el => el.value).join(',') || null,
    horario_abre: document.getElementById('f-horario-abre').value || null,
    horario_fecha: document.getElementById('f-horario-fecha').value || null,
    veiculo_modelo: planoAtualDoCadastro === 'entregador' ? document.getElementById('f-veiculo-modelo').value.trim() : null,
    veiculo_placa: planoAtualDoCadastro === 'entregador' ? document.getElementById('f-veiculo-placa').value.trim().toUpperCase() : null
  };
  // Se a empresa marcou a localização exata no mapa, usa esses valores em
  // vez de deixar a geocodificação automática (por cidade/bairro) sobrescrever
  const latManual = document.getElementById('f-latitude-manual').value;
  const lngManual = document.getElementById('f-longitude-manual').value;
  if(latManual && lngManual){
    payload.latitude = parseFloat(latManual);
    payload.longitude = parseFloat(lngManual);
    payload.localizacao_confirmada_manualmente = true;
  }
  if(!payload.name || !payload.documento || !payload.cat || !payload.estado || !payload.cidade || !payload.bairro || !payload.whatsapp) return false;
  if(planoAtualDoCadastro === 'entregador' && (!payload.veiculo_modelo || !payload.veiculo_placa)){
    document.getElementById('form-msg').textContent = 'Preencha o modelo da moto e a placa — obrigatório pro Pacote Entregador (segurança pra quem vai te contratar).';
    return false;
  }
  if(payload.foto && !/^https?:\/\//i.test(payload.foto)){
    document.getElementById('form-msg').textContent = 'O link da foto precisa começar com http:// ou https://';
    return false;
  }

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

    // Se a pessoa veio de um link de indicação (e não está se auto-indicando), guarda quem indicou
    const indicadoPor = localStorage.getItem('indicado_por');
    if(indicadoPor && indicadoPor !== currentUser.id){
      payload.indicado_por = indicadoPor;
    }

    const { data: inserido, error: errInsert } = await supabaseClient.from('profissionais').insert(payload).select('id').single();
    error = errInsert;
    novoCadastroId = inserido ? inserido.id : null;
  }
  if(error){ console.error(error); msg.textContent = 'erro ao salvar'; return false; }
  closeForm();
  await loadEntries();
  populateBairrosFiltro();

  // Estima a localização (latitude/longitude) a partir da cidade/bairro, em segundo
  // plano — não trava a tela esperando isso, já que não é essencial pro cadastro salvar.
  // Pula essa etapa se a empresa já marcou a localização exata no mapa.
  const idParaGeocodificar = id || novoCadastroId;
  if(idParaGeocodificar && !payload.localizacao_confirmada_manualmente){
    geocodificarCadastro(idParaGeocodificar, payload.cidade, payload.bairro, payload.estado);
  }

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

// Função reutilizável — leva pro chat com o conteúdo pronto pra escolher pra
// quem enviar. Funciona em qualquer página que incluir esse arquivo (app.js).
function compartilharNoChat(url, titulo){
  const conteudo = { url, titulo };
  window.location.href = `chat.html?compartilhar=${encodeURIComponent(JSON.stringify(conteudo))}`;
}

function mostrarQrCode(id){
  const box = document.getElementById('qrcode-box-' + id);
  if(!box) return;

  const jaAberto = box.style.display === 'block';
  document.querySelectorAll('.qrcode-box').forEach(b => { b.style.display = 'none'; });
  if(jaAberto) return;

  const link = `${window.location.origin}/index.html?p=${id}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(link)}`;

  box.innerHTML = `
    <img src="${qrUrl}" alt="QR Code do seu perfil" style="width:100%; max-width:220px; display:block; margin:8px auto;">
    <p style="text-align:center; font-size:0.75rem; color:#666;">Imprime e cola na sua loja — quem escanear vai direto pro seu perfil no GuiaZap</p>
    <a href="${qrUrl}" download="qrcode-guiazap.png" class="link-compartilhar" style="display:block; text-align:center; text-decoration:none;">⬇ Baixar imagem</a>
  `;
  box.style.display = 'block';
}

function fecharTodosMenusFlutuantes(){
  document.querySelectorAll('.card-acoes-extra, .menu-compartilhar, .orcamento-opcoes').forEach(el => { el.style.display = 'none'; });
  const painelFiltros = document.getElementById('filtros-avancados');
  if(painelFiltros) painelFiltros.style.display = 'none';
  const btnFiltros = document.getElementById('btn-abrir-filtros');
  if(btnFiltros) btnFiltros.classList.remove('aberto');
}

function toggleOrcamentoOpcoes(id){
  const box = document.getElementById('orcamento-opcoes-' + id);
  if(!box) return;
  const jaAberto = box.style.display === 'flex';
  fecharTodosMenusFlutuantes();
  box.style.display = jaAberto ? 'none' : 'flex';
}

function toggleFiltrosAvancados(){
  const painel = document.getElementById('filtros-avancados');
  const btn = document.getElementById('btn-abrir-filtros');
  if(!painel) return;
  const abrindo = painel.style.display === 'none';
  fecharTodosMenusFlutuantes();
  painel.style.display = abrindo ? 'block' : 'none';
  if(btn) btn.classList.toggle('aberto', abrindo);
}

function atualizarBadgeFiltrosAtivos(){
  const badge = document.getElementById('badge-filtros-ativos');
  if(!badge) return;

  let contador = 0;
  if(document.getElementById('filter-cep')?.value) contador++;
  if(document.getElementById('filter-estado')?.value) contador++;
  if(document.getElementById('gz-localidade-busca')?.value) contador++;
  if(document.getElementById('filter-bairro')?.value) contador++;
  if(mostrandoSoFavoritos) contador++;
  if(mostrandoSoSeguindo) contador++;
  if(filtroMaisProximosAtivo) contador++;
  if(filtroMelhorAvaliadosAtivo) contador++;
  if(filtroPremiumRapidoAtivo) contador++;
  if(filtroAbertoAgoraAtivo) contador++;

  if(contador > 0){
    badge.textContent = contador;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

function toggleOpcoesExtra(id){
  const box = document.getElementById('opcoes-extra-' + id);
  if(!box) return;
  const jaAberto = box.style.display === 'flex';
  fecharTodosMenusFlutuantes();
  box.style.display = jaAberto ? 'none' : 'flex';
}

function toggleMenuCompartilharCadastro(id, nome){
  const menu = document.getElementById('menu-compartilhar-cad-' + id);
  const jaAberto = menu.style.display === 'block';
  fecharTodosMenusFlutuantes();
  if(jaAberto) return;

  const link = `${window.location.origin}/index.html?p=${id}`;
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
  const link = `${window.location.origin}/index.html?p=${id}`;
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

let seguindoEmpresas = new Set();

async function loadSeguindo(){
  if(!currentUser){ seguindoEmpresas = new Set(); return; }
  const { data, error } = await supabaseClient.from('seguidores').select('profissional_id').eq('user_id', currentUser.id);
  if(error){ console.error(error); return; }
  seguindoEmpresas = new Set((data || []).map(s => s.profissional_id));
}

let contagemSeguidoresPorEmpresa = {};
let listaSeguidoresPorEmpresa = {};

async function loadContagemSeguidores(){
  contagemSeguidoresPorEmpresa = {};
  listaSeguidoresPorEmpresa = {};
  if(!currentUser) return;

  const minhasEmpresasPremium = entries.filter(e => e.user_id === currentUser.id && ehPremiumOuVendas(e.plano));
  if(minhasEmpresasPremium.length === 0) return;

  for(const empresa of minhasEmpresasPremium){
    const { data, error } = await supabaseClient
      .from('seguidores')
      .select('user_email, user_nome, created_at')
      .eq('profissional_id', empresa.id)
      .order('created_at', { ascending: false });
    if(!error){
      listaSeguidoresPorEmpresa[empresa.id] = data || [];
      contagemSeguidoresPorEmpresa[empresa.id] = (data || []).length;
    }
  }
}

async function carregarAgendaContatos(){
  contatosSalvosUserIds = new Set();
  contatosSalvosProfissionalIds = new Set();
  if(!currentUser) return;

  const { data, error } = await supabaseClient.from('agenda_contatos').select('contato_user_id, profissional_id').eq('dono_user_id', currentUser.id);
  if(error){ console.error(error); return; }

  (data || []).forEach(c => {
    if(c.contato_user_id) contatosSalvosUserIds.add(c.contato_user_id);
    if(c.profissional_id) contatosSalvosProfissionalIds.add(c.profissional_id);
  });
}

function toggleListaSeguidores(profissionalId){
  const box = document.getElementById('lista-seguidores-' + profissionalId);
  if(!box) return;
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

async function toggleSeguir(profissionalId, event){
  event.stopPropagation();

  if(!currentUser){
    const authBox = document.getElementById('auth-form-fields');
    if(authBox.style.display === 'none') toggleAuthForm();
    const msg = document.getElementById('auth-msg');
    if(msg) msg.textContent = '👥 Faça login (ou crie uma conta) pra seguir empresas';
    document.getElementById('auth-logged-out').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  if(seguindoEmpresas.has(profissionalId)){
    const { error } = await supabaseClient.from('seguidores').delete().eq('user_id', currentUser.id).eq('profissional_id', profissionalId);
    if(!error) seguindoEmpresas.delete(profissionalId);
  } else {
    const { error } = await supabaseClient.from('seguidores').insert({ user_id: currentUser.id, profissional_id: profissionalId, user_email: currentUser.email, user_nome: currentUser.user_metadata?.nome || null });
    if(!error) seguindoEmpresas.add(profissionalId);
  }
  render();
}
let mostrandoSoFavoritos = false;

function toggleFavorito(id, event){
  if(event) event.stopPropagation();
  if(favoritosEmpresas.has(id)) favoritosEmpresas.delete(id);
  else favoritosEmpresas.add(id);
  localStorage.setItem('favoritos_empresas', JSON.stringify([...favoritosEmpresas]));
  render();
}

const CAMPOS_COM_LIMPAR = ['search', 'filter-cep', 'filter-estado', 'gz-localidade-busca', 'filter-bairro'];

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

let mostrandoSoSeguindo = false;

function toggleFiltroSeguindo(){
  mostrandoSoSeguindo = !mostrandoSoSeguindo;
  const btn = document.getElementById('btn-seguindo-filtro');
  if(btn) btn.classList.toggle('ativo', mostrandoSoSeguindo);
  render();
}

// ---------- FILTROS RÁPIDOS ----------

function estaAbertoAgora(entry){
  if(!entry.horario_dias || !entry.horario_abre || !entry.horario_fecha) return false;

  const diasSemana = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
  const agora = new Date();
  const diaAtual = diasSemana[agora.getDay()];
  const dias = entry.horario_dias.split(',');
  if(!dias.includes(diaAtual)) return false;

  const horaAtual = agora.getHours() * 60 + agora.getMinutes();
  const [horaAbre, minAbre] = entry.horario_abre.split(':').map(Number);
  const [horaFecha, minFecha] = entry.horario_fecha.split(':').map(Number);
  const minutosAbre = horaAbre * 60 + minAbre;
  const minutosFecha = horaFecha * 60 + minFecha;

  return horaAtual >= minutosAbre && horaAtual <= minutosFecha;
}

function calcularDistanciaKm(lat1, lon1, lat2, lon2){
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

let filtroMaisProximosAtivo = false;
let filtroMelhorAvaliadosAtivo = false;
let filtroPremiumRapidoAtivo = false;
let filtroAbertoAgoraAtivo = false;
let minhaLatitude = null;
let minhaLongitude = null;

function toggleFiltroMaisProximos(){
  if(!filtroMaisProximosAtivo && !minhaLatitude){
    if(!navigator.geolocation){
      alert('Seu navegador não suporta localização. Tente por outro filtro.');
      return;
    }
    document.getElementById('chip-proximos').textContent = '📍 Buscando sua localização...';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        minhaLatitude = pos.coords.latitude;
        minhaLongitude = pos.coords.longitude;
        filtroMaisProximosAtivo = true;
        document.getElementById('chip-proximos').textContent = '📍 Mais próximos';
        document.getElementById('chip-proximos').classList.add('ativo');
        render();
      },
      () => {
        document.getElementById('chip-proximos').textContent = '📍 Mais próximos';
        alert('Não conseguimos acessar sua localização. Verifique as permissões do navegador.');
      }
    );
    return;
  }

  filtroMaisProximosAtivo = !filtroMaisProximosAtivo;
  document.getElementById('chip-proximos').classList.toggle('ativo', filtroMaisProximosAtivo);
  render();
}

function toggleFiltroMelhorAvaliados(){
  filtroMelhorAvaliadosAtivo = !filtroMelhorAvaliadosAtivo;
  document.getElementById('chip-avaliados').classList.toggle('ativo', filtroMelhorAvaliadosAtivo);
  render();
}

function toggleFiltroPremiumRapido(){
  filtroPremiumRapidoAtivo = !filtroPremiumRapidoAtivo;
  document.getElementById('chip-premium-rapido').classList.toggle('ativo', filtroPremiumRapidoAtivo);
  render();
}

function toggleFiltroAbertoAgora(){
  filtroAbertoAgoraAtivo = !filtroAbertoAgoraAtivo;
  document.getElementById('chip-aberto-agora').classList.toggle('ativo', filtroAbertoAgoraAtivo);
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

// ---------- VÍDEOS EM DESTAQUE (com visualizador tela cheia, estilo Story) ----------

let videosDestaqueTodos = [];
let videoViewerIndiceAtual = 0;
let videoViewerJaContabilizadas = new Set();

async function loadVideosDestaque(){
  const secao = document.getElementById('destaque-videos-section');
  const container = document.getElementById('destaque-videos-lista');
  if(!secao || !container) return;

  const { data, error } = await supabaseClient
    .from('videos_empresa')
    .select('*, profissionais(name, cat, whatsapp, plano, verificado, status_pagamento)')
    .order('created_at', { ascending: false })
    .limit(20);

  if(error || !data){ secao.style.display = 'none'; return; }

  videosDestaqueTodos = data.filter(v => v.profissionais && v.profissionais.status_pagamento === 'ativo');

  if(videosDestaqueTodos.length === 0){ secao.style.display = 'none'; return; }

  // Mostra vídeos de todo mundo, mas dá prioridade pros de quem a pessoa segue/salvou
  const meusIdsEmpresaVideos = currentUser ? new Set(entries.filter(e => e.user_id === currentUser.id).map(e => e.id)) : new Set();
  videosDestaqueTodos.sort((a, b) => {
    const prioridadeA = calcularPrioridadeStory({ tipo: 'empresa', id: a.profissional_id, empresa: a.profissionais }, meusIdsEmpresaVideos);
    const prioridadeB = calcularPrioridadeStory({ tipo: 'empresa', id: b.profissional_id, empresa: b.profissionais }, meusIdsEmpresaVideos);
    if(prioridadeA !== prioridadeB) return prioridadeB - prioridadeA;
    return new Date(b.created_at) - new Date(a.created_at);
  });

  secao.style.display = 'block';
  container.innerHTML = videosDestaqueTodos.map((v, i) => `
    <div class="destaque-card video-thumb-card" onclick="abrirVideoViewer(${i})">
      <video src="${escapeHtml(v.video_url)}" muted preload="metadata" playsinline></video>
      <div class="video-thumb-play">▶️</div>
      <div class="destaque-info">
        <div class="destaque-nome">${escapeHtml(v.titulo)}</div>
        <div class="destaque-empresa">${escapeHtml(v.profissionais.name)}</div>
      </div>
    </div>
  `).join('');
}

function abrirVideoViewer(indice){
  videoViewerIndiceAtual = indice;
  document.getElementById('video-viewer').classList.add('aberto');
  tocarVideoViewerAtual();
}

function renderVideoViewerSegmentos(){
  const container = document.getElementById('video-viewer-segmentos');
  container.innerHTML = videosDestaqueTodos.map((v, i) => `<div class="video-viewer-segmento${i <= videoViewerIndiceAtual ? ' preenchido' : ''}"></div>`).join('');
}

function tocarVideoViewerAtual(){
  const v = videosDestaqueTodos[videoViewerIndiceAtual];
  if(!v){ fecharVideoViewer(); return; }

  document.getElementById('video-viewer-nome').textContent = v.profissionais.name;
  document.getElementById('video-viewer-titulo').textContent = v.titulo;
  document.getElementById('video-viewer-meta').textContent = `${v.profissionais.cat || ''} · 👁️ ${v.visualizacoes || 0} visualizações`;

  const player = document.getElementById('video-viewer-player');
  player.pause();
  player.src = v.video_url;
  player.currentTime = 0;
  player.muted = false;
  player.onended = () => avancarVideoViewer();
  player.play().catch(() => {});

  const acoes = document.getElementById('video-viewer-acoes');
  const msgZap = encodeURIComponent(`Olá! Vi seu vídeo "${v.titulo}" no GuiaZap e tenho interesse.`);
  acoes.innerHTML = `<a href="https://wa.me/55${(v.profissionais.whatsapp || '').replace(/\D/g,'')}?text=${msgZap}" target="_blank" class="story-btn-comprar">💬 Falar no WhatsApp</a>`;

  renderVideoViewerSegmentos();

  if(!videoViewerJaContabilizadas.has(v.id)){
    videoViewerJaContabilizadas.add(v.id);
    supabaseClient.rpc('incrementar_visualizacao_video', { vid: v.id }).catch(e => console.error(e));
  }
}

function avancarVideoViewer(){
  videoViewerIndiceAtual++;
  if(videoViewerIndiceAtual >= videosDestaqueTodos.length){ fecharVideoViewer(); return; }
  tocarVideoViewerAtual();
}

function voltarVideoViewer(){
  videoViewerIndiceAtual--;
  if(videoViewerIndiceAtual < 0) videoViewerIndiceAtual = 0;
  tocarVideoViewerAtual();
}

function fecharVideoViewer(){
  const player = document.getElementById('video-viewer-player');
  if(player) player.pause();
  document.getElementById('video-viewer').classList.remove('aberto');
}

async function loadProdutosDestaque(){
  const container = document.getElementById('destaque-produtos-lista');
  if(!container) return;

  const { data, error } = await supabaseClient
    .from('produtos')
    .select('*, profissionais(id, name, whatsapp, status_pagamento, plano, user_id)')
    .order('created_at', { ascending: false })
    .limit(50);

  if(error || !data){
    container.innerHTML = '';
    document.getElementById('destaque-produtos-section').style.display = 'none';
    return;
  }

  produtosDestaqueTodos = data
    .filter(p => p.profissionais && p.profissionais.status_pagamento === 'ativo');

  renderProdutosDestaque();
}

function renderProdutosDestaque(){
  const container = document.getElementById('destaque-produtos-lista');
  const secao = document.getElementById('destaque-produtos-section');
  if(!container || !secao) return;

  const query = normalizarTexto(document.getElementById('search').value);

  const filtrados = produtosDestaqueTodos
    .filter(p => !mostrandoSoSeguindo || (p.profissionais && seguindoEmpresas.has(p.profissionais.id)))
    .filter(p =>
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
      <img src="${p.foto ? escapeHtml(p.foto) : 'https://api.dicebear.com/7.x/shapes/svg?seed=' + encodeURIComponent(p.nome)}" alt="${escapeHtml(p.nome)}" loading="lazy">
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

// ---------- NOVIDADES / STORIES (24h) ----------

let storyFotosSelecionadas = [];
let storyLimiteFotos = 1;

let arquivoVideoSelecionado = null;

async function abrirConfigAtendimento(profissionalId){
  document.getElementById('atendimento-profissional-id').value = profissionalId;
  document.getElementById('atendimento-msg').textContent = 'carregando...';

  const { data: config } = await supabaseClient.from('atendimento_config').select('*').eq('profissional_id', profissionalId).maybeSingle();

  document.getElementById('atendimento-ativo').checked = config ? config.ativo : false;
  document.getElementById('atendimento-boas-vindas').value = config ? (config.mensagem_boas_vindas || '') : '';
  document.getElementById('atendimento-pix').checked = config ? config.aceita_pix : true;
  document.getElementById('atendimento-dinheiro').checked = config ? config.aceita_dinheiro : true;
  document.getElementById('atendimento-cartao').checked = config ? config.aceita_cartao : true;
  document.getElementById('atendimento-pagamento-entrega').checked = config ? config.aceita_pagamento_entrega : true;
  document.getElementById('atendimento-faz-entrega').checked = config ? config.faz_entrega : false;
  document.getElementById('atendimento-taxa-base').value = config ? config.taxa_base_entrega : 6.5;
  document.getElementById('atendimento-valor-km').value = config ? config.valor_por_km : 1.5;
  document.getElementById('atendimento-taxa-campo').style.display = (config && config.faz_entrega) ? 'block' : 'none';
  document.getElementById('atendimento-msg').textContent = '';

  document.getElementById('atendimento-form').style.display = 'block';
  document.getElementById('atendimento-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function fecharConfigAtendimento(){
  document.getElementById('atendimento-form').style.display = 'none';
}

// ---------- GERENCIAR MOTOBOYS ----------

function conectarMercadoPago(profissionalId){
  window.location.href = `/.netlify/functions/mp-oauth-conectar?profissionalId=${profissionalId}`;
}

async function abrirGerenciarMotoboys(profissionalId){
  document.getElementById('motoboys-profissional-id').value = profissionalId;
  document.getElementById('motoboy-codigo-input').value = '';
  document.getElementById('motoboy-add-msg').textContent = '';
  document.getElementById('motoboys-form').style.display = 'block';
  document.getElementById('motoboys-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
  await carregarListaMotoboys(profissionalId);
  await carregarRepassesPendentes(profissionalId);
}

function fecharGerenciarMotoboys(){
  document.getElementById('motoboys-form').style.display = 'none';
}

async function carregarListaMotoboys(profissionalId){
  const container = document.getElementById('lista-motoboys');
  container.innerHTML = 'Carregando...';

  const { data, error } = await supabaseClient.from('motoboys').select('id, nome_exibicao, ativo, preferido, cidade').eq('profissional_id', profissionalId).order('preferido', { ascending: false }).order('created_at', { ascending: false });
  if(error){ container.innerHTML = 'Erro ao carregar motoboys.'; return; }

  if(!data || data.length === 0){
    container.innerHTML = '<p style="font-size:0.82rem; color:#888;">Nenhum motoboy cadastrado ainda.</p>';
    return;
  }

  container.innerHTML = data.map(m => `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #f0f0f0; gap:8px;">
      <div style="flex:1;">
        <div style="font-size:0.85rem;">
          ${m.preferido ? '⭐ ' : ''}${escapeHtml(m.nome_exibicao || 'Motoboy')} ${!m.ativo ? '<span style="color:#a4402f; font-size:0.72rem;">(inativo)</span>' : ''}
        </div>
        <div style="font-size:0.72rem; color:#888;">📍 ${escapeHtml(m.cidade || 'sem cidade cadastrada')}</div>
      </div>
      <button type="button" class="link-cancelar" style="color:${m.preferido ? '#a4402f' : 'var(--verde-escuro)'};" onclick="toggleMotoboyPreferido('${m.id}', ${!m.preferido}, '${profissionalId}')">${m.preferido ? 'Desmarcar ⭐' : 'Marcar ⭐'}</button>
      <button type="button" class="link-cancelar" onclick="removerMotoboy('${m.id}', '${profissionalId}')">Remover</button>
    </div>
  `).join('');
}

async function toggleMotoboyPreferido(motoboyId, novoValor, profissionalId){
  const { error } = await supabaseClient.from('motoboys').update({ preferido: novoValor }).eq('id', motoboyId);
  if(error){ alert('Erro ao atualizar.'); return; }
  await carregarListaMotoboys(profissionalId);
}

async function adicionarMotoboy(){
  const profissionalId = document.getElementById('motoboys-profissional-id').value;
  const codigo = document.getElementById('motoboy-codigo-input').value.trim();
  const cidade = document.getElementById('motoboy-cidade-input').value.trim();
  const msg = document.getElementById('motoboy-add-msg');

  if(!codigo){ msg.textContent = 'Digite o código GuiaZap do motoboy.'; return; }

  msg.textContent = 'buscando...';
  try{
    const resp = await fetch('/.netlify/functions/buscar-codigo-guiazap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo })
    });
    const data = await resp.json();

    if(!data.encontrado){
      msg.textContent = 'Código não encontrado. Confira se digitou certo.';
      return;
    }

    const { error } = await supabaseClient.from('motoboys').insert({
      profissional_id: profissionalId,
      user_id: data.userId,
      nome_exibicao: data.nome,
      cidade: cidade || null
    });

    if(error){
      msg.textContent = error.message.includes('duplicate') ? 'Esse motoboy já está cadastrado.' : 'Erro ao adicionar.';
      return;
    }

    msg.textContent = '✓ Motoboy adicionado!';
    document.getElementById('motoboy-codigo-input').value = '';
    document.getElementById('motoboy-cidade-input').value = '';
    await carregarListaMotoboys(profissionalId);
  } catch(e){
    console.error(e);
    msg.textContent = 'Erro ao adicionar motoboy.';
  }
}

async function removerMotoboy(motoboyId, profissionalId){
  if(!confirm('Remover esse motoboy?')) return;
  const { error } = await supabaseClient.from('motoboys').delete().eq('id', motoboyId);
  if(error){ alert('Erro ao remover.'); return; }
  await carregarListaMotoboys(profissionalId);
}

async function carregarRepassesPendentes(profissionalId){
  const container = document.getElementById('lista-repasses');
  container.innerHTML = 'Carregando...';

  const { data, error } = await supabaseClient
    .from('repasses_motoboy')
    .select('id, valor, status, created_at, motoboy_user_id')
    .eq('profissional_id', profissionalId)
    .order('created_at', { ascending: false });

  if(error){ container.innerHTML = 'Erro ao carregar repasses.'; return; }

  if(!data || data.length === 0){
    container.innerHTML = '<p style="font-size:0.82rem; color:#888;">Nenhum repasse registrado ainda.</p>';
    return;
  }

  // Busca nome e chave Pix de cada motoboy envolvido, pra facilitar o pagamento
  const { data: motoboysDaEmpresa } = await supabaseClient.from('motoboys').select('user_id, nome_exibicao, chave_pix').eq('profissional_id', profissionalId);
  const mapaMotoboys = {};
  (motoboysDaEmpresa || []).forEach(m => { mapaMotoboys[m.user_id] = m; });

  const pendentes = data.filter(r => r.status === 'pendente');
  const totalPendente = pendentes.reduce((soma, r) => soma + Number(r.valor), 0);

  container.innerHTML = `
    ${pendentes.length > 0 ? `<div style="background:#fff3cd; color:#7c4a03; padding:10px; border-radius:8px; margin-bottom:10px; font-weight:700; text-align:center;">Total pendente: R$ ${totalPendente.toFixed(2).replace('.', ',')}</div>` : ''}
    ${data.map(r => {
      const motoboy = mapaMotoboys[r.motoboy_user_id];
      const nome = motoboy ? (motoboy.nome_exibicao || 'Motoboy') : 'Motoboy';
      const pix = motoboy ? motoboy.chave_pix : null;
      return `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #f0f0f0;">
          <div>
            <div style="font-size:0.85rem; font-weight:700;">${escapeHtml(nome)} — R$ ${Number(r.valor).toFixed(2).replace('.', ',')}</div>
            <div style="font-size:0.72rem; color:#888;">${new Date(r.created_at).toLocaleDateString('pt-BR')} ${pix ? '· Pix: ' + escapeHtml(pix) : '· sem chave Pix cadastrada'}</div>
          </div>
          ${r.status === 'pago'
            ? '<span style="font-size:0.75rem; font-weight:700; color:#1a7a3c;">✅ Pago</span>'
            : `<button type="button" class="link-cancelar" style="color:#0f766e;" onclick="marcarRepasseComoPago('${r.id}', '${profissionalId}')">Marcar como pago</button>`}
        </div>
      `;
    }).join('')}
  `;
}

async function marcarRepasseComoPago(repasseId, profissionalId){
  if(!confirm('Confirma que você já pagou esse valor pro motoboy por fora (Pix, dinheiro, etc)?')) return;
  const { error } = await supabaseClient.from('repasses_motoboy').update({ status: 'pago', pago_em: new Date().toISOString() }).eq('id', repasseId);
  if(error){ alert('Erro ao atualizar.'); return; }
  await carregarRepassesPendentes(profissionalId);
}

async function salvarConfigAtendimento(e){
  e.preventDefault();
  const msg = document.getElementById('atendimento-msg');
  const profissionalId = document.getElementById('atendimento-profissional-id').value;

  const payload = {
    profissional_id: profissionalId,
    ativo: document.getElementById('atendimento-ativo').checked,
    mensagem_boas_vindas: document.getElementById('atendimento-boas-vindas').value.trim() || null,
    aceita_pix: document.getElementById('atendimento-pix').checked,
    aceita_dinheiro: document.getElementById('atendimento-dinheiro').checked,
    aceita_cartao: document.getElementById('atendimento-cartao').checked,
    aceita_pagamento_entrega: document.getElementById('atendimento-pagamento-entrega').checked,
    faz_entrega: document.getElementById('atendimento-faz-entrega').checked,
    taxa_base_entrega: parseFloat(document.getElementById('atendimento-taxa-base').value) || 0,
    valor_por_km: parseFloat(document.getElementById('atendimento-valor-km').value) || 0,
    updated_at: new Date().toISOString()
  };

  msg.textContent = 'salvando...';
  const { error } = await supabaseClient.from('atendimento_config').upsert(payload, { onConflict: 'profissional_id' });

  if(error){ console.error(error); msg.textContent = 'erro ao salvar: ' + error.message; return false; }

  msg.textContent = 'configuração salva!';
  setTimeout(fecharConfigAtendimento, 1200);
  return false;
}

async function abrirFormVideo(profissionalId, plano){
  document.getElementById('video-profissional-id').value = profissionalId;
  document.getElementById('video-plano').value = plano;
  document.getElementById('video-titulo-input').value = '';
  document.getElementById('video-arquivo-msg').textContent = '';
  arquivoVideoSelecionado = null;

  const limiteTexto = ehPremiumOuVendas(plano)
    ? 'Seu plano permite vídeos de até 60 segundos e 100MB, sem limite de quantidade'
    : 'Seu plano permite vídeos de até 30 segundos e 50MB, até 3 vídeos ativos';
  document.getElementById('video-limite-texto').textContent = limiteTexto;

  document.getElementById('video-form').style.display = 'block';
  document.getElementById('video-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function fecharFormVideo(){
  document.getElementById('video-form').style.display = 'none';
  arquivoVideoSelecionado = null;
}

function selecionarArquivoVideo(event){
  const file = event.target.files[0];
  const msg = document.getElementById('video-arquivo-msg');
  if(!file) return;

  const plano = document.getElementById('video-plano').value;
  const limiteDuracao = ehPremiumOuVendas(plano) ? 60 : 30;
  const limiteTamanho = ehPremiumOuVendas(plano) ? 100 * 1024 * 1024 : 50 * 1024 * 1024;

  if(file.size > limiteTamanho){
    msg.textContent = `Esse arquivo é grande demais (máximo ${ehPremiumOuVendas(plano) ? '100MB' : '50MB'} no seu plano).`;
    msg.style.color = '#a4402f';
    event.target.value = '';
    arquivoVideoSelecionado = null;
    return;
  }

  const videoTeste = document.createElement('video');
  videoTeste.preload = 'metadata';
  videoTeste.onloadedmetadata = () => {
    URL.revokeObjectURL(videoTeste.src);
    const duracao = Math.round(videoTeste.duration);

    if(duracao > limiteDuracao){
      msg.textContent = `Esse vídeo tem ${duracao}s — o máximo no seu plano é ${limiteDuracao}s.`;
      msg.style.color = '#a4402f';
      event.target.value = '';
      arquivoVideoSelecionado = null;
      return;
    }

    arquivoVideoSelecionado = { file, duracao, tamanho: file.size };
    msg.textContent = `✓ Vídeo de ${duracao}s pronto pra enviar.`;
    msg.style.color = 'var(--verde-escuro)';
  };
  videoTeste.src = URL.createObjectURL(file);
}

async function salvarVideoEmpresa(e){
  e.preventDefault();
  const msg = document.getElementById('video-msg');
  const titulo = document.getElementById('video-titulo-input').value.trim();
  const profissionalId = document.getElementById('video-profissional-id').value;

  if(!titulo){ msg.textContent = 'Escreve um título pro vídeo.'; msg.style.color = '#a4402f'; return false; }
  if(!arquivoVideoSelecionado){ msg.textContent = 'Escolhe um vídeo primeiro.'; msg.style.color = '#a4402f'; return false; }

  msg.textContent = 'enviando vídeo, isso pode demorar um pouco...';
  msg.style.color = '#555';

  const nomeArquivo = `videos/${currentUser.id}/${Date.now()}-${arquivoVideoSelecionado.file.name}`;
  const { error: erroUpload } = await supabaseClient.storage.from('fotos').upload(nomeArquivo, arquivoVideoSelecionado.file);
  if(erroUpload){ console.error(erroUpload); msg.textContent = 'erro ao enviar o vídeo'; msg.style.color = '#a4402f'; return false; }

  const { data: urlData } = supabaseClient.storage.from('fotos').getPublicUrl(nomeArquivo);

  const { error: erroInsert } = await supabaseClient.from('videos_empresa').insert({
    profissional_id: profissionalId,
    titulo,
    video_url: urlData.publicUrl,
    duracao_segundos: arquivoVideoSelecionado.duracao,
    tamanho_bytes: arquivoVideoSelecionado.tamanho
  });

  if(erroInsert){
    console.error(erroInsert);
    msg.textContent = erroInsert.message.includes('row-level security') ? 'Você atingiu o limite de vídeos do seu plano.' : 'erro ao publicar vídeo';
    msg.style.color = '#a4402f';
    return false;
  }

  msg.textContent = '✓ Vídeo publicado! Confira na Seção de Vídeos.';
  msg.style.color = 'var(--verde-escuro)';
  setTimeout(fecharFormVideo, 1500);
  return false;
}

async function abrirFormStory(profissionalId, plano){
  document.getElementById('story-profissional-id').value = profissionalId;
  document.getElementById('story-plano').value = plano;
  document.getElementById('story-form').style.display = 'block';
  document.getElementById('story-texto-input').value = '';
  document.getElementById('story-msg').textContent = '';
  storyFotosSelecionadas = [];
  renderStoryFotosPreview();

  storyLimiteFotos = ehPremiumOuVendas(plano) ? 10 : (plano === 'completo' ? 5 : 1);
  document.getElementById('story-limite-texto').textContent = ehPremiumOuVendas(plano)
    ? 'até 10 fotos — Pacote Premium'
    : plano === 'completo'
      ? 'até 5 fotos — Pacote Completo'
      : '1 foto — Pacote Básico';

  const campoProduto = document.getElementById('story-produto-campo');
  if(plano === 'vendas'){
    campoProduto.style.display = 'block';
    const { data: produtos } = await supabaseClient.from('produtos').select('id, nome').eq('profissional_id', profissionalId);
    const sel = document.getElementById('story-produto-id');
    sel.innerHTML = '<option value="">Nenhum</option>' + (produtos || []).map(p => `<option value="${p.id}">${escapeHtml(p.nome)}</option>`).join('');
  } else {
    campoProduto.style.display = 'none';
  }

  const campoNotificar = document.getElementById('story-notificar-campo');
  campoNotificar.style.display = ehPremiumOuVendas(plano) ? 'block' : 'none';
  document.getElementById('story-notificar-seguidores').checked = true;

  document.getElementById('story-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function fecharFormStory(){
  document.getElementById('story-form').style.display = 'none';
}

// ---------- STORY PESSOAL (visitante sem empresa — igual Pacote Básico grátis) ----------

let storyPessoalFotosSelecionadas = [];

function abrirFormStoryPessoal(){
  document.getElementById('story-pessoal-form').style.display = 'block';
  document.getElementById('story-pessoal-texto-input').value = '';
  document.getElementById('story-pessoal-msg').textContent = '';
  storyPessoalFotosSelecionadas = [];
  renderStoryPessoalFotosPreview();
  renderMinhaNovidadePessoal();
  document.getElementById('story-pessoal-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function fecharFormStoryPessoal(){
  document.getElementById('story-pessoal-form').style.display = 'none';
}

async function adicionarFotoStoryPessoal(event){
  const file = event.target.files[0];
  const msg = document.getElementById('story-pessoal-foto-msg');
  if(!file) return;

  if(storyPessoalFotosSelecionadas.length >= 1){
    msg.textContent = 'Você já escolheu sua foto — remova ela pra trocar.';
    event.target.value = '';
    return;
  }

  msg.textContent = 'enviando foto...';
  const nomeArquivo = `stories/${currentUser.id}/${Date.now()}.jpg`;
  const { error } = await supabaseClient.storage.from('fotos').upload(nomeArquivo, file);
  event.target.value = '';

  if(error){ console.error(error); msg.textContent = 'erro ao enviar foto: ' + error.message; return; }

  const { data } = supabaseClient.storage.from('fotos').getPublicUrl(nomeArquivo);
  storyPessoalFotosSelecionadas.push(data.publicUrl);
  msg.textContent = '';
  renderStoryPessoalFotosPreview();
}

function removerFotoStoryPessoal(index){
  storyPessoalFotosSelecionadas.splice(index, 1);
  renderStoryPessoalFotosPreview();
}

function renderStoryPessoalFotosPreview(){
  const container = document.getElementById('story-pessoal-fotos-preview');
  container.innerHTML = storyPessoalFotosSelecionadas.map((url, i) => `
    <div class="story-foto-mini">
      <img src="${url}">
      <button type="button" onclick="removerFotoStoryPessoal(${i})">✕</button>
    </div>
  `).join('');
}

async function salvarStoryPessoal(e){
  e.preventDefault();
  const msg = document.getElementById('story-pessoal-msg');

  if(storyPessoalFotosSelecionadas.length === 0){ msg.textContent = 'Adicione uma foto.'; return false; }

  const grupoAtual = storiesAgrupadas['p_' + currentUser.id];
  if(grupoAtual && grupoAtual.stories.length >= 1){
    msg.textContent = 'Você já tem uma novidade ativa. Espere ela expirar (24h) ou exclua ela antes de postar outra.';
    msg.style.color = '#a4402f';
    return false;
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const payload = {
    usuario_id: currentUser.id,
    fotos: storyPessoalFotosSelecionadas,
    texto: document.getElementById('story-pessoal-texto-input').value.trim() || null,
    expires_at: expiresAt,
    visivel_guiazap: true,
    visivel_papo: document.getElementById('story-pessoal-publicar-no-papo').checked
  };

  msg.textContent = 'publicando...';
  const { error } = await supabaseClient.from('stories').insert(payload);
  if(error){ console.error(error); msg.textContent = 'erro ao publicar: ' + error.message; return false; }

  msg.textContent = 'novidade publicada! fica no ar por 24 horas.';
  setTimeout(fecharFormStoryPessoal, 1500);
  loadStories();
  return false;
}

function renderMinhaNovidadePessoal(){
  const container = document.getElementById('minha-novidade-pessoal');
  if(!container || !currentUser) return;

  const grupo = storiesAgrupadas['p_' + currentUser.id];
  if(!grupo || grupo.stories.length === 0){ container.innerHTML = ''; return; }

  container.innerHTML = `
    <div class="minhas-novidades-label">📸 Sua novidade ativa (some em até 24h):</div>
    <div class="minhas-novidades-lista">
      ${grupo.stories.map(s => `
        <div class="minha-novidade-item">
          <img src="${s.fotos[0]}">
          <button type="button" class="minha-novidade-btn-excluir" title="Excluir agora" onclick="excluirStory('${s.id}')">✕</button>
        </div>
      `).join('')}
    </div>
  `;
}

async function onProdutoStoryChange(){
  const produtoId = document.getElementById('story-produto-id').value;
  if(!produtoId) return;

  const { data: produto } = await supabaseClient.from('produtos').select('nome, foto, preco').eq('id', produtoId).single();
  if(!produto) return;

  // Já usa a foto do próprio produto — não precisa tirar foto nem escolher da galeria de novo
  if(produto.foto){
    storyFotosSelecionadas = [produto.foto];
    renderStoryFotosPreview();
    document.getElementById('story-foto-msg').textContent = 'Foto do produto usada automaticamente.';
  } else {
    document.getElementById('story-foto-msg').textContent = 'Esse produto não tem foto cadastrada na Vitrine — envie uma foto manualmente abaixo.';
  }

  const campoTexto = document.getElementById('story-texto-input');
  if(!campoTexto.value.trim()){
    campoTexto.value = `${produto.nome}${produto.preco ? ' - R$ ' + produto.preco : ''}`;
  }
}

async function adicionarFotoStory(event){
  const file = event.target.files[0];
  const msg = document.getElementById('story-foto-msg');
  if(!file) return;

  if(storyFotosSelecionadas.length >= storyLimiteFotos){
    msg.textContent = `Seu plano permite no máximo ${storyLimiteFotos} foto${storyLimiteFotos > 1 ? 's' : ''} por novidade.`;
    event.target.value = '';
    return;
  }

  msg.textContent = 'enviando foto...';
  const nomeArquivo = `stories/${currentUser.id}/${Date.now()}.jpg`;
  const { error } = await supabaseClient.storage.from('fotos').upload(nomeArquivo, file);
  event.target.value = '';

  if(error){ console.error(error); msg.textContent = 'erro ao enviar foto: ' + error.message; return; }

  const { data } = supabaseClient.storage.from('fotos').getPublicUrl(nomeArquivo);
  storyFotosSelecionadas.push(data.publicUrl);
  msg.textContent = '';
  renderStoryFotosPreview();
}

function removerFotoStory(index){
  storyFotosSelecionadas.splice(index, 1);
  renderStoryFotosPreview();
}

function renderStoryFotosPreview(){
  const container = document.getElementById('story-fotos-preview');
  container.innerHTML = storyFotosSelecionadas.map((url, i) => `
    <div class="story-foto-mini">
      <img src="${url}">
      <button type="button" onclick="removerFotoStory(${i})">✕</button>
    </div>
  `).join('');
}

async function salvarStory(e){
  e.preventDefault();
  const msg = document.getElementById('story-msg');

  if(storyFotosSelecionadas.length === 0){ msg.textContent = 'Adicione pelo menos 1 foto.'; return false; }

  const produtoId = document.getElementById('story-produto-id') ? (document.getElementById('story-produto-id').value || null) : null;
  const plano = document.getElementById('story-plano').value;
  const profissionalIdAtual = document.getElementById('story-profissional-id').value;

  // Checa o limite de NOVIDADES simultâneas só agora, na hora de publicar de verdade
  const grupoAtual = storiesAgrupadas['e_' + profissionalIdAtual];
  const novidadesAtivas = grupoAtual ? grupoAtual.stories.length : 0;
  const limiteNovidades = ehPremiumOuVendas(plano) ? Infinity : (plano === 'completo' ? 3 : 1);
  if(novidadesAtivas >= limiteNovidades){
    const textoAviso = plano === 'basico'
      ? 'Seu plano permite só 1 novidade ativa por vez. Espere a atual expirar (ou exclua ela) pra publicar outra.'
      : `Seu plano permite até ${limiteNovidades} novidades ativas ao mesmo tempo — você já atingiu esse limite.`;
    const nomeProximoPlano = plano === 'basico' ? 'Completo ou Premium' : 'Premium';
    msg.innerHTML = `${textoAviso} <a href="pacotes.html" style="color:#a4402f; font-weight:700; text-decoration:underline;">Quer publicar mais? Conheça o Pacote ${nomeProximoPlano} →</a>`;
    msg.style.color = '#a4402f';
    return false;
  }

  const horasDuracao = ehPremiumOuVendas(plano) ? (24 * 7) : 24;
  const expiresAt = new Date(Date.now() + horasDuracao * 60 * 60 * 1000).toISOString();

  const payload = {
    profissional_id: profissionalIdAtual,
    fotos: storyFotosSelecionadas,
    texto: document.getElementById('story-texto-input').value.trim() || null,
    produto_id: produtoId,
    produto_nome: null,
    produto_preco: null,
    expires_at: expiresAt,
    visivel_guiazap: true,
    visivel_papo: document.getElementById('story-publicar-no-papo').checked
  };

  // Guarda o nome/preço do produto no momento da publicação, pra mostrar na visualização
  if(produtoId){
    const { data: produto } = await supabaseClient.from('produtos').select('nome, preco').eq('id', produtoId).single();
    if(produto){
      payload.produto_nome = produto.nome;
      payload.produto_preco = produto.preco;
    }
  }

  msg.textContent = 'publicando...';
  const { error } = await supabaseClient.from('stories').insert(payload);
  if(error){ console.error(error); msg.textContent = 'erro ao publicar: ' + error.message; return false; }

  msg.textContent = `novidade publicada! fica no ar por ${horasDuracao} horas.`;
  setTimeout(fecharFormStory, 1500);
  loadStories();

  // Se a empresa for Premium, e a pessoa deixou marcado, avisa quem segue por
  // e-mail e por notificação push (não trava a tela esperando)
  const quiseNotificar = document.getElementById('story-notificar-seguidores').checked;
  if(quiseNotificar){
    fetch('/.netlify/functions/notificar-seguidores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profissionalId: payload.profissional_id,
        tipo: 'story',
        titulo: payload.texto || payload.produto_nome || null,
        foto: payload.fotos[0]
      })
    }).catch(e => console.error('erro ao notificar seguidores', e));

    fetch('/.netlify/functions/enviar-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titulo: '📸 Novidade de quem você segue!',
        mensagem: payload.texto || payload.produto_nome || 'Confira a novidade nova',
        url: '/index.html',
        profissionalId: payload.profissional_id
      })
    }).catch(e => console.error('erro ao enviar push', e));
  }

  return false;
}

let storiesAgrupadas = {};
let storySlideAtual = 0;
let storyEmpresaAtual = null;
let storyChaveAtual = null;
let storyTimer = null;
let contatosSalvosUserIds = new Set();
let contatosSalvosProfissionalIds = new Set();

async function renderPainelVerificacao(profissionalId){
  const container = document.getElementById('painel-verificacao-' + profissionalId);
  if(!container) return;
  const cadastro = entries.find(e => e.id === profissionalId);
  if(!cadastro) return;

  if(!cadastro.verificacao_pago){
    container.innerHTML = `<a href="${LINK_SELO_VERIFICADO}" class="link-migrar" style="background:#e3f2fd; border:1.5px solid #1565c0; color:#0d47a1;">🔵 Solicitar Selo Verificado (R$15)</a>`;
    return;
  }

  // Confere o CPF/CNPJ automaticamente (usa a mesma consulta segura que já existe)
  const { data: documento } = await supabaseClient.rpc('obter_meu_documento', { pid: profissionalId });
  const digitos = (documento || '').replace(/\D/g, '');
  let statusDocumento = '⚠️ Não foi possível conferir';
  if(digitos.length === 11) statusDocumento = validarCPF(digitos) ? '✓ CPF válido' : '⚠️ CPF inválido';
  if(digitos.length === 14) statusDocumento = validarCNPJ(digitos) ? '✓ CNPJ válido' : '⚠️ CNPJ inválido';

  container.innerHTML = `
    <div class="painel-verificacao">
      <div class="painel-verificacao-titulo">🔵 Verificação em andamento</div>
      <div class="verificacao-item">📋 Documento (CPF/CNPJ): ${statusDocumento}</div>
      <div class="verificacao-item">
        📄 Foto do documento:
        ${cadastro.verificacao_documento_url
          ? '✓ Enviada'
          : `<label class="btn-verificacao-mini">Enviar foto<input type="file" accept="image/*" style="display:none;" onchange="enviarDocumentoVerificacao(event, '${profissionalId}')"></label>`}
      </div>
      <div class="verificacao-item">
        📧 E-mail confirmado:
        ${cadastro.verificacao_email_confirmado
          ? '✓ Confirmado'
          : `<button type="button" class="btn-verificacao-mini" onclick="enviarCodigoEmailVerificacao('${profissionalId}')">Enviar código por e-mail</button>`}
      </div>
      <div id="verificacao-email-confirmar-${profissionalId}"></div>
      <div class="verificacao-item">
        💬 WhatsApp confirmado:
        ${cadastro.verificacao_whatsapp_confirmado
          ? '✓ Confirmado'
          : `<button type="button" class="btn-verificacao-mini" onclick="confirmarWhatsappVerificacao('${profissionalId}')">Confirmar via WhatsApp</button>`}
      </div>
      <p class="verificacao-rodape">Depois das 4 etapas, o GuiaZap confere tudo e libera o selo — pode levar até 2 dias úteis.</p>
    </div>
  `;
}

async function enviarDocumentoVerificacao(event, profissionalId){
  const file = event.target.files[0];
  if(!file) return;

  const nomeArquivo = `verificacao/${currentUser.id}/${Date.now()}.jpg`;
  const { error: erroUpload } = await supabaseClient.storage.from('fotos').upload(nomeArquivo, file);
  if(erroUpload){ alert('Erro ao enviar o documento. Tente de novo.'); console.error(erroUpload); return; }

  const { data: urlData } = supabaseClient.storage.from('fotos').getPublicUrl(nomeArquivo);
  const { error } = await supabaseClient.from('profissionais').update({ verificacao_documento_url: urlData.publicUrl }).eq('id', profissionalId);
  if(error){ alert('Erro ao salvar. Tente de novo.'); console.error(error); return; }

  const cadastro = entries.find(e => e.id === profissionalId);
  if(cadastro) cadastro.verificacao_documento_url = urlData.publicUrl;
  renderPainelVerificacao(profissionalId);
}

async function enviarCodigoEmailVerificacao(profissionalId){
  const { data: { session } } = await supabaseClient.auth.getSession();
  const resp = await fetch('/.netlify/functions/enviar-codigo-verificacao', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profissionalId, userToken: session.access_token })
  });
  const data = await resp.json();

  const box = document.getElementById('verificacao-email-confirmar-' + profissionalId);
  if(!data.enviado){ box.innerHTML = '<span style="color:#a4402f; font-size:0.75rem;">Erro ao enviar o código, tente de novo.</span>'; return; }

  box.innerHTML = `
    <div class="auth-row" style="margin-top:6px;">
      <input type="text" id="codigo-email-${profissionalId}" placeholder="Cole o código de 6 dígitos" maxlength="6">
      <button type="button" class="btn-verificacao-mini" onclick="confirmarCodigoEmailVerificacao('${profissionalId}')">Confirmar</button>
    </div>
    <span id="codigo-email-msg-${profissionalId}" style="font-size:0.72rem;"></span>
  `;
}

async function confirmarCodigoEmailVerificacao(profissionalId){
  const codigoDigitado = document.getElementById('codigo-email-' + profissionalId).value.trim();
  const msg = document.getElementById('codigo-email-msg-' + profissionalId);

  const { data, error } = await supabaseClient.from('profissionais').select('verificacao_codigo_email').eq('id', profissionalId).single();
  if(error || !data){ msg.textContent = 'erro ao conferir o código'; return; }

  if(data.verificacao_codigo_email !== codigoDigitado){
    msg.textContent = '❌ Código incorreto, confira e tente de novo.';
    msg.style.color = '#a4402f';
    return;
  }

  const { error: erroUpdate } = await supabaseClient.from('profissionais').update({ verificacao_email_confirmado: true }).eq('id', profissionalId);
  if(erroUpdate){ msg.textContent = 'erro ao salvar'; return; }

  const cadastro = entries.find(e => e.id === profissionalId);
  if(cadastro) cadastro.verificacao_email_confirmado = true;
  renderPainelVerificacao(profissionalId);
}

async function confirmarWhatsappVerificacao(profissionalId){
  const cadastro = entries.find(e => e.id === profissionalId);
  if(!cadastro) return;

  const codigo = String(Math.floor(100000 + Math.random() * 900000));
  await supabaseClient.from('profissionais').update({ verificacao_codigo_whatsapp: codigo }).eq('id', profissionalId);

  const mensagem = encodeURIComponent(`Meu código de verificação GuiaZap é: ${codigo} (empresa: ${cadastro.name})`);
  window.open(`https://wa.me/${WHATSAPP_ADMIN_GUIAZAP}?text=${mensagem}`, '_blank');

  alert('Depois de enviar a mensagem no WhatsApp, aguarde a confirmação — o GuiaZap aprova manualmente em até 2 dias úteis.');
}

function renderMinhasNovidades(profissionalId){
  const container = document.getElementById('minhas-novidades-' + profissionalId);
  if(!container) return;

  const grupo = storiesAgrupadas['e_' + profissionalId];
  if(!grupo || grupo.stories.length === 0){ container.innerHTML = ''; return; }

  const cadastro = entries.find(e => e.id === profissionalId);
  const textoValidade = cadastro && ehPremiumOuVendas(cadastro.plano) ? 'somem em até 7 dias' : 'somem em até 24h';

  container.innerHTML = `
    <div class="minhas-novidades-label">📸 Suas novidades ativas (${textoValidade}):</div>
    <div class="minhas-novidades-lista">
      ${grupo.stories.map(s => `
        <div class="minha-novidade-item">
          <img src="${s.fotos[0]}">
          <button type="button" class="minha-novidade-btn-excluir" title="Excluir agora" onclick="excluirStory('${s.id}', '${profissionalId}')">✕</button>
        </div>
      `).join('')}
    </div>
  `;
}


async function excluirStory(storyId, profissionalId){
  if(!confirm('Excluir essa novidade antes do prazo de 24h?')) return;
  const { error } = await supabaseClient.from('stories').delete().eq('id', storyId);
  if(error){ console.error(error); alert('erro ao excluir'); return; }
  await loadStories();
}

async function loadStories(){
  const { data, error } = await supabaseClient
    .from('stories')
    .select('*, profissionais(id, name, foto, whatsapp, plano)')
    .eq('visivel_guiazap', true)
    .order('created_at', { ascending: true });

  if(error){ console.error(error); return; }

  // Stories de pessoa física (usuario_id preenchido) não vêm com o nome já
  // embutido — busca em lote o nome de exibição de quem postou
  const idsPessoais = [...new Set((data || []).filter(s => s.usuario_id).map(s => s.usuario_id))];
  let nomesPessoais = {};
  if(idsPessoais.length > 0){
    const { data: perfis } = await supabaseClient.from('perfis_usuario').select('user_id, nome_exibicao').in('user_id', idsPessoais);
    (perfis || []).forEach(p => { nomesPessoais[p.user_id] = p.nome_exibicao; });
  }

  storiesAgrupadas = {};
  (data || []).forEach(s => {
    if(s.profissional_id && s.profissionais){
      const chave = 'e_' + s.profissional_id;
      if(!storiesAgrupadas[chave]) storiesAgrupadas[chave] = { tipo: 'empresa', id: s.profissional_id, empresa: s.profissionais, stories: [] };
      storiesAgrupadas[chave].stories.push(s);
    } else if(s.usuario_id){
      const chave = 'p_' + s.usuario_id;
      if(!storiesAgrupadas[chave]) storiesAgrupadas[chave] = { tipo: 'pessoa', id: s.usuario_id, nome: nomesPessoais[s.usuario_id] || 'Alguém do GuiaZap', stories: [] };
      storiesAgrupadas[chave].stories.push(s);
    }
  });

  renderStoriesLinha();

  if(currentUser){
    entries.filter(e => e.user_id === currentUser.id).forEach(e => renderMinhasNovidades(e.id));
    renderMinhaNovidadePessoal();
  }
}

let storiesOrdemChaves = [];

function calcularPrioridadeStory(grupo, meusIdsEmpresa){
  if(grupo.tipo === 'empresa'){
    if(meusIdsEmpresa.has(grupo.id)) return 3; // minha própria empresa
    if(seguindoEmpresas.has(grupo.id) || contatosSalvosProfissionalIds.has(grupo.id)) return 2; // sigo ou salvei
    return 0;
  }
  if(currentUser && grupo.id === currentUser.id) return 3;
  if(contatosSalvosUserIds.has(grupo.id)) return 2;
  return 0;
}

function renderStoriesLinha(){
  const container = document.getElementById('stories-linha');
  if(!container) return;

  // Mostra os Stories de todo mundo (não só quem você segue/salvou), mas
  // dá prioridade na fileira pra quem você segue/tem salvo/é sua empresa
  const meusIdsEmpresa = currentUser ? new Set(entries.filter(e => e.user_id === currentUser.id).map(e => e.id)) : new Set();
  let grupos = Object.entries(storiesAgrupadas);

  grupos = grupos.sort((a, b) => {
    const prioridadeA = calcularPrioridadeStory(a[1], meusIdsEmpresa);
    const prioridadeB = calcularPrioridadeStory(b[1], meusIdsEmpresa);
    if(prioridadeA !== prioridadeB) return prioridadeB - prioridadeA;

    // Empate: empresas do Pacote Premium aparecem primeiro
    const premiumA = a[1].tipo === 'empresa' && ehPremiumOuVendas(a[1].empresa.plano) ? 1 : 0;
    const premiumB = b[1].tipo === 'empresa' && ehPremiumOuVendas(b[1].empresa.plano) ? 1 : 0;
    return premiumB - premiumA;
  });

  storiesOrdemChaves = grupos.map(([chave]) => chave);

  // A fileira sempre aparece agora (mesmo sem nenhuma novidade), por causa do botão "+"
  container.style.display = 'flex';

  const bolinhaAdicionar = `
    <div class="story-bolinha story-bolinha-add" onclick="irParaLoginOuPostar()">
      <div class="story-add-circulo">+</div>
      <span>Postar</span>
    </div>
  `;

  const bolinhasContatos = grupos.map(([chave, grupo]) => {
    const primeiraFoto = grupo.stories[0] && grupo.stories[0].fotos && grupo.stories[0].fotos[0];
    const nomeExibido = grupo.tipo === 'empresa' ? grupo.empresa.name : grupo.nome;
    const fotoFallback = grupo.tipo === 'empresa' && grupo.empresa.foto
      ? escapeHtml(grupo.empresa.foto)
      : 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(nomeExibido);
    return `
      <div class="story-bolinha" onclick="abrirStoryViewer('${chave}')">
        <img src="${primeiraFoto ? escapeHtml(primeiraFoto) : fotoFallback}">
        <span>${escapeHtml(nomeExibido.split(' ')[0])}</span>
      </div>
    `;
  }).join('');

  container.innerHTML = bolinhaAdicionar + bolinhasContatos;
}

function irParaLoginOuPostar(){
  if(currentUser){
    // Já logado com empresa: rola até o próprio card e abre o formulário de postar novidade direto
    const meuCadastro = entries.find(e => e.user_id === currentUser.id);
    if(meuCadastro){
      abrirFormStory(meuCadastro.id, meuCadastro.plano);
      return;
    }
    // Já logado sem empresa (visitante): abre o formulário de Story pessoal (1 foto, 24h — igual Pacote Básico grátis)
    abrirFormStoryPessoal();
    return;
  }

  // Não logado ainda: abre a área de login, com uma mensagem explicando o motivo
  const authBox = document.getElementById('auth-form-fields');
  if(authBox.style.display === 'none') toggleAuthForm();

  const msg = document.getElementById('auth-msg');
  if(msg) msg.textContent = '📸 Faça login (ou crie uma conta) pra poder postar uma novidade';
  document.getElementById('auth-logged-out').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function abrirStoryViewer(chave){
  const grupo = storiesAgrupadas[chave];
  if(!grupo) return;

  storyEmpresaAtual = grupo;
  storyChaveAtual = chave;
  storySlideAtual = 0;

  // Monta a lista completa de fotos (juntando todas as stories dessa empresa/pessoa, em ordem)
  storyEmpresaAtual.slidesFlat = [];
  grupo.stories.forEach(s => {
    s.fotos.forEach(foto => {
      storyEmpresaAtual.slidesFlat.push({
        foto,
        texto: s.texto,
        produto_id: s.produto_id,
        produto_nome: s.produto_nome,
        produto_preco: s.produto_preco,
        whatsapp: grupo.tipo === 'empresa' ? grupo.empresa.whatsapp : null,
        nome: grupo.tipo === 'empresa' ? grupo.empresa.name : grupo.nome,
        tipo: grupo.tipo,
        pessoaUserId: grupo.tipo === 'pessoa' ? grupo.id : null
      });
    });
  });

  document.getElementById('story-viewer').style.display = 'flex';
  renderStorySlideAtual();
}

function renderStorySlideAtual(){
  const slides = storyEmpresaAtual.slidesFlat;
  const slide = slides[storySlideAtual];
  if(!slide){ fecharStoryViewer(); return; }

  document.getElementById('story-empresa-nome').textContent = slide.nome;
  document.getElementById('story-foto').src = slide.foto;

  const textoCompleto = [
    slide.produto_nome ? `🏷️ ${slide.produto_nome}${slide.produto_preco ? ' — R$ ' + slide.produto_preco : ''}` : '',
    slide.texto || ''
  ].filter(Boolean).join('\n');
  document.getElementById('story-texto').textContent = textoCompleto;

  const barra = document.getElementById('story-progresso-barra');
  barra.style.width = `${((storySlideAtual + 1) / slides.length) * 100}%`;

  const acoes = document.getElementById('story-acoes');
  const infoProduto = slide.produto_nome ? ` (${slide.produto_nome}${slide.produto_preco ? ' - R$ ' + slide.produto_preco : ''})` : '';

  const botaoContato = slide.tipo === 'pessoa'
    ? `<a href="chat.html?pessoa=${slide.pessoaUserId}" class="story-btn-comprar">💬 Falar pelo Papo</a>`
    : (() => {
        const msgZap = encodeURIComponent(`Olá! Vi sua novidade no GuiaZap${infoProduto} e tenho interesse. Foto que vi: ${slide.foto}`);
        return `<a href="https://wa.me/55${(slide.whatsapp || '').replace(/\D/g,'')}?text=${msgZap}" target="_blank" class="story-btn-comprar">💬 Comprar / Falar no WhatsApp</a>`;
      })();

  acoes.innerHTML = `
    ${botaoContato}
    ${slide.produto_id ? `<a href="vitrine.html?produto=${slide.produto_id}" class="story-btn-produto">Ver produto na Vitrine</a>` : ''}
    <button type="button" class="story-btn-compartilhar" onclick="toggleMenuCompartilharStory(event)">📤 Compartilhar</button>
    <div class="menu-compartilhar" id="menu-compartilhar-story" style="display:none;"></div>
  `;

  clearTimeout(storyTimer);
  storyTimer = setTimeout(() => avancarStorySlide(), 5000);
}

function avancarStorySlide(){
  storySlideAtual++;
  if(storySlideAtual >= storyEmpresaAtual.slidesFlat.length){
    // Acabaram as fotos dessa empresa/pessoa — pula pra próxima da fileira automaticamente
    const indiceAtual = storiesOrdemChaves.indexOf(storyChaveAtual);
    const proximaChave = storiesOrdemChaves[indiceAtual + 1];

    if(proximaChave){
      abrirStoryViewer(proximaChave);
    } else {
      fecharStoryViewer();
    }
    return;
  }
  renderStorySlideAtual();
}

function voltarStorySlide(){
  storySlideAtual--;
  if(storySlideAtual < 0){
    // Já está no primeiro slide dessa empresa/pessoa — volta pra anterior da fileira
    const indiceAtual = storiesOrdemChaves.indexOf(storyChaveAtual);
    const chaveAnterior = storiesOrdemChaves[indiceAtual - 1];

    if(chaveAnterior){
      abrirStoryViewer(chaveAnterior);
      storySlideAtual = storyEmpresaAtual.slidesFlat.length - 1;
      renderStorySlideAtual();
    } else {
      storySlideAtual = 0;
      renderStorySlideAtual();
    }
    return;
  }
  renderStorySlideAtual();
}

function toggleMenuCompartilharStory(event){
  event.stopPropagation();
  const menu = document.getElementById('menu-compartilhar-story');
  const jaAberto = menu.style.display === 'block';

  document.querySelectorAll('.menu-compartilhar').forEach(m => { m.style.display = 'none'; });
  clearTimeout(storyTimer);

  if(jaAberto) return;

  const slide = storyEmpresaAtual.slidesFlat[storySlideAtual];
  const link = slide.foto;
  const texto = `Vi essa novidade de ${slide.nome} no GuiaZap!`;
  const linkCodificado = encodeURIComponent(link);
  const textoCodificado = encodeURIComponent(texto);

  menu.innerHTML = `
    <a href="https://wa.me/?text=${textoCodificado}%20${linkCodificado}" target="_blank" class="opcao-rede whatsapp">WhatsApp</a>
    <a href="https://www.facebook.com/sharer/sharer.php?u=${linkCodificado}" target="_blank" class="opcao-rede facebook">Facebook</a>
    <a href="https://twitter.com/intent/tweet?text=${textoCodificado}&url=${linkCodificado}" target="_blank" class="opcao-rede twitter">X (Twitter)</a>
    <a href="https://t.me/share/url?url=${linkCodificado}&text=${textoCodificado}" target="_blank" class="opcao-rede telegram">Telegram</a>
    <button type="button" class="opcao-rede copiar" onclick="copiarLinkStory(event)">Copiar link</button>
  `;
  menu.style.display = 'block';
}

async function copiarLinkStory(event){
  event.stopPropagation();
  const slide = storyEmpresaAtual.slidesFlat[storySlideAtual];
  try{
    await navigator.clipboard.writeText(slide.foto);
    alert('Link copiado!');
  } catch(e){
    prompt('Copie o link abaixo:', slide.foto);
  }
  document.getElementById('menu-compartilhar-story').style.display = 'none';
}

function fecharStoryViewer(){
  clearTimeout(storyTimer);
  document.getElementById('story-viewer').style.display = 'none';
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
    return `<a class="btn-zap btn-zap-extra" href="https://wa.me/55${numero}?text=${encodeURIComponent('Olá! Vi seu contato no GuiaZap e gostaria de falar com você.')}" target="_blank">${escapeHtml(label.trim())}</a>`;
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
  supabaseClient.from('eventos_analytics').insert({ profissional_id: id, tipo: 'visualizacao' }).then(({ error }) => {
    if(error) console.error('erro ao registrar evento de visualização', error);
  });
}

function registrarCliqueWhatsapp(id){
  supabaseClient.from('eventos_analytics').insert({ profissional_id: id, tipo: 'whatsapp_click' }).catch(e => console.error('erro ao registrar clique whatsapp', e));
}

function usuarioTemCadastroProprio(){
  return !!(currentUser && entries.some(en => en.user_id === currentUser.id));
}

let modoGerenciarAtivo = false;

function verMinhaEmpresa(){
  if(!currentUser){
    const authBox = document.getElementById('auth-form-fields');
    if(authBox.style.display === 'none') toggleAuthForm();
    const msg = document.getElementById('auth-msg');
    if(msg) msg.textContent = '🔑 Faça login pra ver sua empresa';
    return;
  }
  modoGerenciarAtivo = true;
  render();
  document.getElementById('list').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function verBuscaCompleta(){
  modoGerenciarAtivo = false;
  render();
}

function render(){
  atualizarBadgeFiltrosAtivos();

  const btnVerMinhaEmpresa = document.getElementById('btn-ver-minha-empresa');
  if(btnVerMinhaEmpresa) btnVerMinhaEmpresa.style.display = usuarioTemCadastroProprio() ? 'inline-block' : 'none';

  const btnSeguindoFiltro = document.getElementById('btn-seguindo-filtro');
  if(btnSeguindoFiltro) btnSeguindoFiltro.style.display = currentUser ? 'block' : 'none';

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
    .filter(e => {
      // "Modo gerenciar" (ver só o próprio cadastro) só liga quando a pessoa
      // clica no botão "Ver minha empresa" — nunca troca sozinho ao logar,
      // pra ela continuar podendo buscar outras empresas/produtos à vontade.
      return modoGerenciarAtivo ? e.user_id === currentUser.id : e.status_pagamento === 'ativo';
    })
    .filter(e => !mostrandoSoFavoritos || favoritosEmpresas.has(e.id))
    .filter(e => !mostrandoSoSeguindo || seguindoEmpresas.has(e.id))
    .filter(e => !filtroPremiumRapidoAtivo || ehPremiumOuVendas(e.plano))
    .filter(e => !filtroAbertoAgoraAtivo || estaAbertoAgora(e))
    .filter(e => normalizarTexto(e.name).includes(query) || normalizarTexto(e.cat).includes(query) || normalizarTexto(e.categorias_extra).includes(query))
    .filter(e => !estado || e.estado === estado)
    .filter(e => !cidadeBusca || normalizarTexto(e.cidade).includes(cidadeBusca))
    .filter(e => !bairro || e.bairro === bairro)
    .sort((a,b) => {
      // Impulsionamento avulso tem prioridade máxima — acima até do Premium
      const impulsionadoA = a.impulsionado_ate && new Date(a.impulsionado_ate) > new Date() ? 1 : 0;
      const impulsionadoB = b.impulsionado_ate && new Date(b.impulsionado_ate) > new Date() ? 1 : 0;
      if(impulsionadoA !== impulsionadoB) return impulsionadoB - impulsionadoA;

      if(filtroMaisProximosAtivo && minhaLatitude){
        const temDistA = a.latitude != null && a.longitude != null;
        const temDistB = b.latitude != null && b.longitude != null;
        if(temDistA && !temDistB) return -1;
        if(!temDistA && temDistB) return 1;
        if(temDistA && temDistB){
          const distA = calcularDistanciaKm(minhaLatitude, minhaLongitude, a.latitude, a.longitude);
          const distB = calcularDistanciaKm(minhaLatitude, minhaLongitude, b.latitude, b.longitude);
          if(distA !== distB) return distA - distB;
        }
      }
      if(filtroMelhorAvaliadosAtivo){
        const mediaA = mediaDe(a.id).media;
        const mediaB = mediaDe(b.id).media;
        if(mediaA !== mediaB) return mediaB - mediaA;
      }
      const premiumA = ehPremiumOuVendas(a.plano) ? 1 : 0;
      const premiumB = ehPremiumOuVendas(b.plano) ? 1 : 0;
      if(premiumA !== premiumB) return premiumB - premiumA;
      return a.name.localeCompare(b.name, 'pt-BR');
    });

  document.getElementById('count').innerHTML = loaded
    ? (cadastroCompartilhadoId
        ? `Cadastro compartilhado <button type="button" class="link-voltar-busca" onclick="verTodos()">Ver busca completa</button>`
        : modoGerenciarAtivo
          ? `Seus cadastros · <b>${filtered.length} resultado${filtered.length !== 1 ? 's' : ''}</b> <button type="button" class="link-voltar-busca" onclick="verBuscaCompleta()">← Ver busca completa</button>`
          : `Profissionais próximos a você · <b>${filtered.length} resultados</b>`)
    : '';

  if(!loaded){ list.innerHTML = ''; return; }

  if(filtered.length === 0){
    const buscaAtual = document.getElementById('search').value.trim();
    list.innerHTML = entries.length === 0
      ? '<div class="empty">Ainda não há profissionais cadastrados.<br>Seja o primeiro a cadastrar!</div>'
      : `
        <div class="empty empty-com-cta">
          <div class="empty-icone">🔍</div>
          <p>Nenhum resultado ${buscaAtual ? `pra "<b>${escapeHtml(buscaAtual)}</b>"` : 'com esses filtros'} por aqui ainda.</p>
          <p class="empty-sugestao">Tenta ampliar a busca, trocar o filtro de cidade, ou:</p>
          <a href="pacotes.html" class="btn-cadastro-empty">+ Seja o primeiro a se cadastrar nessa categoria</a>
        </div>
      `;
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
        <a href="${linkDoPlano('premium')}" class="link-pagar" style="background:linear-gradient(90deg, #d4af37, #f4d570, #d4af37); color:#4a3800;">👑 Pagar Pacote Premium (R$25/mês)</a>
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
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:6px;">
          <h3>${escapeHtml(e.name)}${e.verificado && ehPremiumOuVendas(e.plano) ? ' <span title="Empresa Verificada e Premium" class="selo-verificado-premium">✅👑 Verificada Premium</span>' : e.verificado ? ' <span title="Empresa verificada pelo GuiaZap" class="selo-verificado">✅ Empresa verificada</span>' : ''}${ehPremiumOuVendas(e.plano) && !e.verificado ? ' <span title="Empresa Premium" class="selo-premium">👑 Premium</span>' : ''}</h3>
          ${e.impulsionado_ate && new Date(e.impulsionado_ate) > new Date() ? '<div class="selo-impulsionado">🚀 Impulsionado — no topo agora</div>' : ''}
          <div class="selo-disponibilidade ${e.status_disponibilidade === 'atendimento' ? 'atendimento' : 'disponivel'}" ${isOwner ? `onclick="toggleStatusDisponibilidade('${e.id}')" style="cursor:pointer;"` : ''}>
            ${e.status_disponibilidade === 'atendimento' ? '🟡 Em atendimento' : '🟢 Disponível agora'}
            ${isOwner ? ' <span class="link-trocar-status">(trocar)</span>' : ''}
          </div>
          ${e.ultimo_login && (Date.now() - new Date(e.ultimo_login).getTime()) < (30 * 24 * 60 * 60 * 1000) ? '<div class="selo-ativo">🟢 Profissional ativo</div>' : ''}
          ${!denunciasPorEmpresa[e.id] ? '<div class="selo-sem-denuncia">✓ Sem denúncias pendentes</div>' : ''}
          ${filtroMaisProximosAtivo && minhaLatitude && e.latitude != null && e.longitude != null ? `<div class="distancia-km">📍 ${calcularDistanciaKm(minhaLatitude, minhaLongitude, e.latitude, e.longitude).toFixed(1)} km de você</div>` : ''}
          ${e.horario_dias && e.horario_abre && e.horario_fecha ? `<div class="selo-horario ${estaAbertoAgora(e) ? 'aberto' : 'fechado'}">${estaAbertoAgora(e) ? '🟢 Aberto agora' : '🔴 Fechado agora'}</div>` : ''}
          ${isOwner && ehPremiumOuVendas(e.plano) ? `
            <div class="contagem-seguidores" onclick="toggleListaSeguidores('${e.id}')">
              👥 ${contagemSeguidoresPorEmpresa[e.id] ?? '...'} seguidor${contagemSeguidoresPorEmpresa[e.id] === 1 ? '' : 'es'}
              <span class="link-ver-lista">(ver lista)</span>
            </div>
            <div class="lista-seguidores" id="lista-seguidores-${e.id}" style="display:none;">
              ${(listaSeguidoresPorEmpresa[e.id] || []).length === 0
                ? '<div class="lista-seguidores-vazio">Nenhum seguidor ainda.</div>'
                : (listaSeguidoresPorEmpresa[e.id] || []).map(s => `
                    <div class="lista-seguidores-item">
                      ${escapeHtml(s.user_nome || s.user_email)}
                      <span class="lista-seguidores-data">desde ${new Date(s.created_at).toLocaleDateString('pt-BR')}</span>
                    </div>
                  `).join('')}
            </div>
          ` : ''}
          <div style="display:flex; align-items:center; gap:4px;">
            <button class="icon-btn-favorito" title="Favoritar" onclick="toggleFavorito('${e.id}', event)">${favoritosEmpresas.has(e.id) ? '❤️' : '🤍'}</button>
            ${!isOwner && ehPremiumOuVendas(e.plano) ? `<button class="btn-seguir${seguindoEmpresas.has(e.id) ? ' seguindo' : ''}" onclick="toggleSeguir('${e.id}', event)">${seguindoEmpresas.has(e.id) ? 'Deixar de seguir' : '+ Seguir'}</button>` : ''}
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
        ${isOwner && !pendente && e.plano !== 'completo' && !ehPremiumOuVendas(e.plano) ? `<a href="${LINK_ASSINATURA_COMPLETO}" class="link-migrar">✨ Migrar para o Pacote Completo (R$10/mês)</a>` : ''}
        ${isOwner && !pendente && !ehPremiumOuVendas(e.plano) ? `<a href="${LINK_ASSINATURA_PREMIUM}" class="link-migrar" style="background:linear-gradient(90deg, #fdf6e3, #f9e9b8); border:1.5px solid #d4af37; color:#4a3800;">👑 Migrar para o Pacote Premium (R$25/mês) — seguidores, mais Stories e prioridade</a>` : ''}
        ${isOwner && !pendente && e.plano !== 'vendas' ? `<a href="${LINK_ASSINATURA_VENDAS}" class="link-migrar" style="background:#0f766e; color:white; border:none;">💼 Migrar para o Pacote Vendas (R$40/mês) — Vitrine, pedidos e atendimento automático</a>` : ''}
        ${isOwner && !pendente && !(e.impulsionado_ate && new Date(e.impulsionado_ate) > new Date()) ? `<a href="${LINK_IMPULSIONAR}" class="link-migrar" style="background:#1c1c1c; color:white; border:none;">🚀 Impulsionar por 24h no topo (R$5,00)</a>` : ''}
        <button type="button" class="btn-opcoes-card" onclick="toggleOpcoesExtra('${e.id}')">⋮ Opções</button>
        <div class="card-acoes-extra" id="opcoes-extra-${e.id}" style="display:none;">
          <button type="button" class="link-compartilhar" onclick="toggleMenuCompartilharCadastro('${e.id}', '${escapeHtml(e.name).replace(/'/g, "\\'")}')">Compartilhar</button>
          <button type="button" class="link-compartilhar" onclick="compartilharNoChat('${window.location.origin}/index.html?p=${e.id}', '${escapeHtml(e.name).replace(/'/g, "\\'")}')">💬 Enviar no chat</button>
          <div class="menu-compartilhar" id="menu-compartilhar-cad-${e.id}" style="display:none;"></div>
          ${isOwner ? `<button type="button" class="link-compartilhar" onclick="mostrarQrCode('${e.id}')">📱 QR Code pra imprimir</button>` : ''}
          <div class="qrcode-box" id="qrcode-box-${e.id}" style="display:none;"></div>
          ${!isOwner ? `<button type="button" class="link-denunciar" onclick="abrirDenuncia('${e.id}')">Denunciar</button>` : ''}
          ${!isOwner ? `<button type="button" class="link-mensagem" onclick="abrirMensagemEmpresa('${e.id}')">💬 Reclamar/Sugerir pra empresa</button>` : ''}
          ${isOwner ? `<button type="button" class="link-ver-denuncias" onclick="toggleMensagensRecebidas('${e.id}')">💬 Ver mensagens recebidas</button>` : ''}
          ${isOwner ? `<a href="chat.html" class="link-ver-denuncias" style="text-decoration:none;">💬 Ver conversas do chat</a>` : ''}
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
        <div class="acoes-empresa-coluna">
          <div class="contatos-row">
            <a class="btn-zap" href="https://wa.me/55${escapeHtml((e.whatsapp || '').replace(/\D/g,''))}?text=${encodeURIComponent('Olá! Vi seu contato no GuiaZap e gostaria de falar com você.')}" target="_blank" onclick="registrarCliqueWhatsapp('${e.id}')">Chamar no WhatsApp</a>
            ${!isOwner ? `<a href="chat.html?empresa=${e.id}" class="btn-zap" style="background:#6b46c1;">💬 Chat pelo Papo</a>` : ''}
            ${renderContatosExtra(e.contatos_extra)}
          </div>
          <div class="orcamento-bloco">
            <button type="button" class="btn-zap btn-orcamento" onclick="toggleOrcamentoOpcoes('${e.id}')">💰 Pedir orçamento</button>
            <div class="orcamento-opcoes" id="orcamento-opcoes-${e.id}" style="display:none;">
              <a class="btn-zap" href="https://wa.me/55${escapeHtml((e.whatsapp || '').replace(/\D/g,''))}?text=${encodeURIComponent('Olá! Vi seu contato no GuiaZap e gostaria de pedir um orçamento.')}" target="_blank" onclick="registrarCliqueWhatsapp('${e.id}')">📱 Pelo WhatsApp</a>
              <a class="btn-zap" style="background:#6b46c1;" href="chat.html?empresa=${e.id}">💬 Pelo Papo</a>
            </div>
          </div>
          ${e.plano === 'vendas' ? `<a href="vitrine.html?empresa=${e.id}" class="link-ver-produtos">🛍️ Ver produtos desta empresa</a>` : ''}
          ${isOwner && (e.plano === 'completo' || ehPremiumOuVendas(e.plano)) ? `<a href="talentos.html" class="link-ver-produtos" style="background:#6b46c1;">🎯 Consultar Banco de Talentos</a>` : ''}
          ${isOwner ? `<button type="button" class="link-ver-produtos" style="background:#e91e63; border:none; cursor:pointer;" onclick="abrirFormStory('${e.id}', '${e.plano}')">📸 Postar novidade (24h)</button>` : ''}
          ${isOwner && (e.plano === 'completo' || ehPremiumOuVendas(e.plano)) ? `<button type="button" class="link-ver-produtos" style="background:#6b46c1; border:none; cursor:pointer;" onclick="abrirFormVideo('${e.id}', '${e.plano}')">🎥 Postar vídeo</button>` : ''}
          ${isOwner && (e.plano === 'completo' || ehPremiumOuVendas(e.plano)) ? `<a href="talentos.html" class="link-ver-produtos" style="background:#6b46c1; text-decoration:none; display:inline-block;">🎯 Banco de Talentos</a>` : ''}
          ${isOwner && e.plano === 'vendas' ? `<button type="button" class="link-ver-produtos" style="background:#0f766e; border:none; cursor:pointer;" onclick="abrirConfigAtendimento('${e.id}')">🤖 Atendimento automático</button>` : ''}
          ${isOwner && e.plano === 'vendas' ? `<button type="button" class="link-ver-produtos" style="background:#1c1c1c; border:none; cursor:pointer;" onclick="abrirGerenciarMotoboys('${e.id}')">🛵 Gerenciar motoboys</button>` : ''}
          ${isOwner && e.plano === 'vendas' ? `<button type="button" class="link-ver-produtos" id="btn-mp-conectar-${e.id}" style="background:${e.mpConectado ? '#1a7a3c' : '#0f766e'}; border:none; cursor:pointer;" onclick="conectarMercadoPago('${e.id}')">${e.mpConectado ? '✅ Mercado Pago conectado' : '💳 Conectar Mercado Pago (receber direto)'}</button>` : ''}
          ${isOwner && (e.plano === 'completo' || ehPremiumOuVendas(e.plano)) ? `<a href="videos.html" class="link-ver-produtos" style="background:#6b46c1; text-decoration:none;">🎬 Ver seção de Vídeos</a>` : ''}
          ${isOwner && ehPremiumOuVendas(e.plano) ? `<a href="relatorio.html" class="link-ver-produtos" style="background:#0a4a6b;">📊 Ver relatório visual</a>` : ''}
        </div>
        ${isOwner ? `<div class="minhas-novidades" id="minhas-novidades-${e.id}"></div>` : ''}
        ${isOwner && !e.verificado ? `<div id="painel-verificacao-${e.id}"></div>` : ''}
      </div>
    </div>
  `; }).join('');

  entries.filter(e => e.user_id === (currentUser && currentUser.id)).forEach(e => renderMinhasNovidades(e.id));
  entries.filter(e => e.user_id === (currentUser && currentUser.id) && !e.verificado).forEach(e => renderPainelVerificacao(e.id));
  renderStoriesLinha();
}

function validarCPF(cpf){
  cpf = (cpf || '').replace(/\D/g, '');
  if(cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  let soma = 0;
  for(let i = 0; i < 9; i++) soma += parseInt(cpf[i]) * (10 - i);
  let resto = (soma * 10) % 11;
  if(resto === 10 || resto === 11) resto = 0;
  if(resto !== parseInt(cpf[9])) return false;

  soma = 0;
  for(let i = 0; i < 10; i++) soma += parseInt(cpf[i]) * (11 - i);
  resto = (soma * 10) % 11;
  if(resto === 10 || resto === 11) resto = 0;
  if(resto !== parseInt(cpf[10])) return false;

  return true;
}

function validarCNPJ(cnpj){
  cnpj = (cnpj || '').replace(/\D/g, '');
  if(cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;

  let tamanho = cnpj.length - 2;
  let numeros = cnpj.substring(0, tamanho);
  const digitos = cnpj.substring(tamanho);
  let soma = 0;
  let pos = tamanho - 7;
  for(let i = tamanho; i >= 1; i--){
    soma += numeros.charAt(tamanho - i) * pos--;
    if(pos < 2) pos = 9;
  }
  let resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
  if(resultado !== parseInt(digitos.charAt(0))) return false;

  tamanho = tamanho + 1;
  numeros = cnpj.substring(0, tamanho);
  soma = 0;
  pos = tamanho - 7;
  for(let i = tamanho; i >= 1; i--){
    soma += numeros.charAt(tamanho - i) * pos--;
    if(pos < 2) pos = 9;
  }
  resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
  if(resultado !== parseInt(digitos.charAt(1))) return false;

  return true;
}

async function conferirDocumentoAoSair(){
  const campo = document.getElementById('f-documento');
  const msg = document.getElementById('f-documento-msg');
  const digitos = campo.value.replace(/\D/g, '');
  if(!msg || !digitos) return;

  if(digitos.length === 11){
    msg.textContent = validarCPF(digitos) ? '✓ CPF válido' : '⚠️ Esse CPF não é válido — confira os números';
    msg.style.color = validarCPF(digitos) ? 'var(--verde-escuro)' : '#a4402f';
    return;
  }

  if(digitos.length === 14){
    if(!validarCNPJ(digitos)){
      msg.textContent = '⚠️ Esse CNPJ não é válido — confira os números';
      msg.style.color = '#a4402f';
      return;
    }

    msg.textContent = 'Consultando na Receita Federal...';
    msg.style.color = '#888';
    try{
      const resp = await fetch(`/.netlify/functions/consultar-cnpj?cnpj=${digitos}`);
      const data = await resp.json();

      if(!data.encontrado){
        msg.textContent = '⚠️ Não encontramos esse CNPJ na Receita Federal — confira os números';
        msg.style.color = '#a4402f';
        return;
      }

      const nomeDigitado = normalizarTexto(document.getElementById('f-name').value.trim());
      const razaoSocial = normalizarTexto(data.razao_social || '');
      const nomeFantasia = normalizarTexto(data.nome_fantasia || '');
      const bateComAlgum = nomeDigitado && (razaoSocial.includes(nomeDigitado) || nomeDigitado.includes(razaoSocial) || (nomeFantasia && (nomeFantasia.includes(nomeDigitado) || nomeDigitado.includes(nomeFantasia))));

      if(data.situacao && data.situacao.toUpperCase() !== 'ATIVA'){
        msg.textContent = `⚠️ CNPJ válido, mas a situação na Receita é "${data.situacao}" (não ativa)`;
        msg.style.color = '#a4402f';
      } else if(!nomeDigitado){
        msg.textContent = `✓ CNPJ válido — Razão Social: ${data.razao_social}`;
        msg.style.color = 'var(--verde-escuro)';
      } else if(bateComAlgum){
        msg.textContent = `✓ CNPJ válido e o nome bate com a Receita Federal (${data.razao_social})`;
        msg.style.color = 'var(--verde-escuro)';
      } else {
        msg.textContent = `⚠️ CNPJ válido, mas o nome digitado não parece bater com a Receita Federal (lá consta: "${data.razao_social}")`;
        msg.style.color = '#a4402f';
      }
    } catch(e){
      console.error(e);
      msg.textContent = '⚠️ Não conseguimos consultar a Receita Federal agora — confira os números manualmente';
      msg.style.color = '#a4402f';
    }
    return;
  }

  msg.textContent = digitos.length > 0 ? '⚠️ CPF tem 11 números, CNPJ tem 14 — confira a quantidade' : '';
  msg.style.color = '#a4402f';
}

function mascaraCep(event){
  let v = event.target.value.replace(/\D/g, '').slice(0, 8);
  if(v.length > 5) v = v.slice(0, 5) + '-' + v.slice(5);
  event.target.value = v;
}

function mascaraDocumento(event){
  let v = event.target.value.replace(/\D/g, '').slice(0, 14);
  if(v.length <= 11){
    // CPF: 000.000.000-00
    v = v.replace(/(\d{3})(\d)/, '$1.$2')
         .replace(/(\d{3})(\d)/, '$1.$2')
         .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  } else {
    // CNPJ: 00.000.000/0000-00
    v = v.replace(/(\d{2})(\d)/, '$1.$2')
         .replace(/(\d{3})(\d)/, '$1.$2')
         .replace(/(\d{3})(\d)/, '$1/$2')
         .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
  }
  event.target.value = v;
}

function normalizarTexto(str){
  return (str || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// Truque contra o Chrome insistir em sugerir contas Google no campo de busca:
// deixa "somente leitura" até a pessoa clicar, só então libera pra digitar.
(function(){
  const campoBusca = document.getElementById('search');
  if(campoBusca){
    campoBusca.setAttribute('readonly', 'readonly');
    campoBusca.addEventListener('focus', function(){
      this.removeAttribute('readonly');
    });
  }
})();

function mostrarWelcomeGateSeNecessario(){
  if(localStorage.getItem('jaVisitouGuiaZap') === '1') return;
  if(localStorage.getItem('abrirCadastroPapoAoCarregar') === '1') return;
  document.getElementById('welcome-gate').style.display = 'flex';
}

function fecharWelcomeGate(){
  localStorage.setItem('jaVisitouGuiaZap', '1');
  document.getElementById('welcome-gate').style.display = 'none';
}

function pularWelcomeGate(){
  fecharWelcomeGate();
}

async function welcomeSignIn(){
  const email = document.getElementById('welcome-email').value.trim();
  const senha = document.getElementById('welcome-password').value;
  const msg = document.getElementById('welcome-msg');
  if(!email || !senha){ msg.textContent = 'preencha e-mail e senha'; return; }

  msg.textContent = 'entrando...';
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password: senha });
  if(error){ msg.textContent = error.message; return; }

  fecharWelcomeGate();
}

async function welcomeSignUp(){
  const nome = document.getElementById('welcome-nome').value.trim();
  const email = document.getElementById('welcome-email').value.trim();
  const senha = document.getElementById('welcome-password').value;
  const msg = document.getElementById('welcome-msg');
  if(!nome || !email || !senha){ msg.textContent = 'preencha nome, e-mail e senha'; return; }
  if(!document.getElementById('welcome-aceite-termos').checked){ msg.textContent = 'você precisa aceitar os Termos de Uso pra continuar'; return; }

  msg.textContent = 'criando conta...';
  const { error } = await supabaseClient.auth.signUp({ email, password: senha, options: { data: { nome } } });
  if(error){ msg.textContent = error.message; return; }

  msg.textContent = 'conta criada! verifique seu e-mail se for solicitado.';
  msg.style.color = 'var(--verde-escuro)';
  setTimeout(fecharWelcomeGate, 2000);
}

if(initSupabase()){
  initAuth();
  loadEntries();
  loadStories();
  loadVideosDestaque();
  loadContadorPlataforma();
  loadDenunciasPorEmpresa();
  mostrarWelcomeGateSeNecessario();

  // Garantia extra: se por algum motivo de timing o sino de notificações
  // não tiver iniciado logo de cara, tenta de novo depois de alguns segundos
  setTimeout(tentarIniciarNotificacoes, 3000);
}

localStorage.removeItem('historico_busca'); // remove o histórico de buscas antigo, já que a funcionalidade foi retirada

if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(err => console.error('erro ao registrar service worker', err));
  });
}

// ---------- INSTALAÇÃO DO APP (PWA) ----------

let promptInstalacaoPWA = null;

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  promptInstalacaoPWA = event;
  const btn = document.getElementById('btn-instalar-pwa');
  if(btn) btn.style.display = 'block';
});

async function instalarPWA(){
  if(!promptInstalacaoPWA) return;
  promptInstalacaoPWA.prompt();
  const { outcome } = await promptInstalacaoPWA.userChoice;
  if(outcome === 'accepted'){
    document.getElementById('btn-instalar-pwa').style.display = 'none';
  }
  promptInstalacaoPWA = null;
}

window.addEventListener('appinstalled', () => {
  const btn = document.getElementById('btn-instalar-pwa');
  if(btn) btn.style.display = 'none';
});

// ---------- NOTIFICAÇÕES PUSH ----------

const VAPID_PUBLIC_KEY = 'BGuNuGRR8zQZL0ZUeJo4y-zeiGItjWzLelApvMPh-F5Sj2wkcmZWcjHKF3RO6fkLCrh1Pmt0HIu4oPzFLz_41fg';

function urlBase64ToUint8Array(base64String){
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for(let i = 0; i < rawData.length; ++i){
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function atualizarVisibilidadeBotaoPush(){
  const btn = document.getElementById('btn-ativar-push');
  if(!btn) return;
  const suportado = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  btn.style.display = (suportado && currentUser) ? 'inline-block' : 'none';
  btn.textContent = Notification.permission === 'granted' ? '🔔' : '🛎️';
  btn.title = Notification.permission === 'granted'
    ? 'Notificações ativadas (toque pra verificar/reativar)'
    : 'Ativar notificações (essencial pra receber chamadas e mensagens do Papo)';

  // Move o botão pro topo, do lado do sino amarelo, assim que essa linha existir
  const linhaTopo = document.getElementById('notif-linha-topo');
  if(linhaTopo && btn.parentElement !== linhaTopo){
    linhaTopo.insertBefore(btn, linhaTopo.firstChild);
  }
}

async function ativarNotificacoesPush(){
  if(!('serviceWorker' in navigator) || !('PushManager' in window)){
    alert('Seu navegador não suporta notificações push.');
    return;
  }
  if(!currentUser){
    alert('Faça login pra ativar notificações.');
    return;
  }

  const permissao = await Notification.requestPermission();
  if(permissao !== 'granted'){
    alert('Você precisa permitir notificações pra ativar esse recurso.');
    return;
  }

  try{
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if(!subscription){
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }

    const subJson = subscription.toJSON();

    const { data: existente } = await supabaseClient.from('push_subscriptions').select('id').eq('endpoint', subJson.endpoint).maybeSingle();
    if(existente){
      await supabaseClient.from('push_subscriptions').update({ user_id: currentUser.id, p256dh: subJson.keys.p256dh, auth: subJson.keys.auth }).eq('endpoint', subJson.endpoint);
    } else {
      await supabaseClient.from('push_subscriptions').insert({ user_id: currentUser.id, endpoint: subJson.endpoint, p256dh: subJson.keys.p256dh, auth: subJson.keys.auth });
    }

    alert('🔔 Notificações ativadas! Agora você vai receber avisos de chamadas e mensagens do Papo, vagas novas e novidades de quem você segue — mesmo com o site fechado.');
    atualizarVisibilidadeBotaoPush();
  } catch(e){
    console.error(e);
    alert('Erro ao ativar notificações. Tente de novo.');
  }
}