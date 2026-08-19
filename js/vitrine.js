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

function initSupabaseV(){
  if(!SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
  supabaseClientV = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return true;
}

async function initAuthV(){
  const { data: { session } } = await supabaseClientV.auth.getSession();
  currentUserV = session ? session.user : null;
  document.getElementById('v-add-btn').style.display = currentUserV ? 'inline-block' : 'none';

  if(currentUserV){
    const { data } = await supabaseClientV
      .from('profissionais')
      .select('id, name')
      .eq('user_id', currentUserV.id)
      .eq('status_pagamento', 'ativo')
      .eq('plano', 'completo');
    meusCadastros = data || [];

    const sel = document.getElementById('p-profissional');
    sel.innerHTML = meusCadastros.map(c => `<option value="${c.id}">${escapeHtmlV(c.name)}</option>`).join('');

    if(meusCadastros.length === 0){
      document.getElementById('v-add-btn').style.display = 'none';
    }
  }
}

let empresaFiltroId = null;
let produtoFiltroId = null;

async function loadProdutos(){
  const { data, error } = await supabaseClientV
    .from('produtos')
    .select('*, profissionais(id, name, whatsapp, status_pagamento, user_id)')
    .order('created_at', { ascending: false });

  if(error){ console.error(error); return; }

  produtos = (data || []).filter(p => p.profissionais && p.profissionais.status_pagamento === 'ativo');
  await loadAvaliacoesProdutos();
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

function renderProdutos(){
  const query = normalizarTextoV(document.getElementById('v-search').value);
  const categoriaFiltro = document.getElementById('v-filter-categoria').value;
  const precoFiltro = document.getElementById('v-filter-preco').value;
  const linkDireto = produtoFiltroId || empresaFiltroId;
  const filtrados = produtos
    .filter(p => !empresaFiltroId || (p.profissionais && p.profissionais.id === empresaFiltroId))
    .filter(p => linkDireto || !currentUserV || (p.profissionais && p.profissionais.user_id === currentUserV.id))
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
    )
    .sort((a, b) => {
      // Coloca o produto compartilhado sempre primeiro
      if(produtoFiltroId){
        if(a.id === produtoFiltroId) return -1;
        if(b.id === produtoFiltroId) return 1;
      }
      return 0;
    });

  document.getElementById('v-count').textContent = `${filtrados.length} produto${filtrados.length !== 1 ? 's' : ''}`;

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
    return `
    <div class="card-produto${isCompartilhado ? ' card-produto-destaque' : ''}">
      ${isCompartilhado ? '<div class="selo-compartilhado">⭐ Produto compartilhado</div>' : ''}
      <img src="${p.foto ? escapeHtmlV(p.foto) : 'https://api.dicebear.com/7.x/shapes/svg?seed=' + encodeURIComponent(p.nome)}" alt="${escapeHtmlV(p.nome)}">
      <div class="info">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div class="nome">${escapeHtmlV(p.nome)}</div>
          <button class="icon-btn-favorito" title="Favoritar" onclick="toggleFavoritoProduto('${p.id}', event)">${favoritosProdutos.has(p.id) ? '❤️' : '🤍'}</button>
          ${isDono ? `<span class="owner-actions">
            <button class="icon-btn" title="Editar" onclick="editarProduto('${p.id}')">✎</button>
            <button class="icon-btn" title="Excluir" onclick="excluirProduto('${p.id}')">✕</button>
          </span>` : ''}
        </div>
        ${p.marca ? `<div class="marca-produto">${escapeHtmlV(p.marca)}</div>` : ''}
        ${p.categoria ? `<div class="categoria-produto">${escapeHtmlV(p.categoria)}</div>` : ''}
        ${isDono ? `<div class="stat-visualizacoes">👁️ ${p.visualizacoes || 0} visualizaç${(p.visualizacoes || 0) === 1 ? 'ão' : 'ões'}</div>` : ''}
        <div class="medida-produto">${textoMedida(p)}</div>
        ${p.preco ? `<div class="preco">R$ ${escapeHtmlV(p.preco)}</div>` : ''}
        <div class="empresa">${p.profissionais ? escapeHtmlV(p.profissionais.name) : ''}</div>
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
        ${p.profissionais && p.profissionais.whatsapp ? `<a class="btn-zap-mini" href="https://wa.me/55${(p.profissionais.whatsapp || '').replace(/\D/g,'')}" target="_blank">Chamar no WhatsApp</a>` : ''}
        <button type="button" class="link-compartilhar-produto" onclick="toggleMenuCompartilhar('${p.id}')">📤 Compartilhar</button>
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

function toggleMenuCompartilhar(id){
  const p = produtos.find(x => x.id === id);
  if(!p) return;

  const menu = document.getElementById('menu-compartilhar-' + id);
  if(menu.style.display === 'block'){
    menu.style.display = 'none';
    return;
  }

  const link = `${window.location.origin}${window.location.pathname}?produto=${id}`;
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
  const link = `${window.location.origin}${window.location.pathname}?produto=${id}`;
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
    await supabaseClientV.from('produtos_catalogo_barcode').upsert({
      codigo_barras: codigo,
      nome: nome || null,
      marca: marca || null,
      foto: foto || null,
      descricao: descricao || null,
      updated_at: new Date().toISOString()
    });
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

  const { error } = await supabaseClientV.storage.from('fotos').upload(nomeArquivo, file, { upsert: true });
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
    codigo_barras: document.getElementById('p-codigo-barras').value.trim() || null
  };

  if(!payload.nome || !payload.profissional_id){ msg.textContent = 'Preencha o nome do produto.'; return false; }
  if(payload.foto && !/^https?:\/\//i.test(payload.foto)){ msg.textContent = 'O link da foto precisa começar com http:// ou https://'; return false; }

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

if(initSupabaseV()){
  initAuthV().then(loadProdutos);
}