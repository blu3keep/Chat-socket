const express = require('express');
const path = require('path');

const app = express();
const PORT = 80;

// Middleware de Log (opcional, mas bom para debug)
app.use((req, res, next) => {
    console.log(`[REQUEST] ${req.method} ${req.url}`);
    next();
});

// --- CONFIGURAÇÃO PADRÃO ---
// Como a pasta 'css' agora está DENTRO daqui, o static já a encontra automaticamente.
app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
    console.log('--------------------------------------------------');
    console.log(`🚀 Frontend Organizado rodando em: http://localhost`);
    console.log('--------------------------------------------------');
});