// Busca GIFs ou figurinhas (stickers) usando o Tenor — a chave é gratuita,
// precisa ser criada em tenor.com/gifapi e configurada como variável de
// ambiente TENOR_API_KEY no Netlify.

exports.handler = async function (event) {
  try {
    const TENOR_API_KEY = process.env.TENOR_API_KEY;
    if (!TENOR_API_KEY) {
      return { statusCode: 200, body: JSON.stringify({ resultados: [], erro: 'TENOR_API_KEY não configurada ainda' }) };
    }

    const termo = (event.queryStringParameters && event.queryStringParameters.q) || '';
    const tipo = (event.queryStringParameters && event.queryStringParameters.tipo) || 'gif'; // 'gif' ou 'sticker'

    const endpoint = termo
      ? `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(termo)}&key=${TENOR_API_KEY}&searchfilter=${tipo}&limit=24&locale=pt_BR`
      : `https://tenor.googleapis.com/v2/featured?key=${TENOR_API_KEY}&searchfilter=${tipo}&limit=24&locale=pt_BR`;

    const resp = await fetch(endpoint);
    const data = await resp.json();

    const resultados = (data.results || []).map(item => ({
      url: item.media_formats && item.media_formats.gif ? item.media_formats.gif.url : null,
      preview: item.media_formats && item.media_formats.tinygif ? item.media_formats.tinygif.url : null
    })).filter(r => r.url);

    return { statusCode: 200, body: JSON.stringify({ resultados }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 200, body: JSON.stringify({ resultados: [], erro: err.message }) };
  }
};