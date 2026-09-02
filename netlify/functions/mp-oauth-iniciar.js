// Gera a URL de autorização do Mercado Pago, mas só depois de confirmar
// (no servidor, com autenticação de verdade) que quem está pedindo é dono
// da empresa. Usa um "state" opaco e aleatório em vez do profissionalId
// puro — isso impede que alguém associe a própria conta MP a uma empresa
// que não é dela.

const crypto = require('crypto');

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { profissionalId } = JSON.parse(event.body || '{}');
    if (!profissionalId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'profissionalId é obrigatório' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const MP_CLIENT_ID = process.env.MP_CLIENT_ID;
    const REDIRECT_URI = 'https://guiazap.shop/.netlify/functions/mp-oauth-callback';

    const headersServico = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    // 1. Confere se quem está chamando está LOGADO de verdade
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

    // 2. Confere se essa empresa é REALMENTE dele
    const empresaResp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&select=user_id`, { headers: headersServico });
    const empresaData = await empresaResp.json();
    if (!empresaData[0] || empresaData[0].user_id !== usuario.id) {
      return { statusCode: 403, body: JSON.stringify({ error: 'essa empresa não é sua' }) };
    }

    // 3. Gera um código aleatório opaco (o "state") e salva a associação
    // real no banco — o Mercado Pago só devolve esse código de volta, então
    // ninguém consegue adulterar pra qual empresa a conexão vai
    const state = crypto.randomBytes(24).toString('hex');

    await fetch(`${SUPABASE_URL}/rest/v1/mp_oauth_states`, {
      method: 'POST',
      headers: headersServico,
      body: JSON.stringify({ state, user_id: usuario.id, profissional_id: profissionalId })
    });

    const urlAutorizacao = `https://auth.mercadopago.com.br/authorization?client_id=${MP_CLIENT_ID}&response_type=code&platform_id=mp&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${state}`;

    return { statusCode: 200, body: JSON.stringify({ url: urlAutorizacao }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao gerar link de autorização' }) };
  }
};