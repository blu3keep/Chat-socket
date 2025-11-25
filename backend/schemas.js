const z = require('zod');

// Schema para Registro e Login
const userSchema = z.object({
    username: z.string()
        .min(3, "O usuário deve ter pelo menos 3 caracteres.")
        .max(20, "O usuário deve ter no máximo 20 caracteres.")
        .regex(/^[a-zA-Z0-9_]+$/, "O usuário deve conter apenas letras, números e underline."),
    password: z.string()
        .min(6, "A senha deve ter pelo menos 6 caracteres.")
        .max(100, "Senha muito longa."),
    // O captcha é opcional no schema pois validamos ele separadamente no server, 
    // mas permitimos que ele passe pelo objeto body
    captchaToken: z.string().optional()
});

// Schema para Mensagens (Socket e API)
const messageSchema = z.object({
    text: z.string()
        .min(1, "A mensagem não pode ser vazia.")
        .max(1000, "A mensagem é muito longa (máx 1000 caracteres)."),
    roomId: z.number().optional(), // Para mensagens públicas
    toUserId: z.number().optional() // Para mensagens privadas
});

module.exports = { userSchema, messageSchema };