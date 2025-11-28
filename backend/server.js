require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const venom = require('venom-bot');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

// --- Configurações ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// --- Health Check (Para o Render não derrubar o serviço) ---
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// --- Supabase ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// --- Sessões Venom em Memória ---
const sessions = {};

// Normaliza telefone
const normalizePhone = (phone) => {
  let p = phone.replace(/\D/g, '');
  if (!p.startsWith('55') && p.length <= 11) p = '55' + p; 
  return p.includes('@c.us') ? p : `${p}@c.us`;
};

const cleanPhoneDB = (phone) => {
  return phone.replace('@c.us', '').replace(/\D/g, '');
};

// --- Venom Logic ---
const startVenomSession = async (sessionKey, hotelId) => {
  console.log(`[Venom] Iniciando sessão: ${sessionKey}`);
  
  await supabase.from('whatsapp_sessions').upsert({ id: sessionKey, hotel_id: hotelId, status: 'STARTING', updated_at: new Date() });

  try {
    const client = await venom.create(
      sessionKey,
      (base64Qr, asciiQR) => {
        console.log(`[Venom] QR Code recebido`);
        io.to(`session:${sessionKey}`).emit('qr', { sessionKey, base64QrImg: base64Qr });
        supabase.from('whatsapp_sessions').update({ status: 'QRCODE', qrcode: base64Qr, updated_at: new Date() }).eq('id', sessionKey).then();
      },
      (statusSession) => {
        console.log(`[Venom] Status: ${statusSession}`);
        io.to(`session:${sessionKey}`).emit('status', { sessionKey, status: statusSession });
        supabase.from('whatsapp_sessions').update({ status: statusSession, qrcode: null, updated_at: new Date() }).eq('id', sessionKey).then();
      },
      {
        folderNameToken: 'tokens',
        headless: 'new',
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage', 
            '--disable-accelerated-2d-canvas', 
            '--no-first-run', 
            '--no-zygote', 
            '--disable-gpu'
        ]
      }
    );

    sessions[sessionKey] = { client, hotelId };
    
    client.onMessage(async (message) => {
      if (message.isGroupMsg) return;
      const fromPhone = cleanPhoneDB(message.from);
      const text = message.body || (message.type === 'image' ? '[Imagem]' : '[Arquivo]');
      console.log(`[Msg] De ${fromPhone}: ${text}`);

      try {
        let { data: contact } = await supabase.from('whatsapp_contacts').select('id').eq('phone', fromPhone).single();
        if (!contact) {
          const { data: newContact, error } = await supabase.from('whatsapp_contacts').insert({
              phone: fromPhone,
              name: message.notifyName || message.sender?.name || 'Novo Contato',
              profile_pic_url: message.sender?.profilePicThumbObj?.eurl
            }).select().single();
          if(!error) contact = newContact;
        }

        if (contact) {
            const { data: savedMsg } = await supabase.from('whatsapp_messages').insert({
                hotel_id: hotelId,
                contact_id: contact.id,
                direction: 'in',
                message: text,
                status: 'received',
                raw_payload: message,
                timestamp: new Date(message.timestamp * 1000)
            }).select().single();

            await supabase.from('whatsapp_chats').upsert({
                hotel_id: hotelId,
                contact_id: contact.id,
                last_message: text,
                last_message_at: new Date()
            }, { onConflict: 'hotel_id, contact_id' });

            io.to(`session:${sessionKey}`).emit('message', { sessionKey, chatId: contact.id, message: savedMsg });
        }
      } catch (err) { console.error('Erro DB:', err); }
    });

  } catch (error) {
    console.error(`Erro fatal Venom:`, error);
    await supabase.from('whatsapp_sessions').update({ status: 'ERROR' }).eq('id', sessionKey);
  }
};

// --- Endpoints ---
app.post('/whatsapp/start-session', async (req, res) => {
  const { hotel_id } = req.body;
  const sessionKey = hotel_id; 
  if (sessions[sessionKey]) return res.json({ status: 'ALREADY_RUNNING' });

  await supabase.from('whatsapp_sessions').upsert({ id: sessionKey, hotel_id, session_name: 'Principal', status: 'STARTING' });
  // Inicia em background
  startVenomSession(sessionKey, hotel_id).catch(err => console.error("Erro async start:", err));
  
  res.json({ status: 'STARTING' });
});

app.post('/whatsapp/send', async (req, res) => {
  const { sessionKey, toWaId, text, chatId } = req.body;
  const session = sessions[sessionKey];
  if (!session) return res.status(404).json({ error: 'Session not active' });

  try {
    await session.client.sendText(normalizePhone(toWaId), text);
    const { data: savedMsg } = await supabase.from('whatsapp_messages').insert({
        hotel_id: session.hotelId, contact_id: chatId, direction: 'out', message: text, status: 'sent', timestamp: new Date()
    }).select().single();
    
    await supabase.from('whatsapp_chats').upsert({
        hotel_id: session.hotelId, contact_id: chatId, last_message: text, last_message_at: new Date()
    }, { onConflict: 'hotel_id, contact_id' });

    res.json({ success: true, dbMessage: savedMsg });
  } catch (error) {
    console.error('Erro envio:', error);
    res.status(500).json({ error: error.message });
  }
});

// Porta Dinâmica (Render)
const PORT = process.env.PORT || 3001; 
server.listen(PORT, () => console.log(`Service running on port ${PORT}`));