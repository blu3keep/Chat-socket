const API_URL = 'http://localhost:3000';
let socket, token;

// --- ESTADO ---
let activeChatContext = 'room'; 
let activeChatTarget = null; 
let myUserId = null; 
let unreadCounts = {}; 
let roomUnreadCounts = {};
let globalUsersList = []; 
let globalRoomsList = [];

// Elementos
const authOverlay = document.getElementById('auth-overlay');
const chatContainer = document.getElementById('chat-container');
const authForm = document.getElementById('auth-form');
const roomList = document.getElementById('room-list');
const msgsBox = document.getElementById('messages-box');
const msgInput = document.getElementById('message-input');
const msgForm = document.getElementById('message-form');
const typingIndicator = document.getElementById('typing-indicator');
const usersList = document.getElementById('users-list');
const onlineCount = document.getElementById('online-count');
const themeBtn = document.getElementById('theme-btn');
const headerTitle = document.getElementById('chat-header-title');
const backToRoomBtn = document.getElementById('back-to-room-btn');

let typingTimeout = undefined;

document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark-mode');
        themeBtn.innerText = 'Modo Claro';
    } else {
        themeBtn.innerText = 'Modo Escuro';
    }

    token = localStorage.getItem('chat_token');
    if (token) iniciarChat();
    else authOverlay.style.display = 'flex';
});

themeBtn.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    if (document.body.classList.contains('dark-mode')) {
        localStorage.setItem('theme', 'dark');
        themeBtn.innerText = 'Modo Claro';
    } else {
        localStorage.setItem('theme', 'light');
        themeBtn.innerText = 'Modo Escuro';
    }
});

let isRegister = false;
document.getElementById('toggle-auth').addEventListener('click', (e) => {
    e.preventDefault(); isRegister = !isRegister;
    document.getElementById('auth-title').innerText = isRegister ? 'Cadastro' : 'Login';
    document.getElementById('auth-submit-btn').innerText = isRegister ? 'Cadastrar' : 'Entrar';
    
    // IMPORTANTE: Removemos o código que escondia o captcha. 
    // Agora ele aparece sempre, tanto no Login quanto no Cadastro.
    if (window.turnstile) window.turnstile.reset(); // Reseta o captcha ao trocar de aba
});

authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = document.getElementById('username-input').value;
    const pass = document.getElementById('password-input').value;
    const route = isRegister ? '/api/auth/register' : '/api/auth/login';

    // PEGA O TOKEN DO CAPTCHA
    const formData = new FormData(authForm);
    const captchaToken = formData.get('cf-turnstile-response');

    // Validação: Exige token em AMBOS os casos (Login e Register)
    if (!captchaToken) {
        document.getElementById('auth-error').innerText = "Complete o desafio de segurança.";
        document.getElementById('auth-error').style.display = 'block';
        return;
    }

    try {
        const res = await fetch(API_URL + route, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                username: user, 
                password: pass,
                captchaToken: captchaToken 
            })
        });
        const data = await res.json();
        
        if (!res.ok) {
            if (window.turnstile) window.turnstile.reset();
            throw new Error(data.error);
        }

        if (isRegister) {
            alert('Sucesso! Faça login.'); 
            isRegister = false; 
            document.getElementById('toggle-auth').click();
        } else {
            localStorage.setItem('chat_token', data.token);
            localStorage.setItem('chat_user', data.username);
            localStorage.setItem('chat_userid', data.userId);
            token = data.token;
            iniciarChat();
        }
    } catch (err) { 
        const errEl = document.getElementById('auth-error');
        errEl.innerText = err.message;
        errEl.style.display = 'block';
    }
});

document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.clear(); location.reload();
});

// ... (RESTO DAS FUNÇÕES DE CHAT - MANTIDAS IGUAIS)
function iniciarChat() {
    authOverlay.style.display = 'none';
    chatContainer.style.display = 'flex';
    const username = localStorage.getItem('chat_user');
    document.getElementById('display-username').innerText = username;
    document.getElementById('user-initial').innerText = username.charAt(0).toUpperCase();
    myUserId = parseInt(localStorage.getItem('chat_userid'));
    socket = io(API_URL, { auth: { token } });
    socket.on('connect_error', () => { alert('Sessão expirada'); document.getElementById('logout-btn').click(); });
    socket.on('newMessage', (msg) => {
        if (activeChatContext === 'room' && msg.room_id == activeChatTarget) {
            renderMessage(msg, false);
            typingIndicator.textContent = '';
        }
    });
    socket.on('roomNotification', (data) => {
        if (activeChatContext === 'room' && activeChatTarget == data.roomId) return;
        if (!roomUnreadCounts[data.roomId]) roomUnreadCounts[data.roomId] = 0;
        roomUnreadCounts[data.roomId]++;
        renderRoomList();
    });
    socket.on('privateMessage', (msg) => {
        if (activeChatContext === 'private' && (msg.sender_id == activeChatTarget || msg.sender_id == myUserId)) {
            renderMessage(msg, true);
            typingIndicator.textContent = '';
        } else if (msg.sender_id !== myUserId) {
            if (!unreadCounts[msg.sender_id]) unreadCounts[msg.sender_id] = 0;
            unreadCounts[msg.sender_id]++;
            renderUserList(globalUsersList);
        }
    });
    socket.on('displayTyping', (data) => {
        if (activeChatContext === 'room' && data.roomId == activeChatTarget) {
            typingIndicator.textContent = `${data.username} está digitando...`;
        } else if (activeChatContext === 'private' && data.userId == activeChatTarget) {
            typingIndicator.textContent = `${data.username} está digitando...`;
        }
    });
    socket.on('hideTyping', (data) => {
        if (activeChatContext === 'room' && data.roomId == activeChatTarget) typingIndicator.textContent = '';
        else if (activeChatContext === 'private' && data.userId == activeChatTarget) typingIndicator.textContent = '';
    });
    socket.on('globalUsers', (users) => { globalUsersList = users; renderUserList(users); });
    socket.on('messageError', (msg) => alert("⚠️ " + msg));
    carregarSalas();
}

async function carregarSalas() {
    const res = await fetch(`${API_URL}/api/rooms`, { headers: { 'Authorization': `Bearer ${token}` }});
    const rooms = await res.json();
    globalRoomsList = rooms;
    renderRoomList();
    if (!activeChatTarget && rooms.length > 0) entrarSala(rooms[0].id, rooms[0].name);
}

function renderRoomList() {
    roomList.innerHTML = '';
    globalRoomsList.forEach((room) => {
        const li = document.createElement('li');
        li.innerText = room.name;
        if (activeChatContext === 'room' && activeChatTarget === room.id) li.classList.add('active');
        li.onclick = () => entrarSala(room.id, room.name);
        li.id = `room-li-${room.id}`;
        if (roomUnreadCounts[room.id] && roomUnreadCounts[room.id] > 0) {
             const badge = document.createElement('span');
             badge.classList.add('notification-badge');
             badge.textContent = roomUnreadCounts[room.id];
             li.appendChild(badge);
             li.style.fontWeight = 'bold';
        }
        roomList.appendChild(li);
    });
}

async function entrarSala(id, name) {
    if (roomUnreadCounts[id]) roomUnreadCounts[id] = 0;
    activeChatContext = 'room';
    activeChatTarget = id;
    renderRoomList();
    headerTitle.innerText = `# ${name}`;
    document.querySelector('header').classList.remove('dm-active');
    backToRoomBtn.style.display = 'none';
    msgInput.disabled = false; msgForm.querySelector('button').disabled = false;
    typingIndicator.textContent = ''; 
    socket.emit('joinRoom', id);
    const res = await fetch(`${API_URL}/api/messages/${id}`, { headers: { 'Authorization': `Bearer ${token}` }});
    const msgs = await res.json();
    msgsBox.innerHTML = '';
    msgs.forEach(m => renderMessage(m, false));
}

async function entrarChatPrivado(targetUserId, targetUserName) {
    if (targetUserId === myUserId) return; 
    if (unreadCounts[targetUserId]) { unreadCounts[targetUserId] = 0; renderUserList(globalUsersList); }
    activeChatContext = 'private';
    activeChatTarget = targetUserId;
    document.querySelectorAll('#room-list li').forEach(l => l.classList.remove('active'));
    headerTitle.innerText = `💬 Conversando com ${targetUserName}`;
    document.querySelector('header').classList.add('dm-active');
    backToRoomBtn.style.display = 'block'; 
    msgInput.disabled = false; msgForm.querySelector('button').disabled = false;
    msgsBox.innerHTML = '<div style="padding:20px; text-align:center; color:#888">Carregando histórico...</div>';
    typingIndicator.textContent = ''; 
    const res = await fetch(`${API_URL}/api/private-messages/${targetUserId}`, { headers: { 'Authorization': `Bearer ${token}` }});
    const msgs = await res.json();
    msgsBox.innerHTML = '';
    if(msgs.length === 0) msgsBox.innerHTML = '<div style="padding:20px; text-align:center; color:#888">Inicie a conversa!</div>';
    msgs.forEach(m => renderMessage(m, true));
}

backToRoomBtn.addEventListener('click', () => { if (globalRoomsList.length > 0) entrarSala(globalRoomsList[0].id, globalRoomsList[0].name); });

function renderUserList(users) {
    usersList.innerHTML = '';
    onlineCount.textContent = `(${users.length})`;
    users.forEach(u => {
        const li = document.createElement('li');
        const nameSpan = document.createElement('span');
        nameSpan.textContent = u.username;
        li.appendChild(nameSpan);
        if (u.id === myUserId) {
            nameSpan.textContent += " (Você)";
            li.classList.add('is-me');
        } else {
            li.onclick = () => entrarChatPrivado(u.id, u.username);
            li.title = "Enviar Mensagem Privada";
            if (unreadCounts[u.id] && unreadCounts[u.id] > 0) {
                const badge = document.createElement('span');
                badge.classList.add('notification-badge');
                badge.textContent = unreadCounts[u.id];
                li.appendChild(badge);
                li.style.fontWeight = 'bold';
            }
        }
        usersList.appendChild(li);
    });
}

function renderMessage(msg, isPrivate) {
    const div = document.createElement('div');
    const euSou = msg.user_name === localStorage.getItem('chat_user');
    div.classList.add('message', euSou ? 'my-msg' : 'other-msg');
    if (isPrivate) div.classList.add('dm-msg'); 
    const userSpan = document.createElement('span');
    userSpan.classList.add('user');
    userSpan.textContent = msg.user_name + (isPrivate ? ' • Privado' : '');
    const textNode = document.createTextNode(" " + (msg.text || ""));
    div.appendChild(userSpan); div.appendChild(textNode);
    msgsBox.appendChild(div);
    msgsBox.scrollTop = msgsBox.scrollHeight;
}

msgForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = msgInput.value;
    if (text && activeChatTarget) {
        if (activeChatContext === 'room') { socket.emit('sendMessage', { roomId: activeChatTarget, text }); } 
        else { socket.emit('sendPrivateMessage', { toUserId: activeChatTarget, text }); }
        clearTimeout(typingTimeout);
        socket.emit('stopTyping', activeChatTarget);
        msgInput.value = '';
    }
});

msgInput.addEventListener('input', () => {
    if (activeChatContext === 'room') socket.emit('typing', activeChatTarget);
    else if (activeChatContext === 'private') socket.emit('typing', activeChatTarget);
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => { socket.emit('stopTyping', activeChatTarget); }, 2000);
});