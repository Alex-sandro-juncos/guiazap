# GuiaZap

Diretório de empresas e profissionais com busca, filtros em cascata
(Estado > Cidade > Bairro), avaliações, foto de perfil e contato direto
pelo WhatsApp.

## Estrutura do projeto

```
guiazap/
├── index.html       -> estrutura da página
├── css/style.css     -> visual (cores, layout)
├── js/app.js          -> lógica (busca, filtros, cadastro, conexão com o banco)
├── config.js          -> suas credenciais do Supabase (preencher)
├── sql/schema.sql   -> script para criar a tabela no Supabase
└── README.md
```

## 1. Criar o banco de dados (Supabase) — uma vez só

1. Crie uma conta grátis em https://supabase.com e crie um novo projeto.
2. Vá em **SQL Editor > New query**, cole o conteúdo de `sql/schema.sql` e clique em Run.
3. Em **Project Settings > API**, copie a **Project URL** e a chave **anon public**.

## 2. Configurar o código

Abra `config.js` e cole os dois valores:

```js
const SUPABASE_URL = "https://xxxxxxxxxxxx.supabase.co";
const SUPABASE_ANON_KEY = "sua-chave-anon-aqui";
```

Salve, abra o `index.html` (ou use a extensão "Live Server" no VS Code) e teste.

## 3. Subir pro GitHub

No terminal (Git Bash), dentro da pasta `guiazap`:

```
git init
git add .
git commit -m "primeiro commit"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/guiazap.git
git push -u origin main
```

## 4. Publicar (Netlify)

1. Crie conta grátis em https://netlify.com, conecte ao repositório do GitHub.
2. Clique em Deploy — você recebe um link público.
3. Depois, em **Domain settings**, conecte o domínio `guiazap.shop` (comprado na Hostinger).

A partir daí: editar código → salvar → `git add . && git commit -m "ajuste" && git push`
→ o site atualiza sozinho.

## Próximas etapas combinadas (ainda não implementadas)

- Login/senha por empresa/pessoa (Supabase Auth), para que cada uma só edite seu próprio cadastro
- Integração com Mercado Pago para cobrança (sem período grátis, valor inicial simbólico)

## Sobre o campo WhatsApp

O botão "Chamar no WhatsApp" usa `https://wa.me/55<número>` — cadastre o número só
com DDD, sem símbolos (ex: 11912345678). O 55 (Brasil) já está fixo no código.

## Observação de segurança

As políticas do banco hoje deixam qualquer visitante cadastrar/editar/excluir —
bom para testar, mas isso será resolvido quando adicionarmos o login (próxima etapa).