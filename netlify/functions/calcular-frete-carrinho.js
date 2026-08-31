// Calcula o frete por distância de rota real (OSRM), retornando o valor
// diretamente — versão enxuta da calcular-frete-entrega.js, feita pro
// carrinho da Vitrine (que não passa pelo fluxo de conversa do robô).

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { profissionalId, endereco } = JSON.parse(event.body || '{}');
    if (!profissionalId || !endereco) {
      return { statusCode: 400, body: JSON.stringify({ error: 'profissionalId e endereco são obrigatórios' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    async function buscar(tabela, query) {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?${query}`, { headers });
      return resp.json();
    }

    const empresas = await buscar('profissionais', `id=eq.${profissionalId}&select=latitude,longitude`);
    const empresa = empresas[0];

    const configs = await buscar('atendimento_config', `profissional_id=eq.${profissionalId}&select=taxa_base_entrega,valor_por_km,faz_entrega`);
    const config = configs[0];

    if (!empresa || empresa.latitude == null || empresa.longitude == null) {
      return { statusCode: 200, body: JSON.stringify({ encontrado: false, motivo: 'empresa sem localização cadastrada' }) };
    }

    const urlGeo = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(endereco + ', Brasil')}`;
    const respGeo = await fetch(urlGeo, { headers: { 'User-Agent': 'GuiaZap/1.0 (contato@guiazap.shop)' } });
    const dadosGeo = respGeo.ok ? await respGeo.json() : [];

    if (!dadosGeo || dadosGeo.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ encontrado: false, motivo: 'endereço não localizado' }) };
    }

    const latCliente = parseFloat(dadosGeo[0].lat);
    const lngCliente = parseFloat(dadosGeo[0].lon);

    const urlRota = `https://router.project-osrm.org/route/v1/driving/${empresa.longitude},${empresa.latitude};${lngCliente},${latCliente}?overview=false`;
    const respRota = await fetch(urlRota);
    const dadosRota = respRota.ok ? await respRota.json() : null;

    let distanciaKm;
    if (dadosRota && dadosRota.routes && dadosRota.routes[0]) {
      distanciaKm = dadosRota.routes[0].distance / 1000;
    } else {
      const R = 6371;
      const dLat = (latCliente - empresa.latitude) * Math.PI / 180;
      const dLng = (lngCliente - empresa.longitude) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(empresa.latitude * Math.PI / 180) * Math.cos(latCliente * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
      distanciaKm = (R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))) * 1.3;
    }

    const taxaBase = config ? parseFloat(config.taxa_base_entrega || 0) : 0;
    const valorPorKm = config ? parseFloat(config.valor_por_km || 0) : 0;
    const valorFrete = Math.round((taxaBase + distanciaKm * valorPorKm) * 100) / 100;

    return {
      statusCode: 200,
      body: JSON.stringify({ encontrado: true, distanciaKm: Math.round(distanciaKm * 10) / 10, valorFrete })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao calcular frete' }) };
  }
};