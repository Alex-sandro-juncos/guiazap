// Calcula o frete de uma entrega usando distância de ROTA real (não linha
// reta), via OSRM (motor de rotas gratuito, mesma filosofia do Nominatim que
// já usamos pra geocodificação). Fórmula: taxa_base + (km * valor_por_km).
// Ao final, grava o pedido, atualiza o estado do atendimento automático e
// manda a mensagem de confirmação pro cliente no Papo.

function normalizarEnderecoChaveFrete(rua, numero, cidade, estado){
  const partes = [rua, numero, cidade, estado].map(p => (p || '').toString().trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' '));
  return partes.filter(Boolean).join('|');
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { conversaId, profissionalId, endereco, latitude, longitude, enderecoEstruturado } = JSON.parse(event.body || '{}');
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

    // 2. Geocodifica o endereço digitado pelo cliente (pula se já veio com
    // coordenadas marcadas manualmente no mapa — mais preciso)
    let latCliente, lngCliente;

    if (latitude != null && longitude != null) {
      latCliente = latitude;
      lngCliente = longitude;
    } else {
      // 2a. Confere primeiro se alguém já confirmou EXATAMENTE esse mesmo
      // endereço no mapa antes (rede compartilhada de localizações
      // verificadas) — evita depender só do Nominatim, que costuma ser
      // impreciso em bairros/zona rural
      let achouNaRede = false;
      if (enderecoEstruturado && enderecoEstruturado.rua) {
        const chave = normalizarEnderecoChaveFrete(enderecoEstruturado.rua, enderecoEstruturado.numero, enderecoEstruturado.cidade, enderecoEstruturado.estado);
        const dadosRede = await buscar('enderecos_confirmados_mapa', `endereco_normalizado=eq.${encodeURIComponent(chave)}&select=latitude,longitude`);
        if (dadosRede && dadosRede.length > 0) {
          latCliente = dadosRede[0].latitude;
          lngCliente = dadosRede[0].longitude;
          achouNaRede = true;
        }
      }

      if (!achouNaRede) {
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

      latCliente = parseFloat(dadosGeo[0].lat);
      lngCliente = parseFloat(dadosGeo[0].lon);
      }
    }

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
    let valorFrete = Math.round((taxaBase + distanciaKm * valorPorKm) * 100) / 100;

    // 4. Busca o carrinho, a escolha de portão/porta (já feita ANTES do
    // endereço) e quem é o cliente dessa conversa
    const estados = await buscar('atendimento_estado', `conversa_id=eq.${conversaId}&select=carrinho,lista_atual`);
    const carrinho = estados[0] ? estados[0].carrinho : [];
    const localEntrega = estados[0] && estados[0].lista_atual && estados[0].lista_atual[0] ? estados[0].lista_atual[0].local_entrega : null;

    if (localEntrega === 'porta') {
      valorFrete = Math.round((valorFrete + 5) * 100) / 100;
    }

    const conversas = await buscar('conversas', `id=eq.${conversaId}&select=visitante_user_id`);
    const clienteUserId = conversas[0] ? conversas[0].visitante_user_id : null;

    function precoParaNumero(precoTexto) {
      if (!precoTexto) return 0;
      let limpo = String(precoTexto).replace(/[^0-9,.]/g, '');
      if (limpo.includes(',')) limpo = limpo.replace(/\./g, '').replace(',', '.');
      return parseFloat(limpo) || 0;
    }

    const subtotal = (carrinho || []).reduce((soma, item) => soma + precoParaNumero(item.preco), 0);
    const total = Math.round((subtotal + valorFrete) * 100) / 100;
    const codigoConfirmacao = String(Math.floor(1000 + Math.random() * 9000));

    // 5. Confirma o frete pro cliente (já com o acréscimo da porta, se for
    // o caso — a escolha de portão/porta já foi feita ANTES de pedir o
    // endereço, então não precisa perguntar de novo aqui) e guarda os
    // dados da entrega. Em seguida, chama a function do banco que decide
    // o próximo passo: perguntar qual motoboy, ou já ir pro pagamento.
    const textoLocalEntrega = localEntrega === 'porta' ? '🏠 Entrega na porta (+R$5,00 já incluso)' : '🚪 Entrega no portão';
    await responderNoChat(`📍 Endereço confirmado: ${endereco}\n📏 Distância: ${distanciaKm.toFixed(1)} km\n${textoLocalEntrega}\n\n🛒 Produtos: R$ ${subtotal.toFixed(2).replace('.', ',')}\n🛵 Frete: R$ ${valorFrete.toFixed(2).replace('.', ',')}\n💰 Total: R$ ${total.toFixed(2).replace('.', ',')}`);

    await fetch(`${SUPABASE_URL}/rest/v1/atendimento_estado?conversa_id=eq.${conversaId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        lista_atual: [{ endereco, taxa_entrega: valorFrete, distancia_km: Math.round(distanciaKm * 10) / 10, latitude: latCliente, longitude: lngCliente, local_entrega: localEntrega }]
      })
    });

    const respPosCalculo = await fetch(`${SUPABASE_URL}/rest/v1/rpc/guiazap_pos_calculo_frete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_conversa_id: conversaId, p_profissional_id: profissionalId })
    });
    if (!respPosCalculo.ok) {
      const erroTexto = await respPosCalculo.text().catch(() => '');
      console.error('erro ao chamar guiazap_pos_calculo_frete:', respPosCalculo.status, erroTexto);
      await responderNoChat(`⚠️ Deu um probleminha ao continuar o pedido (erro: ${respPosCalculo.status}). Digite *menu* e tenta de novo, ou fala com a empresa.`);
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, distanciaKm, valorFrete }) };
  } catch (err) {
    console.error(err);

    // Rede de segurança: mesmo num erro inesperado, avisa o cliente e
    // destrava o atendimento — sem isso, a pessoa ficava presa em
    // "calculando o frete..." pra sempre, até o pedido cancelar sozinho.
    try {
      const bodyRecebido = JSON.parse(event.body || '{}');
      const conversaIdSeguro = bodyRecebido.conversaId;
      const profissionalIdSeguro = bodyRecebido.profissionalId;

      if (conversaIdSeguro) {
        const SUPABASE_URL_SEGURO = process.env.SUPABASE_URL;
        const SUPABASE_SERVICE_ROLE_KEY_SEGURO = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const headersSeguro = {
          apikey: SUPABASE_SERVICE_ROLE_KEY_SEGURO,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY_SEGURO}`,
          'Content-Type': 'application/json'
        };

        let donoUserIdSeguro = null;
        if (profissionalIdSeguro) {
          const donoRespSeguro = await fetch(`${SUPABASE_URL_SEGURO}/rest/v1/profissionais?id=eq.${profissionalIdSeguro}&select=user_id`, { headers: headersSeguro });
          const donoDataSeguro = await donoRespSeguro.json();
          donoUserIdSeguro = donoDataSeguro[0] ? donoDataSeguro[0].user_id : null;
        }

        await fetch(`${SUPABASE_URL_SEGURO}/rest/v1/mensagens_chat`, {
          method: 'POST',
          headers: headersSeguro,
          body: JSON.stringify({
            conversa_id: conversaIdSeguro,
            remetente_user_id: donoUserIdSeguro,
            tipo: 'texto',
            texto: '⚠️ Tivemos um problema técnico pra calcular o frete. Digite *menu* pra tentar de novo, ou fale com a empresa.',
            lida: false,
            enviado_por_bot: true
          })
        });

        await fetch(`${SUPABASE_URL_SEGURO}/rest/v1/atendimento_estado?conversa_id=eq.${conversaIdSeguro}`, {
          method: 'PATCH',
          headers: headersSeguro,
          body: JSON.stringify({ estado: 'menu_principal', carrinho: [], lista_atual: [] })
        });
      }
    } catch (errSeguro) {
      console.error('Erro até na rede de segurança de calcular-frete-entrega:', errSeguro);
    }

    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao calcular frete' }) };
  }
};