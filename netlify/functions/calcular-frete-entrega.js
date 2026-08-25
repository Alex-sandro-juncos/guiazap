// Calcula o frete de uma entrega usando distância de ROTA real (não linha
// reta), via OSRM (motor de rotas gratuito, mesma filosofia do Nominatim que
// já usamos pra geocodificação). Fórmula: taxa_base + (km * valor_por_km).
// Ao final, grava o pedido, atualiza o estado do atendimento automático e
// manda a mensagem de confirmação pro cliente no Papo.

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { conversaId, profissionalId, endereco } = JSON.parse(event.body || '{}');
    if (!conversaId || !profissionalId || !endereco) {
      return { statusCode: 400, body: JSON.stringify({ error: 'conversaId, profissionalId e endereco são obrigatórios' }) };
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

    // 1. Dados da empresa (localização + config de entrega)
    const empresas = await buscar('profissionais', `id=eq.${profissionalId}&select=latitude,longitude,name`);
    const empresa = empresas[0];

    const configs = await buscar('atendimento_config', `profissional_id=eq.${profissionalId}&select=*`);
    const config = configs[0];

    const dono = await buscar('profissionais', `id=eq.${profissionalId}&select=user_id`);
    const donoUserId = dono[0] ? dono[0].user_id : null;

    async function responderNoChat(texto) {
      await fetch(`${SUPABASE_URL}/rest/v1/mensagens_chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          conversa_id: conversaId,
          remetente_user_id: donoUserId,
          tipo: 'texto',
          texto,
          lida: false,
          enviado_por_bot: true
        })
      });
      await fetch(`${SUPABASE_URL}/rest/v1/conversas?id=eq.${conversaId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ ultima_mensagem_em: new Date().toISOString() })
      });
    }

    if (!empresa || empresa.latitude == null || empresa.longitude == null) {
      await responderNoChat('⚠️ Não consegui calcular o frete porque essa empresa ainda não tem localização cadastrada. Vou te colocar em contato com um atendente. Digite *5* no menu pra falar com alguém.');
      await fetch(`${SUPABASE_URL}/rest/v1/atendimento_estado?conversa_id=eq.${conversaId}`, {
        method: 'PATCH', headers, body: JSON.stringify({ estado: 'menu_principal' })
      });
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    // 2. Geocodifica o endereço digitado pelo cliente
    const urlGeo = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(endereco + ', Brasil')}`;
    const respGeo = await fetch(urlGeo, { headers: { 'User-Agent': 'GuiaZap/1.0 (contato@guiazap.shop)' } });
    const dadosGeo = respGeo.ok ? await respGeo.json() : [];

    if (!dadosGeo || dadosGeo.length === 0) {
      await responderNoChat('⚠️ Não consegui localizar esse endereço. Pode tentar de novo com mais detalhes (rua, número, bairro e cidade)?');
      await fetch(`${SUPABASE_URL}/rest/v1/atendimento_estado?conversa_id=eq.${conversaId}`, {
        method: 'PATCH', headers, body: JSON.stringify({ estado: 'aguardando_endereco_entrega' })
      });
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    const latCliente = parseFloat(dadosGeo[0].lat);
    const lngCliente = parseFloat(dadosGeo[0].lon);

    // 3. Calcula a distância de ROTA real via OSRM (não linha reta)
    const urlRota = `https://router.project-osrm.org/route/v1/driving/${empresa.longitude},${empresa.latitude};${lngCliente},${latCliente}?overview=false`;
    const respRota = await fetch(urlRota);
    const dadosRota = respRota.ok ? await respRota.json() : null;

    let distanciaKm;
    if (dadosRota && dadosRota.routes && dadosRota.routes[0]) {
      distanciaKm = dadosRota.routes[0].distance / 1000;
    } else {
      // Se o serviço de rota falhar, usa distância em linha reta com uma margem de segurança
      const R = 6371;
      const dLat = (latCliente - empresa.latitude) * Math.PI / 180;
      const dLng = (lngCliente - empresa.longitude) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(empresa.latitude * Math.PI / 180) * Math.cos(latCliente * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
      distanciaKm = (R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))) * 1.3; // +30% de margem por não ser rota real
    }

    const taxaBase = config ? parseFloat(config.taxa_base_entrega || 0) : 0;
    const valorPorKm = config ? parseFloat(config.valor_por_km || 0) : 0;
    const valorFrete = Math.round((taxaBase + distanciaKm * valorPorKm) * 100) / 100;

    // 4. Busca o carrinho atual pra montar o pedido final
    const estados = await buscar('atendimento_estado', `conversa_id=eq.${conversaId}&select=carrinho`);
    const carrinho = estados[0] ? estados[0].carrinho : [];

    function precoParaNumero(precoTexto) {
      if (!precoTexto) return 0;
      let limpo = String(precoTexto).replace(/[^0-9,.]/g, '');
      if (limpo.includes(',')) limpo = limpo.replace(/\./g, '').replace(',', '.');
      return parseFloat(limpo) || 0;
    }

    const subtotal = (carrinho || []).reduce((soma, item) => soma + precoParaNumero(item.preco), 0);
    const total = Math.round((subtotal + valorFrete) * 100) / 100;

    let resumoItens = (carrinho || []).map(i => `• ${i.nome} — R$ ${i.preco}`).join('\n');
    const respostaFinal = `🧾 Confira seu pedido:\n${resumoItens}\n\n📍 Endereço: ${endereco}\n📏 Distância: ${distanciaKm.toFixed(1)} km\n🛵 Frete: R$ ${valorFrete.toFixed(2).replace('.', ',')}\n\nTotal: R$ ${total.toFixed(2).replace('.', ',')}\n\nConfirma o pedido? Responda *sim* ou *não*.`;

    await responderNoChat(respostaFinal);

    // Guarda o endereço e o frete calculado pro passo de confirmação usar
    await fetch(`${SUPABASE_URL}/rest/v1/atendimento_estado?conversa_id=eq.${conversaId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        estado: 'confirmando_pedido_entrega',
        lista_atual: [{ endereco, taxa_entrega: valorFrete, distancia_km: Math.round(distanciaKm * 10) / 10 }]
      })
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true, distanciaKm, valorFrete }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao calcular frete' }) };
  }
};