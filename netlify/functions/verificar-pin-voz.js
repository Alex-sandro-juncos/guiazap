// Confere se o PIN falado pelo usuário bate com o PIN dele guardado (nunca
// compara texto puro — refaz o hash e compara). Usado como trava de
// segurança antes de qualquer pagamento gerado pelo modo voz da Vitrine.

const crypto = require('crypto');

function hashPin(pin, userId){
  return crypto.createHash('sha256').update(pin + ':' + userId).digest('hex');
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { pin } = JSON.parse(event.body || '{}');
    if (!pin) {
      return { statusCode: 400, body: JSON.stringify({ error: 'pin é obrigatório' }) };
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
      'Content-Type': 'application/json'
    };

    const perfilResp = await fetch(`${SUPABASE_URL}/rest/v1/perfis_usuario?user_id=eq.${usuario.id}&select=pin_voz_hash`, { headers });
    const perfilData = await perfilResp.json();

    if (!perfilData[0] || !perfilData[0].pin_voz_hash) {
      return { statusCode: 200, body: JSON.stringify({ valido: false, motivo: 'sem_pin_cadastrado' }) };
    }

    const hashDigitado = hashPin(pin, usuario.id);
    const valido = hashDigitado === perfilData[0].pin_voz_hash;

    return { statusCode: 200, body: JSON.stringify({ valido }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao conferir PIN' }) };
  }
};