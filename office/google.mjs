import { masterId, tabs } from './sheets.mjs';

// Fixed, read-only tools observed in official events from this office. No
// arbitrary MCP proxy, credentials, account changes, writes or model turn.
export function masterReader(provider, { cwd, model }) {
  let context;
  let reading;
  const call = async (tool, args, deadline) => {
    const remaining = () => Math.max(1, Math.min(30000, deadline - Date.now()));
    context ??= provider
      .request(
        'thread/start',
        {
          cwd,
          model,
          sandbox: 'read-only',
          approvalPolicy: 'on-request',
          developerInstructions:
            'Contesto tecnico in sola lettura del Master AI PM Lab. Nessuna ricerca, nessuna scrittura, nessun invio.',
        },
        remaining(),
      )
      .then((result) => result.thread.id)
      .catch((error) => {
        context = null;
        throw error;
      });
    const threadId = await context;
    if (Date.now() >= deadline) throw new Error('Timeout lettura Master');
    const result = await provider.request(
      'mcpServer/tool/call',
      {
        threadId,
        server: 'codex_apps',
        tool: `google_drive.${tool}`,
        arguments: { spreadsheet_id: masterId, ...args },
      },
      remaining(),
    );
    if (result.isError) throw new Error(`Google: ${tool} non riuscito`);
    if (!result.structuredContent)
      throw new Error(`Google: risposta strutturata assente (${tool})`);
    return result.structuredContent;
  };
  async function metadata(deadline) {
    const result = await call('get_spreadsheet_metadata', {}, deadline);
    if (result.spreadsheetId !== masterId) throw new Error('Master ID inatteso');
    const titles = result.sheets?.map((sheet) => sheet.properties?.title) || [];
    if (!tabs.every((tab) => titles.includes(tab))) throw new Error('Tab del Master mancanti');
    return result;
  }
  return {
    async check() {
      await metadata(Date.now() + 30000);
      return {
        state: 'Accesso Master verificato in lettura',
        checkedAt: new Date().toISOString(),
        details: [
          'Connettore Codex esistente, nessuna nuova credenziale.',
          'Scrittura non collaudata da questo controllo; nessun dato modificato.',
        ],
      };
    },
    read() {
      if (reading) return reading;
      reading = (async () => {
        const deadline = Date.now() + 55000;
        await metadata(deadline);
        const columns = {
          Companies: 'L',
          Contacts: 'J',
          Opportunities: 'T',
          'Campaign Queue': 'Q',
          'Research Log': 'M',
        };
        const values = await Promise.all(
          tabs.map(async (sheet_name) => {
            const result = await call(
              'get_spreadsheet_range',
              { sheet_name, range: `A1:${columns[sheet_name]}1000` },
              deadline,
            );
            if (!Array.isArray(result.values) || !result.values.every((row) => Array.isArray(row)))
              throw new Error(`Risposta righe non valida: ${sheet_name}`);
            return [sheet_name, result.values];
          }),
        );
        return {
          status: 'connected',
          source: 'codex_app_server_mcp_tool_call',
          masterId,
          readAt: new Date().toISOString(),
          rangeLimit: 'Prime 1000 righe, colonne dello schema delle cinque tab',
          reason:
            'Lettura live tramite connettore Codex autorizzato. Dashboard in sola lettura; scritture soltanto nei task autorizzati e con verifica.',
          tabs: Object.fromEntries(values),
        };
      })().finally(() => {
        reading = null;
      });
      return reading;
    },
  };
}
