// Estima a latitude/longitude de um endereço. Primeiro confere se alguém já
// confirmou EXATAMENTE esse endereço no mapa antes (rede compartilhada de
// localizações verificadas — muito mais preciso, especialmente em bairros
// rurais onde o mapa público costuma ser impreciso). Se não achar, cai pro
// Nominatim (motor de geocodificação gratuito do OpenStreetMap).

function normalizarEnderecoChaveServidor(rua, numero, cidade, estado){
  const partes = [rua, numero, cidade, estado].map(p => (p || '').toString().trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' '));
  return partes.filter(Boolean).join('|');
}

exports.handler = async function (event) {
  try {
    const { cidade, bairro, estado, rua, numero } = event.queryStringParameters || {};
    if (!cidade || !estado) {
      return { statusCode: 400, body: JSON.stringify({ error: 'cidade e estado são obrigatórios' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    // 1. Confere primeiro na rede de endereços já confirmados por alguém
    if (rua) {
      const chave = normalizarEnderecoChaveServidor(rua, numero, cidade, estado);
      const respRede = await fetch(`${SUPABASE_URL}/rest/v1/enderecos_confirmados_mapa?endereco_normalizado=eq.${encodeURIComponent(chave)}&select=latitude,longitude`, { headers });
      const dadosRede = await respRede.json();

      if (dadosRede && dadosRede.length > 0) {
        return {
          statusCode: 200,
          body: JSON.stringify({ encontrado: true, latitude: dadosRede[0].latitude, longitude: dadosRede[0].longitude, fonte: 'rede_confirmada' })
        };
      }
    }

    // 2. Não achou na rede — tenta pelo Nominatim (geocodificação pública)
    // Monta o endereço mais completo possível — se tiver rua/número, usa
    // eles (muito mais preciso); senão, cai pra cidade/bairro só mesmo
    const partesEndereco = [];
    if (rua) partesEndereco.push(numero ? `${rua}, ${numero}` : rua);
    if (bairro) partesEndereco.push(bairro);
    partesEndereco.push(cidade, estado, 'Brasil');

    const enderecoCompleto = partesEndereco.join(', ');

    const urlGeo = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(enderecoCompleto)}`;
    const respGeo = await fetch(urlGeo, { headers: { 'User-Agent': 'GuiaZap/1.0 (contato@guiazap.shop)' } });
    let dadosGeo = respGeo.ok ? await respGeo.json() : [];

    // Se não achou nada com o endereço completo (rua/número podem ter erro
    // de digitação, ou não estar no mapa), tenta de novo só com cidade/bairro
    if ((!dadosGeo || dadosGeo.length === 0) && rua) {
      const urlGeoSimples = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent([bairro, cidade, estado, 'Brasil'].filter(Boolean).join(', '))}`;
      const respGeoSimples = await fetch(urlGeoSimples, { headers: { 'User-Agent': 'GuiaZap/1.0 (contato@guiazap.shop)' } });
      dadosGeo = respGeoSimples.ok ? await respGeoSimples.json() : [];
    }

    if (!dadosGeo || dadosGeo.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ encontrado: false }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        encontrado: true,
        latitude: parseFloat(dadosGeo[0].lat),
        longitude: parseFloat(dadosGeo[0].lon),
        fonte: 'nominatim'
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao geocodificar endereço' }) };
  }
};