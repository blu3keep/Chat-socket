require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const pool = require('./db');
const { userSchema, messageSchema } = require('./schemas');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();

// --- SEGURANÇA EXTRA ---
app.disable('x-powered-by');

// --- HELMET (HEADERS) ---
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://challenges.cloudflare.com", "https://cdn.socket.io"],
      connectSrc: ["'self'", "http://localhost", "ws://localhost"], 
      frameSrc: ["'self'", "https://challenges.cloudflare.com"],
      // IMPORTANTE: Permite carregar imagens do próprio servidor e blobs
      imgSrc: ["'self'", "data:", "blob:", "http://localhost:3000"], 
    },
  },
  hidePoweredBy: true,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// --- CORS ---
const allowedOrigin = process.env.ALLOWED_ORIGIN || "http://localhost";
app.set('trust proxy', 1);
app.use(cors({
  origin: allowedOrigin,
  methods: ["GET", "POST"]
}));

app.use(express.json());

// --- SERVIR IMAGENS ESTATICAMENTE ---
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const server = http.createServer(app);
const io = new Server(server, { 
  cors: { origin: allowedOrigin, methods: ["GET", "POST"] } 
});

const SECRET = process.env.JWT_SECRET;
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET;

// --- CONFIGURAÇÃO UPLOAD (MULTER) ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        // Sanitização: Usa UUID + extensão original
        const uniqueName = uuidv4() + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|gif/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Apenas imagens são permitidas!'));
    }
});

// --- RATE LIMIT & AUTH ---
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { error: "Muitas tentativas. Aguarde 15min." }
});

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token necessário' });
  jwt.verify(token, SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    req.user = user;
    next();
  });
};

async function verifyTurnstile(token) {
    if (!token) return false;
    try {
        const formData = new URLSearchParams();
        formData.append('secret', TURNSTILE_SECRET);
        formData.append('response', token);
        const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: formData });
        const outcome = await result.json();
        return outcome.success;
    } catch (err) { return false; }
}

const validateData = (schema) => (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: result.error.issues[0].message });
    next();
};

// --- ROTAS HTTP ---

// Rota de Upload
app.post('/api/upload', authenticateToken, upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ imageUrl });
}, (err, req, res, next) => {
    res.status(400).json({ error: err.message });
});

app.post('/api/auth/register', authLimiter, validateData(userSchema), async (req, res) => {
  const { username, password, captchaToken } = req.body;
  const isCaptchaValid = await verifyTurnstile(captchaToken);
  if (!isCaptchaValid) return res.status(400).json({ error: 'Falha no Captcha.' });
  try {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    await pool.query('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, hash]);
    res.status(201).json({ message: 'Usuário criado!' });
  } catch (err) { 
      if(err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Usuário já existe.' });
      res.status(500).json({ error: 'Erro ao criar usuário.' }); 
  }
});

app.post('/api/auth/login', authLimiter, validateData(userSchema), async (req, res) => {
  const { username, password, captchaToken } = req.body;
  const isCaptchaValid = await verifyTurnstile(captchaToken);
  if (!isCaptchaValid) return res.status(400).json({ error: 'Falha no Captcha.' });
  try {
    const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
    const user = users[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(400).json({ error: 'Credenciais inválidas' });
    const token = jwt.sign({ id: user.id, username: user.username }, SECRET, { expiresIn: '2h' });
    res.json({ token, username: user.username, userId: user.id });
  } catch (err) { res.status(500).json({ error: 'Erro no servidor' }); }
});

app.get('/api/rooms', authenticateToken, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM rooms');
  res.json(rows);
});

app.get('/api/messages/:roomId', authenticateToken, async (req, res) => {
  const [msgs] = await pool.query(`
    SELECT m.id, m.room_id, m.text, m.image_url, m.created_at, u.username as user_name, m.user_id 
    FROM messages m JOIN users u ON m.user_id = u.id
    WHERE m.room_id = ? ORDER BY m.created_at ASC
  `, [req.params.roomId]);
  res.json(msgs);
});

app.get('/api/private-messages/:otherUserId', authenticateToken, async (req, res) => {
  const myId = req.user.id;
  const otherId = req.params.otherUserId;
  try {
    const [msgs] = await pool.query(`
      SELECT dm.id, dm.text, dm.image_url, dm.created_at, dm.sender_id, u.username as user_name
      FROM direct_messages dm JOIN users u ON dm.sender_id = u.id
      WHERE (dm.sender_id = ? AND dm.receiver_id = ?) OR (dm.sender_id = ? AND dm.receiver_id = ?)
      ORDER BY dm.created_at ASC
    `, [myId, otherId, otherId, myId]);
    res.json(msgs);
  } catch (err) { res.status(500).json({ error: 'Erro ao buscar DMs' }); }
});

// --- SOCKET.IO ---
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error("Autenticação necessária"));
  jwt.verify(token, SECRET, (err, decoded) => {
    if (err) return next(new Error("Token inválido"));
    socket.user = decoded;
    socket.spamCount = 0;
    socket.lastMsgTime = Date.now();
    socket.blockedUntil = 0;
    next();
  });
});

async function atualizarListaGlobal() {
  const sockets = await io.fetchSockets();
  const usuarios = sockets.map(s => ({ id: s.user.id, username: s.user.username }));
  const usuariosUnicos = usuarios.filter((v,i,a)=>a.findIndex(v2=>(v2.id===v.id))===i);
  io.emit('globalUsers', usuariosUnicos);
}

io.on('connection', async (socket) => {
  console.log(`User conectado: ${socket.user.username}`);
  socket.join(socket.user.id.toString());
  await atualizarListaGlobal();

  socket.on('joinRoom', async (roomId) => {
    if (socket.currentRoom) socket.leave(socket.currentRoom);
    socket.join(roomId);
    socket.currentRoom = roomId;
  });

  socket.on('typing', (roomId) => socket.to(roomId).emit('displayTyping', { username: socket.user.username, roomId, userId: socket.user.id }));
  socket.on('stopTyping', (roomId) => socket.to(roomId).emit('hideTyping', { roomId, userId: socket.user.id }));

  // MENSAGEM COM IMAGEM
  socket.on('sendMessage', async ({ roomId, text, imageUrl }) => {
    const now = Date.now();
    if (socket.blockedUntil && now < socket.blockedUntil) {
         const remaining = Math.ceil((socket.blockedUntil - now) / 1000);
         return socket.emit('messageError', `Silenciado. Aguarde ${Math.floor(remaining/60)}m ${remaining%60}s.`);
    }
    if (now - socket.lastMsgTime > 5000) { socket.spamCount = 0; socket.lastMsgTime = now; }
    socket.spamCount++;
    if (socket.spamCount > 3) {
        socket.blockedUntil = now + 300000; 
        return socket.emit('messageError', `🚨 SPAM! Silenciado por 5 minutos.`);
    }

    if (!text && !imageUrl) return;

    try {
      const [result] = await pool.query('INSERT INTO messages (room_id, user_id, text, image_url) VALUES (?, ?, ?, ?)', [roomId, socket.user.id, text || "", imageUrl || null]);
      const [rows] = await pool.query(`SELECT m.id, m.room_id, m.text, m.image_url, m.created_at, u.username as user_name FROM messages m JOIN users u ON m.user_id = u.id WHERE m.id = ?`, [result.insertId]);
      io.to(roomId).emit('newMessage', rows[0]);
      io.emit('roomNotification', { roomId: roomId });
    } catch (e) { console.error(e); }
  });

  socket.on('sendPrivateMessage', async ({ toUserId, text, imageUrl }) => {
    if (!text && !imageUrl) return;
    try {
      const fromId = socket.user.id;
      const [result] = await pool.query('INSERT INTO direct_messages (sender_id, receiver_id, text, image_url) VALUES (?, ?, ?, ?)', [fromId, toUserId, text || "", imageUrl || null]);
      const msgData = { id: result.insertId, text: text || "", image_url: imageUrl || null, sender_id: fromId, user_name: socket.user.username, created_at: new Date() };
      io.to(toUserId.toString()).emit('privateMessage', msgData);
      socket.emit('privateMessage', msgData); 
    } catch (e) { console.error("Erro DM:", e); }
  });

  socket.on('disconnect', async () => { await atualizarListaGlobal(); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🔥 Servidor rodando na porta ${PORT}`));