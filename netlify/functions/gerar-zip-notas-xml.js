// "Zip único dos XML do mês" — junta o XML de TODAS as notas fiscais
// emitidas de verdade (nf_status = 'emitida') num período, num único
// arquivo .zip, pra mandar pro contador de uma vez (sem baixar nota por
// nota, uma por uma, na mão). Só empresas que já ativaram emissão de nota
// (Estoque > "Nota / cupom fiscal") têm XML pra juntar — quem não emite
// nota ainda recebe zip vazio com aviso.
//
// Cada XML é baixado da própria Focus NFe (Basic Auth com o token QUE A
// EMPRESA colou — nunca um token do GuiaZap, mesma regra de sempre) a
// partir do caminho absoluto já salvo em empresa_pedidos.nf_caminho_xml
// (ver sql/nota-fiscal-xml-migration.sql e o conserto em
// emitir-nota-fiscal.js — antes esse caminho vinha relativo da Focus NFe
// e não dava pra baixar nada com ele).

const JSZip = require('jszip');

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader) {
      return { statusCode: 401, body: JSON.stringify({ error: 'precisa estar logado' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    const token = authHeader.replace('Bearer ', '');
    const usuarioResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
    });
    if (!usuarioResp.ok) {
      return { statusCode: 401, body: JSON.stringify({ error: 'sessão inválida ou expirada' }) };
    }
    const usuario = await usuarioResp.json();

    const body = JSON.parse(event.body || '{}');
    const { profissionalId, ano, mes } = body;
    if (!profissionalId || !ano || !mes) {
      return { statusCode: 400, body: JSON.stringify({ error: 'profissionalId, ano e mes são obrigatórios' }) };
    }

    const empresaResp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&user_id=eq.${usuario.id}&select=id,name`, { headers });
    const empresaData = empresaResp.ok ? await empresaResp.json() : [];
    if (!empresaData.length) {
      return { statusCode: 403, body: JSON.stringify({ error: 'essa empresa não é sua' }) };
    }
    const empresa = empresaData[0];

    const fiscalResp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais_fiscal_config?profissional_id=eq.${profissionalId}&select=nf_token`, { headers });
    const fiscalData = fiscalResp.ok ? await fiscalResp.json() : [];
    const nfToken = fiscalData[0] && fiscalData[0].nf_token;

    const mesStr = String(mes).padStart(2, '0');
    const inicio = `${ano}-${mesStr}-01`;
    const ultimoDia = new Date(Number(ano), Number(mes), 0).getDate();
    const fim = `${ano}-${mesStr}-${String(ultimoDia).padStart(2, '0')}`;

    const pedidosResp = await fetch(
      `${SUPABASE_URL}/rest/v1/empresa_pedidos?profissional_id=eq.${profissionalId}&nf_status=eq.emitida&nf_caminho_xml=not.is.null&created_at=gte.${inicio}&created_at=lt.${fim}T23:59:59&select=id,nf_numero,nf_chave,nf_caminho_xml`,
      { headers }
    );
    const pedidos = pedidosResp.ok ? await pedidosResp.json() : [];

    const zip = new JSZip();

    if (!pedidos.length || !nfToken) {
      zip.file(
        'sem-notas.txt',
        pedidos.length
          ? 'A empresa ainda não configurou o token de emissão de nota — não dá pra baixar o XML da Focus NFe sem ele.'
          : `Nenhuma nota fiscal emitida encontrada pra ${empresa.name} em ${mesStr}/${ano}.`
      );
    } else {
      const authFocus = 'Basic ' + Buffer.from(`${nfToken}:`).toString('base64');
      let baixadas = 0;
      let falhas = 0;

      for (const pedido of pedidos) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const xmlResp = await fetch(pedido.nf_caminho_xml, { headers: { Authorization: authFocus } });
          if (xmlResp.ok) {
            // eslint-disable-next-line no-await-in-loop
            const xmlTexto = await xmlResp.text();
            const nomeArquivo = `nota-${pedido.nf_numero || pedido.id}-${(pedido.nf_chave || '').slice(-8) || pedido.id}.xml`;
            zip.file(nomeArquivo, xmlTexto);
            baixadas++;
          } else {
            falhas++;
          }
        } catch (eBaixar) {
          falhas++;
        }
      }

      if (falhas > 0) {
        zip.file('avisos.txt', `${baixadas} nota(s) baixada(s) com sucesso. ${falhas} nota(s) não deu pra baixar agora (tenta de novo mais tarde, ou confere se o token de emissão ainda está válido).`);
      }
    }

    const zipBase64 = await zip.generateAsync({ type: 'base64' });
    const nomeZip = `notas-xml-${empresa.name.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 40)}-${mesStr}-${ano}.zip`;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${nomeZip}"`
      },
      body: zipBase64,
      isBase64Encoded: true
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao gerar o zip das notas' }) };
  }
};