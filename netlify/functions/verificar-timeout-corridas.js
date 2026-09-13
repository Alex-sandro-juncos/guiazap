// Roda a cada 2 minutos (configurado no netlify.toml). Procura corridas
// que estão "pendente" (esperando resposta do motoboy) há mais de 5
// minutos, marca como "expirada", e avisa quem pediu: se veio do robô
// automático (tem pedido_id), oferece escolher outro motoboy ou deixar a
// empresa decidir; se veio do Chamar Frete direto, avisa que não teve
// resposta e sugere tentar outro entregador.

const LIMITE_MINUTOS = 5;

exports.handler = async function () {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    const limiteData = new Date(Date.now() - LIMITE_MINUTOS * 60 * 1000).toISOString();

    const corridasResp = await fetch(
      `${SUPABASE_URL}/rest/v1/corridas_motoboy?status=eq.pendente&created_at=lt.${limiteData}&select=id,pedido_id,conversa_id,motoboy_id,entregador_profissional_id`,
      { headers }
    );
    const corridasExpiradas = await corridasResp.json();

    if (!corridasExpiradas || corridasExpiradas.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, expiradas: 0 }) };
    }

    for (const corrida of corridasExpiradas) {
      // Marca como expirada primeiro, pra não processar ela de novo na
      // próxima rodada mesmo se algo abaixo der erro
      await fetch(`${SUPABASE_URL}/rest/v1/corridas_motoboy?id=eq.${corrida.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: 'expirada', respondido_em: new Date().toISOString() })
      });

      if (corrida.pedido_id) {
        // Veio do robô automático — busca o pedido pra achar a conversa do
        // CLIENTE (diferente da conversa com o motoboy) e oferece escolher outro
        const pedidoResp = await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${corrida.pedido_id}&select=conversa_id,profissional_id`, { headers });
        const pedidos = await pedidoResp.json();
        const pedido = pedidos[0];
        if (pedido && pedido.conversa_id) {
          const donoResp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${pedido.profissional_id}&select=user_id`, { headers });
          const donos = await donoResp.json();
          const donoId = donos[0] ? donos[0].user_id : null;

          await fetch(`${SUPABASE_URL}/rest/v1/mensagens_chat`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              conversa_id: pedido.conversa_id,
              remetente_user_id: donoId,
              tipo: 'texto',
              texto: '⏳ O entregador escolhido não respondeu em 5 minutos. Digite o nome de outro entregador, ou *0* pra deixar a empresa escolher.',
              lida: false,
              enviado_por_bot: true
            })
          });
          await fetch(`${SUPABASE_URL}/rest/v1/atendimento_estado?conversa_id=eq.${pedido.conversa_id}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ estado: 'menu_principal', updated_at: new Date().toISOString() })
          });
          await fetch(`${SUPABASE_URL}/rest/v1/conversas?id=eq.${pedido.conversa_id}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ ultima_mensagem_em: new Date().toISOString() })
          });
        }
      } else if (corrida.conversa_id) {
        // Chamado direto (Chamar Frete) — avisa na mesma conversa (cliente
        // e entregador conversam direto ali) que não teve resposta a tempo
        const conversaResp = await fetch(`${SUPABASE_URL}/rest/v1/conversas?id=eq.${corrida.conversa_id}&select=profissional_id`, { headers });
        const conversas = await conversaResp.json();
        const profissionalIdConversa = conversas[0] ? conversas[0].profissional_id : null;
        let donoId = null;
        if (profissionalIdConversa) {
          const donoResp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalIdConversa}&select=user_id`, { headers });
          const donos = await donoResp.json();
          donoId = donos[0] ? donos[0].user_id : null;
        }

        await fetch(`${SUPABASE_URL}/rest/v1/mensagens_chat`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            conversa_id: corrida.conversa_id,
            remetente_user_id: donoId,
            tipo: 'texto',
            texto: '⏳ Esse entregador não respondeu em 5 minutos. Tenta chamar outro no Banco de Entregadores ou no Chamar Frete.',
            lida: false,
            enviado_por_bot: true
          })
        });
        await fetch(`${SUPABASE_URL}/rest/v1/conversas?id=eq.${corrida.conversa_id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ ultima_mensagem_em: new Date().toISOString() })
        });
      }
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, expiradas: corridasExpiradas.length }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};