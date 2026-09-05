const FRASES_CADASTRO_VOZ = [
  'eu autorizo o guiazap',
  'abrir vitrine',
  'adicionar ao carrinho'
];
const LIMIAR_VOZ_DONO = 0.78;
const LIMIAR_LIVENESS = 0.012;

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

function _embeddingDeAmostras(samples){
  if(!samples || !samples.length) return [];
  const n = 64;
  const passo = Math.max(1, Math.floor(samples.length / n));
  const vec = [];
  for(let i = 0; i < n; i++){
    let s = 0, c = 0;
    for(let j = 0; j < passo; j++){
      const idx = i * passo + j;
      if(idx < samples.length){ s += Math.abs(samples[idx]); c++; }
    }
    vec.push(c ? s / c : 0);
  }
  const max = Math.max.apply(null, vec) || 1;
  return vec.map(v => v / max);
}

function _varianciaEnergia(samples){
  const janelas = 12;
  const tam = Math.floor(samples.length / janelas);
  if(tam < 8) return 0;
  const medias = [];
  for(let i = 0; i < janelas; i++){
    let s = 0;
    for(let j = 0; j < tam; j++) s += Math.abs(samples[i * tam + j] || 0);
    medias.push(s / tam);
  }
  const m = medias.reduce((a,b)=>a+b,0) / medias.length;
  return Math.sqrt(medias.reduce((a,b)=>a+(b-m)*(b-m),0) / medias.length);
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
  } catch(e){ console.error('monitor voz', e); }
}

function pararMonitorVozDono(){
  _bioAtiva = false;
  try{ if(window._bioProc) window._bioProc.disconnect(); } catch(e){}
}

function amostraAtualVoz(){
  return _bioAmostras.slice(-32000);
}

function vozPareceAoVivo(samples){
  return _varianciaEnergia(samples) >= LIMIAR_LIVENESS;
}

function autorizarComandoPorVoz(){
  const perfil = perfilVozSalvo();
  if(!perfil || !perfil.embeddings || !perfil.embeddings.length) return true;
  const samples = amostraAtualVoz();
  if(samples.length < 4000){
    _falarBio('Não captei a voz. Fala de novo.');
    return false;
  }
  if(!vozPareceAoVivo(samples)){
    _falarBio('Isso parece uma gravação. Só aceito fala ao vivo.');
    return false;
  }
  const atual = _embeddingDeAmostras(samples);
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
          resolve(_embeddingDeAmostras(Array.from(decoded.getChannelData(0))));
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
      embeddings.push(await gravarFraseCadastro(3));
    }
    localStorage.setItem(_chavePerfilVoz(), JSON.stringify({
      embeddings, frases: FRASES_CADASTRO_VOZ, criado_em: new Date().toISOString()
    }));
    _falarBio('Voz cadastrada. A partir de agora só a sua voz executa comando.');
    alert('Voz cadastrada. Outra pessoa falando não mexe no app.');
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

// Chama isso quando QUALQUER modo voz começar a escutar. Se a pessoa já
// tiver um perfil de voz cadastrado, liga o monitor de biometria por baixo
// dos panos (rodando junto com o reconhecimento de fala normal). Se não
// tiver perfil cadastrado ainda, não faz nada — a biometria é opcional,
// só entra em ação depois que a pessoa cadastra a própria voz.
async function iniciarBiometriaSeConfigurada(){
  if(!perfilVozSalvo()) return;
  if(_biometriaStreamAtivo) return; // já está rodando, não abre de novo
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _biometriaStreamAtivo = stream;
    iniciarMonitorVozDono(stream);
  } catch(e){
    console.warn('não consegui ligar a biometria de voz (comandos vão funcionar normalmente, sem essa camada extra)', e);
  }
}

function pararBiometriaSeAtiva(){
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