
import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import io, { Socket } from 'socket.io-client';

// Configurações (Devem vir de env vars no Next.js)
const API_URL = 'http://localhost:3001'; // URL do Backend Node
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface WhatsAppInboxProps {
  hotelId: string;
}

export default function WhatsAppInbox({ hotelId }: WhatsAppInboxProps) {
  const [sessionStatus, setSessionStatus] = useState<string>('DISCONNECTED');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [chats, setChats] = useState<any[]>([]);
  const [selectedChat, setSelectedChat] = useState<any | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 1. Inicializar Socket e Monitorar Sessão
  useEffect(() => {
    const newSocket = io(API_URL);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      newSocket.emit('join-session', { sessionKey: hotelId });
    });

    newSocket.on('qr', (data: any) => {
      if (data.sessionKey === hotelId) {
        setQrCode(data.base64QrImg);
        setSessionStatus('QRCODE');
      }
    });

    newSocket.on('status', (data: any) => {
      if (data.sessionKey === hotelId) {
        setSessionStatus(data.status);
        if (data.status === 'successChat' || data.status === 'isLogged') {
            setQrCode(null);
        }
      }
    });

    newSocket.on('message', (data: any) => {
      if (data.sessionKey === hotelId) {
        // Se a mensagem for do chat aberto, adiciona na lista
        if (selectedChat && data.chatId === selectedChat.contact_id) {
          setMessages((prev) => [...prev, data.message]);
          scrollToBottom();
        }
        // Atualiza a lista de chats (trazer pro topo)
        fetchChats();
      }
    });

    // Buscar status inicial
    checkSessionStatus();
    fetchChats();

    return () => {
      newSocket.disconnect();
    };
  }, [hotelId, selectedChat]); // selectedChat na dependência para atualizar realtime corretamente

  const checkSessionStatus = async () => {
    const { data } = await supabase
      .from('whatsapp_sessions')
      .select('status, qrcode')
      .eq('id', hotelId)
      .single();
    
    if (data) {
      setSessionStatus(data.status);
      if (data.status === 'QRCODE') setQrCode(data.qrcode);
    }
  };

  const fetchChats = async () => {
    // Busca chats ordenados por última mensagem
    const { data } = await supabase
      .from('whatsapp_chats')
      .select('*, whatsapp_contacts(name, phone, profile_pic_url)')
      .eq('hotel_id', hotelId)
      .order('last_message_at', { ascending: false });
    
    if (data) setChats(data);
  };

  const loadMessages = async (chatId: string) => {
    const res = await fetch(`${API_URL}/whatsapp/messages/${chatId}?limit=50`, {
        headers: { 'Authorization': 'Bearer placeholder' } // Adicionar token real
    });
    const data = await res.json();
    setMessages(data);
    scrollToBottom();
  };

  const handleChatSelect = (chat: any) => {
    setSelectedChat(chat);
    loadMessages(chat.contact_id);
  };

  const handleStartSession = async () => {
    await fetch(`${API_URL}/whatsapp/start-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hotel_id: hotelId, session_name: 'Recepção' })
    });
    setSessionStatus('STARTING');
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !selectedChat) return;

    // Otimistic UI
    const tempMsg = {
        direction: 'out',
        message: inputText,
        timestamp: new Date().toISOString(),
        status: 'sending'
    };
    setMessages([...messages, tempMsg]);
    scrollToBottom();
    const textToSend = inputText;
    setInputText('');

    await fetch(`${API_URL}/whatsapp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionKey: hotelId,
        chatId: selectedChat.contact_id,
        toWaId: selectedChat.whatsapp_contacts.phone,
        text: textToSend
      })
    });
    // O socket atualizará o status real ou carregamos de novo
  };

  const scrollToBottom = () => {
    setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  return (
    <div className="flex h-[600px] border rounded-lg overflow-hidden bg-white shadow-lg font-sans">
      {/* Sidebar: Lista de Chats */}
      <div className="w-1/3 border-r bg-gray-50 flex flex-col">
        <div className="p-4 bg-gray-100 border-b flex justify-between items-center">
          <h2 className="font-bold text-gray-700">WhatsApp</h2>
          <div className="text-xs px-2 py-1 rounded bg-gray-200">
            {sessionStatus}
          </div>
        </div>
        
        {sessionStatus !== 'successChat' && sessionStatus !== 'isLogged' && sessionStatus !== 'CONNECTED' ? (
           <div className="p-4 text-center">
             {sessionStatus === 'DISCONNECTED' && (
                <button 
                  onClick={handleStartSession}
                  className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
                >
                  Conectar WhatsApp
                </button>
             )}
             {(sessionStatus === 'STARTING' || sessionStatus === 'QRCODE') && (
                <div className="flex flex-col items-center">
                    <p className="mb-2 text-sm text-gray-600">Escaneie o QR Code:</p>
                    {qrCode ? (
                        <img src={qrCode} alt="QR Code" className="w-48 h-48 border" />
                    ) : (
                        <div className="w-48 h-48 bg-gray-200 animate-pulse flex items-center justify-center">Carregando...</div>
                    )}
                </div>
             )}
           </div>
        ) : (
            <div className="flex-1 overflow-y-auto">
            {chats.map((chat) => (
                <div 
                key={chat.id}
                onClick={() => handleChatSelect(chat)}
                className={`p-3 border-b cursor-pointer hover:bg-gray-100 flex items-center ${selectedChat?.id === chat.id ? 'bg-blue-50' : ''}`}
                >
                <div className="w-10 h-10 rounded-full bg-gray-300 mr-3 overflow-hidden">
                    {chat.whatsapp_contacts?.profile_pic_url ? (
                        <img src={chat.whatsapp_contacts.profile_pic_url} alt="Avatar" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-500 text-xs">IMG</div>
                    )}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex justify-between">
                        <span className="font-semibold text-sm truncate">{chat.whatsapp_contacts?.name || chat.whatsapp_contacts?.phone}</span>
                        <span className="text-xs text-gray-400">
                            {new Date(chat.last_message_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </span>
                    </div>
                    <p className="text-xs text-gray-500 truncate">{chat.last_message}</p>
                </div>
                </div>
            ))}
            </div>
        )}
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col bg-[#efeae2]">
        {selectedChat ? (
          <>
            <div className="p-3 bg-gray-100 border-b flex items-center">
                <span className="font-bold text-gray-700">{selectedChat.whatsapp_contacts?.name}</span>
                <span className="ml-2 text-xs text-gray-500">{selectedChat.whatsapp_contacts?.phone}</span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {messages.map((msg) => (
                <div key={msg.id || Math.random()} className={`flex ${msg.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[70%] p-2 rounded-lg text-sm shadow ${msg.direction === 'out' ? 'bg-[#d9fdd3]' : 'bg-white'}`}>
                    <p>{msg.message}</p>
                    <div className="text-[10px] text-gray-500 text-right mt-1">
                        {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        {msg.direction === 'out' && <span className="ml-1">✓</span>}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSendMessage} className="p-3 bg-gray-100 flex gap-2">
              <input 
                type="text" 
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Digite uma mensagem..."
                className="flex-1 p-2 border rounded-lg focus:outline-none focus:border-green-500"
              />
              <button type="submit" className="bg-green-600 text-white p-2 rounded-lg hover:bg-green-700">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            Selecione uma conversa para começar
          </div>
        )}
      </div>
    </div>
  );
}
