
# PMS WhatsApp Integration (Venom-bot MVP)

Este módulo adiciona integração com WhatsApp ao PMS usando Venom-bot.

## Pré-requisitos

*   Docker e Docker Compose
*   Conta no Supabase (URL e Service Key)

## Instalação

1.  **Banco de Dados**: Execute o conteúdo de `supabase_whatsapp_schema.sql` no SQL Editor do seu projeto Supabase.
2.  **Configuração**: Crie um arquivo `.env` na raiz baseado no `.env.example` e preencha as credenciais do Supabase.
3.  **Execução**:
    ```bash
    docker-compose up -d --build
    ```

## Uso

1.  Importe o componente `WhatsAppInbox` no seu frontend Next.js.
2.  Passe o `hotelId` como prop (use um UUID fixo ou dinâmico do usuário logado).
3.  Acesse a página, clique em "Conectar WhatsApp" e escaneie o QR Code.

## Endpoints (Backend)

*   `POST /whatsapp/start-session`: Inicia o bot.
*   `POST /whatsapp/send`: Envia mensagem.
*   `GET /whatsapp/messages/:chatId`: Histórico.

## Notas Importantes

*   **Persistência**: As sessões do WhatsApp são salvas na pasta `./backend/tokens`. Não apague esta pasta para manter o login.
*   **Limitações**: Venom-bot não é uma API oficial. Use com cautela e evite spam para não ter o número banido.
*   **Migração**: Para escalar, considere migrar para a WhatsApp Business API oficial (Meta).
