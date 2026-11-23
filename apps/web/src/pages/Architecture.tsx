import { useQuery } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowRight,
  Boxes,
  Cloud,
  Cpu,
  Database,
  FileSearch,
  FileText,
  Layers,
  Lock,
  Mic,
  MonitorSmartphone,
  PlugZap,
  Sparkles,
  Workflow,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge, Card, CardHeader, PageHeader, cn } from '../components/ui';
import { api } from '../lib/api';

/**
 * Arquitectura REAL: los nodos muestran el proveedor que está configurado ahora mismo (vía /api/architecture),
 * y al lado, el servicio Azure por el que se sustituiría cada pieza.
 */
export function ArchitecturePage() {
  const { data } = useQuery({ queryKey: ['architecture'], queryFn: api.architecture });
  const source = data?.sources[0];

  const steps: Step[] = [
    {
      icon: <PlugZap className="size-4" />,
      title: 'Fuentes',
      now: source ? `${source.name} (${source.kind})` : '—',
      detail:
        'SourceAdapter: MoodleAdapter → API REST oficial de Moodle (solo lectura). Login manual en navegador; token cifrado con DPAPI.',
      azure: 'Mismo adaptador; futuros: SharePoint / OneDrive (Microsoft Graph)',
    },
    {
      icon: <Workflow className="size-4" />,
      title: 'Ingesta incremental',
      now: 'SyncService',
      detail:
        'Inventario de metadatos → diff por id + versión remota → descarga solo lo nuevo/modificado → hash SHA-256 → registro de cambios.',
      azure: 'Azure Functions (timer) o Container Apps Job',
    },
    {
      icon: <FileText className="size-4" />,
      title: 'Almacén documental',
      now: data?.storage.files ?? '',
      detail: 'Organización automática DAM › Asignatura › Unidad, con metadatos y URL de origen.',
      azure: 'Azure Blob Storage (Managed Identity)',
    },
    {
      icon: <Layers className="size-4" />,
      title: 'Procesamiento',
      now: 'pdf.js · mammoth · PPTX (XML)',
      detail:
        'Extracción por página/diapositiva/sección → chunking (~1000 car., solapamiento) sin cruzar páginas para poder citar.',
      azure: 'Azure AI Document Intelligence (OCR, layout)',
    },
    {
      icon: <Mic className="size-4" />,
      title: 'Videoclases → transcripción',
      now: data
        ? `${data.transcription.provider}${data.transcription.model ? ' · ' + data.transcription.model : ''}${data.transcription.ok ? '' : ' (no instalado)'}`
        : '',
      detail:
        'Grabaciones detectadas en la fuente o subidas → ffmpeg (audio 16 kHz) → Whisper large-v3-turbo en la GPU con VAD → transcripción con marcas temporales → fragmentos citables con su minuto.',
      azure: 'Azure AI Speech (fast transcription con diarización)',
    },
    {
      icon: <Cpu className="size-4" />,
      title: 'Embeddings',
      now: data ? `${data.embeddings.provider} · ${data.embeddings.model}` : '',
      detail:
        'Vector numérico del significado de cada fragmento. Local con ONNX (transformers.js): gratis y sin enviar datos fuera.',
      azure: 'Azure OpenAI text-embedding-3-small (Foundry)',
    },
    {
      icon: <FileSearch className="size-4" />,
      title: 'Índice híbrido',
      now: data?.index.detail ?? '',
      detail:
        'Búsqueda semántica + BM25 fusionadas con Reciprocal Rank Fusion. Filtro por ámbito antes de buscar.',
      azure: 'Azure AI Search (vector + keyword + semantic ranker)',
    },
    {
      icon: <Sparkles className="size-4" />,
      title: 'RAG + LLM',
      now: data
        ? data.llm.available
          ? `${data.llm.provider} · ${data.llm.model}`
          : 'Sin LLM → modo extractivo'
        : '',
      detail: 'Contexto numerado → respuesta citada [n]. Si no hay base suficiente, no se genera respuesta.',
      azure: 'Azure OpenAI en AI Foundry (gpt-*-mini)',
    },
    {
      icon: <MonitorSmartphone className="size-4" />,
      title: 'StudyVault',
      now: 'React + Vite · API Fastify',
      detail: 'Dashboard, novedades, tareas, visor con salto a página, modo estudio y examen.',
      azure: 'Static Web Apps + Container Apps · Entra ID',
    },
  ];

  return (
    <div>
      <PageHeader
        title="Arquitectura"
        subtitle="Cómo funciona StudyVault, con los componentes que están en ejecución ahora mismo."
        actions={data && <Badge tone={data.mode === 'demo' ? 'warn' : 'accent'}>Modo {data.mode}</Badge>}
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div>
          <div className="text-muted mb-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-1 text-[0.7rem] font-semibold tracking-wider uppercase">
            <span>Implementación actual (local)</span>
            <span />
            <span className="flex items-center gap-1.5">
              <Cloud className="size-3.5" /> Equivalente Azure
            </span>
          </div>
          <ol className="space-y-0">
            {steps.map((s, i) => (
              <li key={s.title} className="animate-in" style={{ animationDelay: `${i * 50}ms` }}>
                <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-[1fr_auto_1fr]">
                  <Card className="p-4">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={cn(
                          'grid size-8 place-items-center rounded-lg text-white',
                          COLORS[i % COLORS.length],
                        )}
                      >
                        {s.icon}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">{s.title}</div>
                        <div className="text-accent-600 dark:text-accent-400 truncate font-mono text-[0.7rem]">
                          {s.now}
                        </div>
                      </div>
                    </div>
                    <p className="text-muted mt-2 text-xs leading-relaxed">{s.detail}</p>
                  </Card>
                  <div className="text-muted hidden items-center md:flex">
                    <ArrowRight className="size-4" />
                  </div>
                  <div className="surface-2 flex items-center gap-2 rounded-2xl border border-dashed border-[var(--border)] p-4 text-xs">
                    <Cloud className="text-muted size-4 shrink-0" />
                    {s.azure}
                  </div>
                </div>
                {i < steps.length - 1 && (
                  <div className="text-muted flex justify-center py-1.5 md:w-[calc(50%-1.25rem)]">
                    <ArrowDown className="size-4" />
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Pitch de 30 segundos" icon={<Boxes className="size-4" />} />
            <p className="text-muted px-5 pb-5 text-sm leading-relaxed">
              Un <b className="text-[var(--text)]">adaptador</b> lee el campus Moodle con su API oficial en
              solo lectura. Una <b className="text-[var(--text)]">ingesta incremental</b> descarga solo lo
              nuevo, extrae el texto por página y lo trocea. Cada fragmento se convierte en un{' '}
              <b className="text-[var(--text)]">embedding</b> y se indexa junto a un índice léxico. Al
              preguntar, una <b className="text-[var(--text)]">búsqueda híbrida</b> recupera los fragmentos
              del ámbito elegido y el LLM responde{' '}
              <b className="text-[var(--text)]">citando la fuente y la página</b>. Cada pieza está detrás de
              una interfaz, así que se sustituye por su servicio Azure sin rehacer la app.
            </p>
          </Card>
          <Card>
            <CardHeader title="Estado del índice" icon={<Database className="size-4" />} />
            <dl className="grid grid-cols-2 gap-3 px-5 pb-5 text-sm">
              {data &&
                Object.entries({
                  Documentos: data.counts.documents,
                  Indexados: data.counts.processed,
                  Fragmentos: data.counts.chunks,
                  'Tareas pend.': data.counts.tasksPending,
                }).map(([k, v]) => (
                  <div key={k} className="surface-2 rounded-xl px-3 py-2">
                    <dt className="text-muted text-xs">{k}</dt>
                    <dd className="font-semibold tabular-nums">{v}</dd>
                  </div>
                ))}
            </dl>
          </Card>
          <Card>
            <CardHeader title="Seguridad y privacidad" icon={<Lock className="size-4" />} />
            <ul className="text-muted space-y-2 px-5 pb-5 text-xs leading-relaxed">
              <li>• Nunca se guardan usuario ni contraseña del campus: login manual (MFA incluido).</li>
              <li>• Token de API cifrado con DPAPI, fuera de Git y borrable con un clic.</li>
              <li>• Lista blanca de funciones Moodle de solo lectura.</li>
              <li>• API ligada a 127.0.0.1; los documentos no salen del equipo (embeddings locales).</li>
              <li>• Minimización: avisos del profesorado, sin mensajes privados por defecto.</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

interface Step {
  icon: ReactNode;
  title: string;
  now: string;
  detail: string;
  azure: string;
}

const COLORS = [
  'bg-indigo-500',
  'bg-sky-500',
  'bg-teal-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-orange-500',
  'bg-violet-500',
  'bg-pink-500',
];
