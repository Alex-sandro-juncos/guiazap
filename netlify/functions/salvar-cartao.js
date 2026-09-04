// Salva um cartão pra uso futuro nas compras por voz. Recebe só o TOKEN já
// gerado pelo Mercado Pago no navegador da pessoa (via SDK.js deles) —
// nunca vê o número do cartão de verdade. Cria um "cliente" no Mercado Pago
// (se ainda não existir) e anexa o cartão a ele.

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { cardToken } = JSON.parse(event.body || '{}');
    if (!cardToken) {
      return { statusCode: 400, body: JSON.stringify({ error: 'cardToken é obrigatório' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    const tokenUsuario = (event.headers.authorization || event.headers.Authorization || '').replace('Bearer ', '');
    if (!tokenUsuario) {
      return { statusCode: 401, body: JSON.stringify({ error: 'não autenticado' }) };
    }
    const usuarioResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${tokenUsuario}` }
    });
    if (!usuarioResp.ok) {
      return { statusCode: 401, body: JSON.stringify({ error: 'sessão inválida ou expirada' }) };
    }
    const usuario = await usuarioResp.json();

    // 1. Confere se essa pessoa já tem um "cliente" no Mercado Pago (criado
    // numa vez anterior) — se não tiver, cria um novo
    const existenteResp = await fetch(`${SUPABASE_URL}/rest/v1/cartoes_salvos_usuario?user_id=eq.${usuario.id}&select=mp_customer_id`, { headers });
    const existenteData = await existenteResp.json();

    let mpCustomerId = existenteData[0] ? existenteData[0].mp_customer_id : null;

    if (!mpCustomerId) {
      const criarClienteResp = await fetch('https://api.mercadopago.com/v1/customers', {
        method: 'POST',
        headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: usuario.email })
      });
      const criarClienteData = await criarClienteResp.json();

      if (!criarClienteResp.ok) {
        // Se o cliente já existe no Mercado Pago com esse e-mail (de uma
        // tentativa anterior), ele avisa — tenta buscar em vez de criar de novo
        if (criarClienteData.cause && criarClienteData.cause[0] && criarClienteData.cause[0].code === '101') {
          const buscaResp = await fetch(`https://api.mercadopago.com/v1/customers/search?email=${encodeURIComponent(usuario.email)}`, {
            headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
          });
          const buscaData = await buscaResp.json();
          mpCustomerId = buscaData.results && buscaData.results[0] ? buscaData.results[0].id : null;
        }
        if (!mpCustomerId) {
          console.error('erro ao criar cliente no Mercado Pago:', JSON.stringify(criarClienteData));
          return { statusCode: 500, body: JSON.stringify({ error: 'erro ao registrar cliente no Mercado Pago' }) };
        }
      } else {
        mpCustomerId = criarClienteData.id;
      }
    }

    // 2. Anexa o cartão (via token) a esse cliente
    const cartaoResp = await fetch(`https://api.mercadopago.com/v1/customers/${mpCustomerId}/cards`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: cardToken })
    });
    const cartaoData = await cartaoResp.json();

    if (!cartaoResp.ok) {
      console.error('erro ao salvar cartão:', JSON.stringify(cartaoData));
      return { statusCode: 500, body: JSON.stringify({ error: 'Não consegui salvar esse cartão. Confere os dados e tenta de novo.' }) };
    }

    // 3. Guarda a referência (nunca o número do cartão) — substitui um
    // cartão salvo anterior, se já existia (só permite 1 cartão por pessoa,
    // por simplicidade)
    await fetch(`${SUPABASE_URL}/rest/v1/cartoes_salvos_usuario?user_id=eq.${usuario.id}`, { method: 'DELETE', headers });

    await fetch(`${SUPABASE_URL}/rest/v1/cartoes_salvos_usuario`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        user_id: usuario.id,
        mp_customer_id: mpCustomerId,
        mp_card_id: cartaoData.id,
        ultimos_digitos: cartaoData.last_four_digits,
        bandeira: cartaoData.payment_method ? cartaoData.payment_method.name : null
      })
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true, ultimosDigitos: cartaoData.last_four_digits }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao salvar cartão' }) };
  }
};