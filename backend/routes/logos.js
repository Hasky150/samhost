const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');
const WowzaStreamingService = require('../config/WowzaStreamingService');

const router = express.Router();

// Configuração do multer para upload de logos
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const userId = req.user.id;
      const userLogin = req.user.email.split('@')[0];
      
      // Inicializar serviço Wowza para obter o servidor correto
      const wowzaService = new WowzaStreamingService();
      const initialized = await wowzaService.initializeFromDatabase(userId);
      
      if (!initialized) {
        throw new Error('Erro ao conectar com servidor de streaming');
      }
      
      // Caminho para logos no servidor do usuário
      const userContentPath = wowzaService.getUserContentPath(userLogin);
      const logoPath = `${userContentPath}/logos`;
      
      // Criar diretório se não existir
      await fs.mkdir(logoPath, { recursive: true });
      
      cb(null, logoPath);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    // Sanitizar nome do arquivo
    const sanitizedName = file.originalname
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .replace(/_{2,}/g, '_');
    
    cb(null, `${Date.now()}_${sanitizedName}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de arquivo não suportado'), false);
    }
  }
});

// GET /api/logos - Lista logos do usuário
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const userLogin = req.user.email.split('@')[0];

    // Inicializar serviço Wowza
    const wowzaService = new WowzaStreamingService();
    const initialized = await wowzaService.initializeFromDatabase(userId);

    const [rows] = await db.execute(
      `SELECT 
        codigo as id,
        nome,
        arquivo as url,
        tamanho,
        tipo_arquivo,
        data_upload as created_at,
        codigo_servidor
       FROM logos 
       WHERE codigo_stm = ?
       ORDER BY data_upload DESC`,
      [userId]
    );

    // Ajustar URLs para serem acessíveis via HTTP
    const logos = rows.map(logo => ({
      ...logo,
      url: logo.url ? `/content/${userLogin}/logos/${path.basename(logo.url)}` : null,
      servidor_ip: initialized ? wowzaService.wowzaHost : null,
      servidor_id: initialized ? wowzaService.serverId : null
    }));

    res.json(logos);
  } catch (err) {
    console.error('Erro ao buscar logos:', err);
    res.status(500).json({ error: 'Erro ao buscar logos', details: err.message });
  }
});

// POST /api/logos - Upload de logo
router.post('/', authMiddleware, upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const { nome } = req.body;
    const userId = req.user.id;
    const userLogin = req.user.email.split('@')[0];

    // Inicializar serviço Wowza
    const wowzaService = new WowzaStreamingService();
    const initialized = await wowzaService.initializeFromDatabase(userId);
    
    if (!initialized) {
      return res.status(500).json({ error: 'Erro ao conectar com servidor de streaming' });
    }

    if (!nome) {
      return res.status(400).json({ error: 'Nome da logo é obrigatório' });
    }

    // Caminho relativo para salvar no banco
    const relativePath = `/logos/${req.file.filename}`;

    // Inserir logo na tabela
    const [result] = await db.execute(
      `INSERT INTO logos (
        codigo_stm, nome, arquivo, tamanho, tipo_arquivo, data_upload, codigo_servidor
      ) VALUES (?, ?, ?, ?, ?, NOW(), ?)`,
      [userId, nome, relativePath, req.file.size, req.file.mimetype, wowzaService.serverId]
    );

    res.status(201).json({
      id: result.insertId,
      nome: nome,
      url: `/content/${userLogin}/logos/${req.file.filename}`,
      tamanho: req.file.size,
      tipo_arquivo: req.file.mimetype,
      servidor_ip: wowzaService.wowzaHost,
      servidor_id: wowzaService.serverId
    });
  } catch (err) {
    console.error('Erro no upload da logo:', err);
    res.status(500).json({ error: 'Erro no upload da logo', details: err.message });
  }
});

// DELETE /api/logos/:id - Remove logo
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const logoId = req.params.id;
    const userId = req.user.id;
    const userLogin = req.user.email.split('@')[0];

    // Inicializar serviço Wowza
    const wowzaService = new WowzaStreamingService();
    const initialized = await wowzaService.initializeFromDatabase(userId);

    // Buscar logo
    const [logoRows] = await db.execute(
      'SELECT arquivo, codigo_servidor FROM logos WHERE codigo = ? AND codigo_stm = ?',
      [logoId, userId]
    );

    if (logoRows.length === 0) {
      return res.status(404).json({ error: 'Logo não encontrada' });
    }

    const logo = logoRows[0];

    // Remover arquivo físico
    try {
      const fullPath = initialized ? 
        `${wowzaService.getUserContentPath(userLogin)}${logo.arquivo}` :
        `/usr/local/WowzaStreamingEngine/content/${userLogin}${logo.arquivo}`;
      
      console.log(`Removendo logo: ${fullPath}`);
      await fs.unlink(fullPath);
      console.log(`Logo removida com sucesso: ${fullPath}`);
    } catch (fileError) {
      console.warn('Erro ao remover arquivo físico:', fileError.message);
    }

    // Remover do banco
    await db.execute(
      'DELETE FROM logos WHERE codigo = ?',
      [logoId]
    );

    res.json({ success: true, message: 'Logo removida com sucesso' });
  } catch (err) {
    console.error('Erro ao remover logo:', err);
    res.status(500).json({ error: 'Erro ao remover logo', details: err.message });
  }
});

module.exports = router;