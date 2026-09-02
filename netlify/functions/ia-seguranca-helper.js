// Arquivo auxiliar (não é uma function pública própria, é usado por dentro
// das outras) — confere se quem está chamando uma função de IA está logado,
// se é dono da empresa, e se ainda não passou do limite diário de uso.
// Assim ninguém consegue automatizar chamadas e gerar custo alto na conta
// da Anthropic/OpenAI sem controle nenhum.

async function verificarAutenticacaoEUsoIA(event, profissionalId, tipo, limiteDiario) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headersServico = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };

  // 1. Confere se está logado
  const tokenUsuario = (event.headers.authorization || event.headers.Authorization || '').replace('Bearer ', '');
  if (!tokenUsuario) {
    return { ok: false, statusCode: 401, error: 'não autenticado' };
  }
  const usuarioResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${tokenUsuario}` }
  });
  if (!usuarioResp.ok) {
    return { ok: false, statusCode: 401, error: 'sessão inválida ou expirada' };
  }
  const usuario = await usuarioResp.json();

  // 2. Confere se a empresa é dele mesmo
  if (!profissionalId) {
    return { ok: false, statusCode: 400, error: 'profissionalId é obrigatório' };
  }
  const empresaResp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&select=user_id,plano`, { headers: headersServico });
  const empresaData = await empresaResp.json();
  if (!empresaData[0] || empresaData[0].user_id !== usuario.id) {
    return { ok: false, statusCode: 403, error: 'essa empresa não é sua' };
  }
  if (empresaData[0].plano !== 'vendas') {
    return { ok: false, statusCode: 403, error: 'esse recurso de IA é exclusivo do Pacote Vendas' };
  }

  // 3. Confere e atualiza o limite diário de uso
  const hoje = new Date().toISOString().slice(0, 10);
  const usoResp = await fetch(`${SUPABASE_URL}/rest/v1/uso_ia_diario?profissional_id=eq.${profissionalId}&tipo=eq.${tipo}&data=eq.${hoje}&select=contador`, { headers: headersServico });
  const usoData = await usoResp.json();
  const contadorAtual = usoData[0] ? usoData[0].contador : 0;

  if (contadorAtual >= limiteDiario) {
    return { ok: false, statusCode: 429, error: `Você atingiu o limite diário de uso desse recurso de IA (${limiteDiario}/dia). Tenta de novo amanhã.` };
  }

  await fetch(`${SUPABASE_URL}/rest/v1/uso_ia_diario`, {
    method: 'POST',
    headers: { ...headersServico, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ profissional_id: profissionalId, tipo, data: hoje, contador: contadorAtual + 1 })
  });

  return { ok: true };
}

module.exports = { verificarAutenticacaoEUsoIA };