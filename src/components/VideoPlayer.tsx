import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useStream } from '../context/StreamContext';
import UniversalVideoPlayer from './UniversalVideoPlayer';

interface VideoPlayerProps {
  playlistVideo?: {
    id: number;
    nome: string;
    url: string;
    duracao?: number;
  };
  onVideoEnd?: () => void;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ playlistVideo, onVideoEnd }) => {
  const { user } = useAuth();
  const { streamData } = useStream();
  const [obsStreamActive, setObsStreamActive] = useState(false);
  const [obsStreamUrl, setObsStreamUrl] = useState<string>('');

  const userLogin = user?.email?.split('@')[0] || 'usuario';

  useEffect(() => {
    // Verificar se há stream OBS ativo
    checkOBSStream();
  }, []);

  const checkOBSStream = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) return;

      const response = await fetch('/api/streaming/obs-status', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.obs_stream.is_live) {
          setObsStreamActive(true);
          // URL do stream OBS
        setObsStreamUrl(`http://samhost.wcore.com.br:1935/samhost/${userLogin}_live/playlist.m3u8`);
        } else {
          setObsStreamActive(false);
        }
      }
    } catch (error) {
      console.error('Erro ao verificar stream OBS:', error);
    }
  };
  
  // Priorizar vídeo da playlist se fornecido, senão usar stream ao vivo
  const getVideoUrl = (url: string) => {
    if (!url) return '';
    
    // Se já é uma URL completa, usar como está
    if (url.startsWith('http')) {
      return url;
    }
    
    // Verificar se estamos em produção ou desenvolvimento
    const isProduction = window.location.hostname !== 'localhost';
    
    // Em produção, usar o domínio correto. Em desenvolvimento, usar localhost
    const baseUrl = isProduction ? 
      `${window.location.protocol}//${window.location.hostname}` : 
      window.location.origin;
    
    // Garantir que a URL comece com /content
    const videoPath = url.startsWith('/content') ? url : `/content${url}`;
    const fullUrl = `${baseUrl}${videoPath}`;
    
    console.log(`URL do vídeo construída: ${fullUrl}`);
    return fullUrl;
  };

  const videoSrc = playlistVideo?.url ? getVideoUrl(playlistVideo.url) : 
    (streamData.isLive ? `${window.location.protocol}//${window.location.hostname}:1935/samhost/${userLogin}_live/playlist.m3u8` : 
     obsStreamActive ? obsStreamUrl : undefined);

  const videoTitle = playlistVideo?.nome || 
    (streamData.isLive ? streamData.title || 'Transmissão ao Vivo' : 
     obsStreamActive ? 'Transmissão OBS ao Vivo' : undefined);

  const isLive = !playlistVideo && (streamData.isLive || obsStreamActive);

  return (
    <UniversalVideoPlayer
      src={videoSrc}
      title={videoTitle}
      isLive={isLive}
      autoplay={!!playlistVideo}
      muted={false}
      controls={true}
      onEnded={onVideoEnd}
      streamStats={isLive ? {
        viewers: streamData.viewers + (obsStreamActive ? 0 : 0), // Evitar duplicação
        bitrate: streamData.isLive ? streamData.bitrate : 2500,
        uptime: streamData.isLive ? streamData.uptime : '00:00:00',
        quality: '1080p'
      } : undefined}
      className="w-full"
    />
  );
};

export default VideoPlayer;