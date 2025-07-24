const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');
const WowzaStreamingService = require('../config/WowzaStreamingService');

const router = express.Router();

// Configuração do multer para upload de vídeos
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const userId = req.user.id;
      const userLogin = req.user.email.split('@')[0];
      const folderId = req.query.folder_id || 'default';
      
      // Inicializar serviço Wowza para obter o servidor correto do usuário
      const wowzaService = new WowzaStreamingService();
      const initialized = await wowzaService.initializeFromDatabase(userId);
      
      if (!initialized) {
        throw new Error('Erro ao conectar com servidor de streaming do usuário');
      }
      
      // Obter caminho do conteúdo baseado no servidor do usuário
      const userContentPath = wowzaService.getUserContentPath(userLogin);
      const wowzaPath = `${userContentPath}/${folderId}`;
      
      console.log(`Caminho de upload para usuário ${userLogin}: ${wowzaPath}`);
      
      // Criar diretório se não existir
      await fs.mkdir(wowzaPath, { recursive: true });
      
      // Garantir que o diretório do usuário existe no servidor Wowza
      await wowzaService.ensureUserDirectory(userLogin);
      
      cb(null, wowzaPath);
    } catch (error) {
      console.error('Erro ao configurar destino do upload:', error);
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
    fileSize: 2 * 1024 * 1024 * 1024 // 2GB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'video/mp4', 'video/avi', 'video/mov', 'video/wmv', 
      'video/flv', 'video/webm', 'video/mkv'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de arquivo não suportado'), false);
    }
  }
});

// GET /api/videos - Lista vídeos por pasta
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const userLogin = req.user.email.split('@')[0];
    const folderId = req.query.folder_id;
    
    if (!folderId) {
      return res.status(400).json({ error: 'folder_id é obrigatório' });
    }

    // Inicializar serviço Wowza para obter o servidor correto do usuário
    const wowzaService = new WowzaStreamingService();
    const initialized = await wowzaService.initializeFromDatabase(userId);
    
    if (!initialized) {
      return res.status(500).json({ error: 'Erro ao conectar com servidor de streaming' });
    }

    // Buscar vídeos baseado no caminho do servidor do usuário
    const folderPath = `/${userLogin}/${folderId}/`;

    const [rows] = await db.execute(
      `SELECT 
        codigo as id,
        video as nome,
        path_video as url,
        duracao_segundos as duracao,
        CHAR_LENGTH(video) * 1024 as tamanho,
        codigo_servidor
       FROM playlists_videos 
       WHERE path_video LIKE ? OR (path_video LIKE ? AND codigo_servidor = ?)
       ORDER BY codigo`,
      [`%${folderPath}%`, `%/${userLogin}/%`, wowzaService.serverId]
    );

    // Ajustar URLs para serem acessíveis via HTTP do servidor correto
    const videos = rows.map(video => ({
      ...video,
      url: video.url ? (video.url.startsWith('/content') ? video.url : `/content${video.url}`) : null,
      servidor_ip: wowzaService.wowzaHost,
      servidor_id: wowzaService.serverId
    }));

    console.log(`Encontrados ${videos.length} vídeos para usuário ${userLogin} na pasta ${folderId}`);

    res.json(videos);
  } catch (err) {
    console.error('Erro ao buscar vídeos:', err);
    res.status(500).json({ error: 'Erro ao buscar vídeos', details: err.message });
  }
});

// POST /api/videos/upload - Upload de vídeo
router.post('/upload', authMiddleware, upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const userId = req.user.id;
    const userLogin = req.user.email.split('@')[0];
    const folderId = req.query.folder_id || 'default';
    const duracao = parseInt(req.body.duracao) || 0;
    const tamanho = parseInt(req.body.tamanho) || req.file.size;

    // Inicializar serviço Wowza para obter o servidor correto do usuário
    const wowzaService = new WowzaStreamingService();
    const initialized = await wowzaService.initializeFromDatabase(userId);
    
    if (!initialized) {
      return res.status(500).json({ error: 'Erro ao conectar com servidor de streaming' });
    }

    // Verificar espaço disponível do usuário
    const [userSpaceRows] = await db.execute(
      'SELECT espaco, espaco_usado FROM streamings WHERE codigo = ? OR codigo_cliente = ?',
      [userId, userId]
    );

    if (userSpaceRows.length > 0) {
      const userSpace = userSpaceRows[0];
      const spaceMB = Math.ceil(tamanho / (1024 * 1024));
      const availableSpace = userSpace.espaco - userSpace.espaco_usado;
      
      if (spaceMB > availableSpace) {
        return res.status(400).json({ 
          error: `Espaço insuficiente. Necessário: ${spaceMB}MB, Disponível: ${availableSpace}MB` 
        });
      }
    }

    // Caminho relativo para salvar no banco
    const relativePath = `/${userLogin}/${folderId}/${req.file.filename}`;
    
    console.log(`Salvando vídeo: ${req.file.originalname}`);
    console.log(`Caminho relativo: ${relativePath}`);
    console.log(`Servidor Wowza: ${wowzaService.wowzaHost} (ID: ${wowzaService.serverId})`);

    // Inserir vídeo na tabela playlists_videos
    const [result] = await db.execute(
      `INSERT INTO playlists_videos (
        codigo_playlist, path_video, video, width, height, 
        bitrate, duracao, duracao_segundos, tipo, ordem, codigo_servidor
      ) VALUES (0, ?, ?, 1920, 1080, 2500, ?, ?, 'video', 0, ?)`,
      [relativePath, req.file.originalname, '00:00:00', duracao, wowzaService.serverId]
    );

    // Atualizar espaço usado do usuário
    const spaceMB = Math.ceil(tamanho / (1024 * 1024));
    if (userSpaceRows.length > 0) {
      await db.execute(
        'UPDATE streamings SET espaco_usado = espaco_usado + ? WHERE codigo = ? OR codigo_cliente = ?',
        [spaceMB, userId, userId]
      );
    }

    res.status(201).json({
      id: result.insertId,
      nome: req.file.originalname,
      url: `/content${relativePath}`,
      duracao: duracao,
      tamanho: tamanho,
      servidor_ip: wowzaService.wowzaHost,
      servidor_id: wowzaService.serverId,
      path_completo: `${wowzaService.getUserContentPath(userLogin)}/${folderId}/${req.file.filename}`
    });
  } catch (err) {
    console.error('Erro no upload:', err);
    res.status(500).json({ error: 'Erro no upload do vídeo', details: err.message });
  }
});

// DELETE /api/videos/:id - Remove vídeo
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const videoId = req.params.id;
    const userId = req.user.id;
    const userLogin = req.user.email.split('@')[0];

    // Inicializar serviço Wowza
    const wowzaService = new WowzaStreamingService();
    const initialized = await wowzaService.initializeFromDatabase(userId);

    // Buscar vídeo
    const [videoRows] = await db.execute(
      'SELECT path_video, video, codigo_servidor FROM playlists_videos WHERE codigo = ?',
      [videoId]
    );

    if (videoRows.length === 0) {
      return res.status(404).json({ error: 'Vídeo não encontrado' });
    }

    const video = videoRows[0];

    // Verificar se o vídeo pertence ao usuário
    if (!video.path_video.includes(`/${userLogin}/`)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    // Verificar se o vídeo está no servidor correto
    if (initialized && video.codigo_servidor && video.codigo_servidor !== wowzaService.serverId) {
      console.warn(`Vídeo está em servidor diferente: ${video.codigo_servidor} vs ${wowzaService.serverId}`);
      // Continuar com a remoção mesmo assim
    }

    // Remover arquivo físico
    try {
      const fullPath = initialized ? 
        `${wowzaService.getUserContentPath(userLogin)}${video.path_video.replace(`/${userLogin}`, '')}` :
        `/usr/local/WowzaStreamingEngine/content${video.path_video}`;
      
      console.log(`Tentando remover arquivo: ${fullPath}`);
      await fs.unlink(fullPath);
      console.log(`Arquivo removido com sucesso: ${fullPath}`);
    } catch (fileError) {
      console.warn('Erro ao remover arquivo físico:', fileError.message);
    }

    // Remover do banco
    await db.execute(
      'DELETE FROM playlists_videos WHERE codigo = ?',
      [videoId]
    );

    res.json({ success: true, message: 'Vídeo removido com sucesso' });
  } catch (err) {
    console.error('Erro ao remover vídeo:', err);
    res.status(500).json({ error: 'Erro ao remover vídeo', details: err.message });
  }
});

module.exports = router;