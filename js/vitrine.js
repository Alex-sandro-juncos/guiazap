let supabaseClientV;
let produtos = [];
let avaliacoesProdutosMap = {};

// ---------- FAVORITOS DE PRODUTO (salvos no navegador) ----------
let favoritosProdutos = new Set(JSON.parse(localStorage.getItem('favoritos_produtos') || '[]'));
let mostrandoSoFavoritosProdutos = false;

function toggleFavoritoProduto(id, event){
  if(event) event.stopPropagation();
  if(favoritosProdutos.has(id)) favoritosProdutos.delete(id);
  else favoritosProdutos.add(id);
  localStorage.setItem('favoritos_produtos', JSON.stringify([...favoritosProdutos]));
  renderProdutos();
}

function toggleFiltroFavoritosProdutos(){
  mostrandoSoFavoritosProdutos = !mostrandoSoFavoritosProdutos;
  const btn = document.getElementById('btn-favoritos-produtos');
  if(btn) btn.classList.toggle('ativo', mostrandoSoFavoritosProdutos);
  renderProdutos();
}
let meusCadastros = [];
let currentUserV = null;
let idadeConfirmada18 = sessionStorage.getItem('idadeConfirmada18') === '1';

function confirmarIdade18Mais(){
  idadeConfirmada18 = true;
  sessionStorage.setItem('idadeConfirmada18', '1');
  renderProdutos();
}
let seguindoEmpresasV = new Set();

async function loadSeguindoV(){
  if(!currentUserV){ seguindoEmpresasV = new Set(); return; }
  const { data, error } = await supabaseClientV.from('seguidores').select('profissional_id').eq('user_id', currentUserV.id);
  if(error){ console.error(error); return; }
  seguindoEmpresasV = new Set((data || []).map(s => s.profissional_id));
}

function initSupabaseV(){
  if(!SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
  supabaseClientV = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Se a pessoa trocar de conta (sair e entrar em outra) sem sair da página,
  // troca pro carrinho certo daquela conta — sem isso, o carrinho de uma
  // conta "vazava" pra outra no mesmo navegador
  supabaseClientV.auth.onAuthStateChange((event, session) => {
    const novoUserId = session ? session.user.id : null;
    const userIdAnterior = currentUserV ? currentUserV.id : null;
    if(novoUserId !== userIdAnterior){
      currentUserV = session ? session.user : null;
      carregarCarrinhoDoUsuarioAtual();
    }
  });

  return true;
}

async function initAuthV(){
  const { data: { session } } = await supabaseClientV.auth.getSession();
  currentUserV = session ? session.user : null;
  carregarCarrinhoDoUsuarioAtual();
  await loadSeguindoV();
  document.getElementById('v-add-btn').style.display = currentUserV ? 'inline-block' : 'none';
  document.getElementById('v-ver-meus-btn').style.display = 'none';

  if(currentUserV){
    const { data } = await supabaseClientV
      .from('profissionais')
      .select('id, name')
      .eq('user_id', currentUserV.id)
      .eq('status_pagamento', 'ativo')
      .eq('plano', 'vendas');
    meusCadastros = data || [];

    const sel = document.getElementById('p-profissional');
    sel.innerHTML = meusCadastros.map(c => `<option value="${c.id}">${escapeHtmlV(c.name)}</option>`).join('');

    if(meusCadastros.length === 0){
      document.getElementById('v-add-btn').style.display = 'none';
    } else {
      document.getElementById('v-ver-meus-btn').style.display = 'inline-block';
    }
  }
}

let empresaFiltroId = null;
let produtoFiltroId = null;

async function loadProdutos(){
  const { data, error } = await supabaseClientV
    .from('produtos')
    .select('*, profissionais(id, name, whatsapp, status_pagamento, user_id, plano)')
    .order('created_at', { ascending: false });

  if(error){ console.error(error); return; }

  produtos = (data || []).filter(p => p.profissionais && p.profissionais.status_pagamento === 'ativo');

  // Sorteia uma posição pra cada produto UMA VEZ, quando a página carrega —
  // assim a ordem não fica pulando toda vez que a pessoa digita na busca,
  // mas ainda vem diferente a cada nova visita à Vitrine.
  produtos.forEach(p => { p._ordemAleatoria = Math.random(); });

  loadAvaliacoesProdutos().then(renderProdutos);
  popularFiltrosProduto();

  const params = new URLSearchParams(window.location.search);
  empresaFiltroId = params.get('empresa');
  produtoFiltroId = params.get('produto');

  if(produtoFiltroId){
    const produtoCompartilhado = produtos.find(p => p.id === produtoFiltroId);
    if(produtoCompartilhado && produtoCompartilhado.profissionais){
      // Mostra o produto em destaque + os outros produtos da mesma empresa
      empresaFiltroId = produtoCompartilhado.profissionais.id;
      const nomeEmpresa = produtoCompartilhado.profissionais.name;
      document.querySelector('.vitrine-header h1').textContent = `Produtos de ${nomeEmpresa}`;
      document.querySelector('.vitrine-header p').innerHTML = `<a href="vitrine.html" style="color:white; text-decoration:underline;">← Ver vitrine completa</a>`;
    } else {
      document.querySelector('.vitrine-header h1').textContent = 'Produto compartilhado';
      document.querySelector('.vitrine-header p').innerHTML = `<a href="vitrine.html" style="color:white; text-decoration:underline;">← Ver vitrine completa</a>`;
    }
  } else if(empresaFiltroId){
    const empresa = produtos.find(p => p.profissionais && p.profissionais.id === empresaFiltroId);
    const nomeEmpresa = empresa ? empresa.profissionais.name : '';
    document.querySelector('.vitrine-header h1').textContent = nomeEmpresa ? `Produtos de ${nomeEmpresa}` : 'GuiaZap Vitrine';
    document.querySelector('.vitrine-header p').innerHTML = `<a href="vitrine.html" style="color:white; text-decoration:underline;">← Ver vitrine completa</a>`;
  }

  renderProdutos();
}

async function loadAvaliacoesProdutos(){
  const { data, error } = await supabaseClientV.from('avaliacoes_produtos').select('produto_id, nota');
  if(error){ console.error(error); return; }

  avaliacoesProdutosMap = {};
  data.forEach(a => {
    if(!avaliacoesProdutosMap[a.produto_id]) avaliacoesProdutosMap[a.produto_id] = { soma: 0, count: 0 };
    avaliacoesProdutosMap[a.produto_id].soma += a.nota;
    avaliacoesProdutosMap[a.produto_id].count += 1;
  });
}

function mediaDeProduto(id){
  const dados = avaliacoesProdutosMap[id];
  if(!dados || dados.count === 0) return { media: 0, count: 0 };
  return { media: dados.soma / dados.count, count: dados.count };
}

function starStringV(rating){
  const full = Math.round(rating);
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}

function jaAvaliouProduto(id){
  return localStorage.getItem('avaliado_produto_' + id) === '1';
}

function abrirAvaliacaoProduto(id){
  const box = document.getElementById('review-produto-box-' + id);
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

let notaSelecionadaProduto = {};

function selecionarNotaProduto(id, nota){
  notaSelecionadaProduto[id] = nota;
  const stars = document.querySelectorAll('#review-produto-stars-' + id + ' span');
  stars.forEach((s, i) => { s.textContent = (i < nota) ? '★' : '☆'; });
}

async function enviarAvaliacaoProduto(id){
  const comentarioInput = document.getElementById('review-produto-comentario-' + id);
  const msg = document.getElementById('review-produto-msg-' + id);

  if(jaAvaliouProduto(id)){ msg.textContent = 'Você já avaliou este produto neste dispositivo.'; return; }

  const nota = notaSelecionadaProduto[id];
  const comentario = comentarioInput.value.trim();
  if(!nota){ msg.textContent = 'Escolha uma nota.'; return; }

  msg.textContent = 'enviando...';
  const { error } = await supabaseClientV.from('avaliacoes_produtos').insert({
    produto_id: id, nota, comentario: comentario || null
  });
  if(error){ console.error(error); msg.textContent = 'erro ao enviar avaliação'; return; }

  localStorage.setItem('avaliado_produto_' + id, '1');
  comentarioInput.value = '';
  delete notaSelecionadaProduto[id];
  msg.textContent = 'avaliação enviada, obrigado!';
  await loadAvaliacoesProdutos();
  renderProdutos();
}

function textoMedida(p){
  const qtd = p.quantidade || 1;
  if(p.unidade_medida === 'peso') return `${qtd} kg`;
  if(p.unidade_medida === 'litro') return `${qtd} L`;
  return qtd == 1 ? '1 unidade' : `${qtd} unidades`;
}

let visualizacoesProdutoContadas = new Set();

function contarVisualizacaoProduto(id, isDono){
  if(isDono) return;
  if(visualizacoesProdutoContadas.has(id)) return;
  visualizacoesProdutoContadas.add(id);
  supabaseClientV.rpc('incrementar_visualizacao_produto', { pid: id }).then(({ error }) => {
    if(error) console.error('erro ao contar visualização de produto', error);
  });
}

function popularFiltrosProduto(){
  const categorias = [...new Set(produtos.map(p => p.categoria).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'pt-BR'));

  const filtroSel = document.getElementById('v-filter-categoria');
  const prevValor = filtroSel.value;
  filtroSel.innerHTML = '<option value="">Categoria</option>' + categorias.map(c => `<option value="${escapeHtmlV(c)}">${escapeHtmlV(c)}</option>`).join('');
  filtroSel.value = prevValor;

  const datalist = document.getElementById('categorias-produto-list');
  if(datalist) datalist.innerHTML = categorias.map(c => `<option value="${escapeHtmlV(c)}">`).join('');
}

let modoGerenciarVitrineAtivo = false;

function verMeusProdutos(){
  if(!currentUserV){
    alert('Faça login na página inicial primeiro pra ver seus produtos.');
    return;
  }
  modoGerenciarVitrineAtivo = true;
  renderProdutos();
  document.getElementById('v-grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function verVitrineCompleta(){
  modoGerenciarVitrineAtivo = false;
  renderProdutos();
}

function renderProdutos(){
  const query = normalizarTextoV(document.getElementById('v-search').value);
  const categoriaFiltro = document.getElementById('v-filter-categoria').value;
  const precoFiltro = document.getElementById('v-filter-preco').value;
  const linkDireto = produtoFiltroId || empresaFiltroId;
  const filtradosBase = produtos
    .filter(p => !empresaFiltroId || (p.profissionais && p.profissionais.id === empresaFiltroId))
    .filter(p => !modoGerenciarVitrineAtivo || (p.profissionais && p.profissionais.user_id === currentUserV.id))
    .filter(p => !mostrandoSoFavoritosProdutos || favoritosProdutos.has(p.id))
    .filter(p => !categoriaFiltro || p.categoria === categoriaFiltro)
    .filter(p => {
      if(!precoFiltro) return true;
      const precoNumerico = parseFloat((p.preco || '').replace(/[^\d,]/g, '').replace(',', '.'));
      if(isNaN(precoNumerico)) return false;
      const [min, max] = precoFiltro.split('-').map(Number);
      return precoNumerico >= min && precoNumerico <= max;
    })
    .filter(p =>
      normalizarTextoV(p.nome).includes(query) ||
      normalizarTextoV(p.marca).includes(query) ||
      normalizarTextoV(p.descricao).includes(query) ||
      normalizarTextoV(p.codigo_barras).includes(query) ||
      (p.profissionais && normalizarTextoV(p.profissionais.name).includes(query))
    );

  // Separa em grupos de prioridade, embaralha CADA grupo de forma independente
  // (embaralhamento de verdade, não só um empate na ordenação), e junta tudo:
  // 1) produto compartilhado por link direto sempre primeiro
  // 2) empresas que a pessoa segue
  // 3) empresas Premium (que não sejam seguidas)
  // 4) todo o resto
  const grupoLink = [];
  const grupoSeguindo = [];
  const grupoPremium = [];
  const grupoResto = [];

  filtradosBase.forEach(p => {
    if(produtoFiltroId && p.id === produtoFiltroId){ grupoLink.push(p); return; }
    if(p.profissionais && seguindoEmpresasV.has(p.profissionais.id)){ grupoSeguindo.push(p); return; }
    if(p.profissionais && p.profissionais.plano === 'premium'){ grupoPremium.push(p); return; }
    grupoResto.push(p);
  });

  const filtrados = [
    ...grupoLink.sort((a, b) => a._ordemAleatoria - b._ordemAleatoria),
    ...grupoSeguindo.sort((a, b) => a._ordemAleatoria - b._ordemAleatoria),
    ...grupoPremium.sort((a, b) => a._ordemAleatoria - b._ordemAleatoria),
    ...grupoResto.sort((a, b) => a._ordemAleatoria - b._ordemAleatoria)
  ];

  document.getElementById('v-count').innerHTML = modoGerenciarVitrineAtivo
    ? `Seus produtos · <b>${filtrados.length}</b> <button type="button" class="link-voltar-busca" onclick="verVitrineCompleta()">← Ver vitrine completa</button>`
    : `${filtrados.length} produto${filtrados.length !== 1 ? 's' : ''}`;

  const grid = document.getElementById('v-grid');
  if(filtrados.length === 0){
    const mensagem = (currentUserV && !linkDireto)
      ? 'Você ainda não tem produtos cadastrados. Clique em "+ Anunciar produto" para começar.'
      : 'Nenhum produto encontrado ainda.';
    grid.innerHTML = `<div class="vazio-vitrine">${mensagem}</div>`;
    return;
  }

  grid.innerHTML = filtrados.map(p => {
    const isDono = currentUserV && p.profissionais && p.profissionais.user_id === currentUserV.id;
    contarVisualizacaoProduto(p.id, isDono);
    const isCompartilhado = produtoFiltroId && p.id === produtoFiltroId;
    const precisaConfirmarIdade = p.produto_18_mais && !idadeConfirmada18;
    return `
    <div class="card-produto${isCompartilhado ? ' card-produto-destaque' : ''}${precisaConfirmarIdade ? ' card-produto-18mais' : ''}">
      ${isCompartilhado ? '<div class="selo-compartilhado">⭐ Produto compartilhado</div>' : ''}
      ${precisaConfirmarIdade ? `
        <div class="overlay-18mais">
          <div class="overlay-18mais-conteudo">
            <div class="overlay-18mais-icone">🔞</div>
            <p>Esse produto é restrito por idade.</p>
            <button type="button" class="btn-confirmar-18mais" onclick="confirmarIdade18Mais()">Confirmo que tenho 18 anos ou mais</button>
          </div>
        </div>
      ` : ''}
      <div class="foto-produto-area">
        <img src="${p.foto ? escapeHtmlV(p.foto) : 'https://api.dicebear.com/7.x/shapes/svg?seed=' + encodeURIComponent(p.nome)}" alt="${escapeHtmlV(p.nome)}" loading="lazy">
        <button class="icon-btn-favorito" title="Favoritar" onclick="toggleFavoritoProduto('${p.id}', event)">${favoritosProdutos.has(p.id) ? '❤️' : '🤍'}</button>
        ${isDono ? `<span class="owner-actions">
          <button class="icon-btn" title="Editar" onclick="editarProduto('${p.id}')">✎</button>
          <button class="icon-btn" title="Excluir" onclick="excluirProduto('${p.id}')">✕</button>
        </span>` : ''}
      </div>
      <div class="info">
        <div class="nome">${escapeHtmlV(p.nome)}${p.produto_18_mais ? ' <span class="selo-18mais">🔞 +18</span>' : ''}</div>
        ${p.marca ? `<div class="marca-produto">${escapeHtmlV(p.marca)}</div>` : ''}
        ${p.categoria ? `<div class="categoria-produto">${escapeHtmlV(p.categoria)}</div>` : ''}
        ${isDono ? `<div class="stat-visualizacoes">👁️ ${p.visualizacoes || 0} visualizaç${(p.visualizacoes || 0) === 1 ? 'ão' : 'ões'}</div>` : ''}
        <div class="medida-produto">${textoMedida(p)}</div>
        ${p.preco ? `<div class="preco">R$ ${escapeHtmlV(p.preco)}</div>` : ''}
        <div class="empresa">${p.profissionais ? escapeHtmlV(p.profissionais.name) : ''}${p.profissionais && p.profissionais.plano === 'premium' ? ' <span class="selo-premium">👑</span>' : ''}</div>
        <div class="stars-produto">
          ${mediaDeProduto(p.id).count > 0
            ? `${starStringV(mediaDeProduto(p.id).media)} <span class="num-produto">${mediaDeProduto(p.id).media.toFixed(1)}</span>`
            : '<span class="sem-avaliacao-produto">Sem avaliações</span>'}
          ${jaAvaliouProduto(p.id) ? '<span class="ja-avaliou-produto">Avaliado</span>' : `<button type="button" class="link-avaliar-produto" onclick="abrirAvaliacaoProduto('${p.id}')">Avaliar</button>`}
        </div>
        <div class="review-box-produto" id="review-produto-box-${p.id}" style="display:none;">
          <div class="review-stars" id="review-produto-stars-${p.id}">
            ${[1,2,3,4,5].map(n => `<span onclick="selecionarNotaProduto('${p.id}', ${n})">☆</span>`).join('')}
          </div>
          <textarea id="review-produto-comentario-${p.id}" placeholder="Comentário (opcional)" class="review-input" rows="2"></textarea>
          <div class="review-actions">
            <button type="button" class="btn-auth" onclick="enviarAvaliacaoProduto('${p.id}')">Enviar</button>
            <span class="review-msg" id="review-produto-msg-${p.id}"></span>
          </div>
        </div>
        <div class="acoes-produto-coluna">
          ${p.disponivel_venda === false
            ? `<span style="display:inline-block; background:#eee; color:#666; font-size:0.75rem; font-weight:700; padding:5px 10px; border-radius:50px; margin-bottom:6px;">📷 Em exposição</span>`
            : `
              <button type="button" class="btn-comprar-externo" style="background:#0f766e; border:none; cursor:pointer; width:100%; margin-bottom:4px;" onclick="adicionarAoCarrinho('${p.id}')">🛒 Adicionar ao carrinho</button>
              ${p.link_externo ? `<button type="button" class="btn-comprar-externo" onclick="avisarSaidaLinkExterno('${escapeHtmlV(p.link_externo)}')">🔗 Comprar direto no site do vendedor</button>` : ''}
            `}
          ${p.profissionais && p.profissionais.whatsapp ? `<a class="btn-zap-mini" href="https://wa.me/55${(p.profissionais.whatsapp || '').replace(/\D/g,'')}?text=${encodeURIComponent('Olá! Vi o produto "' + p.nome + '" na Vitrine do GuiaZap e tenho interesse.')}" target="_blank">Chamar no WhatsApp</a>` : ''}
          <button type="button" class="link-compartilhar-produto" onclick="toggleMenuCompartilhar('${p.id}')">📤 Compartilhar</button>
          <button type="button" class="link-compartilhar-produto" style="background:#6b46c1;" onclick="compartilharProdutoNoChat('${p.id}', '${escapeHtmlV(p.nome).replace(/'/g, "\\'")}')">💬 Enviar no chat</button>
          <button type="button" class="link-compartilhar-produto" style="background:#e91e63;" onclick="colocarProdutoNoStory('${p.id}', '${p.profissional_id}')">📸 Colocar no Story</button>
        </div>
        <div class="menu-compartilhar" id="menu-compartilhar-${p.id}" style="display:none;"></div>
        ${!isDono ? `<button type="button" class="link-denunciar-produto" onclick="abrirDenunciaProduto('${p.id}')">Denunciar produto</button>
        <div class="denuncia-box" id="denuncia-produto-box-${p.id}" style="display:none;">
          <select id="denuncia-produto-motivo-${p.id}" class="review-input">
            <option value="">Selecione o motivo</option>
            <option value="Produto falso ou golpe">Produto falso ou golpe</option>
            <option value="Foto/descricao enganosa">Foto ou descrição enganosa</option>
            <option value="Preco incorreto">Preço incorreto</option>
            <option value="Conteudo ofensivo">Conteúdo ofensivo</option>
            <option value="Outro">Outro</option>
          </select>
          <textarea id="denuncia-produto-descricao-${p.id}" class="review-input" rows="2" placeholder="Descreva o problema (opcional)"></textarea>
          <div class="review-actions">
            <button type="button" class="btn-auth" onclick="enviarDenunciaProduto('${p.id}')">Enviar denúncia</button>
            <span class="review-msg" id="denuncia-produto-msg-${p.id}"></span>
          </div>
        </div>` : `<button type="button" class="link-ver-denuncias" onclick="toggleDenunciasProdutoRecebidas('${p.id}')">🚩 Ver denúncias recebidas</button>
        <div class="denuncias-recebidas-box" id="denuncias-produto-recebidas-${p.id}" style="display:none;"></div>`}
      </div>
    </div>
  `; }).join('');
}

function colocarProdutoNoStory(produtoId, profissionalId){
  // Sempre manda pra tela inicial "lembrando" desse produto — lá, a função
  // abrirStorySeVindoDoProduto() decide o que fazer: se não estiver logado,
  // mostra a área de login com a explicação; se for o dono, abre o formulário direto.
  localStorage.setItem('criarStoryProdutoId', produtoId);
  localStorage.setItem('criarStoryEmpresaId', profissionalId);
  window.location.href = 'index.html';
}

function compartilharProdutoNoChat(id, nome){
  const link = `${window.location.origin}/vitrine.html?produto=${id}`;
  const conteudo = { url: link, titulo: nome };
  window.location.href = `chat.html?compartilhar=${encodeURIComponent(JSON.stringify(conteudo))}`;
}

function toggleMenuCompartilhar(id){
  const p = produtos.find(x => x.id === id);
  if(!p) return;

  const menu = document.getElementById('menu-compartilhar-' + id);
  const jaAberto = menu.style.display === 'block';

  // Fecha qualquer outro menu de compartilhar que esteja aberto na tela
  document.querySelectorAll('.menu-compartilhar').forEach(m => { m.style.display = 'none'; });

  if(jaAberto) return;

  const link = `${window.location.origin}/vitrine.html?produto=${id}`;
  const texto = `Confira ${p.nome} na Vitrine GuiaZap!`;
  const linkCodificado = encodeURIComponent(link);
  const textoCodificado = encodeURIComponent(texto);

  menu.innerHTML = `
    <a href="https://wa.me/?text=${textoCodificado}%20${linkCodificado}" target="_blank" class="opcao-rede whatsapp">WhatsApp</a>
    <a href="https://www.facebook.com/sharer/sharer.php?u=${linkCodificado}" target="_blank" class="opcao-rede facebook">Facebook</a>
    <a href="https://twitter.com/intent/tweet?text=${textoCodificado}&url=${linkCodificado}" target="_blank" class="opcao-rede twitter">X (Twitter)</a>
    <a href="https://t.me/share/url?url=${linkCodificado}&text=${textoCodificado}" target="_blank" class="opcao-rede telegram">Telegram</a>
    <button type="button" class="opcao-rede copiar" onclick="copiarLinkProduto('${id}', event)">Copiar link</button>
  `;
  menu.style.display = 'block';
}

async function copiarLinkProduto(id, event){
  event.preventDefault();
  const link = `${window.location.origin}/vitrine.html?produto=${id}`;
  try{
    await navigator.clipboard.writeText(link);
    alert('Link copiado!');
  } catch(e){
    prompt('Copie o link abaixo:', link);
  }
  document.getElementById('menu-compartilhar-' + id).style.display = 'none';
}

let scannerAtivo = null;

function abrirScanner(){
  document.getElementById('scanner-area').style.display = 'block';
  document.getElementById('scanner-msg').textContent = 'Aponte a câmera para o código de barras, mantendo boa distância e luz';

  scannerAtivo = new Html5Qrcode('scanner-leitor', {
    formatsToSupport: [
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39
    ],
    verbose: false
  });

  scannerAtivo.start(
    { facingMode: 'environment' },
    {
      fps: 15,
      qrbox: { width: 280, height: 130 },
      aspectRatio: 1.6,
      videoConstraints: {
        facingMode: 'environment',
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        advanced: [{ focusMode: 'continuous' }]
      }
    },
    async (codigoLido) => {
      await fecharScanner();
      await buscarProdutoPorCodigoBarras(codigoLido);
    },
    () => {} // erro de leitura de cada frame, ignora silenciosamente
  ).then(() => {
    ativarBotaoLanterna();
  }).catch(err => {
    document.getElementById('scanner-msg').textContent = 'Não foi possível acessar a câmera: ' + err.message;
  });
}

function ativarBotaoLanterna(){
  const existente = document.getElementById('btn-lanterna');
  if(existente) existente.remove();

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'btn-lanterna';
  btn.className = 'btn-cancelar';
  btn.style.marginTop = '6px';
  btn.style.marginRight = '6px';
  btn.textContent = '🔦 Ligar lanterna';
  btn.onclick = toggleLanterna;

  const area = document.getElementById('scanner-area');
  area.insertBefore(btn, document.getElementById('scanner-leitor').nextSibling);
}

let lanternaLigada = false;
async function toggleLanterna(){
  if(!scannerAtivo) return;
  try{
    lanternaLigada = !lanternaLigada;
    await scannerAtivo.applyVideoConstraints({ advanced: [{ torch: lanternaLigada }] });
    document.getElementById('btn-lanterna').textContent = lanternaLigada ? '🔦 Desligar lanterna' : '🔦 Ligar lanterna';
  } catch(e){
    document.getElementById('scanner-msg').textContent = 'Este dispositivo não permite controlar a lanterna pelo navegador.';
  }
}

async function fecharScanner(){
  if(scannerAtivo){
    try{ await scannerAtivo.stop(); await scannerAtivo.clear(); } catch(e){}
    scannerAtivo = null;
  }
  const btnLanterna = document.getElementById('btn-lanterna');
  if(btnLanterna) btnLanterna.remove();
  lanternaLigada = false;
  document.getElementById('scanner-area').style.display = 'none';
}

function formatarValorProduto(event){
  const input = event.target;
  const valorAtual = input.value;

  // Se a pessoa digitou alguma letra (ex: "Sob consulta"), não mexe em nada, deixa livre
  if(/[a-zA-Z]/.test(valorAtual)) return;

  // Pega só os dígitos e formata como dinheiro (últimos 2 dígitos = centavos)
  const somenteDigitos = valorAtual.replace(/\D/g, '');
  if(!somenteDigitos){ input.value = ''; return; }

  const numero = (parseInt(somenteDigitos, 10) / 100).toFixed(2);
  input.value = numero.replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function onCodigoBarrasManualChange(){
  const valor = document.getElementById('p-codigo-barras-manual').value.trim();
  document.getElementById('p-codigo-barras').value = valor;
}

async function buscarInfoLinkExterno(){
  const url = document.getElementById('p-link-externo').value.trim();
  const msg = document.getElementById('p-link-externo-msg');
  if(!url){ msg.textContent = ''; return; }

  if(!/^https?:\/\//i.test(url)){
    msg.textContent = 'O link precisa começar com http:// ou https://';
    return;
  }

  msg.textContent = 'Tentando preencher automaticamente...';

  try{
    const resp = await fetch(`/.netlify/functions/buscar-info-link-externo?url=${encodeURIComponent(url)}`);
    const data = await resp.json();

    if(!data.encontrado){
      msg.textContent = 'Não conseguimos ler essa página automaticamente — preencha os campos manualmente.';
      return;
    }

    let preenchidos = [];

    if(data.nome && !document.getElementById('p-nome').value.trim()){
      document.getElementById('p-nome').value = data.nome;
      preenchidos.push('nome');
    }
    if(data.descricao && !document.getElementById('p-descricao').value.trim()){
      document.getElementById('p-descricao').value = data.descricao;
      preenchidos.push('descrição');
    }
    if(data.preco && !document.getElementById('p-preco').value.trim()){
      document.getElementById('p-preco').value = data.preco;
      preenchidos.push('preço');
    }
    if(data.foto && !document.getElementById('p-foto').value.trim()){
      document.getElementById('p-foto').value = data.foto;
      const preview = document.getElementById('p-foto-preview');
      preview.src = data.foto;
      preview.style.display = 'block';
      preenchidos.push('foto');
    }

    msg.textContent = preenchidos.length > 0
      ? `✓ Preenchemos automaticamente: ${preenchidos.join(', ')}. Confira se está certo!`
      : 'Achamos a página, mas os campos já estavam preenchidos — nada foi sobrescrito.';
  } catch(e){
    console.error(e);
    msg.textContent = 'Erro ao tentar ler essa página — preencha os campos manualmente.';
  }
}

async function buscarInfoCodigoManual(){
  const valor = document.getElementById('p-codigo-barras-manual').value.trim();
  if(!valor){ return; }
  await buscarProdutoPorCodigoBarras(valor);
}

async function buscarProdutoPorCodigoBarras(codigo){
  const msg = document.getElementById('scanner-msg');
  msg.textContent = `Código lido: ${codigo}. Buscando informações...`;
  document.getElementById('p-codigo-barras') && (document.getElementById('p-codigo-barras').value = codigo);

  // 1. Primeiro busca no NOSSO catálogo (cadastros anteriores de qualquer empresa do GuiaZap)
  try{
    const { data: doCatalogo } = await supabaseClientV
      .from('produtos_catalogo_barcode')
      .select('*')
      .eq('codigo_barras', codigo)
      .maybeSingle();

    if(doCatalogo){
      if(doCatalogo.nome) document.getElementById('p-nome').value = doCatalogo.nome;
      if(doCatalogo.marca) document.getElementById('p-marca').value = doCatalogo.marca;
      if(doCatalogo.foto){
        document.getElementById('p-foto').value = doCatalogo.foto;
        onFotoProdutoLinkChange();
      }
      if(doCatalogo.descricao) document.getElementById('p-descricao').value = doCatalogo.descricao;
      msg.textContent = 'Produto encontrado no catálogo do GuiaZap! Confira os dados antes de salvar.';
      return;
    }
  } catch(e){
    console.error('erro ao consultar catálogo do GuiaZap', e);
  }

  // 2. Se não achou no nosso catálogo, chama nossa função no servidor
  // (que tenta o Bluesoft Cosmos primeiro, e cai pro Open Food Facts se não achar)
  try{
    const resp = await fetch(`/.netlify/functions/buscar-codigo-barras?codigo=${codigo}`);
    const data = await resp.json();

    if(data.encontrado){
      if(data.nome) document.getElementById('p-nome').value = data.nome;
      if(data.marca) document.getElementById('p-marca').value = data.marca;
      if(data.foto){
        document.getElementById('p-foto').value = data.foto;
        onFotoProdutoLinkChange();
      }
      if(data.descricao){
        document.getElementById('p-descricao').value = data.descricao;
      }
      const nomeFonte = data.fonte === 'cosmos' ? 'base Bluesoft Cosmos' : 'base pública internacional';
      msg.textContent = `Produto encontrado (${nomeFonte}) e preenchido automaticamente! Confira os dados antes de salvar.`;
    } else {
      msg.textContent = 'Código lido, mas o produto não foi encontrado em nenhuma base. Preencha manualmente — seu cadastro vai ajudar quem escanear esse código depois.';
    }
  } catch(e){
    msg.textContent = 'Código lido, mas houve erro ao buscar informações. Preencha manualmente.';
  }
}

async function contribuirCatalogoBarcode(codigo, nome, marca, foto, descricao){
  if(!codigo) return;
  try{
    const payload = {
      codigo_barras: codigo,
      nome: nome || null,
      marca: marca || null,
      foto: foto || null,
      descricao: descricao || null,
      updated_at: new Date().toISOString()
    };

    // Evita usar .upsert() direto (já tivemos problema com isso hoje em outro lugar do site) —
    // checa se já existe, e decide entre inserir ou atualizar manualmente.
    const { data: existente } = await supabaseClientV
      .from('produtos_catalogo_barcode')
      .select('codigo_barras')
      .eq('codigo_barras', codigo)
      .maybeSingle();

    if(existente){
      const { error } = await supabaseClientV.from('produtos_catalogo_barcode').update(payload).eq('codigo_barras', codigo);
      if(error) console.error('erro ao atualizar catálogo colaborativo', error);
    } else {
      const { error } = await supabaseClientV.from('produtos_catalogo_barcode').insert(payload);
      if(error) console.error('erro ao inserir no catálogo colaborativo', error);
    }
  } catch(e){
    console.error('erro ao contribuir com o catálogo', e);
  }
}

function abrirDenunciaProduto(id){
  const box = document.getElementById('denuncia-produto-box-' + id);
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

async function enviarDenunciaProduto(id){
  const motivo = document.getElementById('denuncia-produto-motivo-' + id).value;
  const descricao = document.getElementById('denuncia-produto-descricao-' + id).value.trim();
  const msg = document.getElementById('denuncia-produto-msg-' + id);

  if(!motivo){ msg.textContent = 'Selecione um motivo.'; return; }

  msg.textContent = 'enviando...';
  const { error } = await supabaseClientV.from('denuncias_produtos').insert({
    produto_id: id,
    motivo,
    descricao: descricao || null,
    denunciante_email: currentUserV ? currentUserV.email : null
  });
  if(error){ console.error(error); msg.textContent = 'erro ao enviar denúncia'; return; }

  msg.textContent = 'denúncia enviada, obrigado por ajudar a manter o GuiaZap seguro.';
  setTimeout(() => { document.getElementById('denuncia-produto-box-' + id).style.display = 'none'; }, 2500);
}

async function toggleDenunciasProdutoRecebidas(produtoId){
  const box = document.getElementById('denuncias-produto-recebidas-' + produtoId);
  if(box.style.display === 'block'){
    box.style.display = 'none';
    return;
  }

  box.style.display = 'block';
  box.innerHTML = '<div class="denuncia-carregando">carregando...</div>';

  const { data, error } = await supabaseClientV
    .from('denuncias_produtos')
    .select('motivo, descricao, created_at')
    .eq('produto_id', produtoId)
    .order('created_at', { ascending: false });

  if(error){ box.innerHTML = '<div class="denuncia-carregando">erro ao carregar denúncias</div>'; return; }

  if(!data || data.length === 0){
    box.innerHTML = '<div class="denuncia-carregando">Nenhuma denúncia recebida. 🎉</div>';
    return;
  }

  box.innerHTML = data.map(d => `
    <div class="denuncia-item">
      <div class="denuncia-motivo">${escapeHtmlV(d.motivo)}</div>
      ${d.descricao ? `<div class="denuncia-descricao">${escapeHtmlV(d.descricao)}</div>` : ''}
      <div class="denuncia-data">${new Date(d.created_at).toLocaleDateString('pt-BR')}</div>
    </div>
  `).join('');
}

function abrirFormProduto(){
  document.getElementById('produto-form').classList.add('open');
  document.getElementById('p-msg').textContent = '';
}

function fecharFormProduto(){
  document.getElementById('produto-form').classList.remove('open');
  document.getElementById('p-id').value = '';
  document.getElementById('p-codigo-barras').value = '';
  document.getElementById('p-codigo-barras-manual').value = '';
  document.getElementById('p-nome').value = '';
  document.getElementById('p-marca').value = '';
  document.getElementById('p-categoria').value = '';
  document.getElementById('p-descricao').value = '';
  document.getElementById('p-unidade-medida').value = 'unidade';
  document.getElementById('p-quantidade').value = '1';
  document.getElementById('p-preco').value = '';
  document.getElementById('p-foto').value = '';
  document.getElementById('p-link-externo').value = '';
  document.getElementById('p-18mais').checked = false;
  document.getElementById('p-disponivel-venda').checked = true;
  document.getElementById('p-foto-preview').style.display = 'none';
  document.getElementById('p-foto-msg').textContent = '';
}

function editarProduto(id){
  const p = produtos.find(x => x.id === id);
  if(!p) return;
  abrirFormProduto();
  document.getElementById('p-id').value = p.id;
  document.getElementById('p-codigo-barras').value = p.codigo_barras || '';
  document.getElementById('p-codigo-barras-manual').value = p.codigo_barras || '';
  document.getElementById('p-profissional').value = p.profissional_id;
  document.getElementById('p-nome').value = p.nome;
  document.getElementById('p-marca').value = p.marca || '';
  document.getElementById('p-categoria').value = p.categoria || '';
  document.getElementById('p-descricao').value = p.descricao || '';
  document.getElementById('p-unidade-medida').value = p.unidade_medida || 'unidade';
  document.getElementById('p-quantidade').value = p.quantidade || 1;
  document.getElementById('p-preco').value = p.preco || '';
  document.getElementById('p-foto').value = p.foto || '';
  document.getElementById('p-link-externo').value = p.link_externo || '';
  document.getElementById('p-18mais').checked = !!p.produto_18_mais;
  document.getElementById('p-disponivel-venda').checked = p.disponivel_venda !== false;
  if(p.foto){
    const preview = document.getElementById('p-foto-preview');
    preview.src = p.foto;
    preview.style.display = 'block';
  }
}

async function excluirProduto(id){
  if(!confirm('Excluir este produto da Vitrine?')) return;
  const { error } = await supabaseClientV.from('produtos').delete().eq('id', id);
  if(error){ console.error(error); alert('Erro ao excluir.'); return; }
  await loadProdutos();
}

async function enviarFotoProduto(event){
  const file = event.target.files[0];
  const msg = document.getElementById('p-foto-msg');
  if(!file || !currentUserV) return;

  msg.textContent = 'enviando foto...';
  const nomeArquivo = `produtos/${currentUserV.id}/${Date.now()}.jpg`;

  const { error } = await supabaseClientV.storage.from('fotos').upload(nomeArquivo, file);
  if(error){
    console.error(error);
    msg.textContent = 'erro ao enviar foto: ' + error.message;
    return;
  }

  const { data } = supabaseClientV.storage.from('fotos').getPublicUrl(nomeArquivo);
  document.getElementById('p-foto').value = data.publicUrl;

  const preview = document.getElementById('p-foto-preview');
  preview.src = data.publicUrl;
  preview.style.display = 'block';
  msg.textContent = 'foto enviada!';
}

function onFotoProdutoLinkChange(){
  const url = document.getElementById('p-foto').value.trim();
  const preview = document.getElementById('p-foto-preview');
  if(url && !/^https?:\/\//i.test(url)){
    preview.style.display = 'none';
    return;
  }
  if(url){ preview.src = url; preview.style.display = 'block'; }
  else { preview.style.display = 'none'; }
}

async function salvarProduto(e){
  e.preventDefault();
  const msg = document.getElementById('p-msg');
  const id = document.getElementById('p-id').value;

  const payload = {
    profissional_id: document.getElementById('p-profissional').value,
    nome: document.getElementById('p-nome').value.trim(),
    marca: document.getElementById('p-marca').value.trim() || null,
    descricao: document.getElementById('p-descricao').value.trim() || null,
    categoria: document.getElementById('p-categoria').value.trim() || null,
    unidade_medida: document.getElementById('p-unidade-medida').value,
    quantidade: parseFloat(document.getElementById('p-quantidade').value) || 1,
    preco: document.getElementById('p-preco').value.trim() || null,
    foto: document.getElementById('p-foto').value.trim() || null,
    codigo_barras: document.getElementById('p-codigo-barras').value.trim() || null,
    link_externo: document.getElementById('p-link-externo').value.trim() || null,
    disponivel_venda: document.getElementById('p-disponivel-venda').checked,
    produto_18_mais: document.getElementById('p-18mais').checked
  };

  if(!payload.nome || !payload.profissional_id){ msg.textContent = 'Preencha o nome do produto.'; return false; }
  if(payload.foto && !/^https?:\/\//i.test(payload.foto)){ msg.textContent = 'O link da foto precisa começar com http:// ou https://'; return false; }
  if(payload.link_externo && !/^https?:\/\//i.test(payload.link_externo)){ msg.textContent = 'O link externo de compra precisa começar com http:// ou https://'; return false; }
  if(payload.link_externo && payload.link_externo.includes('@')){ msg.textContent = 'Link inválido — não pode conter "@" (isso é usado em golpes de phishing pra esconder o destino real do link).'; return false; }

  msg.textContent = 'salvando...';
  let error;
  if(id){
    ({ error } = await supabaseClientV.from('produtos').update(payload).eq('id', id));
  } else {
    ({ error } = await supabaseClientV.from('produtos').insert(payload));
  }
  if(error){ console.error(error); msg.textContent = 'erro ao salvar produto'; return false; }

  // Contribui com o catálogo colaborativo de código de barras, pra ajudar outras empresas depois
  if(payload.codigo_barras){
    await contribuirCatalogoBarcode(payload.codigo_barras, payload.nome, payload.marca, payload.foto, payload.descricao);
  }

  msg.textContent = id ? 'produto atualizado!' : 'produto anunciado!';
  await loadProdutos();
  setTimeout(fecharFormProduto, 1200);

  // Se for produto NOVO (não edição) numa empresa Premium, avisa quem segue por e-mail e push
  if(!id){
    fetch('/.netlify/functions/notificar-seguidores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profissionalId: payload.profissional_id,
        tipo: 'produto',
        titulo: payload.nome,
        foto: payload.foto
      })
    }).catch(e => console.error('erro ao notificar seguidores', e));

    fetch('/.netlify/functions/enviar-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titulo: '🛍️ Novidade de quem você segue!',
        mensagem: payload.nome,
        url: '/vitrine.html',
        profissionalId: payload.profissional_id
      })
    }).catch(e => console.error('erro ao enviar push', e));
  }

  return false;
}

function normalizarTextoV(str){
  return (str || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function escapeHtmlV(str){
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ---------- CARRINHO DE COMPRAS ----------

let carrinhoV = [];

// Cada conta (ou visitante sem login) tem seu próprio carrinho — sem isso,
// trocar de conta no mesmo navegador mostrava o carrinho de outra pessoa
function chaveCarrinhoV(){
  return 'carrinho_vitrine_' + (currentUserV ? currentUserV.id : 'visitante');
}

function carregarCarrinhoDoUsuarioAtual(){
  carrinhoV = JSON.parse(localStorage.getItem(chaveCarrinhoV()) || '[]');
  atualizarBadgeCarrinho();
}

function salvarCarrinhoV(){
  localStorage.setItem(chaveCarrinhoV(), JSON.stringify(carrinhoV));
  atualizarBadgeCarrinho();
}

function precoTextoParaNumeroV(precoTexto){
  if(!precoTexto) return 0;
  let limpo = String(precoTexto).replace(/[^0-9,.]/g, '');
  if(limpo.includes(',')) limpo = limpo.replace(/\./g, '').replace(',', '.');
  return parseFloat(limpo) || 0;
}

function adicionarAoCarrinho(produtoId){
  const p = produtos.find(x => x.id === produtoId);
  if(!p) return;

  const itemExistente = carrinhoV.find(i => i.produtoId === produtoId);
  if(itemExistente){
    itemExistente.quantidade++;
  } else {
    carrinhoV.push({
      produtoId: p.id,
      nome: p.nome,
      preco: p.preco,
      foto: p.foto || '',
      profissionalId: p.profissional_id,
      empresaNome: p.profissionais ? p.profissionais.name : 'Empresa',
      quantidade: 1
    });
  }
  salvarCarrinhoV();

  // Pequeno feedback visual de confirmação
  const badge = document.getElementById('badge-carrinho');
  if(badge){
    badge.style.transform = 'scale(1.4)';
    setTimeout(() => { badge.style.transform = 'scale(1)'; }, 200);
  }
}

function removerDoCarrinho(produtoId){
  carrinhoV = carrinhoV.filter(i => i.produtoId !== produtoId);
  salvarCarrinhoV();
  renderCarrinho();
}

function alterarQuantidadeCarrinho(produtoId, delta){
  const item = carrinhoV.find(i => i.produtoId === produtoId);
  if(!item) return;
  item.quantidade += delta;
  if(item.quantidade <= 0){
    removerDoCarrinho(produtoId);
    return;
  }
  salvarCarrinhoV();
  renderCarrinho();
}

function atualizarBadgeCarrinho(){
  const btn = document.getElementById('btn-carrinho-flutuante');
  const badge = document.getElementById('badge-carrinho');
  if(!btn || !badge) return;
  const total = carrinhoV.reduce((soma, i) => soma + i.quantidade, 0);
  badge.textContent = total > 99 ? '99+' : total;
  btn.style.display = total > 0 ? 'block' : 'none';
}

function abrirCarrinho(){
  renderCarrinho();
  document.getElementById('overlay-carrinho').style.display = 'flex';
  const btnPapo = document.querySelector('.btn-chat-flutuante');
  if(btnPapo) btnPapo.style.setProperty('display', 'none', 'important');
}

function fecharCarrinho(){
  document.getElementById('overlay-carrinho').style.display = 'none';
  const btnPapo = document.querySelector('.btn-chat-flutuante');
  if(btnPapo) btnPapo.style.removeProperty('display');
}

function renderCarrinho(){
  const container = document.getElementById('carrinho-conteudo');
  if(carrinhoV.length === 0){
    container.innerHTML = '<p style="text-align:center; color:#999; padding:30px 0;">Seu carrinho está vazio.</p>';
    return;
  }

  // Agrupa por empresa, já que cada pedido é fechado com um vendedor por vez
  const porEmpresa = {};
  carrinhoV.forEach(item => {
    if(!porEmpresa[item.profissionalId]) porEmpresa[item.profissionalId] = { empresaNome: item.empresaNome, itens: [] };
    porEmpresa[item.profissionalId].itens.push(item);
  });

  container.innerHTML = Object.entries(porEmpresa).map(([profissionalId, grupo]) => {
    const totalGrupo = grupo.itens.reduce((soma, i) => soma + precoTextoParaNumeroV(i.preco) * i.quantidade, 0);
    const linhasItens = grupo.itens.map(item => `
      <div style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid #f2f2f2;">
        <img src="${escapeHtmlV(item.foto || 'https://via.placeholder.com/50')}" style="width:46px; height:46px; border-radius:8px; object-fit:cover; flex-shrink:0;">
        <div style="flex:1; min-width:0;">
          <div style="font-size:0.85rem; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtmlV(item.nome)}</div>
          <div style="font-size:0.78rem; color:#888;">R$ ${escapeHtmlV(item.preco)} cada</div>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <button type="button" onclick="alterarQuantidadeCarrinho('${item.produtoId}', -1)" style="width:26px; height:26px; border-radius:50%; border:1px solid #ddd; background:white; cursor:pointer;">−</button>
          <span style="min-width:18px; text-align:center; font-weight:700; font-size:0.85rem;">${item.quantidade}</span>
          <button type="button" onclick="alterarQuantidadeCarrinho('${item.produtoId}', 1)" style="width:26px; height:26px; border-radius:50%; border:1px solid #ddd; background:white; cursor:pointer;">+</button>
        </div>
      </div>
    `).join('');

    return `
      <div style="margin-bottom:18px;">
        <div style="font-weight:800; font-size:0.9rem; color:var(--verde-escuro); margin-bottom:4px;">🏪 ${escapeHtmlV(grupo.empresaNome)}</div>
        ${linhasItens}
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px;">
          <span style="font-weight:700; font-size:0.9rem;">Subtotal: R$ ${totalGrupo.toFixed(2).replace('.', ',')}</span>
          <button type="button" onclick="finalizarPedidoCarrinho('${profissionalId}')" style="background:var(--verde-whats); color:white; border:none; padding:9px 16px; border-radius:8px; font-weight:700; font-size:0.82rem; cursor:pointer;">Finalizar pedido</button>
        </div>
      </div>
    `;
  }).join('');
}

async function finalizarPedidoCarrinho(profissionalId){
  if(!currentUserV){
    alert('Você precisa estar logado pra finalizar um pedido. Faça login no GuiaZap primeiro.');
    return;
  }

  const itensDaEmpresa = carrinhoV.filter(i => i.profissionalId === profissionalId);
  if(itensDaEmpresa.length === 0) return;

  const formaPagamento = prompt('Como você vai pagar? (Ex: Pix, Dinheiro, Cartão)');
  if(!formaPagamento || !formaPagamento.trim()) return;

  const itensPayload = itensDaEmpresa.map(i => ({ id: i.produtoId, nome: i.nome, preco: i.preco }));
  const subtotal = itensDaEmpresa.reduce((soma, i) => soma + precoTextoParaNumeroV(i.preco) * i.quantidade, 0);
  const codigoConfirmacao = String(Math.floor(1000 + Math.random() * 9000));

  // Acha ou cria a conversa com essa empresa
  const { data: existente } = await supabaseClientV.from('conversas').select('id').eq('profissional_id', profissionalId).eq('visitante_user_id', currentUserV.id).maybeSingle();
  let conversaId = existente ? existente.id : null;
  if(!conversaId){
    const { data: nova, error } = await supabaseClientV.from('conversas').insert({ profissional_id: profissionalId, visitante_user_id: currentUserV.id }).select('id').single();
    if(error){ alert('Erro ao criar a conversa. Tente de novo.'); return; }
    conversaId = nova.id;
  }

  // Cria o pedido (retirada — combine a entrega direto com o vendedor pelo Papo)
  const { error: erroPedido } = await supabaseClientV.from('pedidos').insert({
    conversa_id: conversaId,
    profissional_id: profissionalId,
    cliente_user_id: currentUserV.id,
    itens: itensPayload,
    subtotal,
    taxa_entrega: 0,
    total: subtotal,
    status: 'aguardando_confirmacao',
    forma_pagamento: formaPagamento.trim(),
    codigo_confirmacao: codigoConfirmacao
  });
  if(erroPedido){ console.error(erroPedido); alert('Erro ao enviar o pedido: ' + (erroPedido.message || JSON.stringify(erroPedido))); return; }

  // Manda um resumo bonito pro vendedor ver na conversa
  const resumo = itensDaEmpresa.map(i => `${i.quantidade}x ${i.nome} — R$ ${i.preco}`).join('\n');
  await supabaseClientV.from('mensagens_chat').insert({
    conversa_id: conversaId,
    remetente_user_id: currentUserV.id,
    tipo: 'texto',
    texto: `🛒 Novo pedido pela Vitrine:\n${resumo}\n\nTotal: R$ ${subtotal.toFixed(2).replace('.', ',')}\n💳 Pagamento: ${formaPagamento.trim()}\n🔑 Código de confirmação: ${codigoConfirmacao}\n\n(Combine a entrega ou retirada direto por aqui)`,
    lida: false
  });
  await supabaseClientV.from('conversas').update({ ultima_mensagem_em: new Date().toISOString() }).eq('id', conversaId);

  // Limpa esses itens do carrinho e avisa a pessoa
  carrinhoV = carrinhoV.filter(i => i.profissionalId !== profissionalId);
  salvarCarrinhoV();
  fecharCarrinho();
  alert(`🎉 Pedido enviado!\n\n🔑 Seu código de confirmação: ${codigoConfirmacao}\nGuarde esse código — você vai precisar informar ele na hora de receber o pedido.\n\nVocê já pode combinar os detalhes com o vendedor pelo Papo.`);
  window.location.href = `chat.html?empresa=${profissionalId}`;
}

// Mostra uma tela de aviso antes de abrir um link externo cadastrado pelo
// vendedor — o GuiaZap não verifica esses links, então é importante a pessoa
// ver claramente pra onde vai antes de clicar de verdade, como proteção
// contra links maliciosos/phishing.
function avisarSaidaLinkExterno(url){
  let dominio = url;
  try{ dominio = new URL(url).hostname; } catch(e){ /* usa a url inteira se não conseguir extrair */ }

  if(document.getElementById('overlay-saida-link')) document.getElementById('overlay-saida-link').remove();

  const overlay = document.createElement('div');
  overlay.id = 'overlay-saida-link';
  overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.75); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px;';
  overlay.innerHTML = `
    <div style="background:white; border-radius:14px; padding:24px 20px; max-width:340px; text-align:center; box-shadow:0 10px 40px rgba(0,0,0,0.3);">
      <div style="font-size:2.2rem; margin-bottom:10px;">⚠️</div>
      <div style="font-weight:800; font-size:1rem; margin-bottom:8px;">Você está saindo do GuiaZap</div>
      <div style="font-size:0.82rem; color:#666; margin-bottom:6px;">Esse link foi cadastrado pelo vendedor e não é verificado pelo GuiaZap:</div>
      <div style="font-size:0.85rem; font-weight:700; color:#0a4a3a; word-break:break-all; background:#f2f2f2; padding:8px; border-radius:8px; margin-bottom:16px;">${escapeHtmlV(dominio)}</div>
      <div style="display:flex; gap:8px;">
        <button type="button" onclick="document.getElementById('overlay-saida-link').remove()" style="flex:1; padding:10px; border-radius:8px; border:1px solid #ddd; background:white; font-weight:700; cursor:pointer;">Cancelar</button>
        <button type="button" onclick="window.open('${escapeHtmlV(url)}', '_blank', 'noopener,noreferrer'); document.getElementById('overlay-saida-link').remove();" style="flex:1; padding:10px; border-radius:8px; border:none; background:var(--verde-whats); color:white; font-weight:700; cursor:pointer;">Continuar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

atualizarBadgeCarrinho();

if(initSupabaseV()){
  initAuthV().then(loadProdutos);
}