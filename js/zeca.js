// Lógica do widget de chat do Zeca (botão flutuante + painel).
//
// Suporta: busca de empresa, geração de imagem/áudio/vídeo, edição de
// foto/áudio/vídeo que a pessoa manda anexado, execução de código, análise
// de .zip de projeto e de vídeo (assistir), memória opt-in com conversas
// salvas, voz (falar com o Zeca e ouvir a resposta), colar imagem com
// Ctrl+V, arrastar arquivo pro painel, e anexar imagem/vídeo/áudio/.zip
// pelo clipe.

let _zecaHistorico = [];
let _zecaAberto = false;
let _zecaReconhecimento = null;
let _zecaOuvindo = false;
let _zecaUltimaPerguntaFoiPorVoz = false;
let _zecaConversaAtual = null; // id da conversa salva no banco (null = ainda não salva / memória desativada)
// Guarda o último texto que a pessoa digitou (ex: "tira o fundo dessa
// imagem"), pra reaproveitar se ela anexar a imagem DEPOIS numa mensagem
// separada sem repetir o pedido — senão o Zeca perde a instrução e cai no
// modo "só descrever" a foto em vez de editar.
let _zecaUltimaInstrucaoTexto = null;
const _zecaSynth = window.speechSynthesis;

// --- Continuidade da conversa entre páginas (mesma aba/sessão) ---
// Sem isso, cada página carregada começa o Zeca do zero, mesmo se a
// pessoa tiver memória ativada — ela precisaria abrir o ☰ e escolher a
// mesma conversa de novo toda vez que muda de página. Guarda só o ID da
// conversa atual (não o conteúdo) no sessionStorage — dura só essa aba,
// some ao fechar o navegador — e, ao abrir o painel numa página nova,
// recarrega essa mesma conversa em vez de começar do zero.
const _CHAVE_CONVERSA_SESSAO_ZECA = 'zeca_conversa_sessao';

// Pagamento único de R$7 no Mercado Pago = 5 créditos extras do Zeca (ver
// mp-webhook.js: VALOR_CREDITOS_ZECA / QUANTIDADE_CREDITOS_ZECA — se mudar
// o preço lá, atualiza o texto do botão abaixo também).
const LINK_CREDITOS_ZECA = 'https://mpago.la/2yREdfg';

function _zecaSalvarConversaNaSessao(conversaId){
  try{
    if(conversaId) sessionStorage.setItem(_CHAVE_CONVERSA_SESSAO_ZECA, conversaId);
    else sessionStorage.removeItem(_CHAVE_CONVERSA_SESSAO_ZECA);
  } catch(e){}
}
function _zecaLerConversaDaSessao(){
  try{ return sessionStorage.getItem(_CHAVE_CONVERSA_SESSAO_ZECA); } catch(e){ return null; }
}

function _zecaMensagemBoasVindas(){
  _adicionarMensagemZeca('zeca', 'Oi! Eu sou o Zeca 👋 Posso te ajudar a achar um profissional ou empresa aqui perto, gerar ou editar foto/áudio/vídeo, ou tirar dúvida sobre como o GuiaZap funciona. Manda a pergunta (ou arrasta um arquivo aqui pro painel)!');
}

function toggleZeca(){
  _zecaAberto = !_zecaAberto;
  const painel = document.getElementById('painel-zeca');
  painel.style.display = _zecaAberto ? 'flex' : 'none';

  if(_zecaAberto) _zecaInicializarDragDrop();

  if(_zecaAberto && _zecaHistorico.length === 0){
    const conversaSalvaNaSessao = _zecaLerConversaDaSessao();
    if(conversaSalvaNaSessao){
      // Continuando de outra página — carrega em silêncio (sem alertar
      // se der errado, ex: conversa apagada ou memória desativada nesse
      // meio tempo); nesse caso cai na saudação normal.
      carregarConversaZeca(conversaSalvaNaSessao, true);
    } else {
      _zecaMensagemBoasVindas();
    }
  }
}

function _adicionarMensagemZeca(de, texto){
  _zecaHistorico.push({ de, texto });
  const container = document.getElementById('zeca-mensagens');
  const bolha = document.createElement('div');
  bolha.className = 'zeca-msg ' + (de === 'zeca' ? 'zeca-msg-zeca' : 'zeca-msg-pessoa');
  bolha.textContent = texto;
  container.appendChild(bolha);

  // Resposta do Zeca com algum tamanho ganha botão de copiar — não faz
  // sentido pra mensagem curta tipo "Bora, gerando..." ou erro.
  if(de === 'zeca' && texto && texto.length > 20){
    const linkCopiar = document.createElement('button');
    linkCopiar.type = 'button';
    linkCopiar.className = 'zeca-link-pdf';
    linkCopiar.textContent = '📋 copiar';
    linkCopiar.onclick = () => _copiarRespostaZeca(texto, linkCopiar);
    container.appendChild(linkCopiar);
  }

  // Resposta substancial do Zeca ganha também um botão de baixar em PDF
  if(de === 'zeca' && texto && texto.length > 80){
    const linkPdf = document.createElement('button');
    linkPdf.type = 'button';
    linkPdf.className = 'zeca-link-pdf';
    linkPdf.textContent = '📄 baixar em PDF';
    linkPdf.onclick = () => _baixarPdfZeca(texto);
    container.appendChild(linkPdf);
  }

  container.scrollTop = container.scrollHeight;
}

// Vídeo com avatar gerado pela HeyGen — vem como URL direta (não base64,
// diferente do áudio), então o player só aponta pra ela.
function _renderizarVideoGeradoZeca(url, roteiro){
  const container = document.getElementById('zeca-mensagens');
  const bolha = document.createElement('div');
  bolha.className = 'zeca-msg zeca-msg-zeca';
  bolha.style.padding = '10px';

  const player = document.createElement('video');
  player.controls = true;
  player.src = url;
  player.style.cssText = 'display:block; width:100%; max-width:280px; border-radius:8px; margin-bottom:8px;';
  bolha.appendChild(player);

  if(roteiro){
    const textoRoteiro = document.createElement('div');
    textoRoteiro.style.cssText = 'font-size:0.82rem; color:#555; white-space:pre-wrap; margin-bottom:8px;';
    textoRoteiro.textContent = roteiro;
    bolha.appendChild(textoRoteiro);
  }

  const baixar = document.createElement('a');
  baixar.href = url;
  baixar.download = 'video-zeca.mp4';
  baixar.target = '_blank';
  baixar.rel = 'noopener';
  baixar.textContent = '⬇️ baixar vídeo (mp4)';
  baixar.className = 'zeca-link-pdf';
  baixar.style.cssText = 'display:inline-block; text-decoration:none;';
  bolha.appendChild(baixar);

  container.appendChild(bolha);
  container.scrollTop = container.scrollHeight;
}

// Botão "comprar créditos" — aparece na conversa quando o limite diário
// do plano estourou e a pessoa (logada) não tem crédito extra sobrando.
function _mostrarBotaoComprarCreditosZeca(){
  const container = document.getElementById('zeca-mensagens');
  const link = document.createElement('a');
  link.href = LINK_CREDITOS_ZECA;
  link.target = '_blank';
  link.rel = 'noopener';
  link.className = 'zeca-link-pdf';
  link.textContent = '💳 comprar mais créditos (R$7 = 5 usos extras)';
  container.appendChild(link);
  container.scrollTop = container.scrollHeight;
}

// Copia o texto da resposta do Zeca pra área de transferência. Usa a
// Clipboard API moderna (precisa de HTTPS, que é o caso do site) com um
// fallback via textarea+execCommand pra navegador mais velho/sem suporte.
async function _copiarRespostaZeca(texto, botao){
  const textoOriginal = botao.textContent;
  try{
    if(navigator.clipboard && navigator.clipboard.writeText){
      await navigator.clipboard.writeText(texto);
    } else {
      const area = document.createElement('textarea');
      area.value = texto;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    botao.textContent = '✅ copiado!';
  } catch(e){
    console.error('erro ao copiar', e);
    botao.textContent = '⚠️ não deu pra copiar';
  }
  setTimeout(() => { botao.textContent = textoOriginal; }, 1800);
}

async function _baixarPdfZeca(texto){
  try{
    const resp = await fetch('/.netlify/functions/gerar-pdf-zeca', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto, titulo: 'Resposta do Zeca' })
    });
    if(!resp.ok){ alert('Não consegui gerar o PDF agora. Tenta de novo?'); return; }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zeca.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch(e){
    console.error(e);
    alert('Deu erro baixando o PDF. Tenta de novo?');
  }
}

function _renderizarResultadosZeca(resultados){
  const container = document.getElementById('zeca-mensagens');
  const lista = document.createElement('div');
  lista.className = 'zeca-resultados';

  resultados.forEach(r => {
    const numero = (r.whatsapp || '').replace(/\D/g, '');
    const card = document.createElement('div');
    card.className = 'zeca-card-resultado';
    card.innerHTML = `
      <div class="zeca-card-nome">${r.verificado ? '✅ ' : ''}${_escaparHtmlZeca(r.name)}</div>
      <div class="zeca-card-info">${_escaparHtmlZeca(r.cat || '')}${r.cidade ? ' · ' + _escaparHtmlZeca(r.cidade) : ''}</div>
      ${numero ? `<a href="https://wa.me/55${numero}" target="_blank" class="zeca-card-btn">💬 Chamar no WhatsApp</a>` : ''}
    `;
    lista.appendChild(card);
  });

  container.appendChild(lista);
  container.scrollTop = container.scrollHeight;
}

function _escaparHtmlZeca(texto){
  const div = document.createElement('div');
  div.textContent = texto;
  return div.innerHTML;
}

function _renderizarImagemZeca(url){
  const container = document.getElementById('zeca-mensagens');
  const bolha = document.createElement('div');
  bolha.className = 'zeca-msg zeca-msg-zeca';
  bolha.style.padding = '6px';
  const img = document.createElement('img');
  img.src = url;
  img.alt = 'Imagem gerada pelo Zeca';
  img.style.cssText = 'display:block; max-width:100%; border-radius:10px;';
  bolha.appendChild(img);
  container.appendChild(bolha);
  container.scrollTop = container.scrollHeight;
}

// Foto EDITADA pelo Zeca (diferente da gerada do zero acima) — vem como
// base64 direto na resposta do zeca-chat, já com botão de baixar.
function _renderizarImagemEditadaZeca(base64, mimeType){
  const container = document.getElementById('zeca-mensagens');
  const bolha = document.createElement('div');
  bolha.className = 'zeca-msg zeca-msg-zeca';
  bolha.style.padding = '6px';
  const dataUrl = `data:${mimeType || 'image/png'};base64,${base64}`;
  const img = document.createElement('img');
  img.src = dataUrl;
  img.alt = 'Foto editada pelo Zeca';
  img.style.cssText = 'display:block; max-width:100%; border-radius:10px;';
  bolha.appendChild(img);
  const baixar = document.createElement('a');
  baixar.href = dataUrl;
  baixar.download = 'foto-editada.png';
  baixar.textContent = '⬇️ baixar foto editada';
  baixar.className = 'zeca-link-pdf';
  baixar.style.cssText = 'display:block; margin-top:6px; text-decoration:none;';
  bolha.appendChild(baixar);
  container.appendChild(bolha);
  container.scrollTop = container.scrollHeight;
}

// Áudio EDITADO pelo Zeca (cortado/acelerado/com ruído reduzido) a partir
// de um arquivo que a pessoa mandou — vem como base64 (mp3) direto na
// resposta do zeca-chat, com player + botão de baixar.
function _renderizarAudioEditadoZeca(base64){
  const container = document.getElementById('zeca-mensagens');
  const bolha = document.createElement('div');
  bolha.className = 'zeca-msg zeca-msg-zeca';
  bolha.style.padding = '10px';
  const dataUrl = `data:audio/mpeg;base64,${base64}`;
  const player = document.createElement('audio');
  player.controls = true;
  player.src = dataUrl;
  player.style.cssText = 'display:block; width:100%; max-width:280px;';
  bolha.appendChild(player);
  const baixar = document.createElement('a');
  baixar.href = dataUrl;
  baixar.download = 'audio-editado-zeca.mp3';
  baixar.textContent = '⬇️ baixar áudio editado';
  baixar.className = 'zeca-link-pdf';
  baixar.style.cssText = 'display:block; margin-top:8px; text-decoration:none;';
  bolha.appendChild(baixar);
  container.appendChild(bolha);
  container.scrollTop = container.scrollHeight;
}

// Vídeo EDITADO pelo Zeca (cortado/comprimido/convertido/sem áudio) a
// partir de um arquivo que a pessoa mandou — vem como base64 (mp4) direto
// na resposta do zeca-chat, com player + botão de baixar.
function _renderizarVideoEditadoZeca(base64){
  const container = document.getElementById('zeca-mensagens');
  const bolha = document.createElement('div');
  bolha.className = 'zeca-msg zeca-msg-zeca';
  bolha.style.padding = '10px';
  const dataUrl = `data:video/mp4;base64,${base64}`;
  const player = document.createElement('video');
  player.controls = true;
  player.src = dataUrl;
  player.style.cssText = 'display:block; width:100%; max-width:280px; border-radius:10px;';
  bolha.appendChild(player);
  const baixar = document.createElement('a');
  baixar.href = dataUrl;
  baixar.download = 'video-editado-zeca.mp4';
  baixar.textContent = '⬇️ baixar vídeo editado';
  baixar.className = 'zeca-link-pdf';
  baixar.style.cssText = 'display:block; margin-top:8px; text-decoration:none;';
  bolha.appendChild(baixar);
  container.appendChild(bolha);
  container.scrollTop = container.scrollHeight;
}

// Áudio (narração ou diálogo) gerado pelo Zeca sobre um tema pedido —
// vem como base64 (mp3) + o roteiro em texto, pra pessoa ouvir, baixar e
// usar em vídeo. Mostra um player de áudio nativo + botão de baixar +
// o roteiro escrito (pra ela poder copiar/editar também).
function _renderizarAudioGeradoZeca(base64, roteiro){
  const container = document.getElementById('zeca-mensagens');
  const bolha = document.createElement('div');
  bolha.className = 'zeca-msg zeca-msg-zeca';
  bolha.style.padding = '10px';
  const dataUrl = `data:audio/mpeg;base64,${base64}`;

  const player = document.createElement('audio');
  player.controls = true;
  player.src = dataUrl;
  player.style.cssText = 'display:block; width:100%; margin-bottom:8px;';
  bolha.appendChild(player);

  if(roteiro){
    const textoRoteiro = document.createElement('div');
    textoRoteiro.style.cssText = 'font-size:0.82rem; color:#555; white-space:pre-wrap; margin-bottom:8px;';
    textoRoteiro.textContent = roteiro;
    bolha.appendChild(textoRoteiro);
  }

  const baixar = document.createElement('a');
  baixar.href = dataUrl;
  baixar.download = 'audio-zeca.mp3';
  baixar.textContent = '⬇️ baixar áudio (mp3)';
  baixar.className = 'zeca-link-pdf';
  baixar.style.cssText = 'display:inline-block; text-decoration:none;';
  bolha.appendChild(baixar);

  container.appendChild(bolha);
  container.scrollTop = container.scrollHeight;
}

function toggleMicZeca(){
  if(_zecaOuvindo){
    try{ _zecaReconhecimento.stop(); } catch(e){}
    return;
  }

  const Api = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!Api){
    alert('Seu navegador não suporta reconhecimento de voz. Tenta pelo Chrome.');
    return;
  }

  _zecaReconhecimento = new Api();
  _zecaReconhecimento.lang = 'pt-BR';
  _zecaReconhecimento.continuous = false;
  _zecaReconhecimento.interimResults = false;

  const botaoMic = document.getElementById('zeca-mic');

  _zecaReconhecimento.onstart = () => {
    _zecaOuvindo = true;
    if(botaoMic) botaoMic.classList.add('zeca-mic-ativo');
  };

  _zecaReconhecimento.onresult = (event) => {
    const texto = event.results[0][0].transcript.trim();
    document.getElementById('zeca-input').value = texto;
    _zecaUltimaPerguntaFoiPorVoz = true;
    enviarMensagemZeca();
  };

  _zecaReconhecimento.onerror = (event) => {
    if(event.error === 'not-allowed'){
      alert('Preciso de permissão pro microfone pra te ouvir.');
    }
  };

  _zecaReconhecimento.onend = () => {
    _zecaOuvindo = false;
    if(botaoMic) botaoMic.classList.remove('zeca-mic-ativo');
  };

  try{ _zecaReconhecimento.start(); } catch(e){}
}

// Sobe um vídeo direto pro Supabase Storage (mesmo bucket "fotos" que a
// vitrine já usa pra vídeo de produto), usando o cliente Supabase já
// autenticado com a sessão da pessoa — o upload vai direto navegador →
// Supabase, sem passar pelo corpo da requisição do Netlify Functions,
// que é o que limitava vídeo a poucos MB antes. Precisa de login (a
// política do bucket é por pasta do usuário) — sem login, volta null.
async function _zecaSubirVideoParaStorage(arquivo, pasta){
  try{
    if(typeof window.supabase === 'undefined' || typeof SUPABASE_URL === 'undefined' || typeof SUPABASE_ANON_KEY === 'undefined'){
      return null;
    }
    const cliente = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: sessaoData } = await cliente.auth.getSession();
    const usuario = sessaoData && sessaoData.session ? sessaoData.session.user : null;
    if(!usuario) return null;

    const extensao = (arquivo.name && arquivo.name.includes('.')) ? arquivo.name.split('.').pop() : 'mp4';
    const nomeArquivo = `${pasta || 'zeca-videos'}/${usuario.id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${extensao}`;

    const { error } = await cliente.storage.from('fotos').upload(nomeArquivo, arquivo);
    if(error){
      console.error('erro ao subir arquivo pro Storage', error);
      return null;
    }
    const { data } = cliente.storage.from('fotos').getPublicUrl(nomeArquivo);
    return data.publicUrl;
  } catch(e){
    console.error('erro no upload de arquivo pro Storage', e);
    return null;
  }
}

function _falarRespostaZeca(texto){
  if(!('speechSynthesis' in window)) return;
  _zecaSynth.cancel();
  const fala = new SpeechSynthesisUtterance(texto);
  fala.lang = 'pt-BR';
  _zecaSynth.speak(fala);
}

// Pega o token de sessão, se a pessoa estiver logada — cria um cliente
// Supabase temporário só pra ler a sessão já salva no navegador (funciona
// em qualquer página, não depende do nome da variável que cada tela usa
// pro próprio cliente Supabase). Sem login, volta null — e mesmo assim o
// Zeca funciona pra visitante, com o limite de visitante.
async function _obterTokenZeca(){
  try{
    if(typeof window.supabase === 'undefined' || typeof SUPABASE_URL === 'undefined' || typeof SUPABASE_ANON_KEY === 'undefined'){
      return null;
    }
    const clienteTemp = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: sessaoData } = await clienteTemp.auth.getSession();
    return sessaoData && sessaoData.session ? sessaoData.session.access_token : null;
  } catch(e){
    console.warn('não consegui checar sessão pro Zeca', e);
    return null;
  }
}

// Checa se quem está usando é o criador (Alex) — só pra decidir o limite
// de tamanho de zip mostrado no navegador. É só conveniência de UX; quem
// decide de verdade (e não pode ser enganado) é o backend, que confere o
// login de novo em zeca-chat.js antes de aplicar qualquer limite maior.
let _zecaEmailCache;
async function _souCriadorZeca(){
  if(_zecaEmailCache !== undefined) return _zecaEmailCache === 'contato@guiazap.shop';
  try{
    if(typeof window.supabase === 'undefined' || typeof SUPABASE_URL === 'undefined' || typeof SUPABASE_ANON_KEY === 'undefined'){
      _zecaEmailCache = null;
      return false;
    }
    const clienteTemp = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data } = await clienteTemp.auth.getSession();
    _zecaEmailCache = (data && data.session && data.session.user && data.session.user.email) || null;
  } catch(e){
    _zecaEmailCache = null;
  }
  return _zecaEmailCache === 'contato@guiazap.shop';
}

// --- Memória (opt-in) e conversas salvas ---

async function _chamarMemoriaZeca(acao, extras){
  const token = await _obterTokenZeca();
  if(!token) return null; // sem login não tem memória — chamador decide o que fazer
  try{
    const resp = await fetch('/.netlify/functions/zeca-memoria', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ acao, ...extras })
    });
    return await resp.json();
  } catch(e){
    console.error('erro na memória do Zeca', e);
    return null;
  }
}

async function abrirListaConversasZeca(){
  const status = await _chamarMemoriaZeca('status');
  if(!status){
    alert('Precisa estar logado pra usar conversas salvas.');
    return;
  }

  const listaResp = status.ativada ? await _chamarMemoriaZeca('listar_conversas') : null;
  const conversas = (listaResp && listaResp.conversas) || [];

  let overlay = document.getElementById('zeca-overlay-conversas');
  if(overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.id = 'zeca-overlay-conversas';
  overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:100001; display:flex; align-items:center; justify-content:center; padding:20px;';

  const caixa = document.createElement('div');
  caixa.style.cssText = 'background:white; border-radius:16px; width:100%; max-width:380px; max-height:80vh; display:flex; flex-direction:column; overflow:hidden;';

  caixa.innerHTML = `
    <div style="padding:16px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
      <strong>Conversas salvas</strong>
      <button type="button" onclick="document.getElementById('zeca-overlay-conversas').remove()" style="background:none; border:none; font-size:1.2rem; cursor:pointer;">✕</button>
    </div>
    <div style="padding:14px 16px; border-bottom:1px solid #eee; display:flex; align-items:center; justify-content:space-between; gap:10px;">
      <div style="font-size:0.82rem;">
        <b>Lembrar das conversas</b>
        <div style="color:#888; font-size:0.72rem;">Opcional — fica salvo até você apagar</div>
      </div>
      <label style="position:relative; display:inline-block; width:42px; height:24px; flex-shrink:0;">
        <input type="checkbox" id="zeca-toggle-memoria" ${status.ativada ? 'checked' : ''} onchange="_alternarMemoriaZeca(this.checked)" style="opacity:0; width:0; height:0;">
        <span style="position:absolute; inset:0; background:${status.ativada ? '#f59e0b' : '#ccc'}; border-radius:24px; transition:0.2s;"></span>
        <span style="position:absolute; top:3px; left:${status.ativada ? '21px' : '3px'}; width:18px; height:18px; background:white; border-radius:50%; transition:0.2s;"></span>
      </label>
    </div>
    ${status.ativada ? `
      <button type="button" onclick="novaConversaZeca()" style="margin:12px 16px 6px; background:#f59e0b; color:white; border:none; border-radius:10px; padding:10px; font-weight:700; cursor:pointer;">+ Nova conversa</button>
      <div style="overflow-y:auto; padding:6px 10px 14px;">
        ${conversas.length === 0 ? '<div style="text-align:center; color:#888; font-size:0.82rem; padding:20px;">Nenhuma conversa salva ainda.</div>' : conversas.map(c => `
          <div style="display:flex; align-items:center; gap:8px; padding:10px; border-radius:10px; cursor:pointer;" onmouseover="this.style.background='#f7f5f0'" onmouseout="this.style.background=''">
            <div onclick="carregarConversaZeca('${c.id}')" style="flex:1; min-width:0;">
              <div style="font-size:0.85rem; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${_escaparHtmlZeca(c.titulo)}</div>
              <div style="font-size:0.7rem; color:#999;">${new Date(c.updated_at).toLocaleDateString('pt-BR')}</div>
            </div>
            <button type="button" onclick="apagarConversaZeca('${c.id}')" title="Apagar" style="background:none; border:none; color:#a4402f; cursor:pointer; font-size:0.9rem;">🗑</button>
          </div>
        `).join('')}
      </div>
      <div style="padding:10px 16px; border-top:1px solid #eee; font-size:0.7rem; color:#999;">${status.totalConversas}/${status.limiteConversas} conversas usadas</div>
    ` : `<div style="padding:20px; text-align:center; color:#888; font-size:0.82rem;">Ativa acima pra guardar suas conversas e poder voltar nelas depois.</div>`}
  `;

  overlay.appendChild(caixa);
  overlay.onclick = (e) => { if(e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
}

async function _alternarMemoriaZeca(ligar){
  await _chamarMemoriaZeca(ligar ? 'ativar' : 'desativar');
  abrirListaConversasZeca(); // recarrega o painel já com o novo estado
}

function novaConversaZeca(){
  _zecaConversaAtual = null;
  _zecaSalvarConversaNaSessao(null);
  _zecaHistorico = [];
  _zecaUltimaInstrucaoTexto = null;
  document.getElementById('zeca-mensagens').innerHTML = '';
  document.getElementById('zeca-overlay-conversas')?.remove();
  _adicionarMensagemZeca('zeca', 'Começando uma conversa nova! Manda a pergunta.');
}

// silencioso=true é usado ao restaurar a conversa automaticamente numa
// página nova (ver toggleZeca) — se der errado, cai na saudação padrão
// em vez de mostrar um alert() inesperado assim que o painel abre.
async function carregarConversaZeca(conversaId, silencioso){
  const dados = await _chamarMemoriaZeca('obter_conversa', { conversaId });
  document.getElementById('zeca-overlay-conversas')?.remove();
  if(!dados || !dados.mensagens){
    _zecaSalvarConversaNaSessao(null); // não existe mais / sem acesso — não insiste nela nas próximas páginas
    if(silencioso){
      _zecaMensagemBoasVindas();
    } else {
      alert('Não consegui abrir essa conversa.');
    }
    return;
  }
  _zecaConversaAtual = conversaId;
  _zecaSalvarConversaNaSessao(conversaId);
  _zecaHistorico = [];
  _zecaUltimaInstrucaoTexto = null;
  document.getElementById('zeca-mensagens').innerHTML = '';
  dados.mensagens.forEach(m => _adicionarMensagemZeca(m.remetente, m.texto));
}

async function apagarConversaZeca(conversaId){
  if(!confirm('Apagar essa conversa? Não tem como desfazer.')) return;
  await _chamarMemoriaZeca('apagar_conversa', { conversaId });
  if(_zecaConversaAtual === conversaId) novaConversaZeca();
  abrirListaConversasZeca();
}

async function _gerarImagemViaZeca(descricao, token){
  const respImagem = await fetch('/.netlify/functions/gerar-imagem-zeca', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ descricao })
  });
  return respImagem.json();
}

async function _gerarAudioViaZeca(tema, formato, vozPedida, voz2Pedida, duracaoPedida, velocidadePedida, token){
  const respAudio = await fetch('/.netlify/functions/gerar-audio-zeca', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ tema, formato, vozPedida, voz2Pedida, duracaoPedida, velocidadePedida })
  });
  return respAudio.json();
}

// Vídeo é diferente: gerar-video-zeca.js só INICIA a geração (devolve um
// videoId na hora) — o vídeo em si demora minutos na HeyGen. Essa função
// inicia e já fica perguntando pra verificar-video-zeca.js de tempos em
// tempos até vir pronto (ou falhar), chamando onProgresso a cada tentativa
// pra quem chamou poder atualizar a mensagem "gerando..." na tela.
async function _gerarVideoViaZeca(tema, duracaoPedida, generoPedido, token, onProgresso){
  const respInicio = await fetch('/.netlify/functions/gerar-video-zeca', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ tema, duracaoPedida, generoPedido })
  });
  const dadosInicio = await respInicio.json();
  if(!dadosInicio.videoId){
    return dadosInicio; // tem .error (e talvez .comprarCreditos) pra quem chamou tratar
  }

  const ESPERA_ENTRE_TENTATIVAS_MS = 6000;
  const MAX_TENTATIVAS = 50; // ~5 minutos de teto
  for(let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++){
    await new Promise(r => setTimeout(r, ESPERA_ENTRE_TENTATIVAS_MS));
    if(onProgresso) onProgresso(tentativa);
    try{
      const respStatus = await fetch('/.netlify/functions/verificar-video-zeca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: dadosInicio.videoId })
      });
      const dadosStatus = await respStatus.json();
      if(dadosStatus.status === 'completed' && dadosStatus.url){
        return { url: dadosStatus.url, roteiro: dadosInicio.roteiro };
      }
      if(dadosStatus.status === 'failed'){
        return { error: dadosStatus.erro || 'A geração do vídeo falhou. Tenta de novo?' };
      }
      // "pending"/"processing" — continua esperando
    } catch(eStatus){
      console.error('erro consultando status do vídeo', eStatus);
      // erro de rede pontual na consulta — não desiste, tenta de novo na próxima volta
    }
  }
  return { error: 'O vídeo tá demorando demais pra ficar pronto. Confere de novo daqui a pouco, ou tenta de novo.' };
}

// --- Memória "silenciosa" pra tipos de resposta especiais ---
// gerar_imagem/gerar_audio/executar_codigo e edição de imagem respondem
// direto de OUTRA function (gerar-audio-zeca.js etc.), sem voltar a
// passar pelo zeca-chat.js — então, sem isso, nem o histórico da sessão
// (_zecaHistorico) nem a conversa salva no banco nunca ficavam sabendo
// que aquele áudio/imagem/código foi gerado. Resultado: se a pessoa
// pedisse algo sobre aquilo logo depois (ex: "faz esse áudio mais
// rápido"), o Zeca não tinha a menor ideia do que ela tava falando.
//
// Registra um resumo em TEXTO (não o áudio/imagem em si, só uma
// descrição curta) no histórico da sessão, sem criar uma bolha visível
// extra no chat (o resultado em si já aparece visualmente — áudio,
// imagem, bloco de código), e também salva no banco quando a pessoa tem
// memória ativada, pra sobreviver a um recarregar de página.
function _zecaRegistrarHistoricoSilencioso(de, texto){
  _zecaHistorico.push({ de, texto });
}

async function _zecaSalvarTrocaEspecial(mensagemPessoa, respostaResumo, token){
  try{
    if(!token || !mensagemPessoa || !respostaResumo) return;
    const resultado = await _chamarMemoriaZeca('salvar_mensagem', { conversaId: _zecaConversaAtual, mensagemPessoa, respostaZeca: respostaResumo });
    if(resultado && resultado.conversaId){
      _zecaConversaAtual = resultado.conversaId;
      _zecaSalvarConversaNaSessao(resultado.conversaId);
    }
    // Sem conversaId de volta = ou memória desativada, ou deu algum erro —
    // tudo bem, o histórico da SESSÃO (_zecaHistorico) já foi atualizado
    // de qualquer forma, então ainda funciona pra follow-up na mesma página.
  } catch(e){ console.error('erro ao salvar troca especial na memória do Zeca', e); }
}

// Só chamada quando o próprio zeca-chat.js já sinalizou tipo
// "mudar_codigo" (e isso só acontece quando o back-end já confirmou que
// quem está falando é o criador, pelo login). mudar-codigo-zeca.js
// confere de novo antes de tocar em qualquer coisa no GitHub — nunca
// abre PR sem essa dupla confirmação.
async function _mudarCodigoViaZeca(caminhoArquivo, instrucaoCodigo, token){
  const respMudar = await fetch('/.netlify/functions/mudar-codigo-zeca', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ caminhoArquivo, instrucaoCodigo })
  });
  return respMudar.json();
}

// Redimensiona a imagem no navegador antes de mandar (imagem de celular
// direto da câmera pode ter vários MB — isso encarece a chamada e pode
// estourar limite de tamanho do servidor). Reduz pro lado maior caber em
// 1024px e comprime como JPEG.
function _redimensionarImagemZeca(arquivo){
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1024;
        let { width, height } = img;
        if(width > height && width > MAX){ height = Math.round(height * MAX / width); width = MAX; }
        else if(height > MAX){ width = Math.round(width * MAX / height); height = MAX; }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        resolve(dataUrl.split(',')[1]); // só o base64, sem o prefixo "data:image/jpeg;base64,"
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    leitor.onerror = reject;
    leitor.readAsDataURL(arquivo);
  });
}

// Lê um arquivo (o .zip) como base64 puro, sem redimensionar/comprimir —
// zip não é imagem, precisa manter os bytes originais intactos.
function _arquivoParaBase64Zeca(arquivo){
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = (e) => resolve(e.target.result.split(',')[1]);
    leitor.onerror = reject;
    leitor.readAsDataURL(arquivo);
  });
}

let _zecaImagemPendente = null;
let _zecaZipPendente = null;
let _zecaVideoPendente = null; // { data: base64, mimeType } (pequeno) ou { url, mimeType } (via Storage) — vídeo pro Zeca "assistir"/editar
let _zecaAudioPendente = null; // { data: base64, mimeType } (pequeno) ou { url, mimeType } (via Storage) — áudio pro Zeca editar
// Áudio é bem mais leve que vídeo — quase sempre vai direto em base64.
// Só usa Storage (precisa login) pra arquivo realmente grande.
const MAX_AUDIO_BYTES_ZECA = 4 * 1024 * 1024;            // ~4MB — vai direto no corpo, funciona sem login
const MAX_AUDIO_BYTES_STORAGE_ZECA = 20 * 1024 * 1024;   // ~20MB — via Storage, precisa estar logado (bate com o teto do zeca-chat.js)
const MAX_ZIP_BYTES_ZECA = 8 * 1024 * 1024;           // 8MB pro público
// Pro criador não tem teto de propósito no código — mas o Netlify
// Functions (onde o zeca-chat.js roda) recusa sozinho qualquer requisição
// acima de ~6MB de corpo, então na prática o teto real de hoje é esse do
// Netlify, não este número. Deixado bem alto só pra não barrar antes disso.
const MAX_ZIP_BYTES_CRIADOR_ZECA = 500 * 1024 * 1024; // 500MB (limitado de verdade pelo Netlify antes de chegar aqui)
// Vídeo pequeno (até MAX_VIDEO_BYTES_ZECA) vai direto em base64 no corpo
// da requisição, igual imagem — simples e funciona pra qualquer um,
// mesmo visitante. Vídeo maior que isso precisa subir primeiro pro
// Supabase Storage (só funciona logado — ver _zecaSubirVideoParaStorage)
// e manda só a URL pro zeca-chat, driblando o teto de ~6MB do Netlify.
// MAX_VIDEO_BYTES_STORAGE_ZECA é limitado pelo teto de vídeo inline que o
// próprio Gemini aceita numa chamada só (não é mais o Netlify o gargalo).
const MAX_VIDEO_BYTES_ZECA = 3.5 * 1024 * 1024;          // ~3.5MB — vai direto no corpo, funciona sem login
const MAX_VIDEO_BYTES_STORAGE_ZECA = 15 * 1024 * 1024;   // ~15MB — via Storage, precisa estar logado

// Lógica compartilhada entre seletor de arquivo, colar (Ctrl+V) e
// arrastar-e-soltar — decide se é imagem, vídeo ou .zip, confere tamanho
// e prepara o anexo pendente pra próxima mensagem.
async function _zecaProcessarArquivoAnexado(arquivo){
  const ehZip = arquivo.name.toLowerCase().endsWith('.zip') || arquivo.type === 'application/zip';
  try{
    if(ehZip){
      const limiteZip = (await _souCriadorZeca()) ? MAX_ZIP_BYTES_CRIADOR_ZECA : MAX_ZIP_BYTES_ZECA;
      if(arquivo.size > limiteZip){
        alert(`Esse .zip é muito grande (máximo ${Math.round(limiteZip / 1024 / 1024)}MB).`);
        return;
      }
      _zecaImagemPendente = null;
      _zecaVideoPendente = null;
      _zecaAudioPendente = null;
      _zecaZipPendente = await _arquivoParaBase64Zeca(arquivo);
    } else if(arquivo.type.startsWith('image/')){
      _zecaZipPendente = null;
      _zecaVideoPendente = null;
      _zecaAudioPendente = null;
      _zecaImagemPendente = await _redimensionarImagemZeca(arquivo);
    } else if(arquivo.type.startsWith('video/')){
      _zecaZipPendente = null;
      _zecaImagemPendente = null;
      _zecaAudioPendente = null;

      if(arquivo.size <= MAX_VIDEO_BYTES_ZECA){
        // Vídeo pequeno — vai direto em base64, sem precisar de login.
        _zecaVideoPendente = { data: await _arquivoParaBase64Zeca(arquivo), mimeType: arquivo.type || 'video/mp4' };
      } else if(arquivo.size <= MAX_VIDEO_BYTES_STORAGE_ZECA){
        const temToken = await _obterTokenZeca();
        if(!temToken){
          alert(`Esse vídeo passa de ${Math.round(MAX_VIDEO_BYTES_ZECA / 1024 / 1024 * 10) / 10}MB — pra vídeo maior (até ${Math.round(MAX_VIDEO_BYTES_STORAGE_ZECA / 1024 / 1024)}MB) você precisa estar logado. Faz login ou manda um vídeo bem curto.`);
          return;
        }
        _zecaVideoPendente = null;
        _zecaPreviewImagemPendente(arquivo, true); // mostra "enviando..." já no preview
        const urlVideo = await _zecaSubirVideoParaStorage(arquivo, 'zeca-videos');
        if(!urlVideo){
          alert('Não consegui subir esse vídeo agora. Tenta de novo ou usa um vídeo menor.');
          document.getElementById('zeca-preview-anexo')?.remove();
          return;
        }
        _zecaVideoPendente = { url: urlVideo, mimeType: arquivo.type || 'video/mp4' };
      } else {
        alert(`Esse vídeo é grande demais pro Zeca assistir/editar (máximo ${Math.round(MAX_VIDEO_BYTES_STORAGE_ZECA / 1024 / 1024)}MB, mesmo logado). Tenta um trecho mais curto.`);
        return;
      }
    } else if(arquivo.type.startsWith('audio/')){
      _zecaZipPendente = null;
      _zecaImagemPendente = null;
      _zecaVideoPendente = null;

      if(arquivo.size <= MAX_AUDIO_BYTES_ZECA){
        // Áudio pequeno — vai direto em base64, sem precisar de login.
        _zecaAudioPendente = { data: await _arquivoParaBase64Zeca(arquivo), mimeType: arquivo.type || 'audio/mpeg' };
      } else if(arquivo.size <= MAX_AUDIO_BYTES_STORAGE_ZECA){
        const temToken = await _obterTokenZeca();
        if(!temToken){
          alert(`Esse áudio passa de ${Math.round(MAX_AUDIO_BYTES_ZECA / 1024 / 1024 * 10) / 10}MB — pra áudio maior (até ${Math.round(MAX_AUDIO_BYTES_STORAGE_ZECA / 1024 / 1024)}MB) você precisa estar logado. Faz login ou manda um áudio menor.`);
          return;
        }
        _zecaAudioPendente = null;
        _zecaPreviewImagemPendente(arquivo, true); // mostra "enviando..." já no preview
        const urlAudio = await _zecaSubirVideoParaStorage(arquivo, 'zeca-audios');
        if(!urlAudio){
          alert('Não consegui subir esse áudio agora. Tenta de novo ou usa um arquivo menor.');
          document.getElementById('zeca-preview-anexo')?.remove();
          return;
        }
        _zecaAudioPendente = { url: urlAudio, mimeType: arquivo.type || 'audio/mpeg' };
      } else {
        alert(`Esse áudio é grande demais pro Zeca editar (máximo ${Math.round(MAX_AUDIO_BYTES_STORAGE_ZECA / 1024 / 1024)}MB, mesmo logado). Tenta um arquivo menor.`);
        return;
      }
    } else {
      alert('Só aceito imagem, vídeo, áudio ou .zip por aqui.');
      return;
    }
    _zecaPreviewImagemPendente(arquivo);
  } catch(e){
    console.error(e);
    alert('Não consegui carregar esse arquivo. Tenta outro.');
  }
}

function _abrirSeletorImagemZeca(){
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,video/*,audio/*,.zip';
  input.onchange = async () => {
    const arquivo = input.files[0];
    if(!arquivo) return;
    await _zecaProcessarArquivoAnexado(arquivo);
  };
  input.click();
}

// Ctrl+V numa imagem copiada direto no campo de mensagem — sem precisar
// abrir o seletor de arquivo. Ligado via onpaste="_zecaColarImagem(event)"
// no input de mensagem do Zeca.
async function _zecaColarImagem(event){
  const itens = (event.clipboardData || window.clipboardData)?.items;
  if(!itens) return;
  for(const item of itens){
    if(item.type.startsWith('image/')){
      const arquivo = item.getAsFile();
      if(!arquivo) continue;
      event.preventDefault();
      await _zecaProcessarArquivoAnexado(arquivo);
      break;
    }
  }
}

// Arrastar um arquivo (imagem ou .zip) e soltar em cima do painel do
// Zeca — mesma lógica de processamento do seletor/colar.
function _zecaInicializarDragDrop(){
  const painel = document.getElementById('painel-zeca');
  if(!painel || painel.dataset.dragPronto) return;
  painel.dataset.dragPronto = '1';

  painel.addEventListener('dragover', (e) => {
    e.preventDefault();
    painel.classList.add('zeca-arrastando');
  });
  painel.addEventListener('dragleave', () => {
    painel.classList.remove('zeca-arrastando');
  });
  painel.addEventListener('drop', async (e) => {
    e.preventDefault();
    painel.classList.remove('zeca-arrastando');
    const arquivo = e.dataTransfer.files && e.dataTransfer.files[0];
    if(!arquivo) return;
    await _zecaProcessarArquivoAnexado(arquivo);
  });
}

function _zecaPreviewImagemPendente(arquivo, enviando){
  const rodape = document.querySelector('#painel-zeca .zeca-rodape');
  let preview = document.getElementById('zeca-preview-anexo');
  if(!preview){
    preview = document.createElement('div');
    preview.id = 'zeca-preview-anexo';
    preview.style.cssText = 'display:flex; align-items:center; gap:6px; padding:6px 12px; font-size:0.78rem; color:#555; background:#fef3e2; border-top:1px solid #eee;';
    rodape.parentElement.insertBefore(preview, rodape);
  }
  const rotulo = arquivo.name ? arquivo.name.slice(0, 30) : 'imagem colada';
  if(enviando){
    // Estado transitório enquanto o vídeo grande sobe pro Storage — sem
    // botão de remover ainda, porque o upload já está em andamento.
    preview.innerHTML = `⬆️ enviando ${rotulo}...`;
    return;
  }
  preview.innerHTML = `📎 ${rotulo} <button type="button" onclick="_zecaImagemPendente=null; _zecaZipPendente=null; _zecaVideoPendente=null; _zecaAudioPendente=null; document.getElementById('zeca-preview-anexo').remove();" style="margin-left:auto; background:none; border:none; cursor:pointer; color:#a4402f; font-weight:700;">remover</button>`;
}

function _renderizarResultadoCodigoZeca(resultado){
  const container = document.getElementById('zeca-mensagens');
  const bolha = document.createElement('div');
  bolha.className = 'zeca-msg zeca-msg-zeca';
  bolha.style.fontFamily = 'monospace';
  bolha.style.whiteSpace = 'pre-wrap';
  bolha.style.fontSize = '0.8rem';

  let texto = `Status: ${resultado.status}\n`;
  if(resultado.stdout) texto += `\nSaída:\n${resultado.stdout}`;
  if(resultado.stderr) texto += `\nErro:\n${resultado.stderr}`;
  if(!resultado.stdout && !resultado.stderr) texto += '\n(sem saída)';

  bolha.textContent = texto;
  container.appendChild(bolha);
  container.scrollTop = container.scrollHeight;
}

async function _executarCodigoViaZeca(codigo, linguagem, token){
  const resp = await fetch('/.netlify/functions/executar-codigo-zeca', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ codigo, linguagem })
  });
  return resp.json();
}

async function enviarMensagemZeca(){
  const input = document.getElementById('zeca-input');
  const texto = input.value.trim();
  const imagemAnexada = _zecaImagemPendente;
  const zipAnexado = _zecaZipPendente;
  const videoAnexado = _zecaVideoPendente;
  const audioAnexado = _zecaAudioPendente;
  if(!texto && !imagemAnexada && !zipAnexado && !videoAnexado && !audioAnexado) return;

  // Se veio uma imagem/vídeo/áudio SEM texto novo, mas a pessoa tinha
  // digitado um pedido antes numa mensagem separada, reaproveita esse
  // pedido agora — senão a instrução se perde e o Zeca cai no modo "só
  // descrever" (ou, pro áudio, pede a instrução de novo à toa).
  let mensagemParaEnviar = texto;
  if(!texto && (imagemAnexada || videoAnexado || audioAnexado) && _zecaUltimaInstrucaoTexto){
    mensagemParaEnviar = _zecaUltimaInstrucaoTexto;
  }
  if(texto) _zecaUltimaInstrucaoTexto = texto;

  input.value = '';
  input.disabled = true;
  _adicionarMensagemZeca('pessoa', texto || (zipAnexado ? '📎 (arquivo .zip)' : (mensagemParaEnviar ? `📎 ${mensagemParaEnviar}` : (videoAnexado ? '📎 (vídeo)' : (audioAnexado ? '📎 (áudio)' : '📎 (imagem)')))));
  document.getElementById('zeca-preview-anexo')?.remove();
  _zecaImagemPendente = null;
  _zecaZipPendente = null;
  _zecaVideoPendente = null;
  _zecaAudioPendente = null;
  _zecaUltimaInstrucaoTexto = null; // usa uma vez só — não reaproveita de novo no próximo anexo

  const digitando = document.createElement('div');
  digitando.className = 'zeca-msg zeca-msg-zeca';
  digitando.id = 'zeca-digitando';
  digitando.textContent = zipAnexado ? '📦 Lendo o zip...' : (imagemAnexada ? '👀 Olhando a imagem...' : (videoAnexado ? '🎬 Assistindo/editando o vídeo...' : (audioAnexado ? '🎧 Editando o áudio...' : '...')));
  document.getElementById('zeca-mensagens').appendChild(digitando);
  document.getElementById('zeca-mensagens').scrollTop = 999999;

  try{
    const token = await _obterTokenZeca();

    const resp = await fetch('/.netlify/functions/zeca-chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        mensagem: mensagemParaEnviar,
        historico: _zecaHistorico.slice(0, -1),
        imagem: imagemAnexada ? { data: imagemAnexada, mimeType: 'image/jpeg' } : null,
        arquivoZip: zipAnexado || null,
        video: videoAnexado || null,
        audio: audioAnexado || null,
        conversaId: _zecaConversaAtual
      })
    });
    // Se o próprio Netlify barrar a requisição antes de chegar na function
    // (ex: 413 — corpo grande demais pro limite da plataforma, ~6MB), a
    // resposta vem vazia/sem JSON — resp.json() quebraria aqui sem essa
    // checagem, travando o chat numa mensagem de erro genérica de conexão.
    if (!resp.ok) {
      document.getElementById('zeca-digitando')?.remove();
      let dadosErro = null;
      try { dadosErro = await resp.json(); } catch (e) { /* corpo vazio/não-JSON, ex: bloqueio do próprio Netlify */ }
      const msgErro = resp.status === 413
        ? 'Esse arquivo é grande demais pro servidor aceitar de uma vez (limite da hospedagem, não é o Zeca) — tenta um arquivo menor.'
        : (dadosErro && dadosErro.resposta) || `Deu erro aqui (${resp.status}). Tenta de novo?`;
      _adicionarMensagemZeca('zeca', msgErro);
      if (dadosErro && dadosErro.comprarCreditos) {
        _mostrarBotaoComprarCreditosZeca();
      }
      input.disabled = false;
      input.focus();
      return;
    }

    const data = await resp.json();
    document.getElementById('zeca-digitando')?.remove();
    _adicionarMensagemZeca('zeca', data.resposta || 'Não consegui responder agora. Tenta de novo?');
    if(data.imagemEditada && data.imagemEditada.data){
      _renderizarImagemEditadaZeca(data.imagemEditada.data, data.imagemEditada.mimeType);
      const resumoEdicao = `[Editei a imagem como pedido: "${mensagemParaEnviar}"]`;
      _zecaRegistrarHistoricoSilencioso('zeca', resumoEdicao);
      _zecaSalvarTrocaEspecial(mensagemParaEnviar, resumoEdicao, token);
    }
    if(data.audioEditado && data.audioEditado.data){
      _renderizarAudioEditadoZeca(data.audioEditado.data);
      const resumoEdicaoAudio = `[Editei o áudio como pedido: "${mensagemParaEnviar}"]`;
      _zecaRegistrarHistoricoSilencioso('zeca', resumoEdicaoAudio);
      _zecaSalvarTrocaEspecial(mensagemParaEnviar, resumoEdicaoAudio, token);
    }
    if(data.videoEditado && data.videoEditado.data){
      _renderizarVideoEditadoZeca(data.videoEditado.data);
      const resumoEdicaoVideo = `[Editei o vídeo como pedido: "${mensagemParaEnviar}"]`;
      _zecaRegistrarHistoricoSilencioso('zeca', resumoEdicaoVideo);
      _zecaSalvarTrocaEspecial(mensagemParaEnviar, resumoEdicaoVideo, token);
    }
    if(data.conversaId){ _zecaConversaAtual = data.conversaId; _zecaSalvarConversaNaSessao(data.conversaId); }
    if(data.limiteConversasAtingido){
      _adicionarMensagemZeca('zeca', '⚠️ Essa conversa não foi salva — você já tem 30 conversas guardadas. Apaga uma antiga no ☰ pra continuar salvando.');
    }
    if(_zecaUltimaPerguntaFoiPorVoz && data.resposta){
      _falarRespostaZeca(data.resposta);
    }
    _zecaUltimaPerguntaFoiPorVoz = false;
    if(Array.isArray(data.resultados) && data.resultados.length > 0){
      _renderizarResultadosZeca(data.resultados);
    }
    if(data.tipo === 'gerar_imagem'){
      const gerando = document.createElement('div');
      gerando.className = 'zeca-msg zeca-msg-zeca';
      gerando.id = 'zeca-gerando-imagem';
      gerando.textContent = '🎨 Gerando imagem...';
      document.getElementById('zeca-mensagens').appendChild(gerando);
      document.getElementById('zeca-mensagens').scrollTop = 999999;

      try{
        const dadosImagem = await _gerarImagemViaZeca(data.descricaoImagem, token);
        document.getElementById('zeca-gerando-imagem')?.remove();
        if(dadosImagem.url){
          _renderizarImagemZeca(dadosImagem.url);
          const resumoImagem = `[Gerei uma imagem sobre: "${data.descricaoImagem}"]`;
          _zecaRegistrarHistoricoSilencioso('zeca', resumoImagem);
          _zecaSalvarTrocaEspecial(mensagemParaEnviar, resumoImagem, token);
        } else {
          _adicionarMensagemZeca('zeca', dadosImagem.error || 'Não consegui gerar a imagem agora. Tenta de novo?');
          if(dadosImagem.comprarCreditos){ _mostrarBotaoComprarCreditosZeca(); }
        }
      } catch(eImg){
        console.error(eImg);
        document.getElementById('zeca-gerando-imagem')?.remove();
        _adicionarMensagemZeca('zeca', 'Deu erro gerando a imagem. Tenta de novo?');
      }
    }
    if(data.tipo === 'gerar_audio'){
      const gravando = document.createElement('div');
      gravando.className = 'zeca-msg zeca-msg-zeca';
      gravando.id = 'zeca-gerando-audio';
      gravando.textContent = data.formatoAudio === 'dialogo' ? '🎙️ Escrevendo e gravando o diálogo...' : '🎙️ Escrevendo e gravando o áudio...';
      document.getElementById('zeca-mensagens').appendChild(gravando);
      document.getElementById('zeca-mensagens').scrollTop = 999999;

      try{
        const dadosAudio = await _gerarAudioViaZeca(data.temaAudio, data.formatoAudio, data.vozPedida, data.voz2Pedida, data.duracaoAudio, data.velocidadeAudio, token);
        document.getElementById('zeca-gerando-audio')?.remove();
        if(dadosAudio.audioBase64){
          _renderizarAudioGeradoZeca(dadosAudio.audioBase64, dadosAudio.roteiro);
          const resumoAudio = `[Gerei um áudio sobre "${data.temaAudio}" — ${data.formatoAudio === 'dialogo' ? 'diálogo' : 'narração'}${data.duracaoAudio ? ', duração pedida: ' + data.duracaoAudio : ''}${data.velocidadeAudio ? ', velocidade: ' + data.velocidadeAudio : ''}. Roteiro: "${(dadosAudio.roteiro || '').slice(0, 600)}"]`;
          _zecaRegistrarHistoricoSilencioso('zeca', resumoAudio);
          _zecaSalvarTrocaEspecial(mensagemParaEnviar, resumoAudio, token);
        } else {
          _adicionarMensagemZeca('zeca', dadosAudio.error || 'Não consegui gerar o áudio agora. Tenta de novo?');
          if(dadosAudio.comprarCreditos){ _mostrarBotaoComprarCreditosZeca(); }
        }
      } catch(eAudio){
        console.error(eAudio);
        document.getElementById('zeca-gerando-audio')?.remove();
        _adicionarMensagemZeca('zeca', 'Deu erro gerando o áudio. Tenta de novo?');
      }
    }
    if(data.tipo === 'gerar_video'){
      const gerandoVideo = document.createElement('div');
      gerandoVideo.className = 'zeca-msg zeca-msg-zeca';
      gerandoVideo.id = 'zeca-gerando-video';
      gerandoVideo.textContent = '🎬 Gerando vídeo... isso leva alguns minutos. Não fecha essa aba/navegador enquanto isso, senão perco o andamento.';
      document.getElementById('zeca-mensagens').appendChild(gerandoVideo);
      document.getElementById('zeca-mensagens').scrollTop = 999999;

      try{
        const dadosVideo = await _gerarVideoViaZeca(data.temaVideo, data.duracaoVideo, data.generoVideo, token, (tentativa) => {
          const elGerando = document.getElementById('zeca-gerando-video');
          if(elGerando) elGerando.textContent = `🎬 Gerando vídeo... ainda processando (${tentativa * 6}s), só mais um pouco`;
        });
        document.getElementById('zeca-gerando-video')?.remove();
        if(dadosVideo.url){
          _renderizarVideoGeradoZeca(dadosVideo.url, dadosVideo.roteiro);
          const resumoVideo = `[Gerei um vídeo sobre "${data.temaVideo}". Roteiro: "${(dadosVideo.roteiro || '').slice(0, 600)}"]`;
          _zecaRegistrarHistoricoSilencioso('zeca', resumoVideo);
          _zecaSalvarTrocaEspecial(mensagemParaEnviar, resumoVideo, token);
        } else {
          _adicionarMensagemZeca('zeca', dadosVideo.error || 'Não consegui gerar o vídeo agora. Tenta de novo?');
          if(dadosVideo.comprarCreditos){ _mostrarBotaoComprarCreditosZeca(); }
        }
      } catch(eVideo){
        console.error(eVideo);
        document.getElementById('zeca-gerando-video')?.remove();
        _adicionarMensagemZeca('zeca', 'Deu erro gerando o vídeo. Tenta de novo?');
      }
    }
    if(data.tipo === 'executar_codigo'){
      const rodando = document.createElement('div');
      rodando.className = 'zeca-msg zeca-msg-zeca';
      rodando.id = 'zeca-rodando-codigo';
      rodando.textContent = '⚙️ Rodando código...';
      document.getElementById('zeca-mensagens').appendChild(rodando);
      document.getElementById('zeca-mensagens').scrollTop = 999999;

      try{
        const resultadoCodigo = await _executarCodigoViaZeca(data.codigo, data.linguagem, token);
        document.getElementById('zeca-rodando-codigo')?.remove();
        if(resultadoCodigo.error){
          _adicionarMensagemZeca('zeca', resultadoCodigo.error);
        } else {
          _renderizarResultadoCodigoZeca(resultadoCodigo);
          const resumoCodigo = `[Rodei esse código em ${data.linguagem}. Status: ${resultadoCodigo.status}. ${resultadoCodigo.stdout ? 'Saída: ' + resultadoCodigo.stdout.slice(0, 400) : ''}${resultadoCodigo.stderr ? ' Erro: ' + resultadoCodigo.stderr.slice(0, 400) : ''}]`;
          _zecaRegistrarHistoricoSilencioso('zeca', resumoCodigo);
          _zecaSalvarTrocaEspecial(mensagemParaEnviar, resumoCodigo, token);
        }
      } catch(eCod){
        console.error(eCod);
        document.getElementById('zeca-rodando-codigo')?.remove();
        _adicionarMensagemZeca('zeca', 'Deu erro rodando o código. Tenta de novo?');
      }
    }
    if(data.tipo === 'mudar_codigo'){
      const propondo = document.createElement('div');
      propondo.className = 'zeca-msg zeca-msg-zeca';
      propondo.id = 'zeca-propondo-codigo';
      propondo.textContent = `🔧 Preparando alteração em ${data.caminhoArquivo}...`;
      document.getElementById('zeca-mensagens').appendChild(propondo);
      document.getElementById('zeca-mensagens').scrollTop = 999999;

      try{
        const resultadoMudanca = await _mudarCodigoViaZeca(data.caminhoArquivo, data.instrucaoCodigo, token);
        document.getElementById('zeca-propondo-codigo')?.remove();
        if(resultadoMudanca.error){
          _adicionarMensagemZeca('zeca', resultadoMudanca.error);
        } else if(resultadoMudanca.resposta){
          _adicionarMensagemZeca('zeca', resultadoMudanca.resposta);
        } else {
          _adicionarMensagemZeca('zeca', 'Não consegui preparar essa mudança agora. Tenta de novo?');
        }
      } catch(eCodigo){
        console.error(eCodigo);
        document.getElementById('zeca-propondo-codigo')?.remove();
        _adicionarMensagemZeca('zeca', 'Deu erro tentando preparar essa mudança de código. Tenta de novo?');
      }
    }
  } catch(e){
    console.error(e);
    document.getElementById('zeca-digitando')?.remove();
    _adicionarMensagemZeca('zeca', 'Deu ruim de conexão aqui. Tenta de novo?');
  } finally {
    input.disabled = false;
    input.focus();
  }
}