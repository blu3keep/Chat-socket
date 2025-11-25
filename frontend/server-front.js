const express = require('express');
const path = require('path');

const app = express();
const PORT = 80;

// --- SEGURANÇA: REMOVE O HEADER X-POWERED-BY ---
app.disable('x-powered-by'); // <--- A LINHA MÁGICA

// Middleware de Log (opcional)
app.use((req, res, next) => {
    // console.log(`[REQUEST] ${req.method} ${req.url}`); // Descomente se quiser logs
    next();
});

// Configuração de Arquivos Estáticos
app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
    console.log('--------------------------------------------------');
    console.log(`🚀 Frontend Seguro rodando em: http://localhost`);
    console.log('--------------------------------------------------');
});