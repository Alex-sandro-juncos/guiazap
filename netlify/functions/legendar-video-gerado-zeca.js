// Passo extra do "estúdio multimídia encadeado": depois que um vídeo com
// avatar (gerar-video-zeca.js) termina de gerar, se a pessoa também pediu
// legenda, essa function BAIXA o vídeo pronto (ele fica hospedado num link
// externo, HeyGen), transcreve a fala de verdade (Whisper, mesma técnica
// já usada pra legendar vídeo que a pessoa manda anexado — ver
// zeca-chat.js/_transcreverParaLegenda), queima a legenda em cima
// (legendarVideo, de zeca-ffmpeg-helper.js) e sobe o resultado pro
// Storage (bucket "fotos", que já é o mesmo usado pros vídeos gerados por
// upload direto do navegador) — devolvendo um link novo, hospedado no
// próprio GuiaZap.
//
// Não cobra crédito à parte: é um passo A MAIS em cima de um vídeo que a
// pessoa já pagou/gastou a cota gerando (mesma lógica do roteiro, que
// também já vem "de graça" embutido no custo do vídeo) — só exige login,
// sem gate de plano aqui (quem chegou até aqui já passou pelo gate do
// vídeo em si, em gerar-video-zeca.js).

const { legendarVideo } = require('./zeca-ffmpeg-helper');

const IDIOMAS_LEGENDA = {
  'português': 'português', 'portugues': 'português', 'pt': 'português',
  'inglês': 'inglês (English)', 'ingles': 'inglês (English)', 'english': 'inglês (English)',
  'espanhol': 'espanhol (Español)', 'spanish': 'espanhol (Español)',
  'francês': 'francês (Français)', 'frances': 'francês (Français)'
};

function _detectarIdiomaAlvoLegenda(mensagem) {
  const texto = (mensagem || '').toLowerCase();
  if (!/traduz|tradu[çc][ãa]o/.test(texto)) return null;
  for (const chave of Object.keys(IDIOMAS_LEGENDA)) {
    if (texto.includes(chave)) return IDIOMAS_LEGENDA[chave];
  }
  return 'português';
}

const MAX_SEGMENTOS_LEGENDA = 150;

async function _transcreverVideoWhisper(buffer, mimeType, idiomaAlvo) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) return null;

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType || 'video/mp4' }), 'video.mp4');
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');

  const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form
  });
  if (!resp.ok) {
    console.error('erro na transcrição Whisper (vídeo gerado):', await resp.text());
    return null;
  }
  const dados = await resp.json();
  let segmentos = (dados.segments || [])
    .map(s => ({ inicio: s.start, fim: s.end, texto: (s.text || '').trim() }))
    .filter(s => s.texto)
    .slice(0, MAX_SEGMENTOS_LEGENDA);

  if (idiomaAlvo && segmentos.length) {
    try {
      const { chamarIABarata } = require('./ia-barata-helper');
      const listaNumerada = segmentos.map((s, i) => `${i}: ${s.texto}`).join('\n');
      const promptTraducao = `Traduza cada linha numerada abaixo pra ${idiomaAlvo}, mantendo o sentido natural (não é tradução literal palavra-por-palavra, é legenda de vídeo — curta e natural). Responda APENAS com um JSON válido: {"traducoes": ["texto traduzido da linha 0", "texto traduzido da linha 1", ...]} — a lista PRECISA ter exatamente ${segmentos.length} itens, na mesma ordem, um pra cada linha numerada.`;
      const iaTraducao = await chamarIABarata(promptTraducao, listaNumerada, 1500, true);
      if (iaTraducao.ok && Array.isArray(iaTraducao.json.traducoes) && iaTraducao.json.traducoes.length === segmentos.length) {
        segmentos = segmentos.map((s, i) => ({ ...s, texto: iaTraducao.json.traducoes[i] || s.texto }));
      }
    } catch (eTraducao) {
      console.error('erro traduzindo legenda do vídeo gerado (segue com o idioma original):', eTraducao);
    }
  }

  return { segmentos, idiomaDetectado: dados.language || null };
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader) {
      return { statusCode: 401, body: JSON.stringify({ error: 'precisa estar logado' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headersServico = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    const token = authHeader.replace('Bearer ', '');
    const usuarioResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
    });
    if (!usuarioResp.ok) {
      return { statusCode: 401, body: JSON.stringify({ error: 'sessão inválida ou expirada' }) };
    }
    const usuario = await usuarioResp.json();

    const { videoUrl, mensagemOriginal } = JSON.parse(event.body || '{}');
    if (!videoUrl) {
      return { statusCode: 400, body: JSON.stringify({ error: 'faltou o link do vídeo' }) };
    }

    // Baixa o vídeo pronto (link externo da HeyGen) — isso roda no
    // servidor, então não tem o limite de payload que existe pra upload
    // vindo do navegador.
    const respVideo = await fetch(videoUrl);
    if (!respVideo.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: 'não consegui baixar o vídeo gerado pra legendar' }) };
    }
    const videoBuffer = Buffer.from(await respVideo.arrayBuffer());

    if (videoBuffer.length > 25 * 1024 * 1024) {
      return { statusCode: 200, body: JSON.stringify({ error: 'Esse vídeo ficou grande demais pra eu legendar automaticamente (máximo 25MB nessa etapa). O vídeo sem legenda continua disponível.' }) };
    }

    const idiomaAlvo = _detectarIdiomaAlvoLegenda(mensagemOriginal);
    const transcricao = await _transcreverVideoWhisper(videoBuffer, 'video/mp4', idiomaAlvo);
    if (!transcricao || !transcricao.segmentos.length) {
      return { statusCode: 200, body: JSON.stringify({ error: 'Não consegui reconhecer a fala nesse vídeo pra legendar. O vídeo sem legenda continua disponível.' }) };
    }

    const videoLegendadoBuffer = await legendarVideo(videoBuffer, 'video/mp4', transcricao.segmentos);

    // Sobe pro Storage público (mesmo bucket "fotos" que os outros vídeos
    // do Zeca já usam) — path por usuário, igual o resto do site.
    const caminho = `zeca-videos-legendados/${usuario.id}/${Date.now()}.mp4`;
    const uploadResp = await fetch(`${SUPABASE_URL}/storage/v1/object/fotos/${caminho}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'video/mp4'
      },
      body: videoLegendadoBuffer
    });
    if (!uploadResp.ok) {
      console.error('erro subindo vídeo legendado pro storage:', await uploadResp.text());
      return { statusCode: 200, body: JSON.stringify({ error: 'Legendei o vídeo, mas deu erro salvando ele. O vídeo sem legenda continua disponível.' }) };
    }

    const urlPublica = `${SUPABASE_URL}/storage/v1/object/public/fotos/${caminho}`;
    return {
      statusCode: 200,
      body: JSON.stringify({ url: urlPublica, idiomaAlvo: idiomaAlvo || transcricao.idiomaDetectado || null })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 200, body: JSON.stringify({ error: 'Deu erro legendando o vídeo automaticamente. O vídeo sem legenda continua disponível.' }) };
  }
};