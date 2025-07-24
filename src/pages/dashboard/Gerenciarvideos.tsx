import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { toast } from "react-toastify";
import { Play, Trash2 } from "lucide-react";

type Folder = {
  id: number;
  nome: string;
};

type Video = {
  id: number;
  nome: string;
  id_folder: number; // Usar id_folder para consistência com o banco
  duracao?: number;
  tamanho?: number;
  url?: string;
};

function formatarDuracao(segundos: number): string {
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  const s = Math.floor(segundos % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  } else {
    return `${m}:${s.toString().padStart(2, "0")}`;
  }
}

function formatarTamanho(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

function ModalVideo({
  aberto,
  onFechar,
  videoAtual,
  playlist,
}: {
  aberto: boolean;
  onFechar: () => void;
  videoAtual?: Video | null;
  playlist?: Video[];
}) {
  const [indexAtual, setIndexAtual] = useState(0);

  useEffect(() => {
    if (playlist && playlist.length > 0) setIndexAtual(0);
  }, [playlist]);

  useEffect(() => {
    setIndexAtual(0);
  }, [videoAtual]);

  if (!aberto) return null;

  const videos = playlist && playlist.length > 0 ? playlist : videoAtual ? [videoAtual] : [];

  const video = videos[indexAtual];

  const proximoVideo = () => {
    if (indexAtual < videos.length - 1) {
      setIndexAtual(indexAtual + 1);
    } else {
      onFechar();
    }
  };

  // Construir URL completa para o vídeo
  const getVideoUrl = (video: Video) => {
    if (!video.url) return '';
    
    // Se a URL já é completa, usar como está
    if (video.url.startsWith('http')) {
      return video.url;
    }
    
    // Construir URL completa baseada no ambiente
    const isProduction = window.location.hostname !== 'localhost';
    const baseUrl = isProduction ? 
      `${window.location.protocol}//${window.location.hostname}` : 
      window.location.origin;
    
    // Garantir que a URL comece com /content
    const videoPath = video.url.startsWith('/content') ? video.url : `/content${video.url}`;
    const fullUrl = `${baseUrl}${videoPath}`;
    
    console.log(`URL construída para vídeo ${video.nome}: ${fullUrl}`);
    return fullUrl;
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50"
      onClick={onFechar}
    >
      <div
        className="bg-white rounded shadow-lg max-w-5xl w-full max-h-[95vh] p-4 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-2">
          <h3 className="font-semibold text-lg truncate">{video?.nome || "Nenhum vídeo"}</h3>
          <button onClick={onFechar} className="text-gray-600 hover:text-gray-900 font-bold text-xl leading-none">&times;</button>
        </div>
        {video ? (
          <div className="flex-1 flex flex-col">
            <video
              key={getVideoUrl(video)} // Força reload quando muda o vídeo
              className="w-full flex-1 max-h-[80vh] bg-black"
              src={getVideoUrl(video)}
              controls
              autoPlay
              onEnded={proximoVideo}
              onError={(e) => {
                console.error('Erro ao carregar vídeo:', e);
                console.log('URL do vídeo:', getVideoUrl(video));
                toast.error('Erro ao carregar o vídeo. Verifique se o arquivo existe.');
              }}
              onLoadStart={() => {
                console.log('Carregando vídeo:', getVideoUrl(video));
              }}
            >
              Seu navegador não suporta o elemento de vídeo.
            </video>
            
            {/* Debug info - remover em produção */}
            <div className="mt-2 p-2 bg-gray-100 text-xs text-gray-600">
              <p><strong>URL:</strong> {getVideoUrl(video)}</p>
              <p><strong>Arquivo:</strong> {video.url}</p>
            </div>
          </div>
        ) : (
          <p>Nenhum vídeo para reproduzir</p>
        )}
        {videos.length > 1 && (
          <div className="mt-2 flex justify-between items-center text-sm text-gray-700">
            <button
              onClick={() => setIndexAtual(i => Math.max(i - 1, 0))}
              disabled={indexAtual === 0}
              className={`px-2 py-1 rounded ${indexAtual === 0 ? "opacity-50 cursor-not-allowed" : "hover:bg-gray-200"}`}
            >
              Anterior
            </button>
            <span>{indexAtual + 1} / {videos.length}</span>
            <button
              onClick={() => setIndexAtual(i => Math.min(i + 1, videos.length - 1))}
              disabled={indexAtual === videos.length - 1}
              className={`px-2 py-1 rounded ${indexAtual === videos.length - 1 ? "opacity-50 cursor-not-allowed" : "hover:bg-gray-200"}`}
            >
              Próximo
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Modal de confirmação personalizado
function ModalConfirmacao({
  aberto,
  onFechar,
  onConfirmar,
  titulo,
  mensagem,
  detalhes,
}: {
  aberto: boolean;
  onFechar: () => void;
  onConfirmar: () => void;
  titulo: string;
  mensagem: string;
  detalhes?: string;
}) {
  if (!aberto) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{titulo}</h3>
        <p className="text-gray-700 mb-4">{mensagem}</p>
        {detalhes && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 mb-4">
            <p className="text-sm text-yellow-800">{detalhes}</p>
          </div>
        )}
        <div className="flex justify-end space-x-3">
          <button
            onClick={onFechar}
            className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirmar}
            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
          >
            Confirmar Exclusão
          </button>
        </div>
      </div>
    </div>
  );
}

export default function GerenciarVideos() {
  const { getToken } = useAuth();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderSelecionada, setFolderSelecionada] = useState<Folder | null>(null);
  const [novoFolderNome, setNovoFolderNome] = useState("");
  const [videos, setVideos] = useState<Video[]>([]);
  const [uploadFiles, setUploadFiles] = useState<FileList | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [modalAberta, setModalAberta] = useState(false);
  const [videoModalAtual, setVideoModalAtual] = useState<Video | null>(null);
  const [playlistModal, setPlaylistModal] = useState<Video[] | null>(null);

  // Estados para confirmação
  const [modalConfirmacao, setModalConfirmacao] = useState({
    aberto: false,
    tipo: '' as 'video' | 'folder',
    item: null as any,
    titulo: '',
    mensagem: '',
    detalhes: ''
  });

  useEffect(() => {
    fetchFolders();
  }, []);

  useEffect(() => {
    if (folderSelecionada) {
      fetchVideos(folderSelecionada.id);
    } else {
      setVideos([]);
    }
  }, [folderSelecionada]);

  const fetchFolders = async () => {
    try {
      const token = await getToken();
      const response = await fetch("/api/folders", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      setFolders(data);
      if (data.length > 0) setFolderSelecionada(data[0]);
    } catch {
      toast.error("Erro ao carregar pastas");
    }
  };

  const fetchVideos = async (folder_id: number) => {
    try {
      const token = await getToken();
      const response = await fetch(`/api/videos?folder_id=${folder_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      console.log('Vídeos carregados:', data);
      setVideos(Array.isArray(data) ? data : []);
    } catch {
      toast.error("Erro ao carregar vídeos");
      setVideos([]);
    }
  };

  const handleFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const videosOnly = Array.from(files).filter(f => f.type.startsWith("video/"));
    if (videosOnly.length !== files.length) {
      toast.error("Apenas arquivos de vídeo são permitidos");
      e.target.value = "";
      setUploadFiles(null);
      return;
    }
    const MAX_SIZE = 2 * 1024 * 1024 * 1024;
    const oversizedFiles = videosOnly.filter(f => f.size > MAX_SIZE);
    if (oversizedFiles.length > 0) {
      toast.error(`Arquivos muito grandes: ${oversizedFiles.map(f => f.name).join(", ")}`);
      e.target.value = "";
      setUploadFiles(null);
      return;
    }
    setUploadFiles(files);
  };

  const getVideoDuration = (file: File): Promise<number> => {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.preload = "metadata";
      video.src = url;
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(video.duration);
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(0);
      };
    });
  };

  const uploadVideos = async () => {
    if (!folderSelecionada || !uploadFiles || uploadFiles.length === 0) {
      toast.error("Selecione uma pasta e ao menos um arquivo para upload");
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    try {
      const token = await getToken();
      for (const file of Array.from(uploadFiles)) {
        const formData = new FormData();
        formData.append("video", file);
        const duracao = await getVideoDuration(file);
        formData.append("duracao", duracao.toString());
        formData.append("tamanho", file.size.toString());

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          // Envia folder_id no query da URL
          xhr.open("POST", `/api/videos/upload?folder_id=${folderSelecionada.id.toString()}`);
          xhr.setRequestHeader("Authorization", `Bearer ${token}`);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const progressoAtual = (e.loaded / e.total) * 100;
              setUploadProgress(progressoAtual);
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              const videoData = JSON.parse(xhr.responseText);
              setVideos(prev => [...prev, {
                ...videoData,
                nome: file.name,
                duracao,
                tamanho: file.size,
                url: videoData.url || ""
              }]);
              toast.success(`${file.name} enviado com sucesso!`);
              resolve();
            } else {
              toast.error(`Erro ao enviar ${file.name}`);
              reject();
            }
          };
          xhr.onerror = () => {
            toast.error(`Erro ao enviar ${file.name}`);
            reject();
          };
          xhr.send(formData);
        });
      }
    } catch {
      toast.error("Erro no upload de vídeos");
    } finally {
      setUploading(false);
      setUploadFiles(null);
      setUploadProgress(0);
      const inputFile = document.getElementById("input-upload-videos") as HTMLInputElement;
      if (inputFile) inputFile.value = "";
    }
  };

  const criarFolder = async () => {
    if (!novoFolderNome.trim()) return;
    try {
      const token = await getToken();
      const response = await fetch("/api/folders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ nome: novoFolderNome.trim() })
      });
      if (!response.ok) throw new Error();
      const novaFolder = await response.json();
      setFolders(prev => [...prev, novaFolder]);
      setNovoFolderNome("");
      toast.success("Pasta criada com sucesso!");
    } catch {
      toast.error("Erro ao criar pasta");
    }
  };

  const confirmarDeletarFolder = (folder: Folder) => {
    setModalConfirmacao({
      aberto: true,
      tipo: 'folder',
      item: folder,
      titulo: 'Confirmar Exclusão da Pasta',
      mensagem: `Deseja realmente excluir a pasta "${folder.nome}"?`,
      detalhes: 'Esta ação não pode ser desfeita. Certifique-se de que a pasta não contém vídeos importantes.'
    });
  };

  const confirmarDeletarVideo = (video: Video) => {
    setModalConfirmacao({
      aberto: true,
      tipo: 'video',
      item: video,
      titulo: 'Confirmar Exclusão do Vídeo',
      mensagem: `Deseja realmente excluir o vídeo "${video.nome}"?`,
      detalhes: 'Esta ação não pode ser desfeita e o arquivo será removido permanentemente.'
    });
  };

  const executarDelecao = async () => {
    const { tipo, item } = modalConfirmacao;

    try {
      const token = await getToken();

      if (tipo === 'folder') {
        const response = await fetch(`/api/folders/${item.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` }
        });

        if (!response.ok) {
          const errorData = await response.json();
          toast.error(errorData.details || errorData.error || "Erro ao excluir pasta");
          return;
        }

        setFolders(prev => prev.filter(f => f.id !== item.id));
        if (folderSelecionada?.id === item.id) {
          setFolderSelecionada(null);
          setVideos([]);
        }
        toast.success("Pasta excluída com sucesso!");

      } else if (tipo === 'video') {
        const response = await fetch(`/api/videos/${item.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` }
        });

        if (!response.ok) {
          const errorData = await response.json();
          toast.error(errorData.details || errorData.error || "Erro ao excluir vídeo");
          return;
        }

        setVideos(prev => prev.filter(v => v.id !== item.id));
        toast.success("Vídeo excluído com sucesso!");
      }
    } catch (error) {
      toast.error("Erro ao excluir item");
      console.error('Erro na exclusão:', error);
    } finally {
      setModalConfirmacao({
        aberto: false,
        tipo: '' as any,
        item: null,
        titulo: '',
        mensagem: '',
        detalhes: ''
      });
    }
  };

  const abrirModalVideo = (video: Video) => {
    console.log('Abrindo modal para vídeo:', video);
    setVideoModalAtual(video);
    setPlaylistModal(null);
    setModalAberta(true);
  };

  const abrirModalPlaylist = () => {
    if (!folderSelecionada) return;
    console.log('Abrindo playlist modal com vídeos:', videos);
    setPlaylistModal(videos);
    setVideoModalAtual(null);
    setModalAberta(true);
  };

  return (
    <>
      <div className="max-w-7xl mx-auto p-6 flex flex-col md:flex-row gap-8 min-h-[700px]">
        {/* Seção das Pastas */}
        <section className="md:w-1/3 bg-gray-50 p-6 rounded-lg shadow-md flex flex-col min-h-[500px] border border-gray-300">
          <h2 className="text-2xl font-semibold mb-5 text-gray-900 flex justify-between items-center">
            Pastas
          </h2>
          <ul className="flex-grow overflow-auto max-h-[450px] space-y-2">
            {folders.map((folder) => (
              <li
                key={folder.id}
                className={`cursor-pointer p-2 rounded flex justify-between items-center ${folderSelecionada?.id === folder.id
                  ? "bg-blue-100 font-semibold text-blue-800"
                  : "hover:bg-blue-50 text-gray-800"
                  }`}
                onClick={() => setFolderSelecionada(folder)}
                title={`Selecionar pasta ${folder.nome}`}
              >
                <span>{folder.nome}</span>
                <div className="flex items-center gap-2">
                  {/* Ícone para assistir a pasta (playlist da pasta) */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      abrirModalPlaylist();
                    }}
                    title={`Assistir todos os vídeos da pasta ${folder.nome}`}
                    className="text-blue-600 hover:text-blue-800 transition-colors duration-200"
                    disabled={videos.length === 0}
                  >
                    <Play size={20} />
                  </button>

                  {/* Botão para deletar pasta */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      confirmarDeletarFolder(folder);
                    }}
                    className="text-red-600 hover:text-red-800 transition-colors duration-200"
                    title="Excluir pasta"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {/* Input para criar pasta */}
          <div className="mt-4 flex gap-2 max-w-full">
            <input
              type="text"
              value={novoFolderNome}
              onChange={(e) => setNovoFolderNome(e.target.value)}
              className="flex-grow min-w-0 border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="Nova pasta"
            />
            <button
              onClick={criarFolder}
              className="bg-blue-600 text-white px-5 rounded hover:bg-blue-700 whitespace-nowrap transition-colors duration-200"
            >
              Criar
            </button>
          </div>
        </section>

        {/* Seção dos Vídeos */}
        <section className="md:w-2/3 bg-gray-50 p-6 rounded-lg shadow-md flex flex-col min-h-[500px] border border-gray-300">
          <h2 className="text-2xl font-semibold mb-5 text-gray-900">
            Vídeos {folderSelecionada ? ` - ${folderSelecionada.nome}` : ""}
          </h2>
          <input
            type="file"
            id="input-upload-videos"
            multiple
            accept="video/*"
            onChange={handleFilesChange}
            disabled={!folderSelecionada || uploading}
            className="mb-3"
          />
          {uploading && (
            <div className="w-full bg-gray-200 rounded h-4 mb-4 overflow-hidden">
              <div
                className="bg-blue-600 h-4 transition-all"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          )}
          <button
            onClick={uploadVideos}
            disabled={!uploadFiles || uploadFiles.length === 0 || uploading || !folderSelecionada}
            className="bg-blue-600 text-white px-5 py-3 rounded hover:bg-blue-700 disabled:opacity-50 transition-colors duration-200"
          >
            {uploading ? "Enviando..." : "Enviar"}
          </button>

          <div className="mt-8 flex-grow overflow-auto max-h-[450px]">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-gray-300">
                  <th className="py-2 px-4">Nome</th>
                  <th className="py-2 px-4 w-28">Duração</th>
                  <th className="py-2 px-4 w-28">Tamanho</th>
                  <th className="py-2 px-4 w-24">Assistir</th>
                  <th className="py-2 px-4 w-24">Ações</th>
                </tr>
              </thead>
              <tbody>
                {videos.map((video) => (
                  <tr
                    key={video.id}
                    className="border-b border-gray-200 hover:bg-blue-50 cursor-pointer"
                    title="Clique para assistir"
                  >
                    <td className="py-2 px-4 truncate max-w-xs">{video.nome}</td>
                    <td className="py-2 px-4">{video.duracao ? formatarDuracao(video.duracao) : "--"}</td>
                    <td className="py-2 px-4">{video.tamanho ? formatarTamanho(video.tamanho) : "--"}</td>
                    <td className="py-2 px-4 text-blue-600 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          abrirModalVideo(video);
                        }}
                        title="Assistir vídeo"
                        className="hover:text-blue-800 transition-colors duration-200"
                      >
                        <Play size={20} />
                      </button>
                    </td>
                    <td className="py-2 px-4 text-red-600 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          confirmarDeletarVideo(video);
                        }}
                        title="Excluir vídeo"
                        className="hover:text-red-800 transition-colors duration-200"
                      >
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
                {videos.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-gray-500">
                      Nenhum vídeo nesta pasta
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Modal de vídeo */}
      <ModalVideo
        aberto={modalAberta}
        onFechar={() => setModalAberta(false)}
        videoAtual={videoModalAtual}
        playlist={playlistModal ?? undefined}
      />

      {/* Modal de confirmação */}
      <ModalConfirmacao
        aberto={modalConfirmacao.aberto}
        onFechar={() => setModalConfirmacao(prev => ({ ...prev, aberto: false }))}
        onConfirmar={executarDelecao}
        titulo={modalConfirmacao.titulo}
        mensagem={modalConfirmacao.mensagem}
        detalhes={modalConfirmacao.detalhes}
      />
    </>
  );
}