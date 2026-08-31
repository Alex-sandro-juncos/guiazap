// ============================================================
// Sininho de notificações — módulo compartilhado.
// Inclua <script src="js/notificacoes.js"></script> na página e
// chame initNotificacoes({ supabaseClient, userId, empresaIds })
// depois que o login da página terminar de resolver.
// ============================================================

let _notifConfig = null;
let _notifCarregando = false;

function _notifInjetarUI(){
  let btn = document.getElementById('sino-notificacoes');
  const jaExistiaManual = !!btn;

  if(btn){
    // Já existe um botão colocado manualmente na própria página (ex: chat.html) —
    // só liga o comportamento de clique nele, sem mexer na posição
    btn.onclick = toggleNotificacoes;
  } else {
    btn = document.createElement('button');
    btn.id = 'sino-notificacoes';
    btn.title = 'Notificações';
    btn.innerHTML = '🔔<span class="badge-notif" id="badge-notif" style="display:none;">0</span>';
    btn.onclick = toggleNotificacoes;

    const btnModoEscuro = document.getElementById('btn-modo-escuro');
    if(btnModoEscuro && btnModoEscuro.parentNode){
      // Coloca o sino do lado do botão de modo escuro, numa linha só
      const linha = document.createElement('div');
      linha.id = 'notif-linha-topo';
      btnModoEscuro.parentNode.insertBefore(linha, btnModoEscuro);
      btnModoEscuro.style.margin = '0';
      linha.appendChild(btn);
      linha.appendChild(btnModoEscuro);
    } else {
      // Não achou o botão de modo escuro nessa página — mantém flutuando, como fallback
      btn.classList.add('sino-flutuante-fallback');
      document.body.appendChild(btn);
    }
  }

  if(document.getElementById('painel-notificacoes')) return;

  const painel = document.createElement('div');
  painel.id = 'painel-notificacoes';
  painel.innerHTML = `
    <div class="painel-notif-titulo">🔔 Notificações</div>
    <div id="lista-notificacoes"><div class="notif-vazio">Carregando...</div></div>
  `;
  document.body.appendChild(painel);

  const overlay = document.createElement('div');
  overlay.id = 'overlay-notificacoes';
  overlay.onclick = fecharNotificacoes;
  document.body.appendChild(overlay);

  const style = document.createElement('style');
  style.textContent = `
    #notif-linha-topo {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 8px;
    }
    #sino-notificacoes {
      position: relative;
      background: white;
      border: 1.5px solid var(--line, #d8cdb6);
      color: #555;
      border-radius: 50px;
      padding: 6px 12px;
      font-size: 0.95rem;
      cursor: pointer;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    }
    #sino-notificacoes:hover { background: #f5f5f5; }
    body.dark-mode #sino-notificacoes { background: #333; border-color: #555; color: #ddd; }
    #sino-notificacoes.sino-flutuante-fallback {
      position: fixed;
      top: 14px;
      right: 14px;
      z-index: 9998;
      border-radius: 50%;
      width: 42px;
      height: 42px;
      padding: 0;
      box-shadow: 0 2px 10px rgba(0,0,0,0.25);
    }
    #sino-notificacoes .badge-notif {
      position: absolute;
      top: -4px;
      right: -2px;
      background: #e05d5d;
      color: white;
      font-size: 0.62rem;
      font-weight: 800;
      min-width: 17px;
      height: 17px;
      border-radius: 50px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 3px;
      border: 2px solid white;
    }
    #overlay-notificacoes {
      display: none;
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.35);
      z-index: 9998;
    }
    #overlay-notificacoes.aberto { display: block; }
    #painel-notificacoes {
      display: none;
      position: fixed;
      top: 60px;
      right: 14px;
      left: 14px;
      max-width: 380px;
      margin-left: auto;
      background: white;
      border-radius: 14px;
      box-shadow: 0 8px 28px rgba(0,0,0,0.25);
      z-index: 9999;
      max-height: 70vh;
      overflow-y: auto;
    }
    #painel-notificacoes.aberto { display: block; }
    body.dark-mode #painel-notificacoes { background: #1e1e1e; }
    .painel-notif-titulo {
      font-weight: 800;
      font-size: 0.95rem;
      padding: 14px 16px 10px;
      border-bottom: 1px solid #eee;
      color: #1c1c1c;
    }
    body.dark-mode .painel-notif-titulo { color: #f0f0f0; border-bottom-color: #333; }
    .notif-item {
      display: block;
      width: 100%;
      text-align: left;
      background: none;
      border: none;
      border-bottom: 1px solid #f2f2f2;
      padding: 12px 16px;
      cursor: pointer;
      font-size: 0.85rem;
      color: #333;
    }
    .notif-item:hover { background: #f7f7f7; }
    body.dark-mode .notif-item { color: #ddd; border-bottom-color: #2a2a2a; }
    body.dark-mode .notif-item:hover { background: #262626; }
    .notif-item .notif-preview { color: #888; font-size: 0.78rem; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .notif-item .notif-data { color: #aaa; font-size: 0.68rem; margin-top: 3px; }
    .notif-item.notif-nao-lida { background: #eef8f4; }
    body.dark-mode .notif-item.notif-nao-lida { background: #12261f; }
    .notif-vazio { text-align: center; padding: 30px 16px; color: #999; font-size: 0.82rem; }

    #popup-chamada-overlay {
      display: none;
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.75);
      z-index: 100000;
      align-items: center;
      justify-content: center;
    }
    #popup-chamada-overlay.aberto { display: flex; }
    .popup-chamada-caixa {
      background: white;
      border-radius: 18px;
      padding: 30px 26px;
      text-align: center;
      width: 90%;
      max-width: 320px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.4);
    }
    body.dark-mode .popup-chamada-caixa { background: #1e1e1e; color: white; }
    .popup-chamada-icone { font-size: 2.6rem; margin-bottom: 8px; animation: popupChamadaTremer 1s infinite; }
    @keyframes popupChamadaTremer {
      0%, 100% { transform: rotate(0deg); }
      25% { transform: rotate(-12deg); }
      75% { transform: rotate(12deg); }
    }
    .popup-chamada-botoes { display: flex; justify-content: center; gap: 26px; margin-top: 22px; }
    .popup-chamada-botoes button {
      width: 58px; height: 58px; border-radius: 50%; border: none; font-size: 1.5rem; cursor: pointer; color: white;
    }
    .popup-chamada-recusar { background: #e05d5d; }
    .popup-chamada-aceitar { background: #25D366; }
  `;
  document.head.appendChild(style);
}

async function initNotificacoes(config){
  _notifConfig = config;
  _notifInjetarUI();
  if(!config.userId) return;
  await carregarNotificacoes();
  setInterval(carregarNotificacoes, 30000);
  if(config.escutarChamadas) _iniciarEscutaChamadas();
}

// ---------- CHAMADA ENTRANDO (fora do chat.html) ----------
// Escuta o mesmo canal que o chat.html usa pra chamadas. Se uma oferta
// chegar enquanto a pessoa está no GuiaZap ou na Agenda (não dentro do
// Papo), mostra um popup de chamada tocando, igual telefone de verdade.
// Ao aceitar, guarda a oferta e manda pro chat.html terminar de atender.

let _chamadaCanalListener = null;
let _chamadaPayloadPendente = null;
let _chamadaContextoAudio = null;
let _chamadaIntervaloSom = null;

function _iniciarEscutaChamadas(){
  if(!_notifConfig || !_notifConfig.userId || _chamadaCanalListener) return;
  const { supabaseClient, userId } = _notifConfig;

  _chamadaCanalListener = supabaseClient.channel('chamada-user-' + userId, { config: { broadcast: { self: false } } });
  _chamadaCanalListener.on('broadcast', { event: 'offer' }, (msg) => {
    _mostrarPopupChamadaEntrando(msg.payload);
  });
  _chamadaCanalListener.on('broadcast', { event: 'encerrar' }, () => {
    // Quem ligou cancelou/desligou antes de eu atender — fecha o popup e
    // para o som, senão ele fica tocando pra sempre sem ninguém do outro lado
    _pararSomChamadaPopup();
    const overlay = document.getElementById('popup-chamada-overlay');
    if(overlay) overlay.classList.remove('aberto');
    _chamadaPayloadPendente = null;
  });
  _chamadaCanalListener.on('broadcast', { event: 'aceito_em_outro_lugar' }, () => {
    // A chamada já foi atendida em outra aba/tela aberta com a mesma conta
    // (ex: o Papo estava aberto junto) — para de tocar esse popup também
    _pararSomChamadaPopup();
    const overlay = document.getElementById('popup-chamada-overlay');
    if(overlay) overlay.classList.remove('aberto');
    _chamadaPayloadPendente = null;
  });
  _chamadaCanalListener.subscribe();
}

function _notifInjetarPopupChamada(){
  if(document.getElementById('popup-chamada-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'popup-chamada-overlay';
  overlay.innerHTML = `
    <div class="popup-chamada-caixa">
      <div class="popup-chamada-icone">📞</div>
      <div id="popup-chamada-nome" style="font-weight:800; font-size:1.15rem;"></div>
      <div id="popup-chamada-tipo" style="color:#888; font-size:0.85rem; margin-top:4px;"></div>
      <div class="popup-chamada-botoes">
        <button class="popup-chamada-recusar" onclick="_recusarChamadaPopup()" title="Recusar">✕</button>
        <button class="popup-chamada-aceitar" onclick="_aceitarChamadaPopup()" title="Atender">✓</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function _mostrarPopupChamadaEntrando(payload){
  _chamadaPayloadPendente = payload;
  _notifInjetarPopupChamada();
  document.getElementById('popup-chamada-nome').textContent = payload.deNome || 'Alguém';
  document.getElementById('popup-chamada-tipo').textContent = payload.comVideo ? '📹 Chamada de vídeo pelo Papo' : '📞 Chamada de voz pelo Papo';
  document.getElementById('popup-chamada-overlay').classList.add('aberto');
  _tocarSomChamadaPopup();
}

function _tocarBipPopup(frequencia, duracaoMs, volume){
  try{
    if(!_chamadaContextoAudio) _chamadaContextoAudio = new (window.AudioContext || window.webkitAudioContext)();
    if(_chamadaContextoAudio.state === 'suspended') _chamadaContextoAudio.resume();
    const osc = _chamadaContextoAudio.createOscillator();
    const gain = _chamadaContextoAudio.createGain();
    osc.connect(gain);
    gain.connect(_chamadaContextoAudio.destination);
    osc.frequency.value = frequencia;
    gain.gain.value = volume;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, _chamadaContextoAudio.currentTime + duracaoMs / 1000);
    osc.stop(_chamadaContextoAudio.currentTime + duracaoMs / 1000);
  } catch(e){ console.error('erro ao tocar som de chamada', e); }
}

function _tocarSomChamadaPopup(){
  _pararSomChamadaPopup();
  if(localStorage.getItem('modo_vibracao_chamada') !== '1'){
    _chamadaIntervaloSom = setInterval(() => {
      _tocarBipPopup(880, 400, 0.25);
      setTimeout(() => _tocarBipPopup(1046, 400, 0.25), 450);
    }, 1800);
  }
  if(navigator.vibrate) navigator.vibrate([400, 200, 400]);
}

function _pararSomChamadaPopup(){
  if(_chamadaIntervaloSom){ clearInterval(_chamadaIntervaloSom); _chamadaIntervaloSom = null; }
  if(navigator.vibrate) navigator.vibrate(0);
}

async function _recusarChamadaPopup(){
  _pararSomChamadaPopup();
  const overlay = document.getElementById('popup-chamada-overlay');
  if(overlay) overlay.classList.remove('aberto');

  if(_chamadaPayloadPendente && _notifConfig){
    try{
      const canal = _notifConfig.supabaseClient.channel('chamada-user-' + _chamadaPayloadPendente.de, { config: { broadcast: { self: false } } });
      await canal.subscribe();
      canal.send({ type: 'broadcast', event: 'encerrar', payload: { de: _notifConfig.userId } });
      setTimeout(() => _notifConfig.supabaseClient.removeChannel(canal), 1200);
    } catch(e){ console.error(e); }
  }
  _chamadaPayloadPendente = null;
}

function _aceitarChamadaPopup(){
  _pararSomChamadaPopup();
  if(!_chamadaPayloadPendente) return;

  // Avisa outras abas/telas abertas com a mesma conta (ex: uma aba do Papo
  // separada) que a chamada já vai ser atendida aqui
  if(_chamadaCanalListener){
    _chamadaCanalListener.send({ type: 'broadcast', event: 'aceito_em_outro_lugar', payload: {} });
  }

  sessionStorage.setItem('chamada_pendente_offer', JSON.stringify(_chamadaPayloadPendente));
  window.location.href = 'chat.html?atenderPendente=1';
}

function toggleNotificacoes(){
  const painel = document.getElementById('painel-notificacoes');
  const overlay = document.getElementById('overlay-notificacoes');
  const abrindo = !painel.classList.contains('aberto');
  painel.classList.toggle('aberto', abrindo);
  overlay.classList.toggle('aberto', abrindo);
}

function fecharNotificacoes(){
  document.getElementById('painel-notificacoes').classList.remove('aberto');
  document.getElementById('overlay-notificacoes').classList.remove('aberto');
}

function _notifTempoAtras(dataStr){
  const diffMs = Date.now() - new Date(dataStr).getTime();
  const min = Math.floor(diffMs / 60000);
  if(min < 1) return 'agora';
  if(min < 60) return `${min} min atrás`;
  const h = Math.floor(min / 60);
  if(h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  return `${d}d atrás`;
}

function _notifEscapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function _notifUltimaChecagem(chave){
  const salvo = localStorage.getItem('notif_ultima_checagem_' + chave);
  return salvo ? new Date(salvo) : new Date(Date.now() - 24 * 60 * 60 * 1000);
}

async function carregarNotificacoes(){
  if(_notifCarregando || !_notifConfig || !_notifConfig.userId) return;
  _notifCarregando = true;

  const { supabaseClient, userId, empresaIds } = _notifConfig;
  const itens = [];

  try{
    // ---------- MENSAGENS NÃO LIDAS DO PAPO ----------
    const idsEmpresa = empresaIds || [];

    const { data: comoParticipante } = await supabaseClient.from('conversas').select('id, profissional_id, visitante_user_id, usuario2_id').or(`visitante_user_id.eq.${userId},usuario2_id.eq.${userId}`);
    let comoEmpresa = [];
    if(idsEmpresa.length > 0){
      const { data } = await supabaseClient.from('conversas').select('id, profissional_id, visitante_user_id, usuario2_id').in('profissional_id', idsEmpresa);
      comoEmpresa = data || [];
    }
    const mapaConv = {};
    [...(comoParticipante || []), ...comoEmpresa].forEach(c => { mapaConv[c.id] = c; });
    const conversas = Object.values(mapaConv);

    if(conversas.length > 0){
      const { data: naoLidas } = await supabaseClient
        .from('mensagens_chat')
        .select('id, conversa_id, remetente_user_id, tipo, texto, created_at')
        .in('conversa_id', conversas.map(c => c.id))
        .eq('lida', false)
        .neq('remetente_user_id', userId)
        .order('created_at', { ascending: false });

      // Agrupa por conversa, pega só a mais recente de cada uma
      const jaVistoConversa = new Set();
      for(const m of (naoLidas || [])){
        if(jaVistoConversa.has(m.conversa_id)) continue;
        jaVistoConversa.add(m.conversa_id);

        const conversa = conversas.find(c => c.id === m.conversa_id);
        if(!conversa) continue;

        const souEuAEmpresa = idsEmpresa.includes(conversa.profissional_id);
        let nome, link;
        if(conversa.usuario2_id){
          const outroId = conversa.visitante_user_id === userId ? conversa.usuario2_id : conversa.visitante_user_id;
          const { data: perfil } = await supabaseClient.from('perfis_usuario').select('nome_exibicao').eq('user_id', outroId).maybeSingle();
          nome = (perfil && perfil.nome_exibicao) || 'Contato do GuiaZap';
          link = `chat.html?pessoa=${outroId}`;
        } else if(conversa.profissional_id){
          if(souEuAEmpresa){
            const { data: empresaDoVisitante } = await supabaseClient.from('profissionais').select('name').eq('user_id', conversa.visitante_user_id).limit(1).maybeSingle();
            if(empresaDoVisitante){
              nome = empresaDoVisitante.name;
            } else {
              const { data: perfilVisitante } = await supabaseClient.from('perfis_usuario').select('nome_exibicao').eq('user_id', conversa.visitante_user_id).maybeSingle();
              nome = (perfilVisitante && perfilVisitante.nome_exibicao) || 'Um visitante';
            }
          } else {
            const { data: empresa } = await supabaseClient.from('profissionais').select('name').eq('id', conversa.profissional_id).maybeSingle();
            nome = (empresa && empresa.name) || 'Empresa';
          }
          link = `chat.html?empresa=${conversa.profissional_id}`;
        }
        if(!nome) continue;

        let preview = '💬 mensagem';
        if(m.tipo === 'texto') preview = m.texto;
        else if(m.tipo === 'imagem') preview = '📷 Foto';
        else if(m.tipo === 'audio') preview = '🎤 Áudio';
        else if(m.tipo === 'chamada_perdida') preview = '📞 Chamada perdida';
        else if(m.tipo === 'chamada_atendida') preview = '📞 Chamada';

        itens.push({ tipo: 'mensagem', titulo: `💬 Mensagem de ${nome}`, preview, data: m.created_at, link, naoLida: true });
      }
    }

    // Itens abaixo só existem pra quem tem empresa
    if(idsEmpresa.length > 0){
      // ---------- NOVAS AVALIAÇÕES ----------
      const ultimaAval = _notifUltimaChecagem('avaliacoes');
      const { data: avaliacoes } = await supabaseClient.from('avaliacoes').select('id, profissional_id, nota, comentario, created_at').in('profissional_id', idsEmpresa).gt('created_at', ultimaAval.toISOString()).order('created_at', { ascending: false });
      (avaliacoes || []).forEach(a => {
        itens.push({ tipo: 'avaliacao', titulo: `⭐ Nova avaliação (${a.nota}/5)`, preview: a.comentario || 'Sem comentário', data: a.created_at, link: `index.html?p=${a.profissional_id}`, naoLida: true });
      });

      // ---------- MENSAGENS RECEBIDAS (RECLAMAÇÃO/SUGESTÃO) ----------
      const ultimaMsgEmpresa = _notifUltimaChecagem('mensagens_empresa');
      const { data: msgsEmpresa } = await supabaseClient.from('mensagens_empresa').select('id, profissional_id, tipo, mensagem, created_at').in('profissional_id', idsEmpresa).gt('created_at', ultimaMsgEmpresa.toISOString()).order('created_at', { ascending: false });
      (msgsEmpresa || []).forEach(m => {
        itens.push({ tipo: 'mensagem_empresa', titulo: m.tipo === 'reclamacao' ? '⚠️ Nova reclamação recebida' : '💡 Nova sugestão recebida', preview: m.mensagem, data: m.created_at, link: `index.html?p=${m.profissional_id}`, naoLida: true });
      });

      // ---------- DENÚNCIAS RECEBIDAS ----------
      const ultimaDenuncia = _notifUltimaChecagem('denuncias');
      const { data: denuncias } = await supabaseClient.from('denuncias').select('id, profissional_id, motivo, created_at').in('profissional_id', idsEmpresa).gt('created_at', ultimaDenuncia.toISOString()).order('created_at', { ascending: false });
      (denuncias || []).forEach(d => {
        itens.push({ tipo: 'denuncia', titulo: '🚩 Sua empresa recebeu uma denúncia', preview: d.motivo, data: d.created_at, link: `index.html?p=${d.profissional_id}`, naoLida: true });
      });
    }
  } catch(e){
    console.error('erro ao carregar notificações', e);
  }

  itens.sort((a, b) => new Date(b.data) - new Date(a.data));
  _notifRenderizar(itens.slice(0, 30));
  _notifCarregando = false;
}

function _notifRenderizar(itens){
  const badge = document.getElementById('badge-notif');
  const lista = document.getElementById('lista-notificacoes');
  if(!badge || !lista) return;

  const naoLidas = itens.filter(i => i.naoLida).length;
  if(naoLidas > 0){
    badge.textContent = naoLidas > 9 ? '9+' : naoLidas;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }

  if(itens.length === 0){
    lista.innerHTML = '<div class="notif-vazio">Nenhuma notificação por aqui ainda.</div>';
    return;
  }

  lista.innerHTML = itens.map((item, i) => `
    <button type="button" class="notif-item${item.naoLida ? ' notif-nao-lida' : ''}" onclick="_notifClicar(${i})">
      <div>${_notifEscapeHtml(item.titulo)}</div>
      <div class="notif-preview">${_notifEscapeHtml(item.preview || '')}</div>
      <div class="notif-data">${_notifTempoAtras(item.data)}</div>
    </button>
  `).join('');

  window._notifItensAtuais = itens;
}

function _notifClicar(i){
  const item = window._notifItensAtuais[i];
  if(!item) return;

  // Marca essa categoria como vista (evita repetir a mesma notificação de novo)
  if(item.tipo !== 'mensagem'){
    const chave = item.tipo === 'avaliacao' ? 'avaliacoes' : item.tipo === 'mensagem_empresa' ? 'mensagens_empresa' : 'denuncias';
    localStorage.setItem('notif_ultima_checagem_' + chave, new Date().toISOString());
  }

  fecharNotificacoes();
  window.location.href = item.link;
}