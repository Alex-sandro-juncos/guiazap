// Registra um PIN de login rápido, vinculado a ESSE dispositivo específico
// (device_token gerado no navegador e guardado local). Precisa estar logado
// normalmente (e-mail+senha) pra configurar isso — depois, nesse mesmo
// aparelho, pode entrar só com o PIN.

const crypto = require('crypto');

function hashPin(pin, userId){
  return crypto.createHash('sha256').update(pin + ':' + userId).digest('hex');
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { pin, deviceToken } = JSON.parse(event.body || '{}');
    if (!pin || !/^\d{4,6}$/.test(pin)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'PIN precisa ter de 4 a 6 números' }) };
    }
    if (!deviceToken) {
      return { statusCode: 400, body: JSON.stringify({ error: 'deviceToken é obrigatório' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates'
    };

    await fetch(`${SUPABASE_URL}/rest/v1/pin_login_dispositivos?on_conflict=device_token`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        device_token: deviceToken,
        user_id: usuario.id,
        pin_hash: hashPin(pin, usuario.id),
        tentativas_erradas: 0,
        bloqueado_ate: null
      })
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao configurar PIN de login' }) };
  }
};