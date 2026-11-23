import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, Video } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { dateTime, formatTs } from '../lib/format';
import { STATUS } from '../pages/Recording';
import { Badge, Button, Card, Empty, ErrorBox, Input } from './ui';

/** Pestaña «Videoclases» de una asignatura: listado + subida manual de una grabación propia. */
export function RecordingsList({ subjectId }: { subjectId: number }) {
  const qc = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: ['recordings', subjectId],
    queryFn: () => api.recordings(subjectId),
    refetchInterval: (q) =>
      q.state.data?.some((r) => !['ready', 'unavailable', 'error'].includes(r.status)) ? 3000 : false,
  });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: 60_000 });
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const upload = useMutation({
    mutationFn: () => api.uploadRecording(file!, subjectId, title || file!.name, date),
    onSuccess: () => {
      setFile(null);
      setTitle('');
      void qc.invalidateQueries({ queryKey: ['recordings', subjectId] });
    },
  });
  const t = settings.data?.transcription;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="animate-in p-2 lg:col-span-2">
        {data.length === 0 ? (
          <Empty icon={<Video className="size-5" />} title="Sin videoclases">
            Las grabaciones detectadas en el campus aparecerán aquí tras sincronizar.
          </Empty>
        ) : (
          data.map((r) => (
            <div key={r.id}>
              <Link
                to={`/recordings/${r.id}`}
                className="group flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-[var(--surface-2)]"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-500">
                  <Video className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium group-hover:underline">{r.title}</div>
                  <div className="text-muted truncate text-xs">
                    {[
                      dateTime(r.recordedAt),
                      r.durationSec ? formatTs(r.durationSec) : null,
                      r.teacher,
                      r.platform,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
              </Link>
            </div>
          ))
        )}
      </Card>

      <Card className="animate-in p-5">
        <div className="text-sm font-semibold">Añadir grabación</div>
        <p className="text-muted mt-1 text-xs">
          Sube una clase que hayas descargado legítimamente (p. ej. cuando el profesor permite la descarga).
          Se queda solo en este equipo.
        </p>
        <div className="mt-3 space-y-2">
          <label className="surface-2 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] px-4 py-4 text-sm hover:border-[var(--color-accent-400)]">
            <Upload className="text-muted size-4" />
            <span className="truncate">{file ? file.name : 'Elegir vídeo o audio'}</span>
            <input
              type="file"
              accept="video/*,audio/*"
              className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <Input
            placeholder="Título (opcional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Título"
          />
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Fecha de la clase"
          />
          <Button
            variant="primary"
            className="w-full"
            disabled={!file}
            loading={upload.isPending}
            onClick={() => upload.mutate()}
          >
            Subir y transcribir
          </Button>
          <ErrorBox error={upload.error} />
        </div>
        {t && (
          <p
            className={
              t.available
                ? 'mt-3 text-xs text-emerald-600 dark:text-emerald-400'
                : 'mt-3 text-xs text-amber-700 dark:text-amber-400'
            }
          >
            Motor: {t.provider}
            {t.model ? ` (${t.model})` : ''} · {t.available ? 'listo' : t.reason}
          </p>
        )}
      </Card>
    </div>
  );
}
