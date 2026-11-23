import { useQuery } from '@tanstack/react-query';
import { MessageSquareText } from 'lucide-react';
import { useState } from 'react';
import { MessageRow } from '../components/rows';
import { Card, Empty, PageHeader, Select } from '../components/ui';
import { api } from '../lib/api';

export function MessagesPage() {
  const [subjectId, setSubjectId] = useState<number | undefined>();
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: api.subjects });
  const { data = [] } = useQuery({
    queryKey: ['messages', subjectId],
    queryFn: () => api.messages({ subjectId }),
  });

  return (
    <div>
      <PageHeader
        title="Mensajes y avisos"
        subtitle="Comunicaciones del profesorado visibles para tu cuenta. Solo lectura: StudyVault nunca responde."
        actions={
          <Select
            value={subjectId ?? ''}
            onChange={(e) => setSubjectId(Number(e.target.value) || undefined)}
            aria-label="Filtrar por asignatura"
          >
            <option value="">Todas las asignaturas</option>
            {subjects.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        }
      />
      <Card className="animate-in divide-y divide-[var(--border)] px-2">
        {data.length ? (
          data.map((m) => <MessageRow key={m.id} msg={m} expanded />)
        ) : (
          <Empty icon={<MessageSquareText className="size-5" />} title="Sin mensajes" />
        )}
      </Card>
    </div>
  );
}
