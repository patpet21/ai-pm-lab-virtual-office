import { CodexProvider } from './codex.mjs';

const provider = new CodexProvider({ cwd: process.cwd() });
try {
  await provider.initialize();
  const thread = await provider.request('thread/start', {
    cwd: process.cwd(),
    sandbox: 'read-only',
    approvalPolicy: 'on-request',
  });
  console.log(
    'PASS isolated App Server initialized; own read-only diagnostic thread, no turn started',
  );
  await Promise.all([
    provider
      .request('mcpServerStatus/list', {
        threadId: thread.thread.id,
        detail: 'toolsAndAuthOnly',
        limit: 100,
      })
      .then((inventory) => {
        console.log(
          'LOCAL_MCP_INVENTORY',
          JSON.stringify(
            inventory.data.map((server) => ({
              name: server.name,
              authStatus: server.authStatus,
              googleTools: Object.keys(server.tools).filter((name) =>
                /google.*drive|spreadsheet|sheets/i.test(name),
              ),
              toolCount: Object.keys(server.tools).length,
            })),
          ),
        );
        console.log('MCP_NEXT_CURSOR', inventory.nextCursor);
      })
      .catch((error) => console.log('LOCAL_MCP_DISCOVERY_UNAVAILABLE', error.message)),
    provider
      .request('app/list', { threadId: thread.thread.id, limit: 100 })
      .then((apps) => {
        console.log(
          'LOCAL_GOOGLE_APPS',
          JSON.stringify(
            apps.data
              .filter((app) => /google|drive|sheets/i.test(app.name))
              .map((app) => ({
                name: app.name,
                isAccessible: app.isAccessible,
                isEnabled: app.isEnabled,
              })),
          ),
        );
        console.log('APP_NEXT_CURSOR', apps.nextCursor);
      })
      .catch((error) => console.log('LOCAL_APP_DISCOVERY_UNAVAILABLE', error.message)),
  ]);
} finally {
  await provider.close();
}
