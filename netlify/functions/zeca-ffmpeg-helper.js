// Motor de edição de áudio/vídeo de verdade do Zeca — diferente de
// gerar-audio-zeca.js/gerar-video-zeca.js (que CRIAM um arquivo novo do
// zero, chamando API paga), isso aqui EDITA um arquivo que a pessoa já
// mandou (cortar, mudar velocidade, juntar, redimensionar pro formato de
// Story/Reels/YouTube, etc), usando o ffmpeg rodando localmente dentro da
// própria function — sem chamar nenhuma API externa paga.
//
// Por isso o CUSTO aqui é só tempo de execução da function (processamento
// local), não dinheiro por chamada de API — segue o mesmo teto de segurança
// do "modo geral" do Zeca (ver LIMITES_MODO_GERAL em zeca-chat.js), em vez
// de ter um limite próprio ou consumir crédito extra.
//
// ffmpeg-static baixa um binário pronto do ffmpeg (não precisa instalar
// nada no servidor) — o caminho dele precisa estar incluído no pacote da
// function (ver netlify.toml, "included_files").
//
// TESTADO DE VERDADE (rodando o ffmpeg local antes de entregar) tudo que
// esse arquivo faz, EXCETO: esse binário do ffmpeg NÃO tem o filtro
// "drawtext" disponível — por isso NÃO dá pra gravar legenda/texto em
// cima do vídeo (confirmado rodando: "No such filter: 'drawtext'"). Se um
// dia isso mudar (trocar o binário do ffmpeg-static por uma build com
// libfreetype+drawtext de verdade), dá pra adicionar essa função depois.

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

// Formatos de tela prontos pra rede social — corta/preenche mantendo o
// centro da imagem, sempre saindo com essas dimensões exatas (testado).
const FORMATOS_SOCIAL = {
  story: { largura: 720, altura: 1280 },   // Stories/Reels/TikTok (9:16)
  quadrado: { largura: 1080, altura: 1080 }, // feed do Instagram (1:1)
  youtube: { largura: 1280, altura: 720 }    // YouTube/paisagem (16:9)
};

// ---- ÁUDIO ----
// params: {
//   cortarInicioSeg, duracaoSeg,
//   velocidade (0.25–4, 1 = sem mudança),
//   melhorarQualidade (bool — reduz ruído + normaliza volume),
//   volume (multiplicador, ex: 1.5 = +50%, 0.6 = -40%),
//   fadeInSeg, fadeOutSeg (entrada/saída suave),
//   segundoBuffer + segundoMimeType + modoJuncao ('sequencia' junta um
//     depois do outro | 'fundo' toca o segundo por baixo, mais baixo,
//     tipo música de fundo)
// }
// Sempre devolve mp3 (mesmo formato que o resto do Zeca já entrega).
async function editarAudio(buffer, mimeTypeEntrada, params) {
  const extEntrada = _extensaoPorMime(mimeTypeEntrada, 'mp3');
  const caminhoEntrada = await _salvarTemp(buffer, extEntrada);
  const caminhoSaida = _arquivoTemp('mp3');
  let caminhoSegundo = null;

  try {
    if (params.segundoBuffer) {
      caminhoSegundo = await _salvarTemp(params.segundoBuffer, _extensaoPorMime(params.segundoMimeType, 'mp3'));
    }

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
      if (params.volume && params.volume !== 1) {
        filtrosAudio.push(`volume=${Math.max(0, Math.min(5, params.volume))}`);
      }
      if (typeof params.fadeInSeg === 'number' && params.fadeInSeg > 0) {
        filtrosAudio.push(`afade=t=in:st=0:d=${params.fadeInSeg}`);
      }
      if (typeof params.fadeOutSeg === 'number' && params.fadeOutSeg > 0 && typeof params.duracaoTotalConhecidaSeg === 'number') {
        const inicio = Math.max(0, params.duracaoTotalConhecidaSeg - params.fadeOutSeg);
        filtrosAudio.push(`afade=t=out:st=${inicio}:d=${params.fadeOutSeg}`);
      }

      if (caminhoSegundo && params.modoJuncao === 'fundo') {
        cmd.input(caminhoSegundo);
        const rotuloPrincipal = filtrosAudio.length ? '[a0]' : '[0:a]';
        const filtroPrincipal = filtrosAudio.length ? `[0:a]${filtrosAudio.join(',')}[a0];` : '';
        cmd.complexFilter(`${filtroPrincipal}[1:a]volume=0.25[a1];${rotuloPrincipal}[a1]amix=inputs=2:duration=first:dropout_transition=2[aout]`, 'aout');
      } else if (caminhoSegundo && params.modoJuncao === 'sequencia') {
        cmd.input(caminhoSegundo);
        cmd.complexFilter('[0:a][1:a]concat=n=2:v=0:a=1[aout]', 'aout');
      } else if (filtrosAudio.length) {
        cmd.audioFilters(filtrosAudio);
      }

      cmd.audioCodec('libmp3lame').format('mp3').output(caminhoSaida);
      return cmd;
    });

    return await _lerELimpar(caminhoSaida);
  } finally {
    _apagar(caminhoEntrada);
    _apagar(caminhoSegundo);
  }
}

// ---- VÍDEO ----
// params: {
//   cortarInicioSeg, duracaoSeg,
//   comprimir (bool — reduz resolução/bitrate pra arquivo bem menor),
//   removerAudio (bool),
//   audioNovoBuffer + audioNovoMimeType (troca/adiciona a trilha de áudio
//     — silencia o áudio original e usa esse no lugar),
//   formatoSocial ('story' | 'quadrado' | 'youtube' — recorta/preenche
//     pro formato certo de Stories/Reels, feed quadrado, ou YouTube),
//   rotacionarGraus (90 | 180 | 270),
//   espelhar (bool — inverte horizontalmente),
//   pretoBranco (bool),
//   velocidade (0.25–4, muda a velocidade do vídeo E do áudio juntos),
//   segundoBuffer + segundoMimeType (junta um segundo vídeo em seguida —
//     normaliza resolução/fps antes de juntar, pra não dar erro se forem
//     de tamanhos diferentes)
// }
// Sempre devolve mp4 (formato universal — cobre também o pedido de
// "converter formato", já que a saída é sempre mp4 padronizado).
async function editarVideo(buffer, mimeTypeEntrada, params) {
  const caminhoEntrada = await _salvarTemp(buffer, _extensaoPorMime(mimeTypeEntrada, 'mp4'));
  const caminhoSaida = _arquivoTemp('mp4');
  let caminhoAudioNovo = null;
  let caminhoSegundo = null;

  try {
    if (params.audioNovoBuffer) {
      caminhoAudioNovo = await _salvarTemp(params.audioNovoBuffer, _extensaoPorMime(params.audioNovoMimeType, 'mp3'));
    }
    if (params.segundoBuffer) {
      caminhoSegundo = await _salvarTemp(params.segundoBuffer, _extensaoPorMime(params.segundoMimeType, 'mp4'));
    }

    await _rodarFfmpeg((cmd) => {
      cmd.input(caminhoEntrada);

      if (typeof params.cortarInicioSeg === 'number' && params.cortarInicioSeg > 0) {
        cmd.seekInput(params.cortarInicioSeg);
      }
      if (typeof params.duracaoSeg === 'number' && params.duracaoSeg > 0) {
        cmd.duration(Math.min(DURACAO_MAXIMA_SEG, params.duracaoSeg));
      }

      // Junta um segundo vídeo em seguida — sempre normaliza resolução/fps
      // antes (senão o concat pode falhar/travar se forem diferentes).
      if (caminhoSegundo) {
        cmd.input(caminhoSegundo);
        cmd.complexFilter(
          '[0:v]scale=640:360,fps=24,setsar=1[v0];[1:v]scale=640:360,fps=24,setsar=1[v1];[v0][0:a][v1][1:a]concat=n=2:v=1:a=1[vout][aout]',
          ['vout', 'aout']
        );
        cmd.videoCodec('libx264').audioCodec('aac').format('mp4').outputOptions(['-movflags +faststart']).output(caminhoSaida);
        return cmd;
      }

      // Troca/adiciona a trilha de áudio — silencia a original, usa a nova.
      if (caminhoAudioNovo) {
        cmd.input(caminhoAudioNovo);
        cmd.outputOptions(['-map 0:v:0', '-map 1:a:0', '-shortest']);
      } else if (params.removerAudio) {
        cmd.noAudio();
      }

      const filtrosVideo = [];
      if (params.formatoSocial && FORMATOS_SOCIAL[params.formatoSocial]) {
        const { largura, altura } = FORMATOS_SOCIAL[params.formatoSocial];
        filtrosVideo.push(`scale=${largura}:${altura}:force_original_aspect_ratio=increase`, `crop=${largura}:${altura}`);
      }
      if (params.rotacionarGraus === 90) filtrosVideo.push('transpose=1');
      else if (params.rotacionarGraus === 270) filtrosVideo.push('transpose=2');
      else if (params.rotacionarGraus === 180) filtrosVideo.push('transpose=1', 'transpose=1');
      if (params.espelhar) filtrosVideo.push('hflip');
      if (params.pretoBranco) filtrosVideo.push('hue=s=0');
      if (params.comprimir) filtrosVideo.push("scale='min(720,iw)':-2");
      if (params.velocidade && params.velocidade !== 1) {
        const v = Math.min(4, Math.max(0.25, params.velocidade));
        filtrosVideo.push(`setpts=${(1 / v).toFixed(4)}*PTS`);
        if (!params.removerAudio) cmd.audioFilters([_cadeiaAtempo(v)]);
      }
      if (filtrosVideo.length) cmd.videoFilters(filtrosVideo);

      if (params.comprimir) {
        cmd.videoBitrate('800k');
        cmd.outputOptions(['-preset veryfast']);
      }

      cmd.videoCodec('libx264').audioCodec('aac').format('mp4').outputOptions(['-movflags +faststart']).output(caminhoSaida);
      return cmd;
    });

    return await _lerELimpar(caminhoSaida);
  } finally {
    _apagar(caminhoEntrada);
    _apagar(caminhoAudioNovo);
    _apagar(caminhoSegundo);
  }
}

// Extrai um frame (imagem) de um momento específico do vídeo — pra usar
// como capa/thumbnail. Devolve PNG.
async function extrairFrameVideo(buffer, mimeTypeEntrada, segundoDoFrame) {
  const caminhoEntrada = await _salvarTemp(buffer, _extensaoPorMime(mimeTypeEntrada, 'mp4'));
  const caminhoSaida = _arquivoTemp('png');

  try {
    await _rodarFfmpeg((cmd) => {
      cmd.input(caminhoEntrada);
      if (typeof segundoDoFrame === 'number' && segundoDoFrame > 0) {
        cmd.seekInput(segundoDoFrame);
      }
      cmd.outputOptions(['-frames:v 1', '-update 1']).output(caminhoSaida);
      return cmd;
    });
    return await _lerELimpar(caminhoSaida);
  } finally {
    _apagar(caminhoEntrada);
  }
}

// ---- INTERPRETAÇÃO DO PEDIDO EM TEXTO LIVRE ----
// Converte o que a pessoa escreveu (junto com o(s) arquivo(s) anexado(s))
// num objeto de parâmetros pro ffmpeg — sem precisar de mais uma chamada
// de IA (mais rápido, mais barato, e mais confiável pra comando
// estruturado tipo "corta os primeiros 5 segundos").

// Mesma lógica de velocidade usada em gerar-audio-zeca.js (aceita número
// solto ou frases tipo "mais rápido"/"bem devagar"). Serve tanto pra
// velocidade de áudio quanto de vídeo.
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

function interpretarFormatoSocial(texto) {
  const t = String(texto || '').toLowerCase();
  if (/story|stories|reels?|tiktok|vertical|formato de story/.test(t)) return 'story';
  if (/quadrad|feed(\s+do\s+instagram)?|formato quadrado/.test(t)) return 'quadrado';
  if (/youtube|paisagem|horizontal|widescreen/.test(t)) return 'youtube';
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
  if (/aumenta\w*\s+o\s+volume|mais\s+alto|mais\s+volume/.test(t)) params.volume = 1.6;
  if (/diminui\w*\s+o\s+volume|mais\s+baixo|menos\s+volume/.test(t)) params.volume = 0.6;
  if (/fade\s*-?in|entra\s+suave|come[çc]a\s+suave|aparece\s+suave/.test(t)) params.fadeInSeg = 1.5;
  if (/fade\s*-?out|sai\s+suave|termina\s+suave|acaba\s+suave/.test(t)) params.fadeOutSeg = 1.5;

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
  if (/tira\s+o\s+[áa]udio|remove\s+o\s+[áa]udio|sem\s+[áa]udio|mudo\b|mudo,/.test(t)) {
    params.removerAudio = true;
  }

  const formatoSocial = interpretarFormatoSocial(t);
  if (formatoSocial) params.formatoSocial = formatoSocial;

  const matchRotacao = t.match(/gira|girar|rotaciona|rotacionar/);
  if (matchRotacao) {
    if (/180/.test(t)) params.rotacionarGraus = 180;
    else if (/270|esquerda/.test(t)) params.rotacionarGraus = 270;
    else params.rotacionarGraus = 90; // padrão: 90 graus (direita)
  }

  if (/espelh|invert(e|er)\s+(a\s+)?imagem|flip/.test(t)) params.espelhar = true;
  if (/preto e branco|p&b|\bpb\b|sem cor/.test(t)) params.pretoBranco = true;

  const velocidade = interpretarVelocidade(t);
  if (velocidade) params.velocidade = velocidade;

  return params;
}

// Detecta pedido de extrair um frame/capa do vídeo (isso devolve uma
// IMAGEM, não um vídeo — tratado à parte no zeca-chat.js).
const PADRAO_EXTRAIR_FRAME = /tira\s+(um|uma)\s+(frame|imagem|foto)|pega\s+um\s+frame|captura\s+(um\s+)?frame|faz\s+(uma\s+)?capa|thumbnail|miniatura/i;

function interpretarSegundoDoFrame(texto) {
  const t = String(texto || '').toLowerCase();
  const m = t.match(/segundo\s+(\d+(?:[.,]\d+)?)/);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
}

module.exports = {
  editarAudio,
  editarVideo,
  extrairFrameVideo,
  interpretarPedidoEdicaoAudio,
  interpretarPedidoEdicaoVideo,
  interpretarFormatoSocial,
  PADRAO_EXTRAIR_FRAME,
  interpretarSegundoDoFrame
};