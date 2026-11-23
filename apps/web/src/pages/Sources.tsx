import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight,
  ClipboardList,
  Download,
  KeyRound,
  LogOut,
  PlugZap,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSyncJob } from '../components/SyncButton';
import { Badge, Button, Card, CardHeader, Empty, ErrorBox, PageHeader, cn } from '../components/ui';
import { api, type Inventory } from '../lib/api';
import { KIND_LABEL, bytes, dateTime, relative } from '../lib/format';

export function SourcesPage() {
  const qc = useQueryClient();
  const sources = useQuery({ queryKey: ['sources'], queryFn: api.sources });
  const runs = useQuery({ queryKey: ['sync-runs'], queryFn: api.syncRuns });
  const job = useSyncJob();
  const source = sources.data?.[0];
  const [selectedRun, setSelectedRun] = useState<number | null>(null);

  const loginStatus = useQuery({
    queryKey: ['login', source?.id],
    queryFn: () => api.loginStatus(source!.id),
    enabled: !!source,
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 1000 : false),
  });
  useEffect(() => {
    if (loginStatus.data?.status === 'ok') void qc.invalidateQueries({ queryKey: ['sources'] });
  }, [loginStatus.data?.status, qc]);

  const login = useMutation({
    mutationFn: () => api.login(source!.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['login'] }),
  });
  const logout = useMutation({
    mutationFn: () => api.logout(source!.id),
    onSuccess: () => qc.invalidateQueries(),
  });
  const start = useMutation({
    mutationFn: (mode: 'inventory' | 'sync') => api.startSync(source!.id, mode),
    onSuccess: (r) => {
      setSelectedRun(r.runId);
      void qc.invalidateQueries({ queryKey: ['sync-status'] });
    },
  });
  const running = job.data?.status === 'running';
  const lastRunId = selectedRun ?? runs.data?.[0]?.id ?? null;
  const loggingIn = loginStatus.data?.status === 'running';

  return (
    <div>
      <PageHeader
        title="Fuentes y sincronización"
        subtitle="Ingesta de solo lectura. Primero inventario (solo metadatos), después descarga incremental."
      />

      {source && (
        <Card className="animate-in mb-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="bg-accent-500/10 text-accent-600 dark:text-accent-400 grid size-11 place-items-center rounded-xl">
                <PlugZap className="size-5" />
              </span>
              <div>
                <div className="flex items-center gap-2 font-semibold">
                  {source.name}
                  {source.authenticated ? (
                    <Badge tone="ok">Conectado</Badge>
                  ) : (
                    <Badge tone="warn">Sin sesión</Badge>
                  )}
                  <Badge>solo lectura</Badge>
                </div>
                <div className="text-muted text-sm">
                  {source.baseUrl} {source.account && `· ${source.account}`}
                </div>
                <div className="text-muted mt-1 text-xs">
                  {source.kind === 'moodle'
                    ? 'API oficial de Moodle (servicio móvil) · token cifrado con DPAPI en este equipo'
                    : source.kind === 'moodle-web'
                      ? 'Sesión de navegador local (solo en este equipo, fuera de Git) · lectura de la web del campus'
                      : source.kind}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {source.kind.startsWith('moodle') &&
                (source.authenticated ? (
                  <Button
                    variant="ghost"
                    onClick={() => logout.mutate()}
                    loading={logout.isPending}
                    icon={<LogOut className="size-4" />}
                  >
                    Cerrar sesión y borrar token
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    onClick={() => login.mutate()}
                    loading={login.isPending || loggingIn}
                    icon={<KeyRound className="size-4" />}
                  >
                    Iniciar sesión en el navegador
                  </Button>
                ))}
              <Button
                disabled={!source.authenticated || running}
                loading={start.isPending && start.variables === 'inventory'}
                onClick={() => start.mutate('inventory')}
                icon={<ClipboardList className="size-4" />}
              >
                Generar inventario
              </Button>
              <Button
                variant="primary"
                disabled={!source.authenticated || running}
                loading={start.isPending && start.variables === 'sync'}
                onClick={() => start.mutate('sync')}
                icon={<Download className="size-4" />}
              >
                Sincronizar ahora
              </Button>
            </div>
          </div>

          {(loggingIn || loginStatus.data?.status === 'error') && (
            <div className="surface-2 mt-4 rounded-xl p-4 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <ShieldCheck className="size-4 text-emerald-500" />
                {loggingIn
                  ? 'Completa el inicio de sesión en la ventana del navegador que se ha abierto'
                  : 'No se completó el inicio de sesión'}
              </div>
              <p className="text-muted mt-1 text-xs">
                Tú introduces usuario, contraseña y MFA directamente en la web de tu Moodle. StudyVault no ve
                ni guarda tus credenciales: solo recibe el token de la API móvil oficial al terminar.
              </p>
              {loginStatus.data?.log.map((l, i) => (
                <div key={i} className="text-muted mt-1 font-mono text-xs">
                  › {l}
                </div>
              ))}
              {loginStatus.data?.error && (
                <div className="mt-2 text-xs text-red-500">{loginStatus.data.error}</div>
              )}
            </div>
          )}
          <ErrorBox error={start.error ?? login.error} />
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="animate-in lg:col-span-2">
          <CardHeader
            title="Registro"
            icon={<Terminal className="size-4" />}
            subtitle={
              running
                ? 'En curso…'
                : job.data?.status !== 'idle'
                  ? `Última ejecución: ${job.data?.status}`
                  : undefined
            }
          />
          <LogView runId={lastRunId} live={running ? job.data?.log : undefined} />
        </Card>
        <Card className="animate-in">
          <CardHeader title="Historial" />
          <ul className="px-2 pb-3">
            {runs.data?.length === 0 && <li className="text-muted px-3 text-sm">Sin ejecuciones.</li>}
            {runs.data?.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => setSelectedRun(r.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-[var(--surface-2)]',
                    lastRunId === r.id && 'surface-2',
                  )}
                >
                  <span
                    className={cn(
                      'size-2 rounded-full',
                      r.status === 'ok'
                        ? 'bg-emerald-500'
                        : r.status === 'running'
                          ? 'bg-accent-500 animate-pulse'
                          : r.status === 'partial'
                            ? 'bg-amber-500'
                            : 'bg-red-500',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">{r.mode === 'inventory' ? 'Inventario' : 'Sincronización'}</div>
                    <div className="text-muted text-xs">
                      {relative(r.startedAt)}
                      {r.mode === 'sync' &&
                        r.stats.documentsNew !== undefined &&
                        ` · +${r.stats.documentsNew} docs · ${r.stats.errors} errores`}
                    </div>
                  </div>
                  <ChevronRight className="text-muted size-4" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {lastRunId && !running && <InventoryView runId={lastRunId} />}
    </div>
  );
}

function LogView({ runId, live }: { runId: number | null; live?: string[] }) {
  const run = useQuery({
    queryKey: ['sync-run', runId],
    queryFn: () => api.syncRun(runId!),
    enabled: !!runId && !live,
  });
  const lines = live ?? run.data?.log ?? [];
  return (
    <div className="mx-5 mb-5 max-h-80 overflow-y-auto rounded-xl bg-zinc-950 p-4 font-mono text-[0.72rem] leading-relaxed text-zinc-300">
      {lines.length === 0 && <span className="text-zinc-500">Sin registro todavía.</span>}
      {lines.map((l, i) => (
        <div
          key={i}
          className={cn(
            l.includes('ERROR') || l.includes('Error')
              ? 'text-red-400'
              : l.includes('Nuevo:')
                ? 'text-emerald-400'
                : l.includes('Modificado:')
                  ? 'text-sky-400'
                  : '',
          )}
        >
          {l}
        </div>
      ))}
    </div>
  );
}

function InventoryView({ runId }: { runId: number }) {
  const { data } = useQuery({ queryKey: ['sync-run', runId], queryFn: () => api.syncRun(runId) });
  const inv: Inventory | null | undefined = data?.inventory;
  const [open, setOpen] = useState<string | null>(null);
  if (!inv) return null;
  return (
    <Card className="animate-in mt-4">
      <CardHeader
        title="Inventario detectado"
        icon={<ClipboardList className="size-4" />}
        subtitle={`${inv.account ?? ''} · generado ${dateTime(inv.generatedAt)}${inv.platform?.release ? ` · Moodle ${String(inv.platform.release)}` : ''}`}
      />
      <div className="grid grid-cols-3 gap-3 px-5 sm:grid-cols-6">
        {[
          ['Asignaturas', inv.totals.subjects],
          ['Unidades', inv.totals.units],
          ['Ficheros', inv.totals.files],
          ['Tamaño', bytes(inv.totals.bytes)],
          ['Tareas', inv.totals.tasks],
          ['Avisos', inv.totals.messages],
        ].map(([k, v]) => (
          <div key={k} className="surface-2 rounded-xl px-3 py-2">
            <div className="text-muted text-xs">{k}</div>
            <div className="font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      {inv.warnings.length > 0 && (
        <ul className="text-muted mx-5 mt-3 space-y-0.5 text-xs">
          {inv.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
      <div className="p-2">
        {inv.subjects.length === 0 && <Empty title="Sin asignaturas" />}
        {inv.subjects.map((s) => (
          <div key={s.externalId} className="border-t border-[var(--border)] first:border-0">
            <button
              onClick={() => setOpen(open === s.externalId ? null : s.externalId)}
              className="flex w-full items-center gap-3 px-3 py-3 text-left"
              aria-expanded={open === s.externalId}
            >
              <ChevronRight
                className={cn('text-muted size-4 transition-transform', open === s.externalId && 'rotate-90')}
              />
              <span className="flex-1 text-sm font-medium">{s.name}</span>
              <span className="text-muted text-xs">
                {s.units.reduce((a, u) => a + u.files.length, 0)} ficheros · {s.tasks.length} tareas ·{' '}
                {s.messages.length} avisos
              </span>
            </button>
            {open === s.externalId && (
              <div className="grid gap-4 px-10 pb-4 text-sm md:grid-cols-2">
                <div>
                  {s.teachers.length > 0 && (
                    <p className="text-muted mb-2 text-xs">Profesorado: {s.teachers.join(', ')}</p>
                  )}
                  {s.units.map((u) => (
                    <div key={u.name} className="mb-3">
                      <div className="font-medium">{u.name}</div>
                      <ul className="text-muted mt-1 space-y-0.5 text-xs">
                        {u.files.map((f) => (
                          <li key={f.filename + f.title} className="flex justify-between gap-2">
                            <span className="truncate">{f.filename}</span>
                            <span className="shrink-0">
                              {f.kind ? KIND_LABEL[f.kind] : ''} {bytes(f.size)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="font-medium">Tareas</div>
                    <ul className="text-muted mt-1 space-y-0.5 text-xs">
                      {s.tasks.map((t) => (
                        <li key={t.title}>
                          {t.title} — {dateTime(t.dueAt)}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="font-medium">Avisos</div>
                    <ul className="text-muted mt-1 space-y-0.5 text-xs">
                      {s.messages.map((m) => (
                        <li key={m.title + m.postedAt}>
                          {m.title} · {m.author}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {s.skipped.length > 0 && (
                    <div>
                      <div className="font-medium">No importado</div>
                      <ul className="text-muted mt-1 space-y-0.5 text-xs">
                        {s.skipped.map((x) => (
                          <li key={x.name + x.type}>
                            [{x.type}] {x.name} — {x.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
