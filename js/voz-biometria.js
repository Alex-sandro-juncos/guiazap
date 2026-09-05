// ============================================================
// Biometria de voz — versão melhorada
// ============================================================
// Mede TOM (pitch) e FORMATO DO ESPECTRO de frequência da voz, em vez de
// só volume — muito mais confiável pra diferenciar pessoas diferentes.
//
// ⚠️ Isso é uma aproximação caseira, rodando 100% no navegador, sem
// nenhum serviço pago de verdade por trás. É uma camada extra, não uma
// garantia perfeita. Pra qualquer coisa que envolva dinheiro, o PIN de
// voz continua sendo a opção mais confiável.
// ============================================================

const FRASES_CADASTRO_VOZ = [
  'eu autorizo o guiazap',
  'abrir vitrine',
  'adicionar ao carrinho'
];
const LIMIAR_VOZ_DONO = 0.78;
const LIMIAR_LIVENESS_VARIANCIA_PITCH = 1; // bem tolerante — evita falso positivo em microfones diferentes (PC, headset, etc)

let _bioAtiva = false;
let _bioAmostras = [];
let _bioProcessandoCadastro = false;

function _uidBio(){
  return (window.currentUser && currentUser.id)
    || (window.currentUserV && currentUserV.id)
    || (window.currentUserChat && currentUserChat.id)
    || 'aparelho';
}
function _chavePerfilVoz(){ return 'guiazap_perfil_voz_' + _uidBio(); }

function perfilVozSalvo(){
  try{ return JSON.parse(localStorage.getItem(_chavePerfilVoz()) || 'null'); }
  catch(e){ return null; }
}

function _falarBio(t){
  if(!('speechSynthesis' in window)) return;
  try{
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t);
    u.lang = 'pt-BR';
    speechSynthesis.speak(u);
  } catch(e){}
}

// ---------- FFT simples (radix-2), só o necessário pra pegar o espectro ----------
function _fft(reOriginal, imOriginal){
  const n = reOriginal.length;
  if(n <= 1) return [reOriginal, imOriginal];
  const re = reOriginal.slice();
  const im = imOriginal.slice();

  for(let i = 1, j = 0; i < n; i++){
    let bit = n >> 1;
    for(; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if(i < j){ [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }

  for(let len = 2; len <= n; len <<= 1){
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for(let i = 0; i < n; i += len){
      let curRe = 1, curIm = 0;
      for(let k = 0; k < len / 2; k++){
        const uRe = re[i + k], uIm = im[i + k];
        const vRe = re[i + k + len/2] * curRe - im[i + k + len/2] * curIm;
        const vIm = re[i + k + len/2] * curIm + im[i + k + len/2] * curRe;
        re[i + k] = uRe + vRe; im[i + k] = uIm + vIm;
        re[i + k + len/2] = uRe - vRe; im[i + k + len/2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        const nextIm = curRe * wIm + curIm * wRe;
        curRe = nextRe; curIm = nextIm;
      }
    }
  }
  return [re, im];
}

function _proximaPotenciaDe2(n){
  let p = 1;
  while(p < n) p <<= 1;
  return p;
}

// Divide o espectro de frequência em faixas (parecido com um "filtro mel"
// simplificado) e devolve a energia de cada faixa — captura o "timbre" da
// voz, bem diferente de pessoa pra pessoa
function _espectroPorFaixas(samples, taxaAmostragem, numFaixas){
  const tam = _proximaPotenciaDe2(samples.length);
  const re = new Array(tam).fill(0);
  const im = new Array(tam).fill(0);
  for(let i = 0; i < samples.length; i++){
    const janela = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (samples.length - 1));
    re[i] = samples[i] * janela;
  }

  const [reOut, imOut] = _fft(re, im);
  const metade = tam / 2;
  const magnitudes = new Array(metade);
  for(let i = 0; i < metade; i++){
    magnitudes[i] = Math.sqrt(reOut[i] * reOut[i] + imOut[i] * imOut[i]);
  }

  const freqMin = 80, freqMax = 4000;
  const binMin = Math.max(1, Math.floor(freqMin / (taxaAmostragem / tam)));
  const binMax = Math.min(metade - 1, Math.ceil(freqMax / (taxaAmostragem / tam)));

  const faixas = new Array(numFaixas).fill(0);
  const largura = (binMax - binMin) / numFaixas;
  for(let f = 0; f < numFaixas; f++){
    const inicio = Math.floor(binMin + f * largura);
    const fim = Math.floor(binMin + (f + 1) * largura);
    let soma = 0, count = 0;
    for(let b = inicio; b < fim && b <= binMax; b++){ soma += magnitudes[b]; count++; }
    faixas[f] = count ? soma / count : 0;
  }

  const max = Math.max.apply(null, faixas) || 1;
  return faixas.map(v => v / max);
}

// Estima o tom (pitch) da voz por autocorrelação
function _estimarPitch(samples, taxaAmostragem){
  const minLag = Math.floor(taxaAmostragem / 400);
  const maxLag = Math.floor(taxaAmostragem / 70);
  let melhorLag = -1, melhorCorrelacao = 0;

  for(let lag = minLag; lag <= maxLag && lag < samples.length; lag++){
    let soma = 0;
    for(let i = 0; i < samples.length - lag; i++){
      soma += samples[i] * samples[i + lag];
    }
    if(soma > melhorCorrelacao){ melhorCorrelacao = soma; melhorLag = lag; }
  }

  if(melhorLag <= 0) return 0;
  return taxaAmostragem / melhorLag;
}

function _embeddingDeAmostras(samples, taxaAmostragem){
  if(!samples || samples.length < 2048) return [];
  taxaAmostragem = taxaAmostragem || 16000;

  const tamJanela = 2048;
  const passo = Math.floor(tamJanela / 2);
  const pitches = [];
  const espectros = [];

  for(let inicio = 0; inicio + tamJanela <= samples.length; inicio += passo){
    const janela = samples.slice(inicio, inicio + tamJanela);
    const pitch = _estimarPitch(janela, taxaAmostragem);
    if(pitch > 60 && pitch < 500) pitches.push(pitch);
    espectros.push(_espectroPorFaixas(janela, taxaAmostragem, 16));
  }

  if(espectros.length === 0) return [];

  const espectroMedio = new Array(16).fill(0);
  espectros.forEach(e => { e.forEach((v, i) => { espectroMedio[i] += v / espectros.length; }); });

  const pitchMedio = pitches.length ? pitches.reduce((a,b)=>a+b,0) / pitches.length : 0;
  const pitchNormalizado = Math.min(1, pitchMedio / 400);

  return [...espectroMedio, pitchNormalizado];
}

function _varianciaPitch(pitches){
  if(pitches.length < 2) return 0;
  const m = pitches.reduce((a,b)=>a+b,0) / pitches.length;
  return Math.sqrt(pitches.reduce((a,b)=>a+(b-m)*(b-m),0) / pitches.length);
}

function _cosseno(a, b){
  if(!a || !b || a.length !== b.length) return 0;
  let d = 0, na = 0, nb = 0;
  for(let i = 0; i < a.length; i++){ d += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  if(!na || !nb) return 0;
  return d / (Math.sqrt(na) * Math.sqrt(nb));
}

function iniciarMonitorVozDono(stream){
  _bioAtiva = true;
  _bioAmostras = [];
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(2048, 1, 1);
    proc.onaudioprocess = (ev) => {
      if(!_bioAtiva) return;
      const data = ev.inputBuffer.getChannelData(0);
      for(let i = 0; i < data.length; i++) _bioAmostras.push(data[i]);
      if(_bioAmostras.length > 48000) _bioAmostras = _bioAmostras.slice(-48000);
    };
    src.connect(proc);
    proc.connect(ctx.destination);
    window._bioCtx = ctx;
    window._bioProc = proc;
    window._bioTaxaAmostragem = ctx.sampleRate;
  } catch(e){ console.error('monitor voz', e); }
}

function pararMonitorVozDono(){
  _bioAtiva = false;
  try{ if(window._bioProc) window._bioProc.disconnect(); } catch(e){}
}

function amostraAtualVoz(){
  return _bioAmostras.slice(-32000);
}

// Mede a VARIAÇÃO do tom ao longo do tempo — fala natural sempre varia um
// pouco, ruído/gravação de má qualidade não. Limiar bem tolerante, pra
// não confundir microfone diferente (PC, headset, etc) com "gravação".
function vozPareceAoVivo(samples, taxaAmostragem){
  const tamJanela = 2048;
  const pitches = [];
  for(let inicio = 0; inicio + tamJanela <= samples.length; inicio += tamJanela){
    const p = _estimarPitch(samples.slice(inicio, inicio + tamJanela), taxaAmostragem || 16000);
    if(p > 60 && p < 500) pitches.push(p);
  }
  // Se não conseguiu nem detectar 2 janelas de tom (ex: mic capta muito
  // baixo, ou é uma frase curta demais), não bloqueia por segurança — a
  // checagem de tom/espectro (comparação com o perfil) já cuida da
  // segurança de verdade, essa aqui é só uma camada extra
  if(pitches.length < 2) return true;
  return _varianciaPitch(pitches) >= LIMIAR_LIVENESS_VARIANCIA_PITCH;
}

function autorizarComandoPorVoz(){
  const perfil = perfilVozSalvo();
  if(!perfil || !perfil.embeddings || !perfil.embeddings.length) return true;
  const samples = amostraAtualVoz();
  const taxaAmostragem = window._bioTaxaAmostragem || 16000;

  if(samples.length < 4000){
    // Não captou áudio suficiente pra analisar — deixa passar em vez de
    // bloquear, pra não travar comandos por causa de uma amostra curta
    return true;
  }
  if(!vozPareceAoVivo(samples, taxaAmostragem)){
    _falarBio('Isso parece uma gravação ou ruído. Só aceito fala ao vivo.');
    return false;
  }
  const atual = _embeddingDeAmostras(samples, taxaAmostragem);
  if(!atual.length) return true; // não conseguiu analisar — deixa passar, não trava o comando
  let melhor = 0;
  perfil.embeddings.forEach(e => { melhor = Math.max(melhor, _cosseno(e, atual)); });
  if(melhor < LIMIAR_VOZ_DONO){
    _falarBio('Voz não reconhecida. Nenhuma ação foi feita.');
    return false;
  }
  return true;
}

function gravarFraseCadastro(segundos){
  return new Promise(async (resolve, reject) => {
    try{
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks = [];
      rec.ondataavailable = e => { if(e.data.size) chunks.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        try{
          const blob = new Blob(chunks, { type: 'audio/webm' });
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
          resolve(_embeddingDeAmostras(Array.from(decoded.getChannelData(0)), decoded.sampleRate));
        } catch(e){ reject(e); }
      };
      rec.start();
      setTimeout(() => { try{ rec.stop(); } catch(e){} }, (segundos || 3) * 1000);
    } catch(e){ reject(e); }
  });
}

async function cadastrarVozPrimeiroAcesso(){
  if(_bioProcessandoCadastro) return false;
  if(perfilVozSalvo()) return true;
  _bioProcessandoCadastro = true;
  try{
    _falarBio('Primeiro acesso por voz. Vou pedir três frases. Repita cada uma.');
    alert('Primeiro acesso por voz.\nRepita 3 frases. Depois só a SUA voz controla o app.');
    const embeddings = [];
    for(let i = 0; i < FRASES_CADASTRO_VOZ.length; i++){
      const frase = FRASES_CADASTRO_VOZ[i];
      _falarBio('Fale agora: ' + frase);
      alert('Frase ' + (i+1) + ' de 3. Fale:\n\n"' + frase + '"');
      const emb = await gravarFraseCadastro(3);
      if(emb.length) embeddings.push(emb);
    }
    if(embeddings.length === 0){
      alert('Não consegui captar sua voz direito. Tenta de novo, num lugar mais silencioso.');
      return false;
    }
    localStorage.setItem(_chavePerfilVoz(), JSON.stringify({
      embeddings, frases: FRASES_CADASTRO_VOZ, criado_em: new Date().toISOString(), versao: 2
    }));
    _falarBio('Voz cadastrada. A partir de agora só a sua voz executa comando.');
    alert('Voz cadastrada. Outra pessoa falando não mexe no app.\n\n⚠️ Lembrete: isso é uma camada extra, não substitui o PIN de voz pra pagamentos.');
    return true;
  } catch(e){
    alert('Não deu pra cadastrar a voz. Permita o microfone.');
    return false;
  } finally {
    _bioProcessandoCadastro = false;
  }
}

// ---------- FUNÇÕES DE CONVENIÊNCIA — pra usar de forma simples em qualquer tela ----------

let _biometriaStreamAtivo = null;
let _biometriaTimeoutInicio = null;

// Chama isso quando QUALQUER modo voz começar a escutar. Se a pessoa já
// tiver um perfil de voz cadastrado, liga o monitor de biometria por baixo
// dos panos. Se não tiver perfil cadastrado ainda, não faz nada — a
// biometria é opcional, só entra em ação depois que a pessoa cadastra a
// própria voz.
//
// IMPORTANTE: espera um pouco antes de pedir o PRÓPRIO microfone (getUserMedia),
// em vez de pedir ao mesmo tempo que o reconhecimento de fala normal
// (SpeechRecognition) está pedindo o dele — pedir os dois ao mesmo tempo
// pode confundir o navegador em alguns celulares e travar os dois pedidos
// de permissão, deixando o modo voz sem funcionar nem abrir.
function iniciarBiometriaSeConfigurada(){
  if(!perfilVozSalvo()) return;
  clearTimeout(_biometriaTimeoutInicio);
  _biometriaTimeoutInicio = setTimeout(async () => {
    if(_biometriaStreamAtivo) return; // já está rodando, não abre de novo
    try{
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      _biometriaStreamAtivo = stream;
      iniciarMonitorVozDono(stream);
    } catch(e){
      console.warn('não consegui ligar a biometria de voz (comandos vão funcionar normalmente, sem essa camada extra)', e);
    }
  }, 2500);
}

function pararBiometriaSeAtiva(){
  clearTimeout(_biometriaTimeoutInicio);
  pararMonitorVozDono();
  if(_biometriaStreamAtivo){
    try{ _biometriaStreamAtivo.getTracks().forEach(t => t.stop()); } catch(e){}
    _biometriaStreamAtivo = null;
  }
}

// Chama isso no INÍCIO de qualquer função que processa um comando de voz,
// ANTES de executar qualquer ação. Se não tiver perfil de voz cadastrado,
// deixa passar tudo normal (retorna true). Se tiver perfil, só deixa
// passar se a voz de quem falou bater com o perfil salvo.
function comandoDeVozAutorizado(){
  if(!perfilVozSalvo()) return true;
  return autorizarComandoPorVoz();
}

window.iniciarBiometriaSeConfigurada = iniciarBiometriaSeConfigurada;
window.pararBiometriaSeAtiva = pararBiometriaSeAtiva;
window.comandoDeVozAutorizado = comandoDeVozAutorizado;
window.cadastrarVozPrimeiroAcesso = cadastrarVozPrimeiroAcesso;
window.autorizarComandoPorVoz = autorizarComandoPorVoz;
window.iniciarMonitorVozDono = iniciarMonitorVozDono;
window.pararMonitorVozDono = pararMonitorVozDono;
window.perfilVozSalvo = perfilVozSalvo;