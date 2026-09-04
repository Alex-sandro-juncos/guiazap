// Confere o PIN de login desse dispositivo específico. Se estiver certo,
// gera um link de acesso válido (mesmo mecanismo do "esqueci minha senha"),
// que o navegador usa pra completar o login de verdade — sem precisar
// guardar senha nem token de sessão de longa duração no banco.
//
// ⚠️ SEGURANÇA: bloqueia por 15 minutos depois de 5 tentativas erradas, pra
// um PIN de 4-6 números não virar porta de entrada fácil de adivinhar.

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
    if (!pin || !deviceToken) {
      return { statusCode: 400, body: JSON.stringify({ error: 'pin e deviceToken são obrigatórios' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    // 1. Acha o registro desse dispositivo
    const dispResp = await fetch(`${SUPABASE_URL}/rest/v1/pin_login_dispositivos?device_token=eq.${encodeURIComponent(deviceToken)}&select=*`, { headers });
    const dispData = await dispResp.json();
    const dispositivo = dispData[0];

    if (!dispositivo) {
      return { statusCode: 404, body: JSON.stringify({ error: 'PIN não configurado nesse aparelho. Faz login normal primeiro.' }) };
    }

    // 2. Confere se está bloqueado por muitas tentativas erradas
    if (dispositivo.bloqueado_ate && new Date(dispositivo.bloqueado_ate) > new Date()) {
      const minutosRestantes = Math.ceil((new Date(dispositivo.bloqueado_ate) - new Date()) / 60000);
      return { statusCode: 429, body: JSON.stringify({ error: `Muitas tentativas erradas. Tenta de novo em ${minutosRestantes} minuto(s), ou faz login normal.` }) };
    }

    // 3. Confere o PIN
    const hashDigitado = hashPin(pin, dispositivo.user_id);
    if (hashDigitado !== dispositivo.pin_hash) {
      const novasTentativas = dispositivo.tentativas_erradas + 1;
      const bloquear = novasTentativas >= 5;
      await fetch(`${SUPABASE_URL}/rest/v1/pin_login_dispositivos?id=eq.${dispositivo.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          tentativas_erradas: novasTentativas,
          bloqueado_ate: bloquear ? new Date(Date.now() + 15 * 60000).toISOString() : null
        })
      });
      return { statusCode: 401, body: JSON.stringify({ error: bloquear ? 'PIN errado muitas vezes. Bloqueado por 15 minutos.' : 'PIN incorreto.' }) };
    }

    // 4. PIN certo — zera as tentativas e gera um link de acesso válido
    await fetch(`${SUPABASE_URL}/rest/v1/pin_login_dispositivos?id=eq.${dispositivo.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ tentativas_erradas: 0, bloqueado_ate: null })
    });

    const usuarioResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${dispositivo.user_id}`, { headers });
    const usuarioData = await usuarioResp.json();
    const email = usuarioData.email;

    const linkResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'magiclink', email })
    });
    const linkData = await linkResp.json();

    if (!linkResp.ok || !linkData.hashed_token) {
      console.error('erro ao gerar link de acesso:', JSON.stringify(linkData));
      return { statusCode: 500, body: JSON.stringify({ error: 'PIN certo, mas houve um erro ao entrar. Tenta o login normal.' }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, email, hashedToken: linkData.hashed_token })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao verificar PIN' }) };
  }
};