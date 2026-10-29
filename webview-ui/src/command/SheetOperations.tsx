import type { OfficeEvent } from './client';

const masterId = '1Uuho6icG-4qfnV3jRoTFwXNUoo4wwEgoLfwWuZMZTBk';
export function SheetOperations({
  events,
  threadId,
}: {
  events: OfficeEvent[];
  threadId?: string;
}) {
  const operations = events
    .filter(
      (event) =>
        event.method === 'item/completed' && (!threadId || event.params.threadId === threadId),
    )
    .flatMap((event) => {
      const item = event.params.item as
        | {
            type?: string;
            tool?: string;
            status?: string;
            error?: unknown;
            arguments?: Record<string, unknown>;
          }
        | undefined;
      if (
        item?.type !== 'mcpToolCall' ||
        !item.tool?.startsWith('google_drive.') ||
        item.arguments?.spreadsheet_id !== masterId
      )
        return [];
      return [{ event, item }];
    })
    .reverse();
  return (
    <section className="sheet-operations" aria-label="Operazioni Google osservate">
      <h3>Operazioni reali sul Master</h3>
      <p className="muted">
        Eventi della sessione selezionata nella finestra live. Una chiamata di scrittura riuscita
        non certifica da sola la verifica delle celle.
      </p>
      {!operations.length && (
        <p>
          Nessuna chiamata Google osservata nella finestra corrente. Consulta lo storico per le
          esecuzioni precedenti.
        </p>
      )}
      {operations.slice(0, 30).map(({ event, item }) => (
        <details key={event.seq}>
          <summary>
            <time>{new Date(event.at).toLocaleTimeString('it-IT')}</time>
            <strong>{item.tool?.includes('batch_update') ? 'Scrittura' : 'Lettura'}</strong> ·{' '}
            {String(item.arguments?.sheet_name || 'Master')} {String(item.arguments?.range || '')} ·{' '}
            {item.error || item.status === 'failed' ? 'Errore' : item.status}
          </summary>
          <pre>{JSON.stringify(event.params, null, 2)}</pre>
        </details>
      ))}
    </section>
  );
}
