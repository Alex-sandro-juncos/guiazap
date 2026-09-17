// Confere se o PIN falado pelo usuário bate com o PIN dele guardado (nunca
// compara texto puro — refaz o hash e compara). Usado como trava de
// segurança antes de qualquer pagamento gerado pelo modo voz da Vitrine.
//
// ⚠️ SEGURANÇA: bloqueia por 15 minutos depois de 5 tentativas erradas,
// igual o PIN de login — sem isso, um PIN de 4-6 números pode ser
// adivinhado por tentativa e erro sem limite algum.

const crypto = require('crypto');

function hashPin(pin, userId){
  // O "pepper" é um segredo que só existe nas variáveis de ambiente do
  // servidor, nunca no banco de dados — mesmo que a tabela de PINs vaze
  // inteira, quem pegar o vazamento não consegue testar PIN por PIN
  // offline sem também ter essa chave (que não sai do Netlify).
  const pepper = process.env.PIN_PEPPER_SECRET || '';
  return crypto.createHash('sha256').update(pepper + ':' + pin + ':' + userId).digest('hex');
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

    const perfilResp = await fetch(`${SUPABASE_URL}/rest/v1/perfis_usuario?user_id=eq.${usuario.id}&select=pin_voz_hash,pin_voz_tentativas_erradas,pin_voz_bloqueado_ate`, { headers });
    const perfilData = await perfilResp.json();

    if (!perfilData[0] || !perfilData[0].pin_voz_hash) {
      return { statusCode: 200, body: JSON.stringify({ valido: false, motivo: 'sem_pin_cadastrado' }) };
    }

    const perfil = perfilData[0];

    // Confere se está bloqueado por muitas tentativas erradas
    if (perfil.pin_voz_bloqueado_ate && new Date(perfil.pin_voz_bloqueado_ate) > new Date()) {
      const minutosRestantes = Math.ceil((new Date(perfil.pin_voz_bloqueado_ate) - new Date()) / 60000);
      return { statusCode: 429, body: JSON.stringify({ valido: false, motivo: 'bloqueado', mensagem: `Muitas tentativas erradas. Tenta de novo em ${minutosRestantes} minuto(s).` }) };
    }

    const hashDigitado = hashPin(pin, usuario.id);
    const valido = hashDigitado === perfil.pin_voz_hash;

    if (!valido) {
      const novasTentativas = (perfil.pin_voz_tentativas_erradas || 0) + 1;
      const bloquear = novasTentativas >= 5;
      await fetch(`${SUPABASE_URL}/rest/v1/perfis_usuario?user_id=eq.${usuario.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          pin_voz_tentativas_erradas: novasTentativas,
          pin_voz_bloqueado_ate: bloquear ? new Date(Date.now() + 15 * 60000).toISOString() : null
        })
      });
      return { statusCode: 200, body: JSON.stringify({ valido: false, motivo: bloquear ? 'bloqueado' : 'pin_errado', mensagem: bloquear ? 'PIN errado muitas vezes. Bloqueado por 15 minutos.' : null }) };
    }

    // PIN certo — zera as tentativas
    await fetch(`${SUPABASE_URL}/rest/v1/perfis_usuario?user_id=eq.${usuario.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ pin_voz_tentativas_erradas: 0, pin_voz_bloqueado_ate: null })
    });

    return { statusCode: 200, body: JSON.stringify({ valido: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao conferir PIN' }) };
  }
};