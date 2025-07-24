  const express = require('express');
  const cors = require('cors');
  const path = require('path');
  const db = require('./config/database');


  // Importar rotas
  const authRoutes = require('./routes/auth');
  const foldersRoutes = require('./routes/folders');
  const videosRoutes = require('./routes/videos');
  const playlistsRoutes = require('./routes/playlists');
  const agendamentosRoutes = require('./routes/agendamentos');
  const comerciaisRoutes = require('./routes/comerciais');
  const downloadyoutubeRoutes = require('./routes/downloadyoutube');
  const espectadoresRoutes = require('./routes/espectadores');
  const streamingRoutes = require('./routes/streaming');
  const relayRoutes = require('./routes/relay');
  const logosRoutes = require('./routes/logos');
  const transmissionSettingsRoutes = require('./routes/transmission-settings');
  const ftpRoutes = require('./routes/ftp');
  // const serversRoutes = require('./routes/servers');

  const app = express();
  const PORT = process.env.PORT || 3001;
  const isProduction = process.env.NODE_ENV === 'production';

  // Middlewares
  app.use(cors({
    origin: isProduction ? [
      'http://samhost.wcore.com.br',
      'https://samhost.wcore.com.br',
      'http://samhost.wcore.com.br:3000'
    ] : [
      'http://localhost:3000',
      'http://127.0.0.1:3000'
    ],
    credentials: true
  }));
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Servir arquivos estáticos do Wowza
  // Middleware dinâmico para servir arquivos do servidor Wowza correto
  app.use('/content', async (req, res, next) => {
    try {
      // Extrair informações do usuário da URL ou token
      const authHeader = req.headers.authorization;
      let userId = null;
      
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const jwt = require('jsonwebtoken');
          const token = authHeader.substring(7);
          const decoded = jwt.verify(token, process.env.JWT_SECRET || 'sua_chave_secreta_super_segura_aqui');
          userId = decoded.userId;
        } catch (error) {
          console.warn('Token inválido para acesso ao conteúdo:', error.message);
        }
      }
      
      // Se não conseguiu obter userId do token, tentar extrair da URL
      if (!userId) {
        const urlParts = req.path.split('/');
        if (urlParts.length > 1) {
          // Tentar encontrar usuário baseado no caminho
          const possibleUser = urlParts[1];
          if (possibleUser) {
            try {
              const [userRows] = await db.execute(
                'SELECT codigo FROM streamings WHERE login = ? OR identificacao = ? LIMIT 1',
                [possibleUser, possibleUser]
              );
              if (userRows.length > 0) {
                userId = userRows[0].codigo;
              }
            } catch (error) {
              console.warn('Erro ao buscar usuário pela URL:', error.message);
            }
          }
        }
      }
      
      // Configurar headers CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Authorization');
      res.setHeader('Accept-Ranges', 'bytes');
      
      // Headers para cache de vídeos
      if (req.path.match(/\.(mp4|avi|mov|wmv|flv|webm|mkv|png|jpg|jpeg|gif)$/i)) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
        
        if (req.path.match(/\.(mp4|avi|mov|wmv|flv|webm|mkv)$/i)) {
          res.setHeader('Content-Type', 'video/mp4');
        }
      }
      
      // Se temos userId, usar o servidor Wowza específico do usuário
      if (userId) {
        try {
          const WowzaStreamingService = require('./config/WowzaStreamingService');
          const wowzaService = new WowzaStreamingService();
          const initialized = await wowzaService.initializeFromDatabase(userId);
          
          if (initialized) {
            const userContentPath = wowzaService.getUserContentPath(wowzaService.userLogin || 'default');
            const filePath = path.join(userContentPath, req.path);
            
            console.log(`Servindo arquivo do servidor específico: ${filePath}`);
            
            // Verificar se arquivo existe
            try {
              await fs.access(filePath);
              return res.sendFile(filePath);
            } catch (error) {
              console.warn(`Arquivo não encontrado no servidor específico: ${filePath}`);
            }
          }
        } catch (error) {
          console.warn('Erro ao acessar servidor específico:', error.message);
        }
      }
      
      // Fallback para o caminho padrão
      const defaultPath = `/usr/local/WowzaStreamingEngine/content${req.path}`;
      try {
        await fs.access(defaultPath);
        return res.sendFile(defaultPath);
      } catch (error) {
        console.error(`Arquivo não encontrado: ${defaultPath}`);
        return res.status(404).json({ error: 'Arquivo não encontrado' });
      }
      
    } catch (error) {
      console.error('Erro no middleware de conteúdo:', error);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }
  )
  
  // Servir arquivos estáticos do frontend em produção
  if (isProduction) {
    app.use(express.static(path.join(__dirname, '../dist')));
    
    // Catch all handler: send back React's index.html file for SPA routing
    app.get('*', (req, res) => {
      if (!req.path.startsWith('/api/')) {
        res.sendFile(path.join(__dirname, '../dist/index.html'));
      }
    });
  }

  // Rotas da API
  app.use('/api/auth', authRoutes);
  app.use('/api/folders', foldersRoutes);
  app.use('/api/videos', videosRoutes);
  app.use('/api/playlists', playlistsRoutes);
  app.use('/api/agendamentos', agendamentosRoutes);
  app.use('/api/comerciais', comerciaisRoutes);
  app.use('/api/downloadyoutube', downloadyoutubeRoutes);
  app.use('/api/espectadores', espectadoresRoutes);
  app.use('/api/streaming', streamingRoutes);
  app.use('/api/relay', relayRoutes);
  app.use('/api/logos', logosRoutes);
  app.use('/api/transmission-settings', transmissionSettingsRoutes);
  app.use('/api/ftp', ftpRoutes);
  // app.use('/api/servers', serversRoutes);

  // Rota de teste
  app.get('/api/test', (req, res) => {
    res.json({ message: 'API funcionando!', timestamp: new Date().toISOString() });
  });

  // Rota de health check
  app.get('/api/health', async (req, res) => {
    try {
      const dbConnected = await db.testConnection();
      res.json({
        status: 'ok',
        database: dbConnected ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        status: 'error',
        database: 'disconnected',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Middleware de tratamento de erros
  app.use((error, req, res, next) => {
    console.error('Erro não tratado:', error);
    
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Arquivo muito grande' });
    }
    
    if (error.message.includes('Tipo de arquivo não suportado')) {
      return res.status(400).json({ error: 'Tipo de arquivo não suportado' });
    }
    
    res.status(500).json({ error: 'Erro interno do servidor' });
  });

  // Rota 404
  app.use('*', (req, res) => {
    res.status(404).json({ error: 'Rota não encontrada' });
  });

  // Iniciar servidor
  async function startServer() {
    try {
      // Testar conexão com banco
      const dbConnected = await db.testConnection();
      
      if (!dbConnected) {
        console.error('❌ Não foi possível conectar ao banco de dados');
        process.exit(1);
      }

      app.listen(PORT, () => {
        console.log(`🚀 Servidor rodando na porta ${PORT}`);
        console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
        console.log(`🔧 API test: http://localhost:${PORT}/api/test`);
      });
    } catch (error) {
      console.error('❌ Erro ao iniciar servidor:', error);
      process.exit(1);
    }
  }

  startServer();