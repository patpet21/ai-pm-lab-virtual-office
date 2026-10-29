import './office.css';

import type { ReactNode } from 'react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { ApprovalCenter } from './ApprovalCenter';
import type { Approval, OfficeEvent, OfficeThread } from './client';
import { api, connect, disconnect, getSnapshot, subscribe } from './client';
import { ResearchAudit, ResearchBrief } from './ResearchBrief';
import { defaultResearch } from './researchSettings';
import { RoleManager } from './RoleManager';
import { SheetOperations } from './SheetOperations';

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

export function CommandCenter({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const [token, setToken] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [text, setText] = useState('');
  const [skill, setSkill] = useState('');
  const [promptRole, setPromptRole] = useState<string | null>(null);
  const [model, setModel] = useState('');
  const [tab, setTab] = useState('agency');
  const [sandbox, setSandbox] = useState('read-only');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<History | null>(null);
  const [journal, setJournal] = useState<OfficeEvent[]>([]);
  const [sheets, setSheets] = useState<Sheets | null>(null);
  const [sheetTab, setSheetTab] = useState('Companies');
  const [query, setQuery] = useState('');
  const [chatExpanded, setChatExpanded] = useState(false);
  const [research, setResearch] = useState(defaultResearch);
  const [googleStatus, setGoogleStatus] = useState<{
    state: string;
    checkedAt: string;
    details: string[];
  } | null>(null);
  const chatLog = useRef<HTMLDivElement>(null);
  const followChat = useRef(true);
  const thread = state.threads.find((row) => row.id === selectedId) || state.threads.at(-1);
  const id = thread?.id;
  const selectedRole = state.roles?.find((role) => role.id === thread?.role);
  const effectiveSkill = thread?.role ? selectedRole?.skill || '' : skill;
  const wrongRole = Boolean(promptRole && thread?.role !== promptRole);
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
      setSkill('');
      setText('');
      setHistory(null);
      setPromptRole(null);
      setResearch(
        getSnapshot().threads.find((row) => row.id === (event as CustomEvent<string>).detail)
          ?.lastBrief || defaultResearch,
      );
      setTab('activity');
    };
    window.addEventListener('office-select-thread', listener);
    const openAgency = () => setTab('agency');
    window.addEventListener('office-open-agency', openAgency);
    return () => {
      window.removeEventListener('office-select-thread', listener);
      window.removeEventListener('office-open-agency', openAgency);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (
      !id ||
      !state.connected ||
      (thread?.status === 'idle' && !thread.hasHistory) ||
      thread?.status === 'inProgress'
    )
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
  }, [id, state.connected, thread?.status, thread?.hasHistory]);
  useEffect(() => {
    if (chatLog.current && followChat.current)
      chatLog.current.scrollTop = chatLog.current.scrollHeight;
  }, [state.cursor, id, history]);
  const items = new Map<string, Item>();
  const inputByTurn = new Map(
    state.events
      .filter(
        (event) =>
          event.method === 'office/userMessage' &&
          event.params.threadId === id &&
          event.params.turnId,
      )
      .map((event) => [String(event.params.turnId), String(event.params.text)]),
  );
  const persistedIds = new Set<string>();
  const persistedTurns = new Set<string>();
  if (history && id === (history.thread as { id?: string }).id)
    for (const turn of history.thread.turns || []) {
      if (turn.status === 'inProgress') continue;
      if (turn.status !== 'inProgress') persistedTurns.add(turn.id);
      for (const item of turn.items) {
        items.set(
          item.id,
          item.type === 'userMessage' && inputByTurn.has(turn.id)
            ? { ...item, text: inputByTurn.get(turn.id) }
            : item,
        );
        if (turn.status !== 'inProgress') persistedIds.add(item.id);
      }
    }
  for (const event of state.events.filter((event) => event.params.threadId === id)) {
    // thread/read can normalize item IDs. The completed turn, rather than text
    // equality, is the authoritative boundary between history and the stream.
    if (persistedTurns.has(String(event.params.turnId || ''))) continue;
    const eventItem = event.params.item as Item | undefined;
    if (persistedIds.has(eventItem?.id || String(event.params.itemId || ''))) continue;
    if (event.method === 'item/started' || event.method === 'item/completed') {
      const item = event.params.item as Item;
      if (item)
        items.set(
          item.id,
          item.type === 'userMessage' && inputByTurn.has(String(event.params.turnId))
            ? { ...item, text: inputByTurn.get(String(event.params.turnId)) }
            : item,
        );
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
  const masterChanged = state.events.some((event) => {
    const item = event.params.item as
      | {
          type?: string;
          tool?: string;
          status?: string;
          error?: unknown;
          arguments?: { spreadsheet_id?: string };
        }
      | undefined;
    return (
      event.method === 'item/completed' &&
      item?.type === 'mcpToolCall' &&
      item.tool === 'google_drive.batch_update_spreadsheet' &&
      item.status === 'completed' &&
      !item.error &&
      item.arguments?.spreadsheet_id === '1Uuho6icG-4qfnV3jRoTFwXNUoo4wwEgoLfwWuZMZTBk' &&
      (!sheets?.readAt || Date.parse(event.at) > Date.parse(sheets.readAt))
    );
  });
  const dataRows = rows
    .slice(1)
    .filter((row) => row.join(' ').toLowerCase().includes(query.toLowerCase()));
  const selectThread = (row: OfficeThread) => {
    setHistory(null);
    setSelectedId(row.id);
    setSkill('');
    setText('');
    setPromptRole(null);
    setResearch(row.lastBrief || defaultResearch);
  };

  return (
    <div className={'command-center' + (chatExpanded ? ' chat-expanded' : '')}>
      <header className="command-header">
        <div className="brand-mark">AI</div>
        <div>
          <h1>
            AI PM LAB <span>VIRTUAL OFFICE</span>
          </h1>
          <p>Command Center · Codex / Pixel Agents</p>
        </div>
        <button onClick={() => setChatExpanded((value) => !value)}>
          {chatExpanded ? 'Ufficio e chat' : 'Espandi chat'}
        </button>
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
                  onClick={() => {
                    setSkill(name);
                    setTab('agency');
                  }}
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
              ['agency', 'Agenzia e agenti'],
              ['brief', 'Brief e qualità'],
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
            {tab === 'brief' && (
              <ResearchBrief
                value={research}
                change={setResearch}
                disabled={busy || !!thread?.activeTurn}
              />
            )}
            {tab === 'agency' && (
              <RoleManager
                state={state}
                busy={busy}
                model={model}
                sandbox={sandbox}
                act={act}
                select={(row) => {
                  selectThread(row);
                  setTab('agency');
                }}
                prompt={(value, selectedSkill, roleId) => {
                  setText(value);
                  setSkill(selectedSkill || '');
                  setPromptRole(roleId || null);
                }}
              />
            )}
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
                {thread?.lastBrief && (
                  <p>
                    Ultimo brief: {thread.lastBrief.area} · {thread.lastBrief.count} aziende ·
                    profilo {thread.lastBrief.quality} · destinazione {thread.lastBrief.output}.
                  </p>
                )}
                <SheetOperations events={state.events} threadId={id} />
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
                {masterChanged && (
                  <p className="destination-note" role="status">
                    Codex ha eseguito una chiamata di scrittura sul Master dopo l’ultima lettura qui
                    mostrata. Premi «Leggi dati reali» per aggiornare la dashboard; la chiamata da
                    sola non certifica la verifica delle celle.
                  </p>
                )}
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
                <div className="google-access">
                  <strong>Accesso Google tramite Codex locale</strong>
                  <p>
                    Il pannello legge il Master tramite il connettore Codex esistente. Se la lettura
                    live fallisce, mostra la data dell’ultimo snapshot disponibile. Le scritture
                    avvengono nei task autorizzati: il resoconto in chat deve indicare righe e
                    verifica.
                  </p>
                  <button
                    disabled={!state.connected || busy}
                    onClick={() => act(async () => setGoogleStatus(await api('google-status', {})))}
                  >
                    Verifica connettori locali
                  </button>
                  {googleStatus && (
                    <p role="status">
                      {googleStatus.state} ·{' '}
                      {new Date(googleStatus.checkedAt).toLocaleString('it-IT')}
                      <br />
                      {googleStatus.details.join(' · ')}
                    </p>
                  )}
                </div>
                {!sheets && (
                  <p className="empty">
                    Dati non caricati. È richiesto accesso Google autorizzato nel servizio locale.
                  </p>
                )}
                {sheets && (
                  <p>
                    <strong>
                      {sheets.status === 'snapshot'
                        ? 'Snapshot verificato — non Live'
                        : sheets.status === 'connected'
                          ? 'Live · sola lettura'
                          : sheets.status}
                    </strong>{' '}
                    · {sheets.reason} {sheets.readAt && 'Letto: ' + sheets.readAt}{' '}
                    {sheets.rangeLimit && '· ' + sheets.rangeLimit}
                  </p>
                )}
                {sheets && <ResearchAudit tabs={sheets.tabs} />}
                <div className="actions">
                  {['Companies', 'Contacts', 'Opportunities', 'Campaign Queue', 'Research Log'].map(
                    (name) => (
                      <button
                        key={name}
                        className={sheetTab === name ? 'current' : ''}
                        onClick={() => setSheetTab(name)}
                      >
                        {name}
                        {['connected', 'snapshot'].includes(sheets?.status || '')
                          ? ` (${Math.max(0, (sheets?.tabs[name]?.length || 0) - 1)})`
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
                  const row = await api<OfficeThread>('threads', {
                    model: model || undefined,
                    sandbox,
                  });
                  setHistory(null);
                  setSelectedId(row.id);
                })
              }
            >
              + Sessione
            </button>
          </div>
          <details className="session-settings">
            <summary>Nuove sessioni · modello e permessi</summary>
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
            <label>
              Permessi delle nuove sessioni
              <select
                aria-label="Permessi nuove sessioni"
                value={sandbox}
                onChange={(event) => setSandbox(event.target.value)}
              >
                <option value="read-only">Sola lettura</option>
                <option value="workspace-write">Operativo: scrittura nel workspace</option>
              </select>
            </label>
          </details>
          <select
            aria-label="Sessione Codex"
            value={id || ''}
            onChange={(event) => {
              setHistory(null);
              setSelectedId(event.target.value);
              setSkill('');
              setPromptRole(null);
              setText('');
              setResearch(
                state.threads.find((row) => row.id === event.target.value)?.lastBrief ||
                  defaultResearch,
              );
            }}
          >
            <option value="" disabled>
              Seleziona una sessione
            </option>
            {state.threads.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label || 'Codex'} · {row.id.slice(0, 8)} · {row.status}
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
                <h3>
                  {thread?.loaded && state.connected
                    ? `${thread.label || 'Codex'} pronto`
                    : 'Il tuo ufficio, attività reali.'}
                </h3>
                <p>
                  {thread?.loaded && state.connected
                    ? 'Scrivi un incarico o carica un prompt dal pannello Agenzia. La sessione lavora dopo l’invio.'
                    : 'Collega il servizio locale e crea una sessione Codex. Qui appariranno i messaggi e i risultati effettivi.'}
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
                await api('turn', {
                  threadId: id,
                  text,
                  skill: effectiveSkill || undefined,
                  research,
                });
                setText('');
              });
            }}
          >
            {wrongRole && (
              <p className="command-error" role="alert">
                Questo prompt è per {state.roles?.find((role) => role.id === promptRole)?.name}.
                Seleziona o crea la sessione di quel reparto prima di inviarlo.
              </p>
            )}
            {!thread?.role && (
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
            )}
            {thread?.role && (
              <div className="role-binding">
                <strong>{selectedRole?.name || thread.label}</strong>
                <span>
                  {selectedRole?.skills
                    ? 'Pipeline: Discovery → Intelligence → Readiness'
                    : 'Skill collegata al ruolo'}{' '}
                  · per cambiare funzione seleziona un altro specialista.
                </span>
              </div>
            )}
            <button
              type="button"
              className="brief-shortcut"
              onClick={() => {
                setTab('brief');
                setChatExpanded(false);
              }}
            >
              Brief: {research.quality === 'selective' ? 'selettivo' : 'esplorativo'} ·{' '}
              {research.output === 'sheets'
                ? 'Google Sheet'
                : research.output === 'offline'
                  ? 'file locali'
                  : 'solo chat'}{' '}
              · modifica
            </button>
            <textarea
              aria-label="Messaggio a Codex"
              placeholder="Scrivi a Codex…"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setPromptRole(null);
              }}
              maxLength={16000}
            />
            <div className="actions">
              <button
                className="primary"
                disabled={
                  !state.connected ||
                  !thread?.loaded ||
                  busy ||
                  wrongRole ||
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
      <ApprovalCenter
        requests={state.approvals}
        threads={state.threads}
        busy={busy}
        error={error}
        respond={(request: Approval, payload) =>
          act(() => api('approval', { id: request.id, ...payload }))
        }
      />
    </div>
  );
}
