// Senha gerencial do PDV — trava pra cancelar/devolver uma venda que já
// foi lançada no sistema (caixa, estoque, pedido). O operador do balcão
// não pode desfazer uma venda sozinho: precisa que o gerente/dono digite
// essa senha. Guardamos só o HASH no banco (nunca a senha em texto puro),
// e a verificação SEMPRE acontece aqui no servidor — o hash nunca é
// mandado pro navegador, então não dá pra "roubar" a senha inspecionando
// o app. Mesmo esquema de bloqueio por 5 tentativas erradas / 15 min que
// o PIN de login rápido já usa (login-com-pin.js/definir-pin-login.js).
//
// action "definir": só o DONO da empresa (autenticado) pode configurar
//   ou trocar a senha gerencial.
// action "verificar": qualquer pessoa logada com acesso a essa empresa
//   pode tentar (o operador do caixa também é um user_id logado, só não
//   é necessariamente o dono) — o que importa é acertar a senha.

const crypto = require('crypto');

// Código de acesso é POR CAIXA/TERMINAL (não mais um só pra empresa
// inteira) — assim uma empresa tipo supermercado com vários caixas
// físicos consegue saber depois qual caixa vendeu o quê, e cada um pode
// fechar/conferir separado.
function hashCodigoAcesso(codigo, profissionalId, caixaPdvId){
  const pepper = process.env.PIN_PEPPER_SECRET || '';
  return crypto.createHash('sha256').update(pepper + ':pdvcodigo:' + codigo + ':' + profissionalId + ':' + caixaPdvId).digest('hex');
}

function hashSenha(senha, profissionalId){
  // Pepper só existe nas variáveis de ambiente do servidor — reaproveita
  // o mesmo segredo do PIN de login rápido, é o mesmo tipo de proteção.
  const pepper = process.env.PIN_PEPPER_SECRET || '';
  return crypto.createHash('sha256').update(pepper + ':pdv:' + senha + ':' + profissionalId).digest('hex');
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { action, profissionalId, senha, novaSenha, caixaPdvId, nomeCaixa } = JSON.parse(event.body || '{}');
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

    const empResp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&user_id=eq.${usuario.id}&select=id,pdv_senha_gerencial_hash,pdv_senha_tentativas_erradas,pdv_senha_bloqueada_ate,pdv_codigo_acesso_hash`, { headers });
    const empData = empResp.ok ? await empResp.json() : [];
    if (!empData[0]) {
      return { statusCode: 403, body: JSON.stringify({ error: 'essa empresa não é sua' }) };
    }
    const empresa = empData[0];

    if (action === 'definir') {
      if (!novaSenha || !/^\d{4,6}$/.test(novaSenha)) {
        return { statusCode: 400, body: JSON.stringify({ error: 'A senha gerencial precisa ter de 4 a 6 números.' }) };
      }
      await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          pdv_senha_gerencial_hash: hashSenha(novaSenha, profissionalId),
          pdv_senha_tentativas_erradas: 0,
          pdv_senha_bloqueada_ate: null
        })
      });
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'verificar') {
      if (!empresa.pdv_senha_gerencial_hash) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Essa empresa ainda não configurou uma senha gerencial. Configura em "Estoque" no painel antes de cancelar/devolver uma venda.' }) };
      }
      if (empresa.pdv_senha_bloqueada_ate && new Date(empresa.pdv_senha_bloqueada_ate) > new Date()) {
        const minutosRestantes = Math.ceil((new Date(empresa.pdv_senha_bloqueada_ate) - new Date()) / 60000);
        return { statusCode: 429, body: JSON.stringify({ error: `Muitas tentativas erradas. Tenta de novo em ${minutosRestantes} minuto(s).` }) };
      }
      if (!senha) {
        return { statusCode: 400, body: JSON.stringify({ error: 'senha é obrigatória' }) };
      }

      const hashDigitado = hashSenha(senha, profissionalId);
      if (hashDigitado !== empresa.pdv_senha_gerencial_hash) {
        const novasTentativas = (empresa.pdv_senha_tentativas_erradas || 0) + 1;
        const bloquear = novasTentativas >= 5;
        await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            pdv_senha_tentativas_erradas: novasTentativas,
            pdv_senha_bloqueada_ate: bloquear ? new Date(Date.now() + 15 * 60000).toISOString() : null
          })
        });
        return { statusCode: 401, body: JSON.stringify({ autorizado: false, error: bloquear ? 'Senha errada muitas vezes. Bloqueado por 15 minutos.' : 'Senha gerencial incorreta.' }) };
      }

      await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ pdv_senha_tentativas_erradas: 0, pdv_senha_bloqueada_ate: null })
      });
      return { statusCode: 200, body: JSON.stringify({ autorizado: true }) };
    }

    // Só o DONO mexe nos caixas/terminais — cria, lista, renova código,
    // desativa. O código bruto só aparece UMA vez na resposta de
    // criar/renovar, nunca fica guardado em texto puro.

    if (action === 'criarCaixaPdv') {
      const nome = (nomeCaixa || '').trim();
      if (!nome) return { statusCode: 400, body: JSON.stringify({ error: 'Dá um nome pro caixa (ex: "Caixa 1").' }) };

      const criarResp = await fetch(`${SUPABASE_URL}/rest/v1/empresa_caixas_pdv`, {
        method: 'POST', headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({ profissional_id: profissionalId, nome })
      });
      const criarData = criarResp.ok ? await criarResp.json() : null;
      if (!criarResp.ok || !criarData || !criarData[0]) {
        return { statusCode: 500, body: JSON.stringify({ error: 'erro ao criar o caixa' }) };
      }
      const novoId = criarData[0].id;
      const codigo = crypto.randomBytes(4).toString('hex').toUpperCase(); // ex: "A1B2C3D4"
      await fetch(`${SUPABASE_URL}/rest/v1/empresa_caixas_pdv?id=eq.${novoId}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ codigo_acesso_hash: hashCodigoAcesso(codigo, profissionalId, novoId) })
      });
      return { statusCode: 200, body: JSON.stringify({ ok: true, caixaPdvId: novoId, nome, codigo }) };
    }

    if (action === 'renovarCodigoCaixaPdv') {
      if (!caixaPdvId) return { statusCode: 400, body: JSON.stringify({ error: 'caixaPdvId é obrigatório' }) };
      const codigo = crypto.randomBytes(4).toString('hex').toUpperCase();
      await fetch(`${SUPABASE_URL}/rest/v1/empresa_caixas_pdv?id=eq.${caixaPdvId}&profissional_id=eq.${profissionalId}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ codigo_acesso_hash: hashCodigoAcesso(codigo, profissionalId, caixaPdvId) })
      });
      return { statusCode: 200, body: JSON.stringify({ ok: true, codigo }) };
    }

    if (action === 'alternarCaixaPdv') {
      if (!caixaPdvId) return { statusCode: 400, body: JSON.stringify({ error: 'caixaPdvId é obrigatório' }) };
      const atualResp = await fetch(`${SUPABASE_URL}/rest/v1/empresa_caixas_pdv?id=eq.${caixaPdvId}&profissional_id=eq.${profissionalId}&select=ativo`, { headers });
      const atualData = atualResp.ok ? await atualResp.json() : [];
      if (!atualData[0]) return { statusCode: 404, body: JSON.stringify({ error: 'caixa não encontrado' }) };
      await fetch(`${SUPABASE_URL}/rest/v1/empresa_caixas_pdv?id=eq.${caixaPdvId}`, {
        method: 'PATCH', headers, body: JSON.stringify({ ativo: !atualData[0].ativo })
      });
      return { statusCode: 200, body: JSON.stringify({ ok: true, ativo: !atualData[0].ativo }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'action inválida' }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao processar senha gerencial' }) };
  }
};