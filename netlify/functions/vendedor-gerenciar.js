// Gerenciamento (criar / renovar código / ativar-desativar) dos
// vendedores externos de uma empresa — só o DONO autenticado de verdade
// mexe aqui. O código bruto de acesso só aparece UMA vez na resposta de
// criar/renovar, nunca fica guardado em texto puro (mesmo padrão de
// pdv-senha-gerencial.js pros caixas/PDV).

const crypto = require('crypto');
const { exigirPepper } = require('./pepper-seguranca-helper');

function hashCodigoAcesso(codigo, profissionalId, vendedorId) {
  const pepper = exigirPepper();
  return crypto.createHash('sha256').update(pepper + ':vendedorcodigo:' + codigo + ':' + profissionalId + ':' + vendedorId).digest('hex');
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { action, profissionalId, vendedorId, nomeVendedor } = JSON.parse(event.body || '{}');
    if (!profissionalId || !action) {
      return { statusCode: 400, body: JSON.stringify({ error: 'profissionalId e action são obrigatórios' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader) {
      return { statusCode: 401, body: JSON.stringify({ error: 'não autenticado' }) };
    }
    const token = authHeader.replace('Bearer ', '');
    const usuarioResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
    });
    if (!usuarioResp.ok) {
      return { statusCode: 401, body: JSON.stringify({ error: 'sessão inválida ou expirada' }) };
    }
    const usuario = await usuarioResp.json();

    const empResp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&user_id=eq.${usuario.id}&select=id`, { headers });
    const empData = empResp.ok ? await empResp.json() : [];
    if (!empData[0]) {
      return { statusCode: 403, body: JSON.stringify({ error: 'essa empresa não é sua' }) };
    }

    if (action === 'criarVendedor') {
      const nome = (nomeVendedor || '').trim();
      if (!nome) return { statusCode: 400, body: JSON.stringify({ error: 'Dá um nome pro vendedor (ex: "João - Zona Sul").' }) };

      const criarResp = await fetch(`${SUPABASE_URL}/rest/v1/empresa_vendedores_externos`, {
        method: 'POST', headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({ profissional_id: profissionalId, nome })
      });
      const criarData = criarResp.ok ? await criarResp.json() : null;
      if (!criarResp.ok || !criarData || !criarData[0]) {
        return { statusCode: 500, body: JSON.stringify({ error: 'erro ao criar o vendedor' }) };
      }
      const novoId = criarData[0].id;
      const codigo = crypto.randomBytes(4).toString('hex').toUpperCase();
      await fetch(`${SUPABASE_URL}/rest/v1/empresa_vendedores_externos?id=eq.${novoId}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ codigo_acesso_hash: hashCodigoAcesso(codigo, profissionalId, novoId) })
      });
      return { statusCode: 200, body: JSON.stringify({ ok: true, vendedorId: novoId, nome, codigo }) };
    }

    if (action === 'renovarCodigoVendedor') {
      if (!vendedorId) return { statusCode: 400, body: JSON.stringify({ error: 'vendedorId é obrigatório' }) };
      const codigo = crypto.randomBytes(4).toString('hex').toUpperCase();
      await fetch(`${SUPABASE_URL}/rest/v1/empresa_vendedores_externos?id=eq.${vendedorId}&profissional_id=eq.${profissionalId}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ codigo_acesso_hash: hashCodigoAcesso(codigo, profissionalId, vendedorId) })
      });
      return { statusCode: 200, body: JSON.stringify({ ok: true, codigo }) };
    }

    if (action === 'alternarVendedor') {
      if (!vendedorId) return { statusCode: 400, body: JSON.stringify({ error: 'vendedorId é obrigatório' }) };
      const atualResp = await fetch(`${SUPABASE_URL}/rest/v1/empresa_vendedores_externos?id=eq.${vendedorId}&profissional_id=eq.${profissionalId}&select=ativo`, { headers });
      const atualData = atualResp.ok ? await atualResp.json() : [];
      if (!atualData[0]) return { statusCode: 404, body: JSON.stringify({ error: 'vendedor não encontrado' }) };
      await fetch(`${SUPABASE_URL}/rest/v1/empresa_vendedores_externos?id=eq.${vendedorId}`, {
        method: 'PATCH', headers, body: JSON.stringify({ ativo: !atualData[0].ativo })
      });
      return { statusCode: 200, body: JSON.stringify({ ok: true, ativo: !atualData[0].ativo }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'action inválida' }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao gerenciar vendedor externo' }) };
  }
};