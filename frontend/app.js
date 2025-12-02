const API_URL = 'https://chat.lab-offsec.com.br';
let socket, token;

let activeChatContext = 'room'; 
let activeChatTarget = null; 
let myUserId = null; 
let unreadCounts = {}; 
let roomUnreadCounts = {};
let globalUsersList = []; 
let globalRoomsList = [];
let selectedFile = null;
let isRegister = false;

let typingTimeout = undefined;


let authOverlay, chatContainer, authForm, authTitle, authSubmitBtn, toggleAuthBtn, 
    authError, switchMsg, usernameInput, passwordInput; 
let roomList, msgsBox, msgInput, msgForm, typingIndicator, usersList, 
    onlineCount, themeBtn, headerTitle, backToRoomBtn, fileInput, 
    previewContainer, imagePreview, cancelImageBtn;

document.addEventListener('DOMContentLoaded', () => {
    
    authOverlay = document.getElementById('auth-overlay');
    chatContainer = document.getElementById('chat-container');
    authForm = document.getElementById('auth-form');
    authTitle = document.getElementById('auth-title');
    authSubmitBtn = document.getElementById('auth-submit-btn');
    toggleAuthBtn = document.getElementById('toggle-auth');
    authError = document.getElementById('auth-error');
    switchMsg = document.getElementById('switch-msg');
    usernameInput = document.getElementById('username-input');
    passwordInput = document.getElementById('password-input');
    
    roomList = document.getElementById('room-list');
    msgsBox = document.getElementById('messages-box');
    msgInput = document.getElementById('message-input');
    msgForm = document.getElementById('message-form');
    typingIndicator = document.getElementById('typing-indicator');
    usersList = document.getElementById('users-list');
    onlineCount = document.getElementById('online-count');
    themeBtn = document.getElementById('theme-btn');
    headerTitle = document.getElementById('chat-header-title');
    backToRoomBtn = document.getElementById('back-to-room-btn');
    fileInput = document.getElementById('file-input');
    previewContainer = document.getElementById('image-preview-container');
    imagePreview = document.getElementById('image-preview');
    cancelImageBtn = document.getElementById('cancel-image-btn');

    
    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark-mode');
        themeBtn.innerText = 'Modo Claro';
    } else {
        themeBtn.innerText = 'Modo Escuro';
    }

    
    themeBtn.addEventListener('click', toggleTheme);
    toggleAuthBtn.addEventListener('click', toggleAuthMode);
    authForm.addEventListener('submit', handleAuthSubmit);
    document.getElementById('logout-btn').addEventListener('click', logout);
    
    // Listeners do Chat
    msgInput.addEventListener('input', handleTyping);
    msgForm.addEventListener('submit', handleMessageSubmit);
    fileInput.addEventListener('change', handleFileSelect);
    cancelImageBtn.addEventListener('click', cancelFileSelect);
    backToRoomBtn.addEventListener('click', () => {
        if (globalRoomsList.length > 0) entrarSala(globalRoomsList[0].id, globalRoomsList[0].name);
    });

    
    token = localStorage.getItem('chat_token');
    if (token) {
        iniciarChat();
    } else {
        authOverlay.style.display = 'flex';
        
        updateAuthUI();
    }
});



function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    themeBtn.innerText = isDark ? 'Modo Claro' : 'Modo Escuro';
}

function toggleAuthMode(e) {
    if (e) e.preventDefault();
    isRegister = !isRegister;
    updateAuthUI();
    if (window.turnstile) window.turnstile.reset();
}

function updateAuthUI() {
    
    if (isRegister) {
        authTitle.innerText = 'Cadastro';
        authSubmitBtn.innerText = 'Cadastrar';
        switchMsg.innerText = 'Já tem conta?';
        toggleAuthBtn.innerText = 'Faça Login';
    } else {
        authTitle.innerText = 'Login';
        authSubmitBtn.innerText = 'Entrar';
        switchMsg.innerText = 'Não tem conta?';
        toggleAuthBtn.innerText = 'Cadastre-se';
    }
    authError.style.display = 'none';
}

async function handleAuthSubmit(e) {
    e.preventDefault();
    const user = usernameInput.value;
    const pass = passwordInput.value;
    
    
    const formData = new FormData(authForm);
    const captchaToken = formData.get('cf-turnstile-response');

    if (!captchaToken) {
        authError.innerText = "Complete o desafio de segurança.";
        authError.style.display = 'block';
        return;
    }

    const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login';

    try {
        const res = await fetch(API_URL + endpoint, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user, password: pass, captchaToken: captchaToken })
        });
        const data = await res.json();
        
        if (!res.ok) {
            if (window.turnstile) window.turnstile.reset();
            throw new Error(data.error);
        }

        // SUCESSO
        if (isRegister) {
            alert('Conta criada com sucesso! Faça login agora.');
            
            
            setTimeout(() => {
                
                isRegister = false;
                
                
                updateAuthUI();
                
                
                passwordInput.value = '';
                
                if (window.turnstile) window.turnstile.reset();
                
                console.log("Interface atualizada para Login.");
            }, 100);

        } else {
            // Login
            localStorage.setItem('chat_token', data.token);
            localStorage.setItem('chat_user', data.username);
            localStorage.setItem('chat_userid', data.userId);
            token = data.token;
            iniciarChat();
        }
    } catch (err) { 
        authError.innerText = err.message;
        authError.style.display = 'block';
    }
}

function logout() {
    localStorage.clear();
    location.reload();
}



function iniciarChat() {
    authOverlay.style.display = 'none';
    chatContainer.style.display = 'flex';
    const username = localStorage.getItem('chat_user');
    document.getElementById('display-username').innerText = username;
    document.getElementById('user-initial').innerText = username.charAt(0).toUpperCase();
    myUserId = parseInt(localStorage.getItem('chat_userid'));
    
    socket = io(API_URL, { auth: { token } });
    
    socket.on('connect_error', () => { alert('Sessão expirada'); logout(); });
    
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
        if ((activeChatContext === 'room' && data.roomId == activeChatTarget) || (activeChatContext === 'private' && data.userId == activeChatTarget)) {
            typingIndicator.textContent = `${data.username} está digitando...`;
        }
    });
    socket.on('hideTyping', (data) => {
        if ((activeChatContext === 'room' && data.roomId == activeChatTarget) || (activeChatContext === 'private' && data.userId == activeChatTarget)) {
            typingIndicator.textContent = '';
        }
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

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
        selectedFile = file;
        const reader = new FileReader();
        reader.onload = (e) => {
            imagePreview.src = e.target.result;
            previewContainer.style.display = 'block';
        };
        reader.readAsDataURL(file);
        msgForm.querySelector('button').disabled = false;
    }
}

function cancelFileSelect() {
    selectedFile = null;
    fileInput.value = '';
    previewContainer.style.display = 'none';
    if(msgInput.value.trim() === '') msgForm.querySelector('button').disabled = true;
}

function renderMessage(msg, isPrivate) {
    const div = document.createElement('div');
    const euSou = msg.user_name === localStorage.getItem('chat_user');
    div.classList.add('message', euSou ? 'my-msg' : 'other-msg');
    if (isPrivate) div.classList.add('dm-msg'); 
    const userSpan = document.createElement('span');
    userSpan.classList.add('user');
    userSpan.textContent = msg.user_name + (isPrivate ? ' • Privado' : '');
    div.appendChild(userSpan);

    if (msg.image_url) {
        const img = document.createElement('img');
        img.src = API_URL + msg.image_url; 
        img.onclick = () => window.open(API_URL + msg.image_url, '_blank'); 
        div.appendChild(img);
    }

    if (msg.text) {
        const textNode = document.createTextNode(" " + msg.text);
        div.appendChild(textNode);
    }

    msgsBox.appendChild(div);
    msgsBox.scrollTop = msgsBox.scrollHeight;
}

async function handleMessageSubmit(e) {
    e.preventDefault();
    const text = msgInput.value;
    if (!text && !selectedFile) return;
    let imageUrl = null;
    if (selectedFile) {
        const formData = new FormData();
        formData.append('image', selectedFile);
        try {
            const res = await fetch(`${API_URL}/api/upload`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            if (!res.ok) throw new Error('Falha no upload');
            const data = await res.json();
            imageUrl = data.imageUrl;
        } catch (err) {
            alert("Erro ao enviar imagem: " + err.message);
            return;
        }
    }
    const payload = { 
        roomId: activeChatTarget, 
        toUserId: activeChatTarget,
        text: text,
        imageUrl: imageUrl 
    };
    if (activeChatContext === 'room') socket.emit('sendMessage', payload);
    else socket.emit('sendPrivateMessage', payload);
    clearTimeout(typingTimeout);
    socket.emit('stopTyping', activeChatTarget);
    msgInput.value = '';
    cancelFileSelect();
    msgForm.querySelector('button').disabled = true;
}

function handleTyping() {
    if(msgInput.value.trim() !== '') msgForm.querySelector('button').disabled = false;
    if (activeChatContext === 'room') socket.emit('typing', activeChatTarget);
    else socket.emit('typing', activeChatTarget);
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => { socket.emit('stopTyping', activeChatTarget); }, 2000);
}