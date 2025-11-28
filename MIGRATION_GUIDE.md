
# Guia de Migração para WhatsApp Business API

O Venom-bot é excelente para MVPs, mas para escala e estabilidade garantida, recomenda-se a API Oficial.

## 10 Passos para Migrar

1.  Criar uma conta no **Meta for Developers**.
2.  Criar um App do tipo "Business".
3.  Adicionar o produto "WhatsApp" ao App.
4.  Configurar um número de telefone de teste ou produção.
5.  Obter o **Permanent Access Token**.
6.  Configurar **Webhooks** no painel da Meta apontando para um novo endpoint no seu backend (ex: `/webhook/meta`).
7.  **Backend**: Substituir a lógica de envio `client.sendText` por requisições HTTP POST para a Graph API da Meta.
8.  **Backend**: Substituir o listener `client.onMessage` pelo tratamento do payload do Webhook da Meta.
9.  **Database**: A estrutura criada (`whatsapp_messages`, etc.) pode ser mantida, apenas a origem dos dados muda.
10. **Frontend**: Nenhuma mudança drástica necessária na UI, apenas remoção da tela de QR Code (a conexão é feita via OAuth ou Token).
