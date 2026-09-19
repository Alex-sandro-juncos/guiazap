// Motor de edição de áudio/vídeo de verdade do Zeca — diferente de
// gerar-audio-zeca.js/gerar-video-zeca.js (que CRIAM um arquivo novo do
// zero, chamando API paga), isso aqui EDITA um arquivo que a pessoa já
// mandou (cortar, mudar velocidade, reduzir ruído, comprimir, etc), usando
// o ffmpeg rodando localmente dentro da própria function — sem chamar
// nenhuma API externa paga.
//
// Por isso o CUSTO aqui é só tempo de execução da function (processamento
// local), não dinheiro por chamada de API — segue o mesmo teto de segurança
// do "modo geral" do Zeca (ver LIMITES_MODO_GERAL em zeca-chat.js), em vez
// de ter um limite próprio ou consumir crédito extra.
//
// ffmpeg-static baixa um binário pronto do ffmpeg (não precisa instalar
// nada no servidor) — o caminho dele precisa estar incluído no pacote da
// function (ver netlify.toml, "included_files").

const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const os = require('os');
const path = require('path');

ffmpeg.setFfmpegPath(ffmpegPath);

// Teto de segurança pro tempo de processamento — evita ficar preso até
// estourar o tempo limite da própria Netlify Function sem dar um erro
// claro pra pessoa antes disso.
const TIMEOUT_FFMPEG_MS = 25000;

// Teto de segurança pra duração de corte/edição — nunca processa mais que
// isso de uma vez (arquivo de origem pode ser maior, só não processa tudo).
const DURACAO_MAXIMA_SEG = 180; // 3 minutos

function _arquivoTemp(extensao) {
  return path.join(os.tmpdir(), `zeca-edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extensao}`);
}

async function _salvarTemp(buffer, extensao) {
  const caminho = _arquivoTemp(extensao);
  await fs.promises.writeFile(caminho, buffer);
  return caminho;
}

async function _lerELimpar(caminho) {
  const buffer = await fs.promises.readFile(caminho);
  fs.promises.unlink(caminho).catch(() => {});
  return buffer;
}

function _apagar(caminho) {
  if (caminho) fs.promises.unlink(caminho).catch(() => {});
}

function _rodarFfmpeg(montarComando) {
  return new Promise((resolve, reject) => {
    const comando = montarComando(ffmpeg());
    let travado = false;
    const temporizador = setTimeout(() => {
      travado = true;
      try { comando.kill('SIGKILL'); } catch (e) {}
      reject(new Error('edição demorou demais (arquivo grande demais ou operação pesada)'));
    }, TIMEOUT_FFMPEG_MS);
    comando
      .on('error', (err) => { if (!travado) { clearTimeout(temporizador); reject(err); } })
      .on('end', () => { clearTimeout(temporizador); resolve(); })
      .run();
  });
}

// Cada instância do filtro "atempo" só aceita de 0.5x a 2x — velocidade
// fora desse intervalo (ex: 3x, 0.3x) precisa encadear mais de um filtro.
function _cadeiaAtempo(velocidade) {
  let resto = velocidade;
  const filtros = [];
  while (resto > 2) { filtros.push('atempo=2.0'); resto /= 2; }
  while (resto < 0.5) { filtros.push('atempo=0.5'); resto /= 0.5; }
  filtros.push(`atempo=${resto.toFixed(3)}`);
  return filtros.join(',');
}

function _extensaoPorMime(mimeType, padrao) {
  const m = (mimeType || '').toLowerCase();
  if (m.includes('wav')) return 'wav';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('webm')) return 'webm';
  if (m.includes('m4a') || m.includes('mp4a') || m.includes('aac')) return 'm4a';
  if (m.includes('mp3') || m.includes('mpeg')) return 'mp3';
  return padrao;
}

// ---- ÁUDIO ----
// params: {
//   cortarInicioSeg (número, opcional — pula os primeiros N segundos),
//   duracaoSeg (número, opcional — mantém só N segundos a partir do ponto de corte),
//   velocidade (número 0.25–4, opcional — 1 = sem mudança),
//   melhorarQualidade (bool, opcional — reduz ruído de fundo + normaliza volume)
// }
// Sempre devolve mp3 (mesmo formato que o resto do Zeca já entrega).
async function editarAudio(buffer, mimeTypeEntrada, params) {
  const extEntrada = _extensaoPorMime(mimeTypeEntrada, 'mp3');
  const caminhoEntrada = await _salvarTemp(buffer, extEntrada);
  const caminhoSaida = _arquivoTemp('mp3');

  try {
    await _rodarFfmpeg((cmd) => {
      cmd.input(caminhoEntrada);

      if (typeof params.cortarInicioSeg === 'number' && params.cortarInicioSeg > 0) {
        cmd.seekInput(params.cortarInicioSeg);
      }
      if (typeof params.duracaoSeg === 'number' && params.duracaoSeg > 0) {
        cmd.duration(Math.min(DURACAO_MAXIMA_SEG, params.duracaoSeg));
      }

      const filtrosAudio = [];
      if (params.velocidade && params.velocidade !== 1) {
        filtrosAudio.push(_cadeiaAtempo(Math.min(4, Math.max(0.25, params.velocidade))));
      }
      if (params.melhorarQualidade) {
        filtrosAudio.push('afftdn=nf=-25', 'loudnorm');
      }
      if (filtrosAudio.length) cmd.audioFilters(filtrosAudio);

      cmd.audioCodec('libmp3lame').format('mp3').output(caminhoSaida);
      return cmd;
    });

    return await _lerELimpar(caminhoSaida);
  } finally {
    _apagar(caminhoEntrada);
  }
}

// ---- VÍDEO ----
// params: {
//   cortarInicioSeg (número, opcional),
//   duracaoSeg (número, opcional),
//   comprimir (bool, opcional — reduz resolução/bitrate pra arquivo bem menor),
//   removerAudio (bool, opcional)
// }
// Sempre devolve mp4 (formato universal — cobre também o pedido de
// "converter formato", já que a saída é sempre mp4 padronizado).
async function editarVideo(buffer, mimeTypeEntrada, params) {
  const caminhoEntrada = await _salvarTemp(buffer, _extensaoPorMime(mimeTypeEntrada, 'mp4'));
  const caminhoSaida = _arquivoTemp('mp4');

  try {
    await _rodarFfmpeg((cmd) => {
      cmd.input(caminhoEntrada);

      if (typeof params.cortarInicioSeg === 'number' && params.cortarInicioSeg > 0) {
        cmd.seekInput(params.cortarInicioSeg);
      }
      if (typeof params.duracaoSeg === 'number' && params.duracaoSeg > 0) {
        cmd.duration(Math.min(DURACAO_MAXIMA_SEG, params.duracaoSeg));
      }

      if (params.removerAudio) cmd.noAudio();

      if (params.comprimir) {
        cmd.videoFilters(["scale='min(720,iw)':-2"]);
        cmd.videoBitrate('800k');
        cmd.outputOptions(['-preset veryfast']);
      }

      cmd.videoCodec('libx264').audioCodec('aac').format('mp4').outputOptions(['-movflags +faststart']).output(caminhoSaida);
      return cmd;
    });

    return await _lerELimpar(caminhoSaida);
  } finally {
    _apagar(caminhoEntrada);
  }
}

// ---- INTERPRETAÇÃO DO PEDIDO EM TEXTO LIVRE ----
// Converte o que a pessoa escreveu (junto com o arquivo anexado) num
// objeto de parâmetros pro ffmpeg — sem precisar de mais uma chamada de
// IA (mais rápido, mais barato, e mais confiável pra comando estruturado
// tipo "corta os primeiros 5 segundos").

function _numero(texto) {
  const m = String(texto).replace(',', '.').match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

// Mesma lógica de velocidade usada em gerar-audio-zeca.js (aceita número
// solto ou frases tipo "mais rápido"/"bem devagar").
function interpretarVelocidade(texto) {
  const t = String(texto || '').toLowerCase();
  const matchExplicito = t.match(/(\d+(?:[.,]\d+)?)\s*x\b/);
  if (matchExplicito) {
    const v = parseFloat(matchExplicito[1].replace(',', '.'));
    if (!isNaN(v)) return Math.min(4, Math.max(0.25, v));
  }
  if (/bem r[áa]pid|bem acelerad/.test(t)) return 1.5;
  if (/mais r[áa]pid|acelerad/.test(t)) return 1.25;
  if (/bem devagar|bem lent/.test(t)) return 0.7;
  if (/mais devagar|mais lent/.test(t)) return 0.85;
  return null;
}

// Extrai corte ("corta os primeiros 5 segundos", "deixa só os 10
// primeiros segundos", "corta do segundo 3 ao 8", "encurta pra 15
// segundos"). Não cobre "corta os ÚLTIMOS N segundos" (precisaria saber a
// duração total do arquivo original antes — fica pra uma próxima versão).
function interpretarCorte(texto) {
  const t = String(texto || '').toLowerCase();
  const resultado = {};

  const doAoSeg = t.match(/do\s+segundo\s+(\d+(?:[.,]\d+)?)\s+(?:ao|at[ée])\s+(?:o\s+)?(?:segundo\s+)?(\d+(?:[.,]\d+)?)/);
  if (doAoSeg) {
    const inicio = parseFloat(doAoSeg[1].replace(',', '.'));
    const fim = parseFloat(doAoSeg[2].replace(',', '.'));
    resultado.cortarInicioSeg = inicio;
    resultado.duracaoSeg = Math.max(0.5, fim - inicio);
    return resultado;
  }

  const pulaPrimeiros = t.match(/(?:corta|corte|pula|pular|tira|tirar|remov\w*)\s+(?:os\s+)?primeiros?\s+(\d+(?:[.,]\d+)?)\s*(?:s|seg)/);
  if (pulaPrimeiros) {
    resultado.cortarInicioSeg = parseFloat(pulaPrimeiros[1].replace(',', '.'));
    return resultado;
  }

  const deixaSoOsPrimeiros = t.match(/(?:deixa|deixar|mant[ée]m|manter|s[óo])\s+(?:os\s+)?(?:primeiros?\s+)?(\d+(?:[.,]\d+)?)\s*(?:s|seg)/);
  if (deixaSoOsPrimeiros) {
    resultado.duracaoSeg = parseFloat(deixaSoOsPrimeiros[1].replace(',', '.'));
    return resultado;
  }

  const encurtaPra = t.match(/(?:encurta|encurtar|corta|cortar)\s+pra\s+(\d+(?:[.,]\d+)?)\s*(?:s|seg)/);
  if (encurtaPra) {
    resultado.duracaoSeg = parseFloat(encurtaPra[1].replace(',', '.'));
    return resultado;
  }

  return null;
}

function interpretarPedidoEdicaoAudio(texto) {
  const t = String(texto || '').toLowerCase();
  const params = {};
  const corte = interpretarCorte(t);
  if (corte) Object.assign(params, corte);

  const velocidade = interpretarVelocidade(t);
  if (velocidade) params.velocidade = velocidade;

  if (/ru[íi]do|chiado|chiad|qualidade|normaliza|volume baixo|abafad/.test(t)) {
    params.melhorarQualidade = true;
  }

  return params;
}

function interpretarPedidoEdicaoVideo(texto) {
  const t = String(texto || '').toLowerCase();
  const params = {};
  const corte = interpretarCorte(t);
  if (corte) Object.assign(params, corte);

  if (/comprim|reduz\w*\s+o\s+tamanho|arquivo\s+menor|deixa\s+mais\s+leve/.test(t)) {
    params.comprimir = true;
  }
  if (/converte|converter|mudar\s+(o\s+)?formato|passar\s+pra\s+mp4/.test(t) && !params.comprimir) {
    // "converter" sozinho não precisa comprimir — só normaliza pra mp4,
    // o que a function já faz sempre na saída.
  }
  if (/tira\s+o\s+[áa]udio|remove\s+o\s+[áa]udio|sem\s+[áa]udio|mudo\b|mudo,/.test(t)) {
    params.removerAudio = true;
  }

  return params;
}

module.exports = {
  editarAudio,
  editarVideo,
  interpretarPedidoEdicaoAudio,
  interpretarPedidoEdicaoVideo
};