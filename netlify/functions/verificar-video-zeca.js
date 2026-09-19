// Consulta se um vídeo pedido em gerar-video-zeca.js já terminou de ser
// gerado na HeyGen. O front-end chama essa function de tempos em tempos
// (a cada uns 5s) até vir "completed" (ou "failed"), porque a HeyGen leva
// minutos pra terminar um vídeo — não dá pra esperar isso numa chamada só.

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY;
    if (!HEYGEN_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'geração de vídeo não configurada (HEYGEN_API_KEY)' }) };
    }

    const { videoId } = JSON.parse(event.body || '{}');
    if (!videoId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'faltou o videoId' }) };
    }

    const resp = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`, {
      headers: { 'X-Api-Key': HEYGEN_API_KEY }
    });
    const dados = await resp.json();
    const info = dados && dados.data;

    if (!resp.ok || !info) {
      console.error('erro ao consultar status do vídeo na HeyGen:', JSON.stringify(dados));
      return { statusCode: 500, body: JSON.stringify({ error: 'não consegui consultar o status do vídeo agora' }) };
    }

    // status da HeyGen: "pending" | "processing" | "completed" | "failed"
    return {
      statusCode: 200,
      body: JSON.stringify({
        status: info.status,
        url: info.status === 'completed' ? info.video_url : null,
        erro: info.status === 'failed' ? (info.error && info.error.message) || 'a geração falhou do lado da HeyGen' : null
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao consultar status do vídeo' }) };
  }
};