import { useQuery } from '@tanstack/react-query';
import {
  BellDot,
  BookOpen,
  Boxes,
  CheckSquare,
  FlaskConical,
  FolderTree,
  GraduationCap,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  Moon,
  PlugZap,
  Search,
  Sparkles,
  Sun,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { SyncButton, useSyncJob } from './SyncButton';
import { Dot, cn } from './ui';

const NAV: { to: string; label: string; icon: ReactNode; badge?: 'changes' | 'tasks' }[] = [
  { to: '/', label: 'Inicio', icon: <LayoutDashboard className="size-4" /> },
  { to: '/changes', label: 'Novedades', icon: <BellDot className="size-4" />, badge: 'changes' },
  { to: '/tasks', label: 'Tareas', icon: <CheckSquare className="size-4" />, badge: 'tasks' },
  { to: '/messages', label: 'Mensajes', icon: <MessageSquareText className="size-4" /> },
  { to: '/documents', label: 'Documentos', icon: <FolderTree className="size-4" /> },
  { to: '/search', label: 'Buscar', icon: <Search className="size-4" /> },
  { to: '/assistant', label: 'Asistente IA', icon: <Sparkles className="size-4" /> },
  { to: '/study', label: 'Modo estudio', icon: <BookOpen className="size-4" /> },
  { to: '/exam', label: 'Modo examen', icon: <GraduationCap className="size-4" /> },
];

export function Layout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: Infinity });
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="flex h-full">
      <aside
        className={cn(
          'border-subtle fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r bg-[var(--surface)] transition-transform duration-200 lg:static lg:translate-x-0',
          open ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
        )}
      >
        <Sidebar demo={settings.data?.mode === 'demo'} onClose={() => setOpen(false)} />
      </aside>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/30 backdrop-blur-[2px] lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <div key={location.pathname} className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <Outlet />
          </div>
        </main>
      </div>
      <SyncToast />
    </div>
  );
}

function Sidebar({ demo, onClose }: { demo: boolean; onClose: () => void }) {
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard });
  const changes = dash.data?.unseenChanges.length ?? 0;
  const tasks = dash.data?.counts.tasksPending ?? 0;

  return (
    <>
      <div className="flex h-16 items-center justify-between px-5">
        <NavLink to="/" className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-7" />
          <span className="text-[0.95rem] font-semibold tracking-tight">StudyVault</span>
          {demo && (
            <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[0.62rem] font-bold tracking-wide text-amber-700 dark:text-amber-400">
              DEMO
            </span>
          )}
        </NavLink>
        <button className="text-muted lg:hidden" onClick={onClose} aria-label="Cerrar menú">
          <X className="size-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4">
        <div className="space-y-0.5">
          {NAV.map((n) => (
            <Item
              key={n.to}
              to={n.to}
              icon={n.icon}
              label={n.label}
              badge={n.badge === 'changes' ? changes : n.badge === 'tasks' ? tasks : 0}
            />
          ))}
        </div>

        <div>
          <div className="text-muted mb-1.5 px-3 text-[0.68rem] font-semibold tracking-wider uppercase">
            Asignaturas
          </div>
          <div className="space-y-0.5">
            {dash.data?.subjects.map((s) => (
              <NavLink
                key={s.id}
                to={`/subjects/${s.id}`}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors',
                    isActive
                      ? 'surface-2 font-medium'
                      : 'text-muted hover:bg-[var(--surface-2)] hover:text-[var(--text)]',
                  )
                }
              >
                <Dot color={s.color} />
                <span className="truncate">{s.name}</span>
              </NavLink>
            ))}
            {dash.data && dash.data.subjects.length === 0 && (
              <p className="text-muted px-3 text-xs">Sincroniza para ver tus asignaturas.</p>
            )}
          </div>
        </div>

        <div className="space-y-0.5">
          <Item to="/sources" icon={<PlugZap className="size-4" />} label="Fuentes y sincronización" />
          <Item to="/architecture" icon={<Boxes className="size-4" />} label="Arquitectura" />
        </div>
      </nav>

      <div className="border-subtle text-muted flex items-center gap-2 border-t px-5 py-3 text-[0.7rem]">
        <FlaskConical className="size-3.5" />
        Solo lectura · datos locales
      </div>
    </>
  );
}

function Item({
  to,
  icon,
  label,
  badge = 0,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
          isActive
            ? 'surface-2 font-medium text-[var(--text)]'
            : 'text-muted hover:bg-[var(--surface-2)] hover:text-[var(--text)]',
        )
      }
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {badge > 0 && (
        <span className="bg-accent-500/15 text-accent-600 dark:text-accent-400 rounded-full px-1.5 text-[0.68rem] font-semibold tabular-nums">
          {badge}
        </span>
      )}
    </NavLink>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('sv-theme', next ? 'dark' : 'light');
    } catch {
      /* almacenamiento no disponible */
    }
  };

  return (
    <header className="border-subtle sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b bg-[var(--bg)]/80 px-4 backdrop-blur-md sm:px-6 lg:px-8">
      <button className="text-muted lg:hidden" onClick={onMenu} aria-label="Abrir menú">
        <Menu className="size-5" />
      </button>
      <form
        className="relative max-w-md flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
        }}
      >
        <Search className="text-muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar conceptos en tus materiales…"
          aria-label="Búsqueda semántica"
          className="surface h-9 w-full rounded-xl pr-14 pl-9 text-sm placeholder:text-[var(--muted)]"
        />
        <kbd className="text-muted border-subtle absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded border px-1.5 text-[0.65rem] sm:block">
          Ctrl K
        </kbd>
      </form>
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={toggleTheme}
          className="text-muted grid size-9 place-items-center rounded-xl hover:bg-[var(--surface-2)]"
          aria-label="Cambiar tema"
        >
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
        <SyncButton compact />
      </div>
    </header>
  );
}

function SyncToast() {
  const job = useSyncJob();
  const navigate = useNavigate();
  if (job.data?.status !== 'running') return null;
  const last = job.data.log?.at(-1)?.replace(/^\S+\s/, '') ?? 'Iniciando…';
  return (
    <button
      onClick={() => navigate('/sources')}
      className="surface animate-in fixed right-4 bottom-4 z-50 flex w-80 items-start gap-3 rounded-2xl p-4 text-left shadow-xl"
    >
      <span className="relative mt-1 flex size-2.5">
        <span className="bg-accent-400 absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
        <span className="bg-accent-500 relative inline-flex size-2.5 rounded-full" />
      </span>
      <div className="min-w-0">
        <div className="text-sm font-medium">
          {job.data.mode === 'inventory' ? 'Generando inventario' : 'Sincronizando'}
        </div>
        <div className="text-muted line-clamp-2 text-xs">{last}</div>
      </div>
    </button>
  );
}
