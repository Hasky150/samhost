const express = require('express');
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');
const WowzaStreamingService = require('../config/WowzaStreamingService');

const router = express.Router();

// GET /api/folders - Lista pastas do usuário
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const userLogin = req.user.email.split('@')[0];

    // Inicializar serviço Wowza para obter informações do servidor
    const wowzaService = new WowzaStreamingService();
    const initialized = await wowzaService.initializeFromDatabase(userId);

    // Buscar pastas do usuário
    const [rows] = await db.execute(
      `SELECT 
        codigo as id,
        identificacao as nome,
        codigo_servidor,
        ftp_dir
       FROM streamings 
       WHERE (codigo_cliente = ? OR codigo = ?) AND status = 1`,
      [userId, userId]
    );

    // Ajustar dados das pastas com informações do servidor
    const folders = rows.map(folder => ({
      id: folder.codigo,
      nome: folder.identificacao,
      servidor_id: folder.codigo_servidor,
      ftp_dir: folder.ftp_dir,
      servidor_ip: initialized ? wowzaService.wowzaHost : null
    }));

    // Se não houver pastas, criar uma pasta padrão baseada no usuário
    if (rows.length === 0) {
      res.json([{ 
        id: 1, 
        nome: userLogin,
        servidor_id: initialized ? wowzaService.serverId : null,
        servidor_ip: initialized ? wowzaService.wowzaHost : null,
        ftp_dir: `/${userLogin}/`
      }]);
    } else {
      res.json(folders);
    }
  } catch (err) {
    console.error('Erro ao buscar pastas:', err);
    res.status(500).json({ error: 'Erro ao buscar pastas', details: err.message });
  }
});

// POST /api/folders - Cria nova pasta
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { nome } = req.body;
    if (!nome) return res.status(400).json({ error: 'Nome da pasta é obrigatório' });
    
    const userId = req.user.id;
    const userLogin = req.user.email.split('@')[0];

    // Inicializar serviço Wowza para obter o servidor correto
    const wowzaService = new WowzaStreamingService();
    const initialized = await wowzaService.initializeFromDatabase(userId);
    
    if (!initialized) {
      return res.status(500).json({ error: 'Erro ao conectar com servidor de streaming' });
    }

    // Criar entrada na tabela streamings para representar a pasta
    const [result] = await db.execute(
      `INSERT INTO streamings (
        codigo_cliente, codigo_servidor, login, senha, senha_transmissao,
        espectadores, bitrate, espaco, ftp_dir, identificacao, email,
        data_cadastro, aplicacao, status
      ) VALUES (?, ?, ?, '', '', 100, 2500, 1000, ?, ?, ?, NOW(), 'live', 1)`,
      [userId, wowzaService.serverId, userLogin, `/${userLogin}/${nome}`, nome, req.user.email]
    );

    // Criar diretório físico no servidor Wowza
    const userContentPath = wowzaService.getUserContentPath(userLogin);
    const folderPath = `${userContentPath}/${nome}`;
    
    try {
      await fs.mkdir(folderPath, { recursive: true });
      console.log(`Pasta criada no servidor: ${folderPath}`);
    } catch (error) {
      console.warn('Erro ao criar pasta física:', error.message);
    }

    res.status(201).json({
      id: result.insertId,
      nome: nome,
      servidor_id: wowzaService.serverId,
      servidor_ip: wowzaService.wowzaHost,
      ftp_dir: `/${userLogin}/${nome}`
    });
  } catch (err) {
    console.error('Erro ao criar pasta:', err);
    res.status(500).json({ error: 'Erro ao criar pasta', details: err.message });
  }
});

// DELETE /api/folders/:id - Remove pasta
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const folderId = req.params.id;
    const userId = req.user.id;
    const userLogin = req.user.email.split('@')[0];

    // Inicializar serviço Wowza
    const wowzaService = new WowzaStreamingService();
    const initialized = await wowzaService.initializeFromDatabase(userId);

    // Verificar se a pasta pertence ao usuário
    const [folderRows] = await db.execute(
      'SELECT codigo, identificacao, ftp_dir FROM streamings WHERE codigo = ? AND (codigo_cliente = ? OR codigo = ?)',
      [folderId, userId, userId]
    );

    if (folderRows.length === 0) {
      return res.status(404).json({ error: 'Pasta não encontrada' });
    }

    const folder = folderRows[0];

    // Verificar se há vídeos na pasta
    const [videoRows] = await db.execute(
      'SELECT COUNT(*) as count FROM playlists_videos WHERE path_video LIKE ? OR path_video LIKE ?',
      [`%/${folderId}/%`, `%${folder.ftp_dir}%`]
    );

    if (videoRows[0].count > 0) {
      return res.status(400).json({ 
        error: 'Não é possível excluir pasta que contém vídeos',
        details: 'Remova todos os vídeos da pasta antes de excluí-la'
      });
    }

    // Remover pasta física do servidor Wowza
    if (initialized && folder.ftp_dir) {
      try {
        const folderPath = `${wowzaService.getUserContentPath(userLogin)}${folder.ftp_dir.replace(`/${userLogin}`, '')}`;
        await fs.rmdir(folderPath, { recursive: true });
        console.log(`Pasta física removida: ${folderPath}`);
      } catch (error) {
        console.warn('Erro ao remover pasta física:', error.message);
      }
    }

    // Remover pasta
    await db.execute(
      'DELETE FROM streamings WHERE codigo = ? AND (codigo_cliente = ? OR codigo = ?)',
      [folderId, userId, userId]
    );

    res.json({ success: true, message: 'Pasta removida com sucesso' });
  } catch (err) {
    console.error('Erro ao remover pasta:', err);
    res.status(500).json({ error: 'Erro ao remover pasta', details: err.message });
  }
});

module.exports = router;