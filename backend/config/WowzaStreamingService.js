const DigestFetch = require('digest-fetch');
const db = require('./database');

class WowzaStreamingService {
    constructor(serverId = null) {
        this.serverId = serverId;
        this.wowzaHost = null;
        this.wowzaPassword = null;
        this.wowzaUser = null;
        this.wowzaPort = null;
        this.wowzaApplication = process.env.WOWZA_APPLICATION || 'live';
        this.baseUrl = null;
        this.client = null;
        this.activeStreams = new Map();
        this.obsStreams = new Map(); // Para streams vindos do OBS
    }

    async initializeFromDatabase(userId) {
        try {
            // Buscar dados do usuário e seu servidor Wowza
            let userServerId = null;
            let userLogin = null;
            
            // Primeiro, buscar dados do usuário (streaming ou revenda)
            const [userRows] = await db.execute(
                `SELECT 
                    s.codigo_servidor,
                    s.login,
                    s.identificacao,
                    s.email,
                    'streaming' as tipo
                 FROM streamings s 
                 WHERE s.codigo = ? OR s.codigo_cliente = ?
                 UNION
                 SELECT 
                    NULL as codigo_servidor,
                    r.email as login,
                    r.nome as identificacao,
                    r.email,
                    'revenda' as tipo
                 FROM revendas r 
                 WHERE r.codigo = ?
                 LIMIT 1`,
                [userId, userId, userId]
            );

            if (userRows.length > 0) {
                const userData = userRows[0];
                userServerId = userData.codigo_servidor;
                userLogin = userData.login || userData.email?.split('@')[0];
                
                console.log(`Usuário encontrado: ${userData.identificacao} (${userData.tipo})`);
                console.log(`Servidor do usuário: ${userServerId || 'Não definido'}`);
                console.log(`Login do usuário: ${userLogin}`);
            }

            // Se não encontrou servidor específico do usuário, buscar o melhor servidor disponível
            let serverId = userServerId;
            if (!serverId) {
                console.log('Servidor não definido para o usuário, buscando melhor servidor disponível...');
                const [bestServerRows] = await db.execute(
                    `SELECT codigo FROM wowza_servers 
                     WHERE status = 'ativo' 
                     ORDER BY streamings_ativas ASC, load_cpu ASC 
                     LIMIT 1`
                );
                
                if (bestServerRows.length > 0) {
                    serverId = bestServerRows[0].codigo;
                    console.log(`Servidor selecionado automaticamente: ${serverId}`);
                }
            }

            // Buscar configurações do servidor Wowza
            const [serverRows] = await db.execute(
                `SELECT 
                    codigo,
                    nome,
                    ip, 
                    senha_root,
                    porta_ssh,
                    limite_streamings,
                    streamings_ativas,
                    load_cpu,
                    status,
                    tipo_servidor,
                    caminho_conteudo
                 FROM wowza_servers 
                 WHERE codigo = ? AND status = 'ativo'`,
                [serverId || 1]
            );

            if (serverRows.length > 0) {
                const server = serverRows[0];
                this.serverId = server.codigo;
                this.wowzaHost = server.ip;
                this.wowzaPort = 8087; // Porta da API REST do Wowza
                this.wowzaUser = 'admin'; // Usuário padrão da API
                this.wowzaPassword = server.senha_root; // Usar senha root como senha da API
                this.contentPath = server.caminho_conteudo || '/usr/local/WowzaStreamingEngine/content';
                this.userLogin = userLogin;
                this.serverInfo = {
                    id: server.codigo,
                    nome: server.nome,
                    limite_streamings: server.limite_streamings,
                    streamings_ativas: server.streamings_ativas,
                    load_cpu: server.load_cpu,
                    tipo_servidor: server.tipo_servidor
                    caminho_conteudo: server.caminho_conteudo
                };

                this.baseUrl = `http://${this.wowzaHost}:${this.wowzaPort}/v2/servers/_defaultServer_/vhosts/_defaultVHost_`;
                this.client = new DigestFetch(this.wowzaUser, this.wowzaPassword);
                
                console.log(`Wowza inicializado: ${server.nome} (${server.ip})`);
                return true;
            } else {
                console.error('Nenhum servidor Wowza ativo encontrado no banco de dados');
                return false;
            }
        } catch (error) {
            console.error('Erro ao inicializar configurações do Wowza:', error);
            return false;
        }
    }

    // Método para obter o caminho completo do conteúdo do usuário
    getUserContentPath(userLogin) {
        if (!this.contentPath || !userLogin) {
            return '/usr/local/WowzaStreamingEngine/content';
        }
        return `${this.contentPath}/${userLogin}`;
    }

    // Método para criar diretório do usuário no servidor Wowza
    async ensureUserDirectory(userLogin) {
        try {
            const userPath = this.getUserContentPath(userLogin);
            console.log(`Garantindo que o diretório do usuário existe: ${userPath}`);
            
            // Em produção, você faria uma chamada SSH ou API para criar o diretório
            // Por enquanto, apenas logamos
            return { success: true, path: userPath };
        } catch (error) {
            console.error('Erro ao criar diretório do usuário:', error);
            return { success: false, error: error.message };
        }
    }

    async makeWowzaRequest(endpoint, method = 'GET', data = null) {
        if (!this.client || !this.baseUrl) {
            throw new Error('Serviço Wowza não inicializado. Chame initializeFromDatabase() primeiro.');
        }

        try {
            const url = `${this.baseUrl}${endpoint}`;
            const options = {
                method,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                }
            };

            if (data) {
                options.body = JSON.stringify(data);
            }

            const response = await this.client.fetch(url, options);
            const text = await response.text();

            let parsedData;
            try {
                parsedData = text ? JSON.parse(text) : {};
            } catch {
                parsedData = text;
            }

            return {
                statusCode: response.status,
                data: parsedData,
                success: response.ok
            };
        } catch (error) {
            console.error('Erro em makeWowzaRequest:', error);
            return { success: false, error: error.message };
        }
    }

    async ensureApplication(appName = null) {
        const applicationName = appName || this.wowzaApplication;

        const checkResult = await this.makeWowzaRequest(
            `/applications/${applicationName}`
        );

        if (checkResult.success) {
            return { success: true, exists: true };
        }

        const appConfig = {
            id: applicationName,
            appType: 'Live',
            name: applicationName,
            description: 'Live streaming app created via API',
        };

        const createResult = await this.makeWowzaRequest(
            `/applications`,
            'POST',
            appConfig
        );

        return {
            success: createResult.success,
            exists: false,
            created: createResult.success
        };
    }

    async configurePlatformPush(streamName, platforms) {
        const pushConfigs = [];

        for (const platform of platforms) {
            try {
                const pushConfig = {
                    id: `${streamName}_${platform.platform.codigo}`,
                    sourceStreamName: streamName,
                    entryName: streamName,
                    outputHostName: this.extractHostFromRtmp(platform.rtmp_url || platform.platform.rtmp_base_url),
                    outputApplicationName: this.extractAppFromRtmp(platform.rtmp_url || platform.platform.rtmp_base_url),
                    outputStreamName: platform.stream_key,
                    userName: '',
                    password: '',
                    enabled: true
                };

                const result = await this.makeWowzaRequest(
                    `/applications/${this.wowzaApplication}/pushpublish/mapentries/${pushConfig.id}`,
                    'PUT',
                    pushConfig
                );

                if (result.success) {
                    pushConfigs.push({
                        platform: platform.platform.codigo,
                        name: pushConfig.id,
                        success: true
                    });
                } else {
                    pushConfigs.push({
                        platform: platform.platform.codigo,
                        name: pushConfig.id,
                        success: false,
                        error: result.data
                    });
                }
            } catch (error) {
                console.error(`Erro ao configurar push para ${platform.platform.nome}:`, error);
                pushConfigs.push({
                    platform: platform.platform.codigo,
                    success: false,
                    error: error.message
                });
            }
        }

        return pushConfigs;
    }

    extractHostFromRtmp(rtmpUrl) {
        try {
            const url = new URL(rtmpUrl.replace('rtmp://', 'http://').replace('rtmps://', 'https://'));
            return url.hostname;
        } catch {
            return rtmpUrl.split('/')[2] || rtmpUrl;
        }
    }

    extractAppFromRtmp(rtmpUrl) {
        try {
            const parts = rtmpUrl.split('/');
            return parts[3] || 'live';
        } catch {
            return 'live';
        }
    }

    // Configurar aplicação para receber streams do OBS
    async setupOBSApplication(userLogin, userConfig) {
        try {
            const applicationName = userConfig.aplicacao || 'live';
            
            // Verificar se aplicação existe
            const appResult = await this.ensureApplication(applicationName);
            if (!appResult.success) {
                throw new Error('Falha ao configurar aplicação no Wowza');
            }

            // Configurar stream de entrada para o usuário
            const streamConfig = {
                name: `${userLogin}_live`,
                sourceStreamName: `${userLogin}_live`,
                applicationName: applicationName,
                streamType: 'live',
                recordingEnabled: true,
                recordingPath: `/usr/local/WowzaStreamingEngine/content/${userLogin}/recordings/`,
                maxBitrate: userConfig.bitrate || 2500,
                maxViewers: userConfig.espectadores || 100
            };

            return {
                success: true,
                rtmpUrl: `rtmp://${this.wowzaHost}:1935/${applicationName}`,
                streamKey: `${userLogin}_live`,
                hlsUrl: `http://${this.wowzaHost}:1935/${applicationName}/${userLogin}_live/playlist.m3u8`,
                recordingPath: streamConfig.recordingPath,
                config: streamConfig
            };
        } catch (error) {
            console.error('Erro ao configurar aplicação OBS:', error);
            return { success: false, error: error.message };
        }
    }

    // Iniciar gravação de stream
    async startRecording(streamName, userLogin) {
        try {
            const recordingConfig = {
                instanceName: `${streamName}_recording`,
                fileFormat: 'mp4',
                segmentationType: 'none',
                outputPath: `/usr/local/WowzaStreamingEngine/content/${userLogin}/recordings/`,
                recordData: true,
                applicationName: this.wowzaApplication,
                streamName: streamName
            };

            const result = await this.makeWowzaRequest(
                `/applications/${this.wowzaApplication}/instances/_definst_/streamrecorders/${recordingConfig.instanceName}`,
                'PUT',
                recordingConfig
            );

            return result;
        } catch (error) {
            console.error('Erro ao iniciar gravação:', error);
            return { success: false, error: error.message };
        }
    }

    // Parar gravação de stream
    async stopRecording(streamName) {
        try {
            const recordingInstanceName = `${streamName}_recording`;
            
            const result = await this.makeWowzaRequest(
                `/applications/${this.wowzaApplication}/instances/_definst_/streamrecorders/${recordingInstanceName}/actions/stopRecording`,
                'PUT'
            );

            return result;
        } catch (error) {
            console.error('Erro ao parar gravação:', error);
            return { success: false, error: error.message };
        }
    }

    // Verificar se stream está ativo (vindo do OBS)
    async checkOBSStreamStatus(streamName) {
        try {
            const result = await this.makeWowzaRequest(
                `/applications/${this.wowzaApplication}/instances/_definst_/incomingstreams/${streamName}`
            );

            if (result.success && result.data) {
                return {
                    isLive: true,
                    streamName: streamName,
                    bitrate: result.data.bitrate || 0,
                    viewers: await this.getStreamViewers(streamName),
                    uptime: this.calculateStreamUptime(result.data.uptimeSeconds || 0)
                };
            }

            return { isLive: false };
        } catch (error) {
            console.error('Erro ao verificar status do stream OBS:', error);
            return { isLive: false, error: error.message };
        }
    }

    // Obter número de espectadores de um stream
    async getStreamViewers(streamName) {
        try {
            const result = await this.makeWowzaRequest(
                `/applications/${this.wowzaApplication}/instances/_definst_/incomingstreams/${streamName}/monitoring/current`
            );

            if (result.success && result.data) {
                return result.data.sessionCount || 0;
            }

            return 0;
        } catch (error) {
            console.error('Erro ao obter espectadores:', error);
            return 0;
        }
    }

    // Calcular uptime do stream
    calculateStreamUptime(uptimeSeconds) {
        const hours = Math.floor(uptimeSeconds / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);
        const seconds = Math.floor(uptimeSeconds % 60);

        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    // Configurar push para múltiplas plataformas
    async setupMultiPlatformPush(sourceStreamName, platforms, userConfig) {
        const pushConfigs = [];

        for (const platform of platforms) {
            try {
                // Verificar se o bitrate está dentro do limite do usuário
                const maxBitrate = userConfig.bitrate || 2500;
                const platformBitrate = Math.min(platform.bitrate || 2500, maxBitrate);

                const pushConfig = {
                    id: `${sourceStreamName}_${platform.platform.codigo}`,
                    sourceStreamName: sourceStreamName,
                    entryName: sourceStreamName,
                    outputHostName: this.extractHostFromRtmp(platform.rtmp_url || platform.platform.rtmp_base_url),
                    outputApplicationName: this.extractAppFromRtmp(platform.rtmp_url || platform.platform.rtmp_base_url),
                    outputStreamName: platform.stream_key,
                    userName: '',
                    password: '',
                    enabled: true,
                    profile: 'rtmp',
                    videoCodec: 'H.264',
                    audioCodec: 'AAC',
                    videoBitrate: platformBitrate,
                    audioBitrate: 128
                };

                const result = await this.makeWowzaRequest(
                    `/applications/${this.wowzaApplication}/pushpublish/mapentries/${pushConfig.id}`,
                    'PUT',
                    pushConfig
                );

                if (result.success) {
                    pushConfigs.push({
                        platform: platform.platform.codigo,
                        name: pushConfig.id,
                        success: true,
                        bitrate: platformBitrate
                    });
                } else {
                    pushConfigs.push({
                        platform: platform.platform.codigo,
                        name: pushConfig.id,
                        success: false,
                        error: result.data
                    });
                }
            } catch (error) {
                console.error(`Erro ao configurar push para ${platform.platform.nome}:`, error);
                pushConfigs.push({
                    platform: platform.platform.codigo,
                    success: false,
                    error: error.message
                });
            }
        }

        return pushConfigs;
    }

    // Iniciar transmissão de playlist do painel
    async startPlaylistStream({ streamId, userId, userLogin, userConfig, playlistId, videos = [], platforms = [] }) {
        try {
            console.log(`Iniciando transmissão de playlist - Stream ID: ${streamId}`);

            // Verificar limites do usuário
            if (this.serverInfo) {
                if (this.serverInfo.streamings_ativas >= this.serverInfo.limite_streamings) {
                    throw new Error('Servidor atingiu o limite máximo de streamings simultâneas');
                }
                
                if (this.serverInfo.load_cpu > 90) {
                    throw new Error('Servidor com alta carga de CPU. Tente novamente em alguns minutos');
                }
            }

            // Verificar se usuário não excedeu seu limite de bitrate
            const maxBitrate = userConfig.bitrate || 2500;
            const streamBitrate = Math.min(2500, maxBitrate);

            const appResult = await this.ensureApplication();
            if (!appResult.success) {
                throw new Error('Falha ao configurar aplicação no Wowza');
            }

            const streamName = `${userLogin}_playlist_${Date.now()}`;

            // Configurar push para plataformas
            const pushResults = await this.setupMultiPlatformPush(streamName, platforms, userConfig);

            // Configurar gravação se habilitada
            let recordingResult = null;
            if (userConfig.gravar_stream !== 'nao') {
                recordingResult = await this.startRecording(streamName, userLogin);
            }

            // Atualizar contador de streamings ativas no servidor
            if (this.serverId) {
                await db.execute(
                    'UPDATE wowza_servers SET streamings_ativas = streamings_ativas + 1 WHERE codigo = ?',
                    [this.serverId]
                );
            }

            this.activeStreams.set(streamId, {
                streamName,
                wowzaStreamId: streamName,
                videos,
                currentVideoIndex: 0,
                startTime: new Date(),
                playlistId,
                platforms: pushResults,
                viewers: 0,
                bitrate: streamBitrate,
                serverId: this.serverId,
                userLogin,
                recording: recordingResult?.success || false,
                type: 'playlist'
            });

            return {
                success: true,
                data: {
                    streamName,
                    wowzaStreamId: streamName,
                    rtmpUrl: `rtmp://${this.wowzaHost}:1935/${this.wowzaApplication}`,
                    streamKey: streamName,
                    playUrl: `http://${this.wowzaHost}:1935/${this.wowzaApplication}/${streamName}/playlist.m3u8`,
                    hlsUrl: `http://${this.wowzaHost}:1935/${this.wowzaApplication}/${streamName}/playlist.m3u8`,
                    dashUrl: `http://${this.wowzaHost}:1935/${this.wowzaApplication}/${streamName}/manifest.mpd`,
                    pushResults,
                    serverInfo: this.serverInfo,
                    recording: recordingResult?.success || false
                },
                bitrate: streamBitrate
            };

        } catch (error) {
            console.error('Erro ao iniciar stream de playlist:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async startStream({ streamId, userId, playlistId, videos = [], platforms = [] }) {
        // Método mantido para compatibilidade - redireciona para startPlaylistStream
        return this.startPlaylistStream({ streamId, userId, playlistId, videos, platforms });
    }

    async startOBSStream({ userId, userLogin, userConfig, platforms = [] }) {
        try {
            console.log(`Configurando stream OBS para usuário: ${userLogin}`);

            // Verificar se o servidor ainda tem capacidade
            if (this.serverInfo) {
                if (this.serverInfo.streamings_ativas >= this.serverInfo.limite_streamings) {
                    throw new Error('Servidor atingiu o limite máximo de streamings simultâneas');
                }
                
                if (this.serverInfo.load_cpu > 90) {
                    throw new Error('Servidor com alta carga de CPU. Tente novamente em alguns minutos');
                }
            }

            // Configurar aplicação para receber stream do OBS
            const obsResult = await this.setupOBSApplication(userLogin, userConfig);
            if (!obsResult.success) {
                throw new Error('Falha ao configurar aplicação para OBS');
            }

            // Configurar push para plataformas se fornecidas
            let pushResults = [];
            if (platforms.length > 0) {
                pushResults = await this.setupMultiPlatformPush(`${userLogin}_live`, platforms, userConfig);
            }

            // Atualizar contador de streamings ativas no servidor
            if (this.serverId) {
                await db.execute(
                    'UPDATE wowza_servers SET streamings_ativas = streamings_ativas + 1 WHERE codigo = ?',
                    [this.serverId]
                );
            }

            // Registrar stream OBS ativo
            this.obsStreams.set(userId, {
                userLogin,
                streamName: `${userLogin}_live`,
                startTime: new Date(),
                platforms: pushResults,
                serverId: this.serverId,
                type: 'obs',
                recording: userConfig.gravar_stream !== 'nao'
            });

            return {
                success: true,
                data: {
                    rtmpUrl: obsResult.rtmpUrl,
                    streamKey: obsResult.streamKey,
                    hlsUrl: obsResult.hlsUrl,
                    recordingPath: obsResult.recordingPath,
                    pushResults,
                    serverInfo: this.serverInfo,
                    maxBitrate: userConfig.bitrate || 2500,
                    maxViewers: userConfig.espectadores || 100
                }
            };

        } catch (error) {
            console.error('Erro ao configurar stream OBS:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async stopOBSStream(userId) {
        try {
            const streamInfo = this.obsStreams.get(userId);

            if (!streamInfo) {
                return {
                    success: true,
                    message: 'Stream OBS não estava ativo'
                };
            }

            // Parar gravação se estava ativa
            if (streamInfo.recording) {
                await this.stopRecording(streamInfo.streamName);
            }

            // Remover push para plataformas
            if (streamInfo.platforms) {
                for (const platform of streamInfo.platforms) {
                    if (platform.success && platform.name) {
                        await this.makeWowzaRequest(
                            `/applications/${this.wowzaApplication}/pushpublish/mapentries/${platform.name}`,
                            'DELETE'
                        );
                    }
                }
            }

            // Decrementar contador de streamings ativas no servidor
            if (streamInfo.serverId) {
                await db.execute(
                    'UPDATE wowza_servers SET streamings_ativas = GREATEST(streamings_ativas - 1, 0) WHERE codigo = ?',
                    [streamInfo.serverId]
                );
            }

            this.obsStreams.delete(userId);

            return {
                success: true,
                message: 'Stream OBS parado com sucesso'
            };

        } catch (error) {
            console.error('Erro ao parar stream OBS:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async getOBSStreamStats(userId) {
        try {
            const streamInfo = this.obsStreams.get(userId);

            if (!streamInfo) {
                return {
                    isActive: false,
                    isLive: false,
                    viewers: 0,
                    bitrate: 0,
                    uptime: '00:00:00'
                };
            }

            // Verificar se stream está realmente ativo no Wowza
            const wowzaStatus = await this.checkOBSStreamStatus(streamInfo.streamName);
            
            if (wowzaStatus.isLive) {
                const uptime = this.calculateUptime(streamInfo.startTime);
                
                return {
                    isActive: true,
                    isLive: true,
                    viewers: wowzaStatus.viewers,
                    bitrate: wowzaStatus.bitrate,
                    uptime,
                    platforms: streamInfo.platforms,
                    recording: streamInfo.recording
                };
            } else {
                return {
                    isActive: false,
                    isLive: false,
                    viewers: 0,
                    bitrate: 0,
                    uptime: '00:00:00'
                };
            }

        } catch (error) {
            console.error('Erro ao obter estatísticas do stream OBS:', error);
            return {
                isActive: false,
                isLive: false,
                viewers: 0,
                bitrate: 0,
                uptime: '00:00:00',
                error: error.message
            };
        }
    }

    async stopStream(streamId) {
        try {
            const streamInfo = this.activeStreams.get(streamId);

            if (!streamInfo) {
                return {
                    success: true,
                    message: 'Stream não estava ativo'
                };
            }

            if (streamInfo.platforms) {
                for (const platform of streamInfo.platforms) {
                    if (platform.success && platform.name) {
                        await this.makeWowzaRequest(
                            `/applications/${this.wowzaApplication}/pushpublish/mapentries/${platform.name}`,
                            'DELETE'
                        );
                    }
                }
            }

            // Decrementar contador de streamings ativas no servidor
            if (streamInfo.serverId) {
                await db.execute(
                    'UPDATE wowza_servers SET streamings_ativas = GREATEST(streamings_ativas - 1, 0) WHERE codigo = ?',
                    [streamInfo.serverId]
                );
            }
            this.activeStreams.delete(streamId);

            return {
                success: true,
                message: 'Stream parado com sucesso'
            };

        } catch (error) {
            console.error('Erro ao parar stream:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Método atualizado para suportar tanto playlist quanto OBS
    async getStreamStats(streamId) {
        try {
            const streamInfo = this.activeStreams.get(streamId);

            if (!streamInfo) {
                return {
                    isActive: false,
                    viewers: 0,
                    bitrate: 0,
                    uptime: '00:00:00'
                };
            }

            let viewers, bitrate;
            
            if (streamInfo.type === 'obs') {
                // Para streams OBS, verificar status real no Wowza
                const wowzaStatus = await this.checkOBSStreamStatus(streamInfo.streamName);
                viewers = wowzaStatus.viewers || 0;
                bitrate = wowzaStatus.bitrate || streamInfo.bitrate;
            } else {
                // Para streams de playlist, usar valores simulados
                viewers = Math.floor(Math.random() * 50) + 5;
                bitrate = streamInfo.bitrate + Math.floor(Math.random() * 500);
            }

            streamInfo.viewers = viewers;
            streamInfo.bitrate = bitrate;

            const uptime = this.calculateUptime(streamInfo.startTime);

            return {
                isActive: true,
                viewers,
                bitrate,
                uptime,
                currentVideo: streamInfo.currentVideoIndex ? streamInfo.currentVideoIndex + 1 : null,
                totalVideos: streamInfo.videos ? streamInfo.videos.length : null,
                platforms: streamInfo.platforms,
                recording: streamInfo.recording || false,
                type: streamInfo.type || 'playlist'
            };

        } catch (error) {
            console.error('Erro ao obter estatísticas:', error);
            return {
                isActive: false,
                viewers: 0,
                bitrate: 0,
                uptime: '00:00:00',
                error: error.message
            };
        }
    }

    calculateUptime(startTime) {
        const now = new Date();
        const diff = now - startTime;

        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    // Método para listar gravações salvas
    async listRecordings(userLogin) {
        try {
            const recordingsPath = `/usr/local/WowzaStreamingEngine/content/${userLogin}/recordings/`;
            
            // Simular listagem de arquivos (em produção, usar fs para listar arquivos reais)
            const recordings = [
                {
                    filename: `${userLogin}_${new Date().toISOString().split('T')[0]}_001.mp4`,
                    size: 1024 * 1024 * 150, // 150MB
                    duration: 3600, // 1 hora
                    created: new Date().toISOString(),
                    url: `/content/${userLogin}/recordings/${userLogin}_${new Date().toISOString().split('T')[0]}_001.mp4`
                }
            ];

            return {
                success: true,
                recordings,
                path: recordingsPath
            };
        } catch (error) {
            console.error('Erro ao listar gravações:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Método para verificar limites do usuário
    async checkUserLimits(userConfig, requestedBitrate = null) {
        try {
            const maxBitrate = userConfig.bitrate || 2500;
            const maxViewers = userConfig.espectadores || 100;
            const maxSpace = userConfig.espaco || 1000; // MB
            const usedSpace = userConfig.espaco_usado || 0;

            const limits = {
                bitrate: {
                    max: maxBitrate,
                    requested: requestedBitrate || maxBitrate,
                    allowed: requestedBitrate ? Math.min(requestedBitrate, maxBitrate) : maxBitrate
                },
                viewers: {
                    max: maxViewers
                },
                storage: {
                    max: maxSpace,
                    used: usedSpace,
                    available: maxSpace - usedSpace,
                    percentage: Math.round((usedSpace / maxSpace) * 100)
                }
            };

            const warnings = [];
            if (limits.storage.percentage > 90) {
                warnings.push('Espaço de armazenamento quase esgotado');
            }
            if (requestedBitrate && requestedBitrate > maxBitrate) {
                warnings.push(`Bitrate solicitado (${requestedBitrate}) excede o limite (${maxBitrate})`);
            }

            return {
                success: true,
                limits,
                warnings
            };
        } catch (error) {
            console.error('Erro ao verificar limites:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async testConnection() {
        try {
            const result = await this.makeWowzaRequest(`/applications`);
            return {
                success: result.success,
                connected: result.success,
                data: result.data
            };
        } catch (error) {
            return {
                success: false,
                connected: false,
                error: error.message
            };
        }
    }

    async listApplications() {
        try {
            const result = await this.makeWowzaRequest(`/applications`);
            return result;
        } catch (error) {
            console.error('Erro ao listar aplicações:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async getServerInfo() {
        try {
            const result = await this.makeWowzaRequest(`/server`);
            return result;
        } catch (error) {
            console.error('Erro ao obter informações do servidor:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = WowzaStreamingService;