let supabaseClientV;
let produtos = [];
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

  const params = new URLSearchParams(window.location.search);
  empresaFiltroId = params.get('empresa');
  produtoFiltroId = params.get('produto');

  if(produtoFiltroId){
    document.querySelector('.vitrine-header h1').textContent = 'Produto compartilhado';
    document.querySelector('.vitrine-header p').innerHTML = `<a href="vitrine.html" style="color:white; text-decoration:underline;">← Ver vitrine completa</a>`;
  } else if(empresaFiltroId){
    const empresa = produtos.find(p => p.profissionais && p.profissionais.id === empresaFiltroId);
    const nomeEmpresa = empresa ? empresa.profissionais.name : '';
    document.querySelector('.vitrine-header h1').textContent = nomeEmpresa ? `Produtos de ${nomeEmpresa}` : 'GuiaZap Vitrine';
    document.querySelector('.vitrine-header p').innerHTML = `<a href="vitrine.html" style="color:white; text-decoration:underline;">← Ver vitrine completa</a>`;
  }

  renderProdutos();
}

function textoMedida(p){
  const qtd = p.quantidade || 1;
  if(p.unidade_medida === 'peso') return `${qtd} kg`;
  if(p.unidade_medida === 'litro') return `${qtd} L`;
  return qtd == 1 ? '1 unidade' : `${qtd} unidades`;
}

function renderProdutos(){
  const query = normalizarTextoV(document.getElementById('v-search').value);
  const linkDireto = produtoFiltroId || empresaFiltroId;
  const filtrados = produtos
    .filter(p => !produtoFiltroId || p.id === produtoFiltroId)
    .filter(p => produtoFiltroId || !empresaFiltroId || (p.profissionais && p.profissionais.id === empresaFiltroId))
    .filter(p => linkDireto || !currentUserV || (p.profissionais && p.profissionais.user_id === currentUserV.id))
    .filter(p =>
      normalizarTextoV(p.nome).includes(query) ||
      normalizarTextoV(p.marca).includes(query) ||
      normalizarTextoV(p.descricao).includes(query) ||
      normalizarTextoV(p.codigo_barras).includes(query) ||
      (p.profissionais && normalizarTextoV(p.profissionais.name).includes(query))
    );

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
    return `
    <div class="card-produto">
      <img src="${p.foto ? escapeHtmlV(p.foto) : 'https://api.dicebear.com/7.x/shapes/svg?seed=' + encodeURIComponent(p.nome)}" alt="${escapeHtmlV(p.nome)}">
      <div class="info">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div class="nome">${escapeHtmlV(p.nome)}</div>
          ${isDono ? `<span class="owner-actions">
            <button class="icon-btn" title="Editar" onclick="editarProduto('${p.id}')">✎</button>
            <button class="icon-btn" title="Excluir" onclick="excluirProduto('${p.id}')">✕</button>
          </span>` : ''}
        </div>
        ${p.marca ? `<div class="marca-produto">${escapeHtmlV(p.marca)}</div>` : ''}
        <div class="medida-produto">${textoMedida(p)}</div>
        ${p.preco ? `<div class="preco">R$ ${escapeHtmlV(p.preco)}</div>` : ''}
        <div class="empresa">${p.profissionais ? escapeHtmlV(p.profissionais.name) : ''}</div>
        ${p.profissionais && p.profissionais.whatsapp ? `<a class="btn-zap-mini" href="https://wa.me/55${p.profissionais.whatsapp}" target="_blank">Chamar no WhatsApp</a>` : ''}
        <button type="button" class="link-compartilhar-produto" onclick="toggleMenuCompartilhar('${p.id}')">📤 Compartilhar</button>
        <div class="menu-compartilhar" id="menu-compartilhar-${p.id}" style="display:none;"></div>
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

  try{
    const resp = await fetch(`https://world.openfoodfacts.org/api/v0/product/${codigo}.json`);
    const data = await resp.json();

    if(data.status === 1 && data.product){
      const prod = data.product;
      if(prod.product_name) document.getElementById('p-nome').value = prod.product_name;
      if(prod.brands) document.getElementById('p-marca').value = prod.brands;
      if(prod.image_url){
        document.getElementById('p-foto').value = prod.image_url;
        onFotoProdutoLinkChange();
      }
      if(prod.quantity){
        document.getElementById('p-descricao').value = 'Quantidade da embalagem: ' + prod.quantity;
      }
      msg.textContent = 'Produto encontrado e preenchido automaticamente! Confira os dados antes de salvar.';
    } else {
      msg.textContent = 'Código lido, mas o produto não foi encontrado na base pública. Preencha manualmente.';
    }
  } catch(e){
    msg.textContent = 'Código lido, mas houve erro ao buscar informações. Preencha manualmente.';
  }
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
    unidade_medida: document.getElementById('p-unidade-medida').value,
    quantidade: parseFloat(document.getElementById('p-quantidade').value) || 1,
    preco: document.getElementById('p-preco').value.trim() || null,
    foto: document.getElementById('p-foto').value.trim() || null,
    codigo_barras: document.getElementById('p-codigo-barras').value.trim() || null
  };

  if(!payload.nome || !payload.profissional_id){ msg.textContent = 'Preencha o nome do produto.'; return false; }

  msg.textContent = 'salvando...';
  let error;
  if(id){
    ({ error } = await supabaseClientV.from('produtos').update(payload).eq('id', id));
  } else {
    ({ error } = await supabaseClientV.from('produtos').insert(payload));
  }
  if(error){ console.error(error); msg.textContent = 'erro ao salvar produto'; return false; }

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