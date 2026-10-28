import './office.css';

import type { ReactNode } from 'react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import type { Approval, OfficeEvent, OfficeThread } from './client';
import { api, connect, disconnect, getSnapshot, subscribe } from './client';

const names = ['ai-pm-lead-discovery', 'ai-pm-business-intelligence', 'ai-pm-campaign-readiness'];
const labels = ['Lead Discovery', 'Business Intelligence', 'Campaign Readiness'];
type Item = {
  id: string;
  type: string;
  text?: string;
  content?: Array<{ text?: string }>;
  [key: string]: unknown;
};
type History = { thread: { turns?: Array<{ id: string; status: string; items: Item[] }> } };
type Sheets = {
  status: string;
  reason?: string;
  readAt?: string;
  rangeLimit?: string;
  tabs: Record<string, string[][]>;
};

function ApprovalCard({
  request,
  act,
}: {
  request: Approval;
  act: (operation: () => Promise<unknown>) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  return (
    <section className="approval">
      <strong>Decisione richiesta da Codex</strong>
      <p>{request.method}</p>
      <pre>
        {request.params.command ||
          request.params.reason ||
          'Verifica i dettagli prima di decidere.'}
      </pre>
      <details>
        <summary>Payload ufficiale</summary>
        <pre>{JSON.stringify(request.params, null, 2)}</pre>
      </details>
      {request.params.questions?.map((question) => (
        <label key={question.id}>
          {question.question}
          {question.options?.map((option) => (
            <button
              key={option.label}
              title={option.description}
              onClick={() =>
                setAnswers((previous) => ({ ...previous, [question.id]: option.label }))
              }
            >
              {option.label}
            </button>
          ))}
          <input
            value={answers[question.id] || ''}
            onChange={(event) =>
              setAnswers((previous) => ({ ...previous, [question.id]: event.target.value }))
            }
          />
        </label>
      ))}
      {request.params.questions ? (
        <button onClick={() => act(() => api('approval', { id: request.id, answers }))}>
          Invia risposta
        </button>
      ) : (
        <div className="actions">
          <button
            onClick={() => act(() => api('approval', { id: request.id, decision: 'accept' }))}
          >
            Approva questa richiesta
          </button>
          <button
            onClick={() => act(() => api('approval', { id: request.id, decision: 'decline' }))}
          >
            Rifiuta
          </button>
          <button
            onClick={() => act(() => api('approval', { id: request.id, decision: 'cancel' }))}
          >
            Annulla
          </button>
        </div>
      )}
    </section>
  );
}

export function CommandCenter({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const [token, setToken] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [text, setText] = useState('');
  const [skill, setSkill] = useState('');
  const [model, setModel] = useState('');
  const [tab, setTab] = useState('activity');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<History | null>(null);
  const [journal, setJournal] = useState<OfficeEvent[]>([]);
  const [sheets, setSheets] = useState<Sheets | null>(null);
  const [sheetTab, setSheetTab] = useState('Companies');
  const [query, setQuery] = useState('');
  const chatLog = useRef<HTMLDivElement>(null);
  const followChat = useRef(true);
  const thread = state.threads.find((row) => row.id === selectedId) || state.threads.at(-1);
  const id = thread?.id;
  const act = (operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    void operation()
      .catch((problem) => setError(String(problem instanceof Error ? problem.message : problem)))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    const listener = (event: Event) => {
      setSelectedId((event as CustomEvent<string>).detail);
      setTab('activity');
    };
    window.addEventListener('office-select-thread', listener);
    return () => window.removeEventListener('office-select-thread', listener);
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (!id || !state.connected || thread?.status === 'idle' || thread?.status === 'inProgress')
      return;
    void api<History>('history?threadId=' + encodeURIComponent(id))
      .then((value) => {
        if (!cancelled) setHistory(value);
      })
      .catch((problem) => {
        if (!cancelled) setError(problem.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id, state.connected, thread?.status]);
  useEffect(() => {
    if (chatLog.current && followChat.current)
      chatLog.current.scrollTop = chatLog.current.scrollHeight;
  }, [state.cursor, id, history]);
  const items = new Map<string, Item>();
  const persistedIds = new Set<string>();
  if (history && id === (history.thread as { id?: string }).id)
    for (const turn of history.thread.turns || [])
      for (const item of turn.items) {
        items.set(item.id, item);
        if (turn.status !== 'inProgress') persistedIds.add(item.id);
      }
  for (const event of state.events.filter((event) => event.params.threadId === id)) {
    const eventItem = event.params.item as Item | undefined;
    if (persistedIds.has(eventItem?.id || String(event.params.itemId || ''))) continue;
    if (event.method === 'item/started' || event.method === 'item/completed') {
      const item = event.params.item as Item;
      if (item) items.set(item.id, item);
    }
    if (event.method === 'item/agentMessage/delta') {
      const itemId = String(event.params.itemId);
      const item = items.get(itemId);
      items.set(itemId, {
        id: itemId,
        type: 'agentMessage',
        text: (item?.text || '') + String(event.params.delta || ''),
      });
    }
  }
  const chat = [...items.values()].filter((item) =>
    ['agentMessage', 'userMessage', 'plan'].includes(item.type),
  );
  const rows = sheets?.tabs[sheetTab] || [];
  const dataRows = rows
    .slice(1)
    .filter((row) => row.join(' ').toLowerCase().includes(query.toLowerCase()));
  const selectThread = (row: OfficeThread) => {
    setHistory(null);
    setSelectedId(row.id);
  };

  return (
    <div className="command-center">
      <header className="command-header">
        <div className="brand-mark">AI</div>
        <div>
          <h1>
            AI PM LAB <span>VIRTUAL OFFICE</span>
          </h1>
          <p>Command Center · Codex / Pixel Agents</p>
        </div>
        <span className={'connection ' + (state.connected ? 'online' : '')} role="status">
          ● {state.connected ? 'Connected' : 'Disconnected'}
        </span>
        {state.connected && <button onClick={disconnect}>Disconnetti browser</button>}
      </header>
      {!state.connected && (
        <form
          className="pairing"
          onSubmit={(event) => {
            event.preventDefault();
            act(async () => {
              await connect(token);
              setToken('');
            });
          }}
        >
          <label>
            Servizio locale · 127.0.0.1:4318{' '}
            <input
              aria-label="Token di abbinamento"
              type="password"
              autoComplete="off"
              placeholder="Token mostrato da npm run office"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
          <button disabled={busy || !token.trim()}>Collega Codex</button>
          <small>
            Il token resta in memoria. Se il browser blocca localhost, usa l’indirizzo locale.
          </small>
          {state.error && <p role="alert">{state.error}</p>}
        </form>
      )}
      <main className="command-main">
        <section className="office-column" aria-label="Ufficio Pixel Agents">
          <div className="office-heading">
            <span>WORKSPACE / LIVE OFFICE</span>
            <small>
              {state.threads.filter((row) => row.loaded && state.connected).length} sessioni
              collegate ·{' '}
              {state.threads.filter((row) => row.status === 'inProgress' && state.connected).length}{' '}
              turni attivi
            </small>
          </div>
          <div className="pixel-office">{children}</div>
          <div className="stations" aria-label="Skill Manager">
            {names.map((name, index) => {
              const installed = state.skills.find((row) => row.name === name && !row.unavailable);
              const active =
                state.connected &&
                state.threads.find(
                  (row) => row.loaded && row.status === 'inProgress' && row.phase?.name === name,
                );
              return (
                <button
                  key={name}
                  className={'station ' + (active ? 'working' : '')}
                  onClick={() => setSkill(name)}
                  disabled={!installed}
                  title={installed?.path || 'Skill non disponibile'}
                >
                  <span className="station-number">0{index + 1}</span>
                  <span>
                    <strong>{labels[index]}</strong>
                    <small>
                      {active
                        ? 'Lettura SKILL.md osservata · ' + active.id.slice(0, 8)
                        : installed
                          ? 'Installata · fase non osservata'
                          : 'Non verificata / non disponibile'}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
          <nav className="command-tabs" aria-label="Pannelli">
            {[
              ['activity', 'Attività e dettagli'],
              ['leads', 'Master Leads'],
              ['history', 'Storico esecuzioni'],
            ].map(([key, label]) => (
              <button
                key={key}
                className={tab === key ? 'current' : ''}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </nav>
          <section className="data-panel">
            {tab === 'activity' && (
              <>
                <div className="panel-heading">
                  <h2>Eventi osservati</h2>
                  <span>Finestra live: ultimi 1.000 eventi</span>
                </div>
                {thread && (
                  <p>
                    Sessione {thread.id} · {thread.status} · sandbox {thread.sandbox}
                    <br />
                    {thread.phase
                      ? `Fase: ${thread.phase.name} — evidenza ${thread.phase.evidence}, item ${thread.phase.itemId}`
                      : 'Fase skill non osservata.'}
                  </p>
                )}
                <p className="muted">
                  Un personaggio per sessione collegata. Le tre postazioni rappresentano funzioni. I
                  file consultati compaiono solo se riportati negli eventi dello strumento.
                </p>
                <div className="event-list">
                  {state.events
                    .filter((event) => !id || event.params.threadId === id)
                    .slice(-100)
                    .reverse()
                    .map((event) => (
                      <details key={event.seq}>
                        <summary>
                          <time>{new Date(event.at).toLocaleTimeString('it-IT')}</time>{' '}
                          {event.method}
                        </summary>
                        <pre>{JSON.stringify(event.params, null, 2)}</pre>
                      </details>
                    ))}
                </div>
                {!state.events.length && <p className="empty">Nessuna attività osservata.</p>}
              </>
            )}
            {tab === 'history' && (
              <>
                <div className="panel-heading">
                  <h2>Sessioni dell’ufficio</h2>
                  <button
                    disabled={!state.connected || busy}
                    onClick={() =>
                      act(async () => {
                        const value = await api<{ events: OfficeEvent[] }>('journal');
                        setJournal(value.events);
                        if (id)
                          setHistory(
                            await api<History>('history?threadId=' + encodeURIComponent(id)),
                          );
                      })
                    }
                  >
                    Leggi registro locale
                  </button>
                </div>
                {state.threads.map((row) => (
                  <div className="history-row" key={row.id}>
                    <button onClick={() => selectThread(row)}>
                      {row.id.slice(0, 8)} · {new Date(row.createdAt).toLocaleString('it-IT')} ·{' '}
                      {row.status}
                    </button>
                    {!row.loaded && (
                      <button
                        disabled={!state.connected || busy}
                        onClick={() => act(() => api('resume', { threadId: row.id }))}
                      >
                        Ricollega
                      </button>
                    )}
                  </div>
                ))}
                <p className="muted">
                  Il registro conserva gli eventi reali su questo computer; visualizzazione limitata
                  agli ultimi 2.000. Le altre chat Codex sono escluse.
                </p>
                {journal
                  .slice()
                  .reverse()
                  .map((event, index) => (
                    <details key={index}>
                      <summary>
                        {event.at} · {event.method}
                      </summary>
                      <pre>{JSON.stringify(event.params, null, 2)}</pre>
                    </details>
                  ))}
                {history && (
                  <details>
                    <summary>Turni e risultati della sessione selezionata</summary>
                    <pre>{JSON.stringify(history.thread, null, 2)}</pre>
                  </details>
                )}
              </>
            )}
            {tab === 'leads' && (
              <>
                <div className="panel-heading">
                  <h2>
                    Master Leads <span>READ ONLY</span>
                  </h2>
                  <button
                    disabled={!state.connected || busy}
                    onClick={() => act(async () => setSheets(await api<Sheets>('sheets')))}
                  >
                    Leggi dati reali
                  </button>
                </div>
                <p>
                  <a
                    href="https://docs.google.com/spreadsheets/d/1Uuho6icG-4qfnV3jRoTFwXNUoo4wwEgoLfwWuZMZTBk/edit"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Apri il Master Leads esistente ↗
                  </a>
                </p>
                {!sheets && (
                  <p className="empty">
                    Dati non caricati. È richiesto accesso Google autorizzato nel servizio locale.
                  </p>
                )}
                {sheets && (
                  <p>
                    {sheets.status} · {sheets.reason || 'Letto: ' + sheets.readAt}{' '}
                    {sheets.rangeLimit && '· ' + sheets.rangeLimit}
                  </p>
                )}
                <div className="actions">
                  {['Companies', 'Contacts', 'Opportunities', 'Campaign Queue', 'Research Log'].map(
                    (name) => (
                      <button
                        key={name}
                        className={sheetTab === name ? 'current' : ''}
                        onClick={() => setSheetTab(name)}
                      >
                        {name}
                        {sheets?.status === 'connected'
                          ? ` (${Math.max(0, (sheets.tabs[name]?.length || 0) - 1)})`
                          : ''}
                      </button>
                    ),
                  )}
                </div>
                <input
                  aria-label="Cerca nei dati"
                  placeholder="Cerca nei dati caricati"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {!!rows.length && (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          {rows[0].map((cell, index) => (
                            <th key={index}>{cell}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dataRows.slice(0, 300).map((row, index) => (
                          <tr key={index}>
                            {rows[0].map((_, col) => (
                              <td key={col}>{row[col] || ''}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <small>{dataRows.length} righe filtrate · prime 300 visibili</small>
                  </div>
                )}
              </>
            )}
          </section>
        </section>
        <aside className="chat-column" aria-label="Chat Codex">
          <div className="panel-heading">
            <h2>
              Codex <span>LIVE</span>
            </h2>
            <button
              disabled={!state.connected || busy}
              onClick={() =>
                act(async () => {
                  const row = await api<OfficeThread>('threads', { model: model || undefined });
                  setHistory(null);
                  setSelectedId(row.id);
                })
              }
            >
              + Sessione
            </button>
          </div>
          <select
            aria-label="Modello per nuove sessioni"
            value={model}
            onChange={(event) => setModel(event.target.value)}
          >
            <option value="">Modello predefinito disponibile</option>
            {state.models?.map((row) => (
              <option key={row.model} value={row.model}>
                {row.displayName || row.model}
              </option>
            ))}
          </select>
          <select
            aria-label="Sessione Codex"
            value={id || ''}
            onChange={(event) => {
              setHistory(null);
              setSelectedId(event.target.value);
            }}
          >
            <option value="" disabled>
              Seleziona una sessione
            </option>
            {state.threads.map((row) => (
              <option key={row.id} value={row.id}>
                {row.id.slice(0, 8)} · {row.status}
              </option>
            ))}
          </select>
          <div
            className="chat-log"
            aria-live="polite"
            ref={chatLog}
            onScroll={() => {
              const element = chatLog.current;
              if (element)
                followChat.current =
                  element.scrollHeight - element.scrollTop - element.clientHeight < 60;
            }}
          >
            {!chat.length && (
              <div className="empty">
                <h3>Il tuo ufficio, attività reali.</h3>
                <p>
                  Collega il servizio locale e crea una sessione Codex. Qui appariranno i messaggi e
                  i risultati effettivi.
                </p>
              </div>
            )}
            {chat.map((item) => (
              <article key={item.id} className={'chat-message ' + item.type}>
                <small>
                  {item.type === 'userMessage'
                    ? 'TU'
                    : item.type === 'plan'
                      ? 'PIANO CODEX'
                      : 'CODEX'}
                </small>
                <pre>{item.text || item.content?.map((part) => part.text || '').join('\n')}</pre>
              </article>
            ))}
          </div>
          {state.approvals.map((request) => (
            <ApprovalCard key={request.id} request={request} act={act} />
          ))}
          {error && (
            <p className="command-error" role="alert">
              {error}
            </p>
          )}
          <form
            className="chat-compose"
            onSubmit={(event) => {
              event.preventDefault();
              act(async () => {
                await api('turn', { threadId: id, text, skill: skill || undefined });
                setText('');
              });
            }}
          >
            <label>
              Skill per il prossimo messaggio
              <select
                aria-label="Skill"
                value={skill}
                onChange={(event) => setSkill(event.target.value)}
              >
                <option value="">Nessuna skill esplicita</option>
                {names.map((name, index) => (
                  <option
                    key={name}
                    value={name}
                    disabled={!state.skills.find((row) => row.name === name && !row.unavailable)}
                  >
                    {labels[index]}
                  </option>
                ))}
              </select>
            </label>
            <textarea
              aria-label="Messaggio a Codex"
              placeholder="Scrivi a Codex…"
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={16000}
            />
            <div className="actions">
              <button
                className="primary"
                disabled={
                  !state.connected ||
                  !thread?.loaded ||
                  busy ||
                  !!thread?.activeTurn ||
                  !text.trim()
                }
              >
                Invia a Codex
              </button>
              <button
                type="button"
                disabled={!state.connected || !thread?.activeTurn || busy}
                onClick={() => act(() => api('interrupt', { threadId: id }))}
              >
                Interrompi turno
              </button>
            </div>
            <small>
              {state.cwd || 'Workspace configurato nel servizio locale'}
              <br />
              Nessun invio email o follow-up automatico.
            </small>
          </form>
        </aside>
      </main>
    </div>
  );
}
