// O Mercado Pago manda o usuário de volta pra cá depois que ele autoriza a
// conexão. Troca o "code" recebido pelos tokens de acesso reais, e guarda
// na tabela mp_conexoes (isolada, protegida) associada à empresa certa.

exports.handler = async function (event) {
  try {
    const { code, state, error: erroAutorizacao } = event.queryStringParameters || {};
    const profissionalId = state;

    if (erroAutorizacao) {
      return {
        statusCode: 302,
        headers: { Location: `https://guiazap.shop/index.html?mp_conectado=erro` }
      };
    }

    if (!code || !profissionalId) {
      return { statusCode: 400, body: 'code e state (profissionalId) são obrigatórios' };
    }

    const MP_CLIENT_ID = process.env.MP_CLIENT_ID;
    const MP_CLIENT_SECRET = process.env.MP_CLIENT_SECRET;
    const REDIRECT_URI = 'https://guiazap.shop/.netlify/functions/mp-oauth-callback';

    // Troca o código de autorização pelos tokens de verdade
    const respToken = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: MP_CLIENT_ID,
        client_secret: MP_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI
      })
    });

    const dadosToken = await respToken.json();

    if (!respToken.ok || !dadosToken.access_token) {
      console.error('erro ao trocar code por token:', JSON.stringify(dadosToken));
      return {
        statusCode: 302,
        headers: { Location: `https://guiazap.shop/index.html?mp_conectado=erro` }
      };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates'
    };

    const expiraEm = new Date(Date.now() + (dadosToken.expires_in || 15552000) * 1000).toISOString();

    // Salva (ou atualiza, se já existia) na tabela isolada de conexões
    await fetch(`${SUPABASE_URL}/rest/v1/mp_conexoes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        profissional_id: profissionalId,
        mp_access_token: dadosToken.access_token,
        mp_refresh_token: dadosToken.refresh_token,
        mp_user_id: String(dadosToken.user_id),
        mp_token_expira_em: expiraEm,
        conectado: true,
        updated_at: new Date().toISOString()
      })
    });

    return {
      statusCode: 302,
      headers: { Location: `https://guiazap.shop/index.html?mp_conectado=sucesso` }
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 302,
      headers: { Location: `https://guiazap.shop/index.html?mp_conectado=erro` }
    };
  }
};