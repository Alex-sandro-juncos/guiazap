const crypto = require('crypto');

function hashPin(pin, userId){
  return crypto.createHash('sha256').update(pin + ':' + userId).digest('hex');
}

exports.handler = async function (event) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const pin = body.pin;
    if (!pin || !/^\d{4,6}$/.test(pin)) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'PIN precisa ter de 4 a 6 números' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'servidor sem SUPABASE_URL/ANON_KEY' }) };
    }

    const rawAuth = event.headers.authorization || event.headers.Authorization || body.access_token || '';
    const tokenUsuario = String(rawAuth).replace(/^Bearer\s+/i, '').trim();
    if (!tokenUsuario) {
      return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'não autenticado' }) };
    }

    const usuarioResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + tokenUsuario }
    });
    if (!usuarioResp.ok) {
      const detalhe = await usuarioResp.text();
      console.error('auth/user falhou', usuarioResp.status, detalhe);
      return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'sessão inválida ou expirada' }) };
    }
    const usuario = await usuarioResp.json();
    if (!usuario || !usuario.id) {
      return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'sessão inválida ou expirada' }) };
    }

    if (!SUPABASE_SERVICE_ROLE_KEY) {
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'servidor sem SERVICE_ROLE' }) };
    }

    const hash = hashPin(pin, usuario.id);
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json'
    };

    // Confere PRIMEIRO se já existe uma linha pra esse usuário, em vez de
    // torcer pra um INSERT com "merge-duplicates" dar certo sozinho — isso
    // só funciona direito se a coluna user_id tiver uma restrição de
    // "único" configurada no banco, o que não dá pra garantir daqui. Assim
    // fica à prova de erro, não importa como a tabela foi configurada.
    const existeResp = await fetch(`${SUPABASE_URL}/rest/v1/perfis_usuario?user_id=eq.${usuario.id}&select=user_id`, { headers });
    if (!existeResp.ok) {
      const txt = await existeResp.text();
      console.error('erro ao conferir perfil existente', existeResp.status, txt);
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'não deu pra checar o perfil no banco' }) };
    }
    const existentes = await existeResp.json();

    let opResp;
    if (existentes.length > 0) {
      // Já existe — atualiza só o PIN, sem mexer no resto do perfil
      opResp = await fetch(`${SUPABASE_URL}/rest/v1/perfis_usuario?user_id=eq.${usuario.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ pin_voz_hash: hash })
      });
    } else {
      // Não existe ainda — cria a linha
      opResp = await fetch(`${SUPABASE_URL}/rest/v1/perfis_usuario`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ user_id: usuario.id, pin_voz_hash: hash })
      });
    }

    if (!opResp.ok) {
      const txt = await opResp.text();
      console.error('salvar pin falhou', opResp.status, txt);
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'não deu pra salvar o PIN no banco: ' + txt }) };
    }

    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'erro ao definir PIN' }) };
  }
};