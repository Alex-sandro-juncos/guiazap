// Define (ou atualiza) o PIN de voz do usuário — só guarda o HASH, nunca o
// número puro. Esse PIN é pedido antes de confirmar um pagamento pelo modo
// voz, como camada extra de segurança (evita que alguém pegue o celular
// destravado da pessoa e compre sem querer/sem autorização).

const crypto = require('crypto');

function hashPin(pin, userId){
  // Usa o próprio ID do usuário como "sal", pra dois usuários com o mesmo
  // PIN não gerarem o mesmo hash
  return crypto.createHash('sha256').update(pin + ':' + userId).digest('hex');
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { pin } = JSON.parse(event.body || '{}');
    if (!pin || !/^\d{4,6}$/.test(pin)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'PIN precisa ter de 4 a 6 números' }) };
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

    const hash = hashPin(pin, usuario.id);

    await fetch(`${SUPABASE_URL}/rest/v1/perfis_usuario`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ user_id: usuario.id, pin_voz_hash: hash })
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao definir PIN' }) };
  }
};