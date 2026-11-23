import type { SearchScope } from '@studyvault/shared';
import { useState } from 'react';
import { AskPanel } from '../components/AskPanel';
import { ScopePicker } from '../components/ScopePicker';
import { PageHeader } from '../components/ui';

export function AssistantPage() {
  const [scope, setScope] = useState<SearchScope>({});
  const [label, setLabel] = useState('Todo DAM');
  return (
    <div>
      <PageHeader
        title="Asistente IA"
        subtitle="RAG sobre tus materiales: recupera, responde y cita. Elige el ámbito para limitar la búsqueda."
        actions={<ScopePicker value={scope} onChange={(s, l) => (setScope(s), setLabel(l))} />}
      />
      <AskPanel
        key={JSON.stringify(scope)}
        className="h-[calc(100vh-13rem)] min-h-[520px]"
        scope={scope}
        scopeLabel={label}
        suggestions={[
          { label: '¿Qué es el patrón DAO?', question: '¿Qué es el patrón DAO?' },
          {
            label: 'Diferencia entre sobrecarga y sobrescritura',
            question: '¿Qué diferencia hay entre sobrecarga y sobrescritura?',
          },
          { label: '¿Cómo evito la inyección SQL?', question: '¿Cómo evito la inyección SQL?' },
        ]}
      />
    </div>
  );
}
