// Recebe um pedido de resgate de cupom (usuário logado digitou um código).
// 1. Confirma quem é o usuário de verdade (pelo token de login).
// 2. Verifica se o cupom existe e está ativo.
// 3. Resgata de forma ATÔMICA via função do Postgres (resgatar_cupom_atomic)
//    — evita que dois resgates simultâneos do mesmo cupom estourem o
//    limite de usos_maximos (o que acontecia antes, lendo e somando o
//    contador em duas chamadas separadas).
// 4. Se o resgate atômico confirmar que ainda tinha uso disponível, ativa
//    o cadastro sem cobrar nada.

exports.handler = async function (event) {
  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader) {
      return { statusCode: 401, body: JSON.stringify({ error: 'não autenticado' }) };
    }
    const token = authHeader.replace('Bearer ', '');

    const body = JSON.parse(event.body || '{}');
    const { codigo, profissionalId } = body;

    if (!codigo || !profissionalId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'código ou cadastro não informado' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };

    // 1. Confirma o usuário real a partir do token
    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` }
    });
    const userData = await userResp.json();
    if (!userData.id) {
      return { statusCode: 401, body: JSON.stringify({ error: 'sessão inválida' }) };
    }

    const codigoNormalizado = codigo.trim().toUpperCase();

    // 2. Busca o cupom só pra dar uma mensagem de erro melhor (inválido vs
    // esgotado) — quem decide de verdade se ainda cabe um uso é o passo 3
    const cupomResp = await fetch(
      `${SUPABASE_URL}/rest/v1/cupons?codigo=eq.${encodeURIComponent(codigoNormalizado)}&select=codigo,ativo,usos_atuais,usos_maximos`,
      { headers }
    );
    const cupons = await cupomResp.json();
    const cupom = cupons[0];

    if (!cupom || !cupom.ativo) {
      return { statusCode: 404, body: JSON.stringify({ error: 'cupom inválido ou inexistente' }) };
    }

    // 3. Confirma que o cadastro pertence mesmo a esse usuário
    const cadastroResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&user_id=eq.${userData.id}&select=id,status_pagamento`,
      { headers }
    );
    const cadastros = await cadastroResp.json();
    if (!cadastros[0]) {
      return { statusCode: 403, body: JSON.stringify({ error: 'esse cadastro não pertence a você' }) };
    }

    // 4. Resgate atômico — só passa daqui se realmente sobrou uso, sem
    // brecha de corrida entre resgates concorrentes
    const rpcResp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/resgatar_cupom_atomic`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_codigo: codigoNormalizado })
    });
    const conseguiuResgatar = await rpcResp.json();

    if (!rpcResp.ok) {
      console.error('erro ao chamar resgatar_cupom_atomic:', JSON.stringify(conseguiuResgatar));
      return { statusCode: 500, body: JSON.stringify({ error: 'erro ao resgatar cupom' }) };
    }
    if (!conseguiuResgatar) {
      return { statusCode: 400, body: JSON.stringify({ error: 'cupom esgotado' }) };
    }

    await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status_pagamento: 'ativo' })
    });

    return { statusCode: 200, body: JSON.stringify({ sucesso: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};