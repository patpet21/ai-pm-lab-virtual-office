import { useState } from 'react';

import type { OfficeSnapshot, OfficeThread } from './client';
import { api } from './client';

export function RoleManager({
  state,
  busy,
  model,
  sandbox,
  act,
  select,
  prompt,
}: {
  state: OfficeSnapshot;
  busy: boolean;
  model: string;
  sandbox: string;
  act: (work: () => Promise<unknown>) => void;
  select: (thread: OfficeThread) => void;
  prompt: (text: string, skill?: string) => void;
}) {
  const [target, setTarget] = useState<Record<string, string>>({});
  const available = state.connected && !busy;
  const roleList = state.roles || [];
  return (
    <section className="role-manager" aria-label="Agenzia e agenti">
      <div className="panel-heading">
        <h2>La tua agenzia</h2>
        <button
          disabled={!available || !roleList.length}
          onClick={() =>
            act(async () => {
              const team = await api<{ threads: OfficeThread[] }>('team', {
                model: model || undefined,
                sandbox,
              });
              select(team.threads[0]);
              prompt(roleList[0].example, roleList[0].skill);
            })
          }
        >
          Crea team di 3 sessioni reali
        </button>
      </div>
      <p className="muted">
        I reparti possono lavorare su incarichi indipendenti. La pipeline usa Discovery →
        Intelligence → Readiness, con risultati trasferiti dopo il completamento. Creare una
        sessione non avvia una ricerca.
      </p>
      {!roleList.length && <p>Aggiornare il servizio locale per caricare ruoli e prompt.</p>}
      <div className="role-grid">
        {roleList.map((role) => {
          const threads = state.threads.filter((thread) => thread.role === role.id);
          const skills = role.skills || (role.skill ? [role.skill] : []);
          const installed = skills.every((name) =>
            state.skills.some((skill) => skill.name === name && !skill.unavailable),
          );
          return (
            <section className="role-card" key={role.id}>
              <h3>{role.name}</h3>
              <p>{role.description}</p>
              <div className="actions">
                <button
                  disabled={!available || !installed}
                  onClick={() =>
                    act(async () => {
                      const thread = await api<OfficeThread>('threads', {
                        role: role.id,
                        model: model || undefined,
                        sandbox,
                      });
                      select(thread);
                      prompt(role.example, role.skill);
                    })
                  }
                >
                  Crea {role.id === 'coordinator' ? 'coordinatore' : 'specialista'}
                </button>
                <button onClick={() => prompt(role.example, role.skill)}>
                  Usa prompt d’esempio
                </button>
              </div>
              <details>
                <summary>Leggi il prompt</summary>
                <pre>{role.example}</pre>
              </details>
              {role.id === 'coordinator' && (
                <small>1 sessione reale, tre skill in ordine. Un solo personaggio.</small>
              )}
              {threads.map((thread) => {
                const events = state.events.filter((event) => event.params.threadId === thread.id);
                const task = events
                  .slice()
                  .reverse()
                  .find((event) => event.method === 'office/userMessage');
                const last = events
                  .slice()
                  .reverse()
                  .find((event) =>
                    ['item/started', 'item/completed', 'turn/completed'].includes(event.method),
                  );
                const item = last?.params.item as
                  { command?: string; tool?: string; type?: string } | undefined;
                const nextRole =
                  thread.role === 'discovery'
                    ? 'intelligence'
                    : thread.role === 'intelligence'
                      ? 'campaign'
                      : null;
                const recipients = state.threads.filter(
                  (row) =>
                    row.role === nextRole &&
                    row.loaded &&
                    !row.activeTurn &&
                    (!thread.teamId || row.teamId === thread.teamId),
                );
                const recipient = target[thread.id] || recipients[0]?.id || '';
                return (
                  <div className="role-thread" key={thread.id}>
                    <button onClick={() => select(thread)}>
                      {thread.id.slice(0, 8)} · {thread.status}
                    </button>
                    <small>
                      Ruolo assegnato: {role.name} · Fase osservata:{' '}
                      {thread.phase?.name || 'non osservata'}
                    </small>
                    {task && (
                      <p title={String(task.params.text)}>
                        Incarico: {String(task.params.text).slice(0, 180)}
                      </p>
                    )}
                    {last && (
                      <p>
                        Ultimo evento: {item?.command || item?.tool || item?.type || last.method}
                      </p>
                    )}
                    {nextRole && (
                      <div className="handoff-controls">
                        <select
                          aria-label={'Destinatario ' + thread.id.slice(0, 8)}
                          value={recipient}
                          onChange={(event) =>
                            setTarget((previous) => ({
                              ...previous,
                              [thread.id]: event.target.value,
                            }))
                          }
                        >
                          <option value="" disabled>
                            Seleziona reparto successivo
                          </option>
                          {recipients.map((row) => (
                            <option key={row.id} value={row.id}>
                              {row.label} · {row.id.slice(0, 8)}
                            </option>
                          ))}
                        </select>
                        <button
                          disabled={!available || thread.status !== 'completed' || !recipient}
                          onClick={() =>
                            act(async () => {
                              await api('handoff', {
                                fromThreadId: thread.id,
                                toThreadId: recipient,
                              });
                              const destination = state.threads.find((row) => row.id === recipient);
                              if (destination) {
                                select(destination);
                                prompt('', undefined);
                              }
                            })
                          }
                        >
                          Passa risultato e avvia reparto
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </section>
  );
}
