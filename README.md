# Prime Imóveis — site e painel de aluguel de imóveis

Site público para divulgação de imóveis para aluguel (casas, apartamentos, kitnets, coberturas e salas comerciais) com painel administrativo para corretor e administrador, chat entre cliente e corretor, acompanhamento de solicitação por e-mail + celular e captcha nos formulários e no login.

## Requisitos

- Node.js **22.13 ou superior** (usa o SQLite embutido do Node, sem compilação nativa).

## Como rodar

```bash
npm install
npm start
```

Acesse:

- Site: http://localhost:3000
- Painel: http://localhost:3000/admin/login

Na primeira execução o banco (`data/imoveis.db`) é criado automaticamente com os usuários e alguns imóveis de demonstração.

### Usuários iniciais

| Usuário  | Senha      | Perfil        |
|----------|------------|---------------|
| Paulo    | Abcd1234   | Administrador |
| Mariele  | Abcd1234   | Corretora     |

Recomenda-se trocar as senhas em **Painel → Meu perfil** após o primeiro acesso.

### Variáveis de ambiente (opcionais)

| Variável         | Padrão              | Descrição |
|------------------|---------------------|-----------|
| `PORT`           | `3000`              | Porta do servidor |
| `SESSION_SECRET` | aleatório a cada start | Segredo das sessões. Defina um valor fixo em produção para não derrubar sessões ao reiniciar |
| `NODE_ENV`       | —                   | Use `production` em produção |
| `CAPTCHA_DEBUG`  | —                   | `1` expõe a resposta do captcha no header `X-Captcha-Debug` para testes automatizados. Ignorado quando `NODE_ENV=production` |

Exemplo no PowerShell:

```powershell
$env:PORT=3080; $env:SESSION_SECRET="troque-por-um-segredo"; npm start
```

Para desenvolvimento com reinício automático: `npm run dev`.

## Funcionalidades

### Site público
- Home com busca, destaques, categorias e "como funciona".
- Listagem com filtros (tipo, cidade, bairro, faixa de preço, quartos, vagas, pets, mobiliado) e ordenação.
- Página do imóvel com galeria, características, valores (aluguel, condomínio, IPTU), mapa de comodidades e formulário **"Tenho interesse"** com captcha.
- Redes sociais (Instagram, Facebook, TikTok, YouTube, LinkedIn) e botão flutuante do WhatsApp, configuráveis no painel.
- Página de contato com captcha e página "Sobre".

### Acompanhamento do cliente (sem login)
- Em **Acompanhar solicitação** o cliente informa e-mail + celular + captcha e vê todas as suas solicitações.
- Cada solicitação tem protocolo, linha do tempo de status e **chat com o corretor** (atualização automática).

### Painel (login com captcha)
- Bloqueio temporário após 5 tentativas de login incorretas.
- Dashboard com indicadores, solicitações recentes e imóveis mais procurados.
- Cadastro completo de imóveis: fotos (jpg/png/webp, até 15 por imóvel, capa e ordenação), valores, características, comodidades, destaque, status.
- Gestão de solicitações: status, corretor responsável, agendamento de visita, notas internas, histórico e chat com o cliente.
- Configurações do site (nome, contatos, redes sociais, textos, requisitos para alugar) — apenas admin.
- Gestão de usuários (criar, ativar/desativar, redefinir senha) — apenas admin.

## Regras de negócio

- Fluxo de status da solicitação: **Novo → Em análise → Em contato → Visita agendada → Documentação → Aprovado → Contrato**. Encerramentos: Contrato, Recusado, Cancelado.
- Imóvel só pode ser publicado (disponível) com pelo menos 1 foto; sem foto fica inativo.
- Caução limitada a 3 meses de aluguel.
- Cliente que enviar novo interesse para o mesmo imóvel com uma solicitação em aberto recebe o mesmo protocolo (não duplica).
- **Aprovado** reserva o imóvel; **Contrato** marca como alugado e cancela automaticamente as outras solicitações abertas para ele.
- Solicitações encerradas só podem ser reabertas pelo administrador.
- A primeira resposta do corretor no chat move a solicitação de Novo para Em análise.
- Visita exige data futura; recusa e cancelamento exigem motivo.
- Captcha de uso único, expira em 10 minutos, em: login, formulário de interesse/contato e acompanhamento.

## Estrutura

```
server.js            # bootstrap do Express
src/db.js            # schema SQLite, seed e constantes
src/auth.js          # autenticação, perfis e bloqueio de login
src/captcha.js       # geração/validação do captcha
src/routes/          # public.js, client.js, admin.js
views/               # templates EJS (public, admin, partials)
public/              # css, js e imagens estáticas
uploads/             # fotos enviadas (criado em runtime)
data/                # banco SQLite (criado em runtime)
```

Para começar do zero, pare o servidor e apague as pastas `data/` e `uploads/`; elas são recriadas na próxima execução.
