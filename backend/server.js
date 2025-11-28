require('dotenv').config();
const express = require('express');
const { create, Whatsapp } = require('venom-bot');
const { createClient } = require('@supabase/supabase-js');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// --- Configuração Inicial ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Permite conexão de qualquer origem (útil para dev local)
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// --- Supabase Setup ---
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error("ERRO: Variáveis de ambiente SUPABASE não configuradas.");
  process.exit(1);
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const SESSION_NAME = process.env.SESSION_NAME || 'hotel-session';
const HOTEL_ID = process.env.HOTEL_ID;
let clientVenom = null;

// --- Funções Auxiliares ---
const normalizePhone = (phone) => phone.replace(/\D/g, ''); // Remove tudo que não é número

// --- Atualizar Status da Sessão no Banco ---
async function updateSessionStatus(status, qrcode) {
    if (!HOTEL_ID) return;
    
    // Verifica se já existe sessão
    const { data: existing } = await supabase
        .from('whatsapp_sessions')
        .select('id')
        .eq('hotel_id', HOTEL_ID)
        .eq('session_name', SESSION_NAME)
        .single();

    const payload = {
        hotel_id: HOTEL_ID,
        session_name: SESSION_NAME,
        status,
        qrcode: status === 'QRCODE' ? qrcode : null,
        updated_at: new Date()
    };

    if (existing) {
        await supabase.from('whatsapp_sessions').update(payload).eq('id', existing.id);
    } else {
        await supabase.from('whatsapp_sessions').insert(payload);
    }
}

// --- Iniciar Venom Bot ---
const startVenom = async () => {
  try {
    console.log('--- Iniciando Venom Bot ---');
    
    clientVenom = await create(
      SESSION_NAME,
      (base64Qr, asciiQR, attempts) => {
        console.log('QR Code recebido (Tentativa ' + attempts + ')');
        io.emit('qr', { base64Qr, attempts });
        updateSessionStatus('QRCODE', base64Qr);
      },
      (statusSession, session) => {
        console.log('Status da Sessão:', statusSession);
        io.emit('status', { status: statusSession });
        updateSessionStatus(statusSession, null);
      },
      {
        folderNameToken: 'tokens', // Salva sessão na pasta local /tokens
        headless: true, // Roda sem abrir janela do Chrome (background)
        useChrome: true,
        debug: false,
        logQR: false,
        browserArgs: ['--no-sandbox', '--disable-setuid-sandbox']
      }
    );

    console.log('✅ Venom conectado e pronto!');
    updateSessionStatus('CONNECTED', null);

    // Listener de Mensagens Recebidas
    clientVenom.onMessage(async (message) => {
      if (message.isGroupMsg) return; // Ignora grupos
      await handleIncomingMessage(message);
    });

  } catch (error) {
    console.error('Erro fatal no Venom:', error);
  }
};

// --- Processar Mensagem Recebida ---
async function handleIncomingMessage(msg) {
    const fromPhone = normalizePhone(msg.from.split('@')[0]);
    const body = msg.body || msg.caption || '(Mídia recebida)';
    const msgType = msg.type;

    console.log(`📩 Nova mensagem de ${fromPhone}: ${body.substring(0, 50)}...`);

    try {
        // 1. Criar ou Buscar Contato
        let contactId;
        const { data: contact } = await supabase
            .from('whatsapp_contacts')
            .select('id')
            .eq('phone', fromPhone)
            .maybeSingle();

        if (contact) {
            contactId = contact.id;
        } else {
            // Cria contato novo
            const { data: newContact, error } = await supabase
                .from('whatsapp_contacts')
                .insert({
                    phone: fromPhone,
                    name: msg.notifyName || fromPhone,
                    profile_pic_url: msg.sender?.profilePicThumbObj?.eurl || null
                })
                .select()
                .single();
            
            if (error) throw error;
            contactId = newContact.id;

            // Tenta vincular Guest automaticamente pelo telefone
            const { data: guest } = await supabase
                .from('guests')
                .select('id')
                .ilike('phone', `%${fromPhone.slice(-8)}%`) // Busca fuzzy últimos 8 dígitos
                .maybeSingle();
            
            if (guest) {
                await supabase.from('guests').update({ whatsapp_contact_id: contactId }).eq('id', guest.id);
                console.log('🔗 Guest vinculado automaticamente:', guest.id);
            }
        }

        // 2. Atualizar ou Criar Chat
        let chatId;
        const { data: chat } = await supabase
            .from('whatsapp_chats')
            .select('id, unread_count')
            .eq('contact_id', contactId)
            .eq('hotel_id', HOTEL_ID)
            .maybeSingle();

        if (chat) {
            chatId = chat.id;
            await supabase.from('whatsapp_chats').update({
                last_message: body,
                last_message_at: new Date(),
                unread_count: (chat.unread_count || 0) + 1
            }).eq('id', chatId);
        } else {
            const { data: newChat } = await supabase
                .from('whatsapp_chats')
                .insert({
                    contact_id: contactId,
                    hotel_id: HOTEL_ID,
                    last_message: body,
                    unread_count: 1
                })
                .select()
                .single();
            chatId = newChat.id;
        }

        // 3. Salvar Mensagem
        const { data: savedMsg } = await supabase
            .from('whatsapp_messages')
            .insert({
                chat_id: chatId,
                contact_id: contactId,
                hotel_id: HOTEL_ID,
                direction: 'in',
                body: body,
                message_type: msgType,
                wa_message_id: msg.id,
                status: 'read'
            })
            .select()
            .single();

        // 4. Avisar Frontend (Realtime via Socket)
        io.emit('new_message', savedMsg);

    } catch (err) {
        console.error('Erro ao processar mensagem:', err);
    }
}

// --- API Endpoints ---

// Enviar Mensagem (Frontend -> Backend -> WhatsApp)
app.post('/send', async (req, res) => {
    const { phone, message, chatId } = req.body;

    if (!clientVenom) return res.status(503).json({ error: 'Bot não inicializado' });

    try {
        const to = `${normalizePhone(phone)}@c.us`;
        const result = await clientVenom.sendText(to, message);
        
        // Recuperar contact_id pelo chatId
        let contactId;
        if (chatId) {
            const { data: chat } = await supabase.from('whatsapp_chats').select('contact_id').eq('id', chatId).single();
            contactId = chat?.contact_id;
        }

        if (contactId) {
            // Salvar mensagem enviada no banco
            const { data: savedMsg } = await supabase.from('whatsapp_messages').insert({
                chat_id: chatId,
                contact_id: contactId,
                hotel_id: HOTEL_ID,
                direction: 'out',
                body: message,
                status: 'sent',
                wa_message_id: result.to._serialized + result.id
            }).select().single();

            // Atualizar Chat
            await supabase.from('whatsapp_chats').update({
                last_message: message,
                last_message_at: new Date()
            }).eq('id', chatId);

            io.emit('new_message', savedMsg); // Avisa frontend para atualizar UI instantaneamente
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao enviar:', error);
        res.status(500).json({ error: error.message });
    }
});

// Reiniciar Sessão
app.post('/restart', async (req, res) => {
    res.json({ message: 'Reiniciando processo...' });
    process.exit(0); // O PM2 ou Docker irá reiniciar automaticamente
});

app.get('/health', (req, res) => res.json({ status: 'online', session: SESSION_NAME }));

// --- Start Server ---
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    startVenom();
});
