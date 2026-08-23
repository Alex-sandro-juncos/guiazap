// Converte cidade/bairro/estado numa coordenada aproximada (latitude/longitude),
// usando o Nominatim (serviço gratuito do OpenStreetMap). Não é um endereço
// exato — é só uma estimativa, suficiente pra ordenar por "mais próximos".

exports.handler = async function (event) {
  try {
    const cidade = event.queryStringParameters && event.queryStringParameters.cidade;
    const bairro = event.queryStringParameters && event.queryStringParameters.bairro;
    const estado = event.queryStringParameters && event.queryStringParameters.estado;

    if (!cidade || !estado) {
      return { statusCode: 400, body: JSON.stringify({ error: 'cidade e estado são obrigatórios' }) };
    }

    const endereco = [bairro, cidade, estado, 'Brasil'].filter(Boolean).join(', ');
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(endereco)}`;

    const resp = await fetch(url, {
      headers: { 'User-Agent': 'GuiaZap/1.0 (contato@guiazap.shop)' }
    });

    if (!resp.ok) {
      return { statusCode: 200, body: JSON.stringify({ encontrado: false }) };
    }

    const data = await resp.json();
    if (!data || data.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ encontrado: false }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ encontrado: true, latitude: parseFloat(data[0].lat), longitude: parseFloat(data[0].lon) })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 200, body: JSON.stringify({ encontrado: false }) };
  }
};