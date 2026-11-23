import type { SearchScope } from '@studyvault/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Select } from './ui';

/** Selector de ámbito: Todo DAM → asignatura → unidad. */
export function ScopePicker({
  value,
  onChange,
  allowAll = true,
}: {
  value: SearchScope;
  onChange: (s: SearchScope, label: string) => void;
  allowAll?: boolean;
}) {
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: api.subjects });
  const detail = useQuery({
    queryKey: ['subject', value.subjectId],
    queryFn: () => api.subject(value.subjectId!),
    enabled: !!value.subjectId,
  });
  const subjectName = subjects.data?.find((s) => s.id === value.subjectId)?.name;

  return (
    <div className="flex flex-wrap gap-2">
      <Select
        aria-label="Asignatura"
        value={value.subjectId ?? ''}
        onChange={(e) => {
          const id = Number(e.target.value) || undefined;
          onChange(
            id ? { subjectId: id } : {},
            id ? (subjects.data?.find((s) => s.id === id)?.name ?? '') : 'Todo DAM',
          );
        }}
      >
        {allowAll && <option value="">Todo DAM</option>}
        {!allowAll && !value.subjectId && <option value="">Elige asignatura…</option>}
        {subjects.data?.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Select>
      {value.subjectId && (
        <Select
          aria-label="Unidad"
          value={value.unitIds?.[0] ?? ''}
          onChange={(e) => {
            const id = Number(e.target.value) || undefined;
            const unit = detail.data?.units.find((u) => u.id === id);
            onChange(
              id ? { subjectId: value.subjectId, unitIds: [id] } : { subjectId: value.subjectId },
              unit ? `${subjectName} › ${unit.name}` : (subjectName ?? ''),
            );
          }}
        >
          <option value="">Todas las unidades</option>
          {detail.data?.units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}
