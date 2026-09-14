# GuiaZap

Diretório de empresas e profissionais locais, com busca, Vitrine de produtos,
chat próprio (Papo), sistema de pedidos e entrega, vagas de emprego, currículo,
e modo de voz em quase todo o site.

## Estrutura do projeto

```
guiazap/
├── index.html, vitrine.html, chat.html, ...   -> páginas do site
├── css/style.css                               -> visual (cores, layout)
├── js/                                          -> lógica de cada página
├── config.js                                    -> credenciais do Supabase
├── sql/                                         -> scripts pra rodar no Supabase
├── netlify/functions/                           -> backend (Netlify Functions)
└── README.md
```

## Configurar o projeto do zero

1. Crie um projeto em https://supabase.com
2. Rode os scripts da pasta `sql/` no SQL Editor do Supabase (na ordem em que foram criados)
3. Em **Project Settings > API**, copie a **Project URL** e a chave **anon public** pro `config.js`
4. No Netlify, configure as variáveis de ambiente necessárias (Supabase, Mercado Pago, Anthropic/Gemini, Resend, etc. — confira cada function em `netlify/functions/` pra saber quais chaves ela usa)

## Publicar mudanças

```
git add .
git commit -m "descrição da mudança"
git push
```

O Netlify publica sozinho a cada push na branch `main`.

## Segurança

- As tabelas usam Row Level Security (RLS) no Supabase — cada pessoa só edita/exclui o próprio cadastro (`auth.uid() = user_id`). Confira em **Authentication > Policies** no Supabase se tiver dúvida.
- O webhook do Mercado Pago (`mp-webhook.js`) exige a variável `MP_WEBHOOK_SECRET` configurada — sem ela, o webhook recusa avisos de pagamento por segurança.
- O login por PIN usa um "pepper" de servidor (`PIN_PEPPER_SECRET`) — sem essa variável, o hash do PIN fica mais fraco.

## Sobre o campo WhatsApp

O botão "Chamar no WhatsApp" usa `https://wa.me/55<número>` — cadastre o número só
com DDD, sem símbolos (ex: 11912345678). O 55 (Brasil) já está fixo no código.v