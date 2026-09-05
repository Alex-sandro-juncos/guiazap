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

let _aguardandoAtivacaoPapo = false;
let _vozPapoUltimoSinalDeVida = 0;
let _vozPapoVigia = null;
let _vozPapoTentativasReconexao = 0;

function iniciarModoVozPapo(retomandoAutomaticamente){
  const Api = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!Api){
    alert('Use o Chrome para o modo voz.');
    return;
  }
  _vozPapoAtiva = true;
  window._vozPapoAtiva = true;
  _estadoVozPapo = { etapa: conversaAtual ? 'conversa' : 'lista' };
  _aguardandoAtivacaoPapo = !!retomandoAutomaticamente;
  _vozPapoTentativasReconexao = 0;
  const painel = document.getElementById('painel-modo-voz-papo');
  if(painel) painel.style.display = 'block';
  const btn = document.getElementById('btn-modo-voz-papo');
  if(btn) btn.style.background = '#a4402f';

  _criarReconhecimentoPapo(Api);
  _iniciarVigiaVozPapo(Api);
  if(typeof iniciarBiometriaSeConfigurada === 'function') iniciarBiometriaSeConfigurada();

  if(_aguardandoAtivacaoPapo){
    falarVozPapo('Modo voz em espera. Fala "ativar" pra começar.');
  } else if(conversaAtual){
    falarVozPapo('Papo. Conversa aberta com ' + (outroLadoNomeAtual || 'contato') + '. Diga atendimento por voz pra fazer um pedido falando naturalmente, ou falar, ouvir, ligar, voltar.');
  } else {
    const n = (typeof conversasCarregadasCache !== 'undefined' && conversasCarregadasCache) ? conversasCarregadasCache.length : 0;
    falarVozPapo('Papo. Você tem ' + n + ' conversas. Diga listar, ou o nome da pessoa para abrir. Diga papo para voltar ao GuiaZap.');
  }
}

function _criarReconhecimentoPapo(Api){
  _vozPapoReconhecimento = new Api();
  _vozPapoReconhecimento.lang = 'pt-BR';
  _vozPapoReconhecimento.continuous = true;
  _vozPapoReconhecimento.interimResults = false;

  _vozPapoReconhecimento.onstart = () => {
    _vozPapoUltimoSinalDeVida = Date.now();
    _vozPapoTentativasReconexao = 0;
  };

  _vozPapoReconhecimento.onresult = (event) => {
    _vozPapoUltimoSinalDeVida = Date.now();
    if(!_vozPapoAtiva) return;
    const ultimo = event.results[event.results.length - 1];
    if(!ultimo || !ultimo.isFinal) return;
    const texto = (ultimo[0] && ultimo[0].transcript || '').trim();
    if(!texto) return;
    const trans = document.getElementById('voz-papo-transcricao');
    if(trans) trans.textContent = '"' + texto + '"';

    if(_aguardandoAtivacaoPapo){
      const t = normalizarVozPapo(texto);
      if(t.includes('ativar') || t.includes('guiazap')){
        _aguardandoAtivacaoPapo = false;
        falarVozPapo('Modo voz ativado.');
      }
      return;
    }

    processarComandoVozPapo(texto);
  };
  _vozPapoReconhecimento.onend = () => {
    _vozPapoUltimoSinalDeVida = Date.now();
    if(_vozPapoAtiva && !_vozPapoFalando){
      try{ _vozPapoReconhecimento.start(); } catch(e){}
    }
  };
  _vozPapoReconhecimento.onerror = (event) => {
    if(event.error === 'not-allowed'){
      alert('Permita o microfone para o modo voz.');
      pararModoVozPapo();
      return;
    }
    _vozPapoUltimoSinalDeVida = Date.now();
    if(_vozPapoAtiva && (event.error === 'no-speech' || event.error === 'aborted' || event.error === 'network')){
      setTimeout(() => { try{ _vozPapoReconhecimento.start(); } catch(e){} }, 400);
    }
  };
  try{ _vozPapoReconhecimento.start(); } catch(e){}
  _vozPapoUltimoSinalDeVida = Date.now();
}

function _iniciarVigiaVozPapo(Api){
  clearInterval(_vozPapoVigia);
  _vozPapoVigia = setInterval(() => {
    if(!_vozPapoAtiva){ clearInterval(_vozPapoVigia); return; }
    if(_vozPapoFalando) return;

    const semSinalHa = Date.now() - _vozPapoUltimoSinalDeVida;
    if(semSinalHa > 8000){
      _vozPapoTentativasReconexao++;
      console.warn('modo voz do Papo parece ter travado, recriando (tentativa ' + _vozPapoTentativasReconexao + ')');
      try{ _vozPapoReconhecimento.onend = null; _vozPapoReconhecimento.onerror = null; _vozPapoReconhecimento.stop(); } catch(e){}
      _criarReconhecimentoPapo(Api);

      if(_vozPapoTentativasReconexao === 2){
        falarVozPapo('O microfone parou de responder. Reconectando...');
      }
    }
  }, 4000);
}

function pararModoVozPapo(){
  _vozPapoAtiva = false;
  window._vozPapoAtiva = false;
  clearInterval(_vozPapoVigia);
  if(typeof pararBiometriaSeAtiva === 'function') pararBiometriaSeAtiva();
  if(_vozPapoReconhecimento){
    _vozPapoReconhecimento.onresult = null;
    _vozPapoReconhecimento.onend = null;
    _vozPapoReconhecimento.onerror = null;
    try{ _vozPapoReconhecimento.abort(); } catch(e){}
    _vozPapoReconhecimento = null;
  }
  if(_vozPapoSynth) _vozPapoSynth.cancel();
  const painel = document.getElementById('painel-modo-voz-papo');
  if(painel) painel.style.display = 'none';
  const btn = document.getElementById('btn-modo-voz-papo');
  if(btn) btn.style.background = '#6b46c1';
}

function falarVozPapo(texto, aoTerminar){
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
    if(typeof aoTerminar === 'function') aoTerminar();
  };
  fala.onerror = () => { _vozPapoFalando = false; };
  _vozPapoSynth.speak(fala);
  setTimeout(() => {
    _vozPapoFalando = false;
    if(_vozPapoAtiva && _vozPapoReconhecimento){
      try{ _vozPapoReconhecimento.start(); } catch(e){}
    }
  }, 6000);
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
  if(_vozPapoSynth) try{ _vozPapoSynth.cancel(); } catch(e){}
  _vozPapoFalando = false;
  const t = normalizarVozPapo(transcricao);

  const _ehPararP = t === 'parar' || t === 'desligar' || t === 'sair do modo voz' || t.includes('cala boca') || t.includes('fica quieto') || t.includes('fique quieto');
  if(!_ehPararP && typeof comandoDeVozAutorizado === 'function' && !comandoDeVozAutorizado()){
    return;
  }

  if(t === 'parar' || t === 'desligar' || t === 'sair do modo voz' || t.includes('cala boca') || t.includes('fica quieto') || t.includes('fique quieto')){
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

  if(_estadoVozPapo.etapa === 'navegando_cardapio'){
    clearTimeout(_estadoVozPapo.timeoutAvancoCardapio);

    if(t === 'sair do atendimento' || t === 'sair' || t === 'parar' || t === 'parar aqui'){
      _estadoVozPapo.etapa = 'atendimento';
      falarVozPapo('Saindo da navegação do cardápio. Fala atendimento por voz pra ver de novo, ou finalizar pra fechar o pedido.');
      return;
    }

    if(t === 'finalizar'){
      _estadoVozPapo.etapa = 'atendimento';
      if(typeof enviarQualquerMensagem === 'function') await enviarQualquerMensagem({ tipo: 'texto', texto: 'finalizar' });
      return;
    }

    if(t === 'proximo' || t === 'próximo' || t === 'pular' || t === 'nao' || t === 'não'){
      avancarNavegacaoCardapio();
      return;
    }

    if(t === 'quero' || t === 'sim' || t === 'esse' || t.includes('quero esse') || t.includes('adiciona') || t.includes('coloca')){
      const item = _estadoVozPapo.itensCardapio[_estadoVozPapo.indiceCardapio];
      const numero = String(_estadoVozPapo.indiceCardapio + 1);
      if(typeof enviarQualquerMensagem === 'function' && conversaAtual){
        await enviarQualquerMensagem({ tipo: 'texto', texto: numero });
      }
      // Não fala a confirmação aqui de propósito — a resposta de verdade
      // do robô ("✅ item adicionado!") já chega pelo tempo real e é lida
      // sozinha, então só espera um pouco antes de seguir pro próximo item
      const indiceNoMomento = _estadoVozPapo.indiceCardapio;
      setTimeout(() => {
        if(_estadoVozPapo && _estadoVozPapo.etapa === 'navegando_cardapio' && _estadoVozPapo.indiceCardapio === indiceNoMomento){
          avancarNavegacaoCardapio();
        }
      }, 3500);
      return;
    }

    // Fala não reconhecida durante a navegação — avança mesmo assim, pra
    // não travar esperando algo que não vai vir
    avancarNavegacaoCardapio();
    return;
  }

  if(_estadoVozPapo.etapa === 'atendimento'){
    if(t === 'sair do atendimento' || t === 'sair' || t === 'parar atendimento' || t === 'voltar'){
      _estadoVozPapo.etapa = 'conversa';
      falarVozPapo('Saindo do atendimento por voz. Diga falar, ouvir, ligar, ou voltar.');
      return;
    }
    if(typeof enviarQualquerMensagem === 'function' && conversaAtual){
      const textoParaEnviar = converterEscolhaFaladaEmNumeros(transcricao) || transcricao.trim();
      await enviarQualquerMensagem({ tipo: 'texto', texto: textoParaEnviar });
      // Não fala nada aqui de propósito — a resposta da empresa (bot ou
      // pessoa) chega pelo tempo real e já é lida sozinha, porque a
      // leitura automática vem ligada por padrão. Falar aqui também
      // ia duplicar e atrapalhar.
    } else {
      falarVozPapo('Não consegui enviar. Tente de novo.');
    }
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

  if(t.includes('atendimento por voz') || t.includes('fazer pedido por voz') || t.includes('modo atendimento') || t === 'atendimento'){
    if(!conversaAtual){
      falarVozPapo('Abra uma conversa primeiro. Diga o nome da empresa.');
      return;
    }
    if(typeof lerAutomaticoPapoAtivo === 'function' && !lerAutomaticoPapoAtivo() && typeof toggleLerAutomaticoPapo === 'function'){
      toggleLerAutomaticoPapo();
    }
    _estadoVozPapo.etapa = 'atendimento';
    falarVozPapo('Modo atendimento ativado. Agora é só falar seu pedido naturalmente, tipo "quero um pastel doce" ou "quero retirar no local". Pra sair, diga sair do atendimento.');
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

// Converte fala tipo "quero o número dois", "escolho o três e o cinco",
// "dois, quatro" em "2,4" — o formato que o robô de atendimento entende
// pra marcar itens do cardápio. Só converte quando a fala PARECE mesmo uma
// escolha de número (senão devolve null e manda o texto original, pra não
// atrapalhar respostas de texto livre como "quero pagar com pix").
function converterEscolhaFaladaEmNumeros(transcricao){
  const mapaNumeros = { zero:'0', um:'1', uma:'1', dois:'2', duas:'2', tres:'3', três:'3', quatro:'4', cinco:'5', seis:'6', sete:'7', oito:'8', nove:'9', dez:'10' };
  const t = normalizarVozPapo(transcricao);

  // Remove palavras de "enfeite" pra sobrar só os números — se sobrar
  // qualquer outra palavra que não seja número, não é uma escolha simples
  const palavras = t.split(/\s+/).filter(p => p && !['quero','o','a','os','as','numero','número','item','escolho','e','ou','por','favor','também','tambem'].includes(p));

  if(palavras.length === 0) return null;

  const numeros = [];
  for(const p of palavras){
    if(/^\d+$/.test(p)) numeros.push(p);
    else if(mapaNumeros[p] !== undefined) numeros.push(mapaNumeros[p]);
    else return null; // achou uma palavra que não é número — não é uma escolha simples, manda o texto original
  }

  return numeros.length ? numeros.join(',') : null;
}

// ---------- NAVEGAÇÃO DO CARDÁPIO ITEM POR ITEM (pausa de ~2,5s pra "quero") ----------

function falarItemCardapioAtualPorVoz(){
  const estado = _estadoVozPapo;
  const itens = estado.itensCardapio || [];

  if(estado.indiceCardapio >= itens.length){
    estado.etapa = 'atendimento';
    falarVozPapo('Isso é tudo do cardápio. Fala finalizar pra fechar o pedido, ou atendimento por voz pra ouvir de novo.');
    return;
  }

  const item = itens[estado.indiceCardapio];
  const preco = item.preco ? (String(item.preco).replace('.', ',') + ' reais') : 'preço a combinar';
  const texto = (estado.indiceCardapio + 1) + ': ' + (item.nome || 'produto') + ', ' + preco + '. Diga quero, ou espera pra pular.';

  falarVozPapo(texto, () => {
    clearTimeout(estado.timeoutAvancoCardapio);
    const indiceNoMomento = estado.indiceCardapio;
    estado.timeoutAvancoCardapio = setTimeout(() => {
      if(_estadoVozPapo && _estadoVozPapo.etapa === 'navegando_cardapio' && _estadoVozPapo.indiceCardapio === indiceNoMomento){
        avancarNavegacaoCardapio();
      }
    }, 2500);
  });
}

function avancarNavegacaoCardapio(){
  clearTimeout(_estadoVozPapo.timeoutAvancoCardapio);
  _estadoVozPapo.indiceCardapio++;
  falarItemCardapioAtualPorVoz();
}

// Chamada pelo listener de mensagens em tempo real do chat.html quando
// chega um cardápio interativo — só assume a leitura se o atendimento por
// voz estiver ativo (senão, deixa a leitura normal de mensagem cuidar disso)
function iniciarNavegacaoCardapioPorVoz(mensagem){
  if(!_vozPapoAtiva) return false;
  if(!_estadoVozPapo || (_estadoVozPapo.etapa !== 'atendimento' && _estadoVozPapo.etapa !== 'navegando_cardapio')) return false;

  let itens;
  try{ itens = JSON.parse(mensagem.texto); } catch(e){ return false; }
  if(!Array.isArray(itens) || itens.length === 0) return false;

  _estadoVozPapo.etapa = 'navegando_cardapio';
  _estadoVozPapo.itensCardapio = itens;
  _estadoVozPapo.indiceCardapio = 0;
  falarVozPapo('Cardápio com ' + itens.length + ' itens. Vou falar um de cada vez.', () => {
    falarItemCardapioAtualPorVoz();
  });
  return true;
}

window.iniciarNavegacaoCardapioPorVoz = iniciarNavegacaoCardapioPorVoz;
window.iniciarModoVozPapo = iniciarModoVozPapo;
window.toggleModoVozPapo = toggleModoVozPapo;
window.pararModoVozPapo = pararModoVozPapo;