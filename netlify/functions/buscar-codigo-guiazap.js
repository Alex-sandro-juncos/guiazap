// Busca um perfil pelo código GuiaZap de forma segura — essa consulta usa a
// chave de serviço (não a chave pública do navegador), então não depende da
// política de RLS da tabela pra funcionar, e o navegador nunca tem acesso
// direto à tabela inteira de perfis. Só retorna o mínimo necessário
// (user_id e nome) quando a correspondência é EXATA.

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { codigo } = JSON.parse(event.body || '{}');
    if (!codigo || typeof codigo !== 'string') {
      return { statusCode: 400, body: JSON.stringify({ error: 'codigo é obrigatório' }) };
    }

    // Só aceita o formato esperado (GZ + 8 dígitos) — qualquer outra coisa
    // já retorna "não encontrado" sem nem consultar o banco
    const codigoLimpo = codigo.trim().toUpperCase();
    if (!/^GZ\d{8}$/.test(codigoLimpo)) {
      return { statusCode: 200, body: JSON.stringify({ encontrado: false }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/perfis_usuario?codigo_guiazap=eq.${encodeURIComponent(codigoLimpo)}&select=user_id,nome_exibicao`,
      { headers }
    );
    const resultados = await resp.json();

    if (!resultados || resultados.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ encontrado: false }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ encontrado: true, userId: resultados[0].user_id, nome: resultados[0].nome_exibicao })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao buscar código' }) };
  }
};