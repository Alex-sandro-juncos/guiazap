let _vozPapoReconhecimento = null;
let _vozPapoAtiva = false;
let _vozPapoFalando = false;
const _vozPapoSynth = window.speechSynthesis;
let _estadoVozPapo = { etapa: 'lista' }; // lista | conversa | ditando

function normalizarVozPapo(str){
  return (str || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function toggleModoVozPapo(){
  if(_vozPapoAtiva) pararModoVozPapo();
  else iniciarModoVozPapo();
}

function iniciarModoVozPapo(){
  const Api = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!Api){
    alert('Use o Chrome para o modo voz.');
    return;
  }
  _vozPapoAtiva = true;
  window._vozPapoAtiva = true;
  _estadoVozPapo = { etapa: conversaAtual ? 'conversa' : 'lista' };
  const painel = document.getElementById('painel-modo-voz-papo');
  if(painel) painel.style.display = 'block';
  const btn = document.getElementById('btn-modo-voz-papo');
  if(btn) btn.style.background = '#a4402f';

  _vozPapoReconhecimento = new Api();
  _vozPapoReconhecimento.lang = 'pt-BR';
  _vozPapoReconhecimento.continuous = true;
  _vozPapoReconhecimento.interimResults = false;
  _vozPapoReconhecimento.onresult = (event) => {
    const ultimo = event.results[event.results.length - 1];
    if(!ultimo || !ultimo.isFinal) return;
    const texto = (ultimo[0] && ultimo[0].transcript || '').trim();
    if(!texto) return;
    const trans = document.getElementById('voz-papo-transcricao');
    if(trans) trans.textContent = '"' + texto + '"';
    processarComandoVozPapo(texto);
  };
  _vozPapoReconhecimento.onend = () => {
    if(_vozPapoAtiva && !_vozPapoFalando){
      try{ _vozPapoReconhecimento.start(); } catch(e){}
    }
  };
  _vozPapoReconhecimento.onerror = (event) => {
    if(event.error === 'not-allowed'){
      alert('Permita o microfone para o modo voz.');
      pararModoVozPapo();
    }
  };
  try{ _vozPapoReconhecimento.start(); } catch(e){}

  if(conversaAtual){
    falarVozPapo('Papo. Conversa aberta com ' + (outroLadoNomeAtual || 'contato') + '. Diga falar para mandar mensagem, ouvir para ler, ligar, ou voltar.');
  } else {
    const n = (typeof conversasCarregadasCache !== 'undefined' && conversasCarregadasCache) ? conversasCarregadasCache.length : 0;
    falarVozPapo('Papo. Você tem ' + n + ' conversas. Diga listar, ou o nome da pessoa para abrir. Diga papo para voltar ao GuiaZap.');
  }
}

function pararModoVozPapo(){
  _vozPapoAtiva = false;
  window._vozPapoAtiva = false;
  if(_vozPapoReconhecimento){
    try{ _vozPapoReconhecimento.stop(); } catch(e){}
    _vozPapoReconhecimento = null;
  }
  if(_vozPapoSynth) _vozPapoSynth.cancel();
  const painel = document.getElementById('painel-modo-voz-papo');
  if(painel) painel.style.display = 'none';
  const btn = document.getElementById('btn-modo-voz-papo');
  if(btn) btn.style.background = '#6b46c1';
}

function falarVozPapo(texto){
  if(!_vozPapoSynth) return;
  _vozPapoFalando = true;
  const status = document.getElementById('voz-papo-status');
  if(status) status.textContent = texto;
  _vozPapoSynth.cancel();
  const fala = new SpeechSynthesisUtterance(texto);
  fala.lang = 'pt-BR';
  fala.rate = 1;
  fala.onend = () => {
    _vozPapoFalando = false;
    if(status) status.textContent = 'Pode falar...';
    if(_vozPapoAtiva && _vozPapoReconhecimento){
      try{ _vozPapoReconhecimento.start(); } catch(e){}
    }
  };
  fala.onerror = () => { _vozPapoFalando = false; };
  _vozPapoSynth.speak(fala);
}

function listarConversasEmVoz(){
  const lista = (typeof conversasCarregadasCache !== 'undefined' && conversasCarregadasCache) ? conversasCarregadasCache : [];
  if(!lista.length) return 'Nenhuma conversa ainda. Diga adicionar contato e fale o código.';
  const nomes = lista.slice(0, 8).map(c => c.nomeExibido).filter(Boolean);
  const extra = lista.length - nomes.length;
  return extra > 0
    ? 'Conversas: ' + nomes.join(', ') + ', e mais ' + extra + '.'
    : 'Conversas: ' + nomes.join(', ') + '. Diga o nome para abrir.';
}

function acharConversaPorNome(fala){
  const t = normalizarVozPapo(fala);
  const lista = conversasCarregadasCache || [];
  return lista.find(c => {
    const n = normalizarVozPapo(c.nomeExibido || '');
    return n && (n.includes(t) || t.includes(n) || t.split(' ').some(p => p.length > 2 && n.includes(p)));
  });
}

async function processarComandoVozPapo(transcricao){
  if(_vozPapoFalando) return;
  const t = normalizarVozPapo(transcricao);

  if(t === 'parar' || t === 'desligar' || t === 'sair do modo voz'){
    falarVozPapo('Modo voz desligado.');
    setTimeout(pararModoVozPapo, 1200);
    return;
  }
  if(t === 'guiazap' || t === 'inicio' || t === 'início' || t.includes('voltar pro guiazap') || t.includes('pagina inicial')){
    localStorage.setItem('retomarModoVozAoCarregar', '1');
    falarVozPapo('Voltando ao GuiaZap.');
    setTimeout(() => { window.location.href = 'index.html'; }, 1000);
    return;
  }

  if(_estadoVozPapo.etapa === 'ditando'){
    if(t === 'cancelar' || t === 'voltar'){
      _estadoVozPapo.etapa = 'conversa';
      falarVozPapo('Cancelado. Diga falar de novo quando quiser.');
      return;
    }
    if(typeof enviarQualquerMensagem === 'function' && conversaAtual){
      await enviarQualquerMensagem({ tipo: 'texto', texto: transcricao.trim() });
      _estadoVozPapo.etapa = 'conversa';
      falarVozPapo('Mensagem enviada: ' + transcricao.trim());
    } else {
      falarVozPapo('Não consegui enviar. Tente de novo.');
    }
    return;
  }

  if(t.includes('listar') || t === 'conversas' || t.includes('quais conversas')){
    if(typeof fecharConversa === 'function' && conversaAtual) fecharConversa();
    _estadoVozPapo.etapa = 'lista';
    falarVozPapo(listarConversasEmVoz());
    return;
  }

  if(t.includes('adicionar contato') || t.includes('codigo') || t.includes('código')){
    if(typeof adicionarContatoPorCodigo === 'function'){
      falarVozPapo('Abrindo adicionar contato por código.');
      adicionarContatoPorCodigo();
    }
    return;
  }

  if(t === 'voltar' || t === 'lista'){
    if(conversaAtual && typeof fecharConversa === 'function'){
      fecharConversa();
      _estadoVozPapo.etapa = 'lista';
      falarVozPapo('Lista de conversas. ' + listarConversasEmVoz());
    } else {
      localStorage.setItem('retomarModoVozAoCarregar', '1');
      window.location.href = 'index.html';
    }
    return;
  }

  if(t === 'falar' || t === 'mensagem' || t.includes('mandar mensagem') || t.includes('enviar mensagem')){
    if(!conversaAtual){
      falarVozPapo('Abra uma conversa primeiro. Diga o nome da pessoa.');
      return;
    }
    _estadoVozPapo.etapa = 'ditando';
    falarVozPapo('Pode falar a mensagem. Eu envio em texto, para quem não ouve conseguir ler.');
    return;
  }

  if(t === 'ouvir' || t.includes('ler mensagens') || t.includes('ler conversa')){
    if(!conversaAtual){
      falarVozPapo('Abra uma conversa primeiro.');
      return;
    }
    const bolhas = document.querySelectorAll('#chat-mensagens .bolha-msg');
    const ultimas = Array.from(bolhas).slice(-4).map(b => (b.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    falarVozPapo(ultimas.length ? ('Últimas mensagens: ' + ultimas.join('. ')) : 'Nenhuma mensagem ainda.');
    return;
  }

  if(t === 'ligar' || t.includes('chamada') || t.includes('telefon')){
    if(!conversaAtual){
      falarVozPapo('Abra uma conversa primeiro.');
      return;
    }
    if(typeof iniciarChamada === 'function'){
      falarVozPapo('Ligando.');
      iniciarChamada(false);
    }
    return;
  }

  if(t.includes('video') || t.includes('vídeo')){
    if(conversaAtual && typeof iniciarChamada === 'function'){
      falarVozPapo('Iniciando chamada de vídeo.');
      iniciarChamada(true);
    }
    return;
  }

  const nomeLimpo = t.replace(/^(abrir|conversa com|falar com|chamar)\s+/, '').trim();
  const achada = acharConversaPorNome(nomeLimpo);
  if(achada && typeof abrirConversa === 'function'){
    await abrirConversa(achada.id);
    _estadoVozPapo.etapa = 'conversa';
    falarVozPapo('Conversa com ' + (achada.nomeExibido || 'contato') + '. Diga falar, ouvir, ligar ou voltar.');
    return;
  }

  falarVozPapo('Não achei esse comando. Diga listar, o nome da pessoa, falar, ouvir, ligar ou voltar.');
}

window.iniciarModoVozPapo = iniciarModoVozPapo;
window.toggleModoVozPapo = toggleModoVozPapo;
window.pararModoVozPapo = pararModoVozPapo;
