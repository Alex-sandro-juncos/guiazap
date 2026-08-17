// Só retorna dados se quem estiver pedindo for o e-mail administrador.
// Usa a chave secreta pra ler tabelas que não têm leitura pública (feedback_site, denúncias).

const ADMIN_EMAIL = 'contato@guiazap.shop';

exports.handler = async function (event) {
  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader) {
      return { statusCode: 401, body: JSON.stringify({ error: 'não autenticado' }) };
    }
    const token = authHeader.replace('Bearer ', '');

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` }
    });
    const userData = await userResp.json();

    if (!userData.email || userData.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      return { statusCode: 403, body: JSON.stringify({ error: 'acesso negado' }) };
    }

    async function buscar(tabela, ordem) {
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/${tabela}?select=*&order=${ordem || 'created_at.desc'}`,
        { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
      );
      return resp.json();
    }

    const [feedbackSite, denuncias, denunciasProdutos, mensagensEmpresa, profissionais, produtos] = await Promise.all([
      buscar('feedback_site'),
      buscar('denuncias'),
      buscar('denuncias_produtos'),
      buscar('mensagens_empresa'),
      buscar('profissionais', 'name.asc'),
      buscar('produtos', 'nome.asc')
    ]);

    return {
      statusCode: 200,
      body: JSON.stringify({ feedbackSite, denuncias, denunciasProdutos, mensagensEmpresa, profissionais, produtos })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};