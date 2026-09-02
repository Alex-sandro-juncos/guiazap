// Gera um link TEMPORÁRIO (expira em alguns minutos) pra ver um documento de
// verificação — só o próprio dono do documento ou o admin do GuiaZap
// conseguem gerar esse link. Substitui o link público permanente que
// existia antes (falha de segurança: qualquer um com o link via documento
// de identidade de qualquer pessoa).

const ADMIN_EMAIL = 'contato@guiazap.shop';

exports.handler = async function (event) {
  try {
    const { profissionalId } = event.queryStringParameters || {};
    if (!profissionalId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'profissionalId é obrigatório' }) };
    }

    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader) {
      return { statusCode: 401, body: JSON.stringify({ error: 'não autenticado' }) };
    }
    const token = authHeader.replace('Bearer ', '');

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` }
    });
    const userData = await userResp.json();
    if (!userData.id) {
      return { statusCode: 401, body: JSON.stringify({ error: 'sessão inválida' }) };
    }

    const ehAdmin = userData.email && userData.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();

    // Se não for admin, confere se é o DONO da empresa desse documento
    if (!ehAdmin) {
      const empresaResp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&select=user_id`, { headers });
      const empresaData = await empresaResp.json();
      if (!empresaData[0] || empresaData[0].user_id !== userData.id) {
        return { statusCode: 403, body: JSON.stringify({ error: 'acesso negado' }) };
      }
    }

    // Acha o caminho salvo do documento
    const docResp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&select=verificacao_documento_caminho`, { headers });
    const docData = await docResp.json();
    const caminho = docData[0] ? docData[0].verificacao_documento_caminho : null;

    if (!caminho) {
      return { statusCode: 404, body: JSON.stringify({ error: 'nenhum documento enviado ainda' }) };
    }

    // Gera um link temporário (5 minutos) pro documento no bucket privado
    const signedResp = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/documentos-verificacao/${caminho}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ expiresIn: 300 })
    });
    const signedData = await signedResp.json();

    if (!signedData.signedURL) {
      return { statusCode: 500, body: JSON.stringify({ error: 'erro ao gerar link do documento' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ url: `${SUPABASE_URL}/storage/v1${signedData.signedURL}` }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao gerar link do documento' }) };
  }
};