import type { ResearchSettings } from './researchSettings';

export function ResearchBrief({
  value,
  change,
  disabled,
}: {
  value: ResearchSettings;
  change: (value: ResearchSettings) => void;
  disabled: boolean;
}) {
  return (
    <div className="research-brief">
      <div className="panel-heading">
        <h2>Brief di ricerca</h2>
        <span>Applicato al prossimo incarico</span>
      </div>
      <p>
        Definisci il cliente che cerchi prima di inviare il messaggio. Il target non obbliga Codex a
        riempire la lista con aziende poco pertinenti.
      </p>
      <fieldset disabled={disabled}>
        <div className="brief-grid">
          <label>
            Obiettivo aziende
            <input
              type="number"
              min={1}
              max={30}
              value={value.count}
              onChange={(event) => change({ ...value, count: Number(event.target.value) })}
            />
          </label>
          <label>
            Massimo candidati da esaminare
            <input
              type="number"
              min={value.count}
              max={100}
              value={value.cap}
              onChange={(event) => change({ ...value, cap: Number(event.target.value) })}
            />
          </label>
          <label>
            Area geografica
            <input
              maxLength={500}
              value={value.area}
              onChange={(event) => change({ ...value, area: event.target.value })}
            />
          </label>
          <label>
            Profilo di qualificazione
            <select
              value={value.quality}
              onChange={(event) =>
                change({ ...value, quality: event.target.value as ResearchSettings['quality'] })
              }
            >
              <option value="selective">Selettivo · evidenze e primo incarico</option>
              <option value="exploratory">Esplorativo · aziende e contatti</option>
            </select>
          </label>
        </div>
        <label>
          Settori e tipo di cliente
          <textarea
            maxLength={500}
            value={value.sectors}
            onChange={(event) => change({ ...value, sectors: event.target.value })}
          />
        </label>
        <label>
          Esclusioni
          <textarea
            maxLength={500}
            value={value.exclusions}
            onChange={(event) => change({ ...value, exclusions: event.target.value })}
          />
        </label>
        <label>
          Destinazione risultati
          <select
            aria-label="Destinazione risultati"
            value={value.output}
            onChange={(event) =>
              change({ ...value, output: event.target.value as ResearchSettings['output'] })
            }
          >
            <option value="sheets">Google Sheet · verifica live prima della ricerca</option>
            <option value="offline">Staging locale · pending_sync esplicito</option>
            <option value="chat">Solo consultazione in chat</option>
          </select>
        </label>
      </fieldset>
      <p className="destination-note">
        {value.output === 'sheets'
          ? 'Prima di ricercare, Codex deve leggere il Master nella propria sessione. Se il collegamento manca, deve fermarsi. Uno snapshot non abilita dedupe o scritture; la chat deve contenere il riepilogo e la verifica delle righe.'
          : value.output === 'offline'
            ? 'Hai scelto file locali: nessuna scrittura sul Master. I risultati restano pending_sync finché non viene eseguita e verificata una sincronizzazione autorizzata.'
            : 'Consultazione: nessuna modifica alle liste o al Master.'}
      </p>
      <p className="muted">
        Queste sono istruzioni operative per Codex; non sono una certificazione automatica delle
        fonti. Le skill globali e i dati esistenti restano invariati.
      </p>
    </div>
  );
}

export function ResearchAudit({ tabs }: { tabs: Record<string, string[][]> }) {
  const records = (name: string) => {
    const [header, ...rows] = tabs[name] || [];
    return rows
      .filter((row) => row.some(Boolean))
      .map((row) =>
        Object.fromEntries((header || []).map((key, index) => [key, row[index] || ''])),
      );
  };
  const opportunities = records('Opportunities');
  const queue = records('Campaign Queue');
  const weak = opportunities.filter(
    (row) => !row.project_feasibility_score?.trim() || Number(row.project_feasibility_score) === 0,
  );
  const missingSources = opportunities.filter(
    (row) => !row.source_urls?.trim() || !row.verified_signals?.trim(),
  );
  const incomplete = queue.filter(
    (row) => !row.template_id?.trim() || !row.landing_page_url?.trim(),
  );
  if (!opportunities.length && !queue.length) return null;
  return (
    <section className="research-audit" aria-label="Controlli qualità dei dati caricati">
      <h3>Da approfondire nei dati caricati</h3>
      <div className="audit-counts">
        <span>
          <strong>
            {weak.length}/{opportunities.length}
          </strong>{' '}
          opportunità senza punteggio positivo per un primo incarico
        </span>
        <span>
          <strong>{missingSources.length}</strong> opportunità con fonti o segnali mancanti
        </span>
        <span>
          <strong>
            {incomplete.length}/{queue.length}
          </strong>{' '}
          righe coda con template o landing non configurati
        </span>
      </div>
      {!!weak.length && (
        <details>
          <summary>Aziende da approfondire</summary>
          <ul>
            {weak.map((row) => (
              <li key={row.opportunity_id}>
                {row.company_name || row.company_id} · score {row.fit_score || 'assente'} · stato
                registrato: {row.analysis_status || 'assente'}
              </li>
            ))}
          </ul>
        </details>
      )}
      <small>
        Controllo strutturale dei valori caricati, non nuova verifica delle fonti. Gli score e gli
        stati nel Master non vengono modificati. Nel profilo selettivo richiedi ulteriori evidenze
        prima del passaggio alla coda.
      </small>
    </section>
  );
}
