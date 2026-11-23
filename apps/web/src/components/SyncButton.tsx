import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError } from '../lib/api';
import { Button } from './ui';

/** Hook compartido: estado de la sincronización en curso con sondeo mientras corre. */
export function useSyncJob() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ['sync-status'],
    queryFn: api.syncStatus,
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 800 : false),
  });
  const prev = useRef(status.data?.status);
  useEffect(() => {
    if (prev.current === 'running' && status.data?.status !== 'running') void qc.invalidateQueries();
    prev.current = status.data?.status;
  }, [status.data?.status, qc]);
  return status;
}

export function SyncButton({ compact }: { compact?: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const sources = useQuery({ queryKey: ['sources'], queryFn: api.sources });
  const job = useSyncJob();
  const running = job.data?.status === 'running';
  const source = sources.data?.[0];

  const start = useMutation({
    mutationFn: () => api.startSync(source!.id, 'sync'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sync-status'] }),
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'SOURCE_AUTH') navigate('/sources');
    },
  });

  return (
    <Button
      variant="primary"
      size={compact ? 'sm' : 'md'}
      onClick={() => (source?.authenticated ? start.mutate() : navigate('/sources'))}
      disabled={!source}
      loading={start.isPending}
      icon={<RefreshCw className={running ? 'size-4 animate-spin' : 'size-4'} />}
    >
      {running ? 'Sincronizando…' : 'Sincronizar ahora'}
    </Button>
  );
}
