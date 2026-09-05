let supabaseClientVagas;
let vagas = [];
let filtroHomeOfficeAtivo = false;
let filtroSemExperienciaAtivo = false;

function toggleFiltroHomeOffice(){
  filtroHomeOfficeAtivo = !filtroHomeOfficeAtivo;
  document.getElementById('chip-home-office-vaga').classList.toggle('ativo', filtroHomeOfficeAtivo);
  renderVagas();
}

function toggleFiltroSemExperiencia(){
  filtroSemExperienciaAtivo = !filtroSemExperienciaAtivo;
  document.getElementById('chip-sem-experiencia-vaga').classList.toggle('ativo', filtroSemExperienciaAtivo);
  renderVagas();
}
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

  vagas.sort((a, b) => {
    const premiumA = a.profissionais && a.profissionais.plano === 'premium' ? 1 : 0;
    const premiumB = b.profissionais && b.profissionais.plano === 'premium' ? 1 : 0;
    return premiumB - premiumA;
  });

  popularFiltrosVaga();

  const params = new URLSearchParams(window.location.search);
  vagaFiltroId = params.get('id');

  renderVagas();
}

function popularFiltrosVaga(){
  // mantém filtros se existirem no HTML
}

function renderVagas(){
  const grid = document.getElementById('v-grid-vaga');
  if(!grid) return;

  let lista = vagas.slice();

  if(filtroHomeOfficeAtivo) lista = lista.filter(v => v.home_office);
  if(filtroSemExperienciaAtivo) lista = lista.filter(v => v.sem_experiencia);

  const buscaEl = document.getElementById('v-busca-vaga');
  if(buscaEl && buscaEl.value.trim()){
    const q = normalizarTextoVagas(buscaEl.value);
    lista = lista.filter(v =>
      normalizarTextoVagas(v.titulo).includes(q) ||
      normalizarTextoVagas(v.descricao).includes(q) ||
      normalizarTextoVagas(v.profissionais && v.profissionais.name).includes(q)
    );
  }

  if(vagaFiltroId){
    lista = lista.filter(v => v.id === vagaFiltroId);
  }

  if(lista.length === 0){
    grid.innerHTML = '<div class="vazio-vitrine">Nenhuma vaga encontrada no momento.</div>';
    return;
  }

  grid.innerHTML = lista.map(v => {
    const empresa = v.profissionais ? escapeHtmlVagas(v.profissionais.name) : '';
    const wa = v.profissionais && v.profissionais.whatsapp ? v.profissionais.whatsapp.replace(/\D/g, '') : '';
    const premium = v.profissionais && v.profissionais.plano === 'premium';
    const podeExcluir = currentUserVagas && meusCadastrosVagas.some(c => c.id === v.profissional_id);

    return `
      <div class="card-vaga${premium ? ' card-premium' : ''}">
        <div class="card-vaga-titulo">${escapeHtmlVagas(v.titulo)}</div>
        <div class="card-vaga-meta">${empresa}${v.tipo ? ' · ' + escapeHtmlVagas(v.tipo) : ''}</div>
        ${v.salario ? `<div class="card-vaga-salario">💰 ${escapeHtmlVagas(v.salario)}</div>` : ''}
        <div class="card-vaga-tags">
          ${v.home_office ? '<span class="tag-vaga">🏠 Home office</span>' : ''}
          ${v.sem_experiencia ? '<span class="tag-vaga">🔰 Sem experiência</span>' : ''}
        </div>
        ${v.descricao ? `<div class="card-vaga-desc">${escapeHtmlVagas(v.descricao)}</div>` : ''}
        ${v.requisitos ? `<div class="card-vaga-req"><b>Requisitos:</b> ${escapeHtmlVagas(v.requisitos)}</div>` : ''}
        <div class="card-vaga-acoes">
          ${wa ? `<a class="btn-whats" href="https://wa.me/55${wa}?text=${encodeURIComponent('Olá! Vi a vaga de ' + v.titulo + ' no GuiaZap e tenho interesse.')}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
          ${podeExcluir ? `<button type="button" class="btn-cancelar" onclick="excluirVaga('${v.id}')">Excluir</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function formatarValorVaga(event){
  let v = event.target.value.replace(/\D/g, '');
  if(!v){ event.target.value = ''; return; }
  v = (parseInt(v, 10) / 100).toFixed(2) + '';
  v = v.replace('.', ',');
  v = v.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  event.target.value = v;
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
  const ho = document.getElementById('vg-home-office');
  const se = document.getElementById('vg-sem-experiencia');
  if(ho) ho.checked = false;
  if(se) se.checked = false;
  const msg = document.getElementById('vg-msg');
  if(msg) msg.textContent = '';
}

async function salvarVaga(e){
  if(e && e.preventDefault) e.preventDefault();
  const msg = document.getElementById('vg-msg');

  const payload = {
    profissional_id: document.getElementById('vg-profissional').value,
    titulo: document.getElementById('vg-titulo').value.trim(),
    tipo: document.getElementById('vg-tipo').value,
    descricao: document.getElementById('vg-descricao').value.trim() || null,
    requisitos: document.getElementById('vg-requisitos').value.trim() || null,
    salario: document.getElementById('vg-salario').value.trim() || null,
    home_office: document.getElementById('vg-home-office').checked,
    sem_experiencia: document.getElementById('vg-sem-experiencia').checked
  };

  if(!payload.titulo || !payload.profissional_id){ msg.textContent = 'Preencha o cargo da vaga.'; return false; }

  msg.textContent = 'publicando...';
  const { error } = await supabaseClientVagas.from('vagas').insert(payload);
  if(error){ console.error(error); msg.textContent = 'erro ao publicar vaga'; return false; }

  msg.textContent = 'vaga publicada!';
  await loadVagas();
  setTimeout(fecharFormVaga, 1200);

  fetch('/.netlify/functions/enviar-push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      titulo: '💼 Nova vaga no GuiaZap!',
      mensagem: payload.titulo,
      url: '/vagas.html',
      userIds: 'todos'
    })
  }).catch(err => console.error('erro ao enviar push', err));

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
  d.textContent = str || '';
  return d.innerHTML;
}

if(initSupabaseVagas()){
  initAuthVagas().then(loadVagas);
}

// ---------- MODO VOZ: PUBLICAR VAGA POR VOZ (fluxo guiado) ----------
let _vozVagasReconhecimento = null;
let _vozVagasAtiva = false;
let _vozVagasFalando = false;
const _vozVagasSynth = window.speechSynthesis;
let _estadoVozVagas = null;

function normalizarVozVagas(str){
  return (str || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function toggleModoVozVagas(){
  if(_vozVagasAtiva) pararModoVozVagas();
  else iniciarModoVozVagas();
}

let _aguardandoAtivacaoVagas = false;
let _vozVagasUltimoSinalDeVida = 0;
let _vozVagasVigia = null;
let _vozVagasTentativasReconexao = 0;

function iniciarModoVozVagas(retomandoAutomaticamente){
  const SpeechRecognitionApi = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SpeechRecognitionApi){
    alert('Seu navegador não suporta reconhecimento de voz. Tenta pelo Chrome no celular ou computador.');
    return;
  }
  if(!currentUserVagas){
    alert('Faça login na página inicial pra publicar vaga por voz.');
    return;
  }
  if(meusCadastrosVagas.length === 0){
    alert('Você precisa ter um cadastro ativo no GuiaZap pra publicar vaga.');
    return;
  }

  _vozVagasAtiva = true;
  document.getElementById('btn-modo-voz-vagas').style.background = '#a4402f';
  document.getElementById('btn-modo-voz-vagas').setAttribute('aria-label', 'Desativar modo voz');
  document.getElementById('painel-modo-voz-vagas').style.display = 'block';
  document.getElementById('voz-vagas-transcricao').textContent = '';
  _aguardandoAtivacaoVagas = !!retomandoAutomaticamente;
  _vozVagasTentativasReconexao = 0;

  if(_aguardandoAtivacaoVagas){
    // Não abre o formulário nem começa a perguntar nada até ouvir a
    // palavra de ativação — só entra no fluxo de publicar vaga de propósito
    document.getElementById('voz-vagas-status').textContent = '🎙️ Modo voz em espera';
  } else {
    _estadoVozVagas = { etapa: 'titulo', rascunho: '', dados: {} };
    document.getElementById('voz-vagas-status').textContent = '🎙️ Modo voz ativado';
    abrirFormVaga();
  }

  _criarReconhecimentoVagas(SpeechRecognitionApi);
  _iniciarVigiaVozVagas(SpeechRecognitionApi);
  if(typeof iniciarBiometriaSeConfigurada === 'function') iniciarBiometriaSeConfigurada();
  if(_aguardandoAtivacaoVagas){
    falarVozVagas('Modo voz em espera. Fala "ativar" pra publicar uma vaga.');
  } else {
    falarVozVagas('Modo voz ativado. Vamos publicar uma vaga juntos. Qual o cargo ou título da vaga?');
  }
}

function _criarReconhecimentoVagas(SpeechRecognitionApi){
  _vozVagasReconhecimento = new SpeechRecognitionApi();
  _vozVagasReconhecimento.lang = 'pt-BR';
  _vozVagasReconhecimento.continuous = true;
  _vozVagasReconhecimento.interimResults = false;

  _vozVagasReconhecimento.onstart = () => {
    _vozVagasUltimoSinalDeVida = Date.now();
    _vozVagasTentativasReconexao = 0;
  };

  _vozVagasReconhecimento.onresult = (event) => {
    _vozVagasUltimoSinalDeVida = Date.now();
    if(!_vozVagasAtiva) return;
    const ultimo = event.results[event.results.length - 1];
    if(!ultimo || !ultimo.isFinal) return;
    const transcricao = (ultimo[0] && ultimo[0].transcript || '').trim();
    if(!transcricao) return;
    document.getElementById('voz-vagas-transcricao').textContent = '🗣️ "' + transcricao + '"';

    if(_aguardandoAtivacaoVagas){
      const t = normalizarTextoVagas(transcricao);
      if(t.includes('ativar') || t.includes('guiazap')){
        _aguardandoAtivacaoVagas = false;
        _estadoVozVagas = { etapa: 'titulo', rascunho: '', dados: {} };
        abrirFormVaga();
        falarVozVagas('Modo voz ativado. Vamos publicar uma vaga. Qual o cargo?');
      }
      return;
    }

    processarComandoVozVagas(transcricao);
  };

  _vozVagasReconhecimento.onend = () => {
    _vozVagasUltimoSinalDeVida = Date.now();
    if(_vozVagasAtiva && !_vozVagasFalando){
      try{ _vozVagasReconhecimento.start(); } catch(e){}
    }
  };

  _vozVagasReconhecimento.onerror = (event) => {
    if(event.error === 'not-allowed'){
      alert('Você precisa permitir o uso do microfone pra usar o modo voz.');
      pararModoVozVagas();
      return;
    }
    _vozVagasUltimoSinalDeVida = Date.now();
  };

  try{ _vozVagasReconhecimento.start(); } catch(e){}
  _vozVagasUltimoSinalDeVida = Date.now();
}

function _iniciarVigiaVozVagas(SpeechRecognitionApi){
  clearInterval(_vozVagasVigia);
  _vozVagasVigia = setInterval(() => {
    if(!_vozVagasAtiva){ clearInterval(_vozVagasVigia); return; }
    if(_vozVagasFalando) return;

    const semSinalHa = Date.now() - _vozVagasUltimoSinalDeVida;
    if(semSinalHa > 8000){
      _vozVagasTentativasReconexao++;
      console.warn('modo voz de Vagas parece ter travado, recriando (tentativa ' + _vozVagasTentativasReconexao + ')');
      try{ _vozVagasReconhecimento.onend = null; _vozVagasReconhecimento.onerror = null; _vozVagasReconhecimento.stop(); } catch(e){}
      _criarReconhecimentoVagas(SpeechRecognitionApi);

      if(_vozVagasTentativasReconexao === 2){
        falarVozVagas('O microfone parou de responder. Reconectando...');
      }
    }
  }, 4000);
}

function pararModoVozVagas(){
  _vozVagasAtiva = false;
  _estadoVozVagas = null;
  clearInterval(_vozVagasVigia);
  if(typeof pararBiometriaSeAtiva === 'function') pararBiometriaSeAtiva();
  if(_vozVagasReconhecimento){
    _vozVagasReconhecimento.onresult = null;
    _vozVagasReconhecimento.onend = null;
    _vozVagasReconhecimento.onerror = null;
    try{ _vozVagasReconhecimento.abort(); } catch(e){}
    _vozVagasReconhecimento = null;
  }
  if(_vozVagasSynth) _vozVagasSynth.cancel();
  const btn = document.getElementById('btn-modo-voz-vagas');
  if(btn){
    btn.style.background = '#6b46c1';
    btn.setAttribute('aria-label', 'Publicar vaga por voz, sem tocar na tela');
  }
  const painel = document.getElementById('painel-modo-voz-vagas');
  if(painel) painel.style.display = 'none';
  const ind = document.getElementById('voz-vagas-indicador');
  if(ind) ind.style.background = '#6b46c1';
}

function falarVozVagas(texto){
  if(!_vozVagasSynth) return;
  _vozVagasFalando = true;
  const ind = document.getElementById('voz-vagas-indicador');
  if(ind) ind.style.background = '#e05d5d';
  const status = document.getElementById('voz-vagas-status');
  if(status) status.textContent = '🔊 ' + texto;

  _vozVagasSynth.cancel();
  const fala = new SpeechSynthesisUtterance(texto);
  fala.lang = 'pt-BR';
  fala.rate = 1.0;
  fala.onend = () => {
    _vozVagasFalando = false;
    if(ind) ind.style.background = '#22c55e';
    if(status) status.textContent = '🎙️ Pode falar...';
    if(_vozVagasAtiva && _vozVagasReconhecimento){
      try{ _vozVagasReconhecimento.start(); } catch(e){}
    }
  };
  fala.onerror = () => {
    _vozVagasFalando = false;
    if(ind) ind.style.background = '#22c55e';
  };
  _vozVagasSynth.speak(fala);
}

function ehSimVagas(t){
  return t === 'sim' || t === 'isso' || t === 'certo' || t === 'confirma' || t === 'confirmar' || t === 'ok' || t === 'pode' || t.includes('esta certo') || t.includes('está certo');
}
function ehNaoVagas(t){
  return t === 'nao' || t === 'não' || t === 'errado' || t === 'corrigir' || t === 'de novo' || t === 'repetir';
}

async function processarComandoVozVagas(transcricao){
  if(!_estadoVozVagas || _vozVagasFalando) return;
  const t = normalizarVozVagas(transcricao);
  const estado = _estadoVozVagas;

  const _ehPararVg = t === 'cancelar' || t === 'parar' || t === 'sair' || t === 'desligar' || t.includes('cala boca') || t.includes('fica quieto') || t.includes('fique quieto');
  if(!_ehPararVg && typeof comandoDeVozAutorizado === 'function' && !comandoDeVozAutorizado()){
    return;
  }

  if(t === 'cancelar' || t === 'parar' || t === 'sair' || t === 'desligar' || t.includes('cala boca') || t.includes('fica quieto') || t.includes('fique quieto')){
    falarVozVagas('Modo voz desligado.');
    setTimeout(pararModoVozVagas, 1500);
    return;
  }

  if(estado.etapa === 'titulo'){
    estado.rascunho = transcricao.trim();
    estado.etapa = 'confirmar_titulo';
    falarVozVagas('Entendi o cargo: ' + estado.rascunho + '. Está certo? Fala sim ou não.');
    return;
  }
  if(estado.etapa === 'confirmar_titulo'){
    if(ehSimVagas(t)){
      estado.dados.titulo = estado.rascunho;
      document.getElementById('vg-titulo').value = estado.rascunho;
      estado.rascunho = '';
      estado.etapa = 'tipo';
      falarVozVagas('Cargo salvo. Qual o tipo de contrato? Fala: CLT, PJ, meio período, temporário, freelancer, estágio ou diarista.');
    } else if(ehNaoVagas(t)){
      estado.etapa = 'titulo';
      estado.rascunho = '';
      falarVozVagas('Tudo bem. Fala o cargo de novo.');
    } else {
      falarVozVagas('Não entendi. Fala sim se o cargo está certo, ou não para repetir.');
    }
    return;
  }

  if(estado.etapa === 'tipo'){
    let tipoLabel = 'CLT';
    if(t.includes('clt')) tipoLabel = 'CLT';
    else if(t.includes('pj') || t.includes('pessoa juridica') || t.includes('pessoa jurídica')) tipoLabel = 'PJ';
    else if(t.includes('meio') || t.includes('parcial')) tipoLabel = 'Meio período';
    else if(t.includes('tempor')) tipoLabel = 'Temporário';
    else if(t.includes('freelancer') || t.includes('free lancer') || t.includes('autonom')) tipoLabel = 'Freelancer';
    else if(t.includes('estagio') || t.includes('estágio')) tipoLabel = 'Estágio';
    else if(t.includes('diarista') || t.includes('diaria') || t.includes('diária')) tipoLabel = 'Diarista';
    estado.dados.tipo = tipoLabel;
    const sel = document.getElementById('vg-tipo');
    if(sel){
      for(const opt of sel.options){
        if(opt.value === tipoLabel || normalizarVozVagas(opt.value) === normalizarVozVagas(tipoLabel)){
          sel.value = opt.value;
          break;
        }
      }
    }
    estado.etapa = 'descricao';
    falarVozVagas('Tipo ' + tipoLabel + ' anotado. Agora descreva a vaga: o que a pessoa vai fazer no dia a dia. Quando terminar, fala pronto.');
    document.getElementById('vg-descricao').value = '';
    return;
  }

  if(estado.etapa === 'descricao'){
    if(t === 'pronto' || t === 'terminei' || t === 'finalizei' || t === 'pular'){
      const desc = document.getElementById('vg-descricao').value.trim();
      estado.dados.descricao = desc || null;
      estado.etapa = 'requisitos';
      document.getElementById('vg-requisitos').value = '';
      falarVozVagas('Descrição salva. Agora fala os requisitos, o que vocês procuram. Ou fala pular. Quando terminar, fala pronto.');
      return;
    }
    const campo = document.getElementById('vg-descricao');
    campo.value = (campo.value.trim() ? campo.value.trim() + ' ' : '') + transcricao.trim();
    falarVozVagas('Anotado. Continue ou fala pronto.');
    return;
  }

  if(estado.etapa === 'requisitos'){
    if(t === 'pronto' || t === 'terminei' || t === 'finalizei' || t === 'pular'){
      const req = document.getElementById('vg-requisitos').value.trim();
      estado.dados.requisitos = req || null;
      estado.etapa = 'salario';
      falarVozVagas('Requisitos salvos. Qual o salário? Fala o valor, ou fala a combinar, ou pular.');
      return;
    }
    const campo = document.getElementById('vg-requisitos');
    campo.value = (campo.value.trim() ? campo.value.trim() + ' ' : '') + transcricao.trim();
    falarVozVagas('Anotado. Continue ou fala pronto.');
    return;
  }

  if(estado.etapa === 'salario'){
    if(t === 'pular' || t === 'nao' || t === 'não'){
      estado.dados.salario = null;
      document.getElementById('vg-salario').value = '';
    } else if(t.includes('combinar')){
      estado.dados.salario = 'A combinar';
      document.getElementById('vg-salario').value = 'A combinar';
    } else {
      estado.dados.salario = transcricao.trim();
      document.getElementById('vg-salario').value = transcricao.trim();
    }
    estado.etapa = 'home_office';
    falarVozVagas('Salário anotado. A vaga é home office? Fala sim ou não.');
    return;
  }

  if(estado.etapa === 'home_office'){
    const sim = ehSimVagas(t);
    estado.dados.home_office = sim;
    document.getElementById('vg-home-office').checked = sim;
    estado.etapa = 'sem_experiencia';
    falarVozVagas((sim ? 'Home office sim. ' : 'Home office não. ') + 'Aceita candidato sem experiência? Fala sim ou não.');
    return;
  }

  if(estado.etapa === 'sem_experiencia'){
    const sim = ehSimVagas(t);
    estado.dados.sem_experiencia = sim;
    document.getElementById('vg-sem-experiencia').checked = sim;
    estado.etapa = 'confirmar_envio';
    const resumo = 'Vaga: ' + (estado.dados.titulo || '') +
      '. Tipo: ' + (estado.dados.tipo || '') +
      '. Home office: ' + (estado.dados.home_office ? 'sim' : 'não') +
      '. Sem experiência: ' + (sim ? 'sim' : 'não') +
      '. Quer publicar agora? Fala sim ou não.';
    falarVozVagas(resumo);
    return;
  }

  if(estado.etapa === 'confirmar_envio'){
    if(ehSimVagas(t) || t.includes('publicar') || t.includes('enviar')){
      falarVozVagas('Publicando a vaga. Um momento.');
      const sel = document.getElementById('vg-profissional');
      if(sel && !sel.value && meusCadastrosVagas.length > 0){
        sel.value = meusCadastrosVagas[0].id;
      }
      const fakeEvent = { preventDefault: function(){} };
      await salvarVaga(fakeEvent);
      const msgTxt = (document.getElementById('vg-msg').textContent || '');
      if(msgTxt.includes('publicada')){
        falarVozVagas('Vaga publicada com sucesso. Modo voz desligado.');
      } else {
        falarVozVagas('Houve um problema ao publicar. Os dados ficaram no formulário. Modo voz desligado.');
      }
      setTimeout(pararModoVozVagas, 3000);
    } else if(ehNaoVagas(t) || t.includes('cancelar')){
      falarVozVagas('Tudo bem. Os dados ficaram preenchidos no formulário. Você pode revisar e publicar quando quiser. Modo voz desligado.');
      setTimeout(pararModoVozVagas, 3000);
    } else {
      falarVozVagas('Não entendi. Fala sim pra publicar, ou não pra só deixar no formulário.');
    }
    return;
  }
}

window.addEventListener('pagehide', function(){
  if(_vozVagasAtiva){
    localStorage.setItem('retomarModoVozAoCarregar', '1');
  }
});

window.addEventListener('pageshow', function(event){
  if(event.persisted){
    if(_vozVagasReconhecimento){
      try{
        _vozVagasReconhecimento.onresult = null;
        _vozVagasReconhecimento.onend = null;
        _vozVagasReconhecimento.onerror = null;
        _vozVagasReconhecimento.abort();
      } catch(e){}
      _vozVagasReconhecimento = null;
    }
    clearInterval(_vozVagasVigia);
    _vozVagasAtiva = false;
    const btn = document.getElementById('btn-modo-voz-vagas');
    if(btn) btn.style.background = '#6b46c1';
    const painel = document.getElementById('painel-modo-voz-vagas');
    if(painel) painel.style.display = 'none';
  }
});