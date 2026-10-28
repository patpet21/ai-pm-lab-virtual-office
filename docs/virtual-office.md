# AI PM Lab Virtual Office

Command Center operativo basato sul Canvas, sui personaggi, sugli asset, sul layout e sull’editor originali di Pixel Agents. Il runtime browser usa esclusivamente il provider Codex locale; non importa `browserMock`, non genera agenti o risultati dimostrativi e non avvia la pipeline commerciale al caricamento.

## Avvio su Windows

Prerequisiti: Node.js 22, Codex CLI nel PATH e autenticazione Codex già effettuata dall’operatore. Versione verificata: `codex-cli 0.144.6`. Il servizio non legge né restituisce `auth.json`, non espone operazioni di login/logout e non modifica la configurazione globale.

Dal repository:

```powershell
npm ci
npm run build:webview
npm run office
```

Aprire `http://127.0.0.1:4318` e inserire il token stampato nel terminale. Il token è generato casualmente a ogni avvio e rimane solo nella memoria del browser. Il servizio avvia un proprio processo `codex app-server --listen stdio://`; Codex non apre un listener Internet.

Se il filtro TLS aziendale/AVG usa certificati già attendibili in Windows, per npm si può usare `$env:NODE_OPTIONS='--use-system-ca'`. Non disattivare la verifica TLS.

Creare una sessione con **+ Sessione**, scegliere eventualmente un modello restituito da `model/list`, quindi scrivere nella chat. Nel collaudo il modello globale `gpt-6.1-sol` era rifiutato dall’account CLI; il modello predefinito restituito da `model/list`, `gpt-5.6-sol`, ha completato le prove. La configurazione globale è rimasta invariata.

**Disconnetti browser** scollega la vista; per fermare un turno usare **Interrompi turno**. Chiudere il servizio con Ctrl+C termina esclusivamente il processo App Server avviato da questo servizio.

## Configurazione locale

Variabili lette dal servizio, mai incorporate nella build Vite:

| Variabile                        | Uso                                                                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `CODEX_BIN`                      | Percorso dell’eseguibile Codex, se non nel PATH.                                                                             |
| `CODEX_OFFICE_WORKSPACE`         | Cartella di lavoro delle nuove sessioni; predefinita la radice del repository.                                               |
| `CODEX_OFFICE_MODEL`             | Modello per nuove sessioni, validato contro `model/list`; la selezione esplicita nel browser prevale.                        |
| `CODEX_OFFICE_SANDBOX`           | `read-only` predefinito; `workspace-write` solo se impostato esplicitamente dall’operatore. Non viene abilitato full access. |
| `CODEX_OFFICE_ORIGINS`           | Origini HTTPS esatte autorizzate, separate da virgola, per esempio il proprio sito Netlify. Niente wildcard.                 |
| `CODEX_OFFICE_TOKEN`             | Token opzionale fornito dall’operatore, almeno 32 caratteri. Preferire quello casuale predefinito.                           |
| `GOOGLE_APPLICATION_CREDENTIALS` | Percorso locale di un file credenziali service account Google con accesso Viewer al Master Leads.                            |

La porta del frontend è fissata a **4318**. `CODEX_OFFICE_PORT` serve alle prove tecniche del bridge; una porta diversa richiede anche aggiornamento dell’endpoint frontend e della CSP. Nessuna variabile segreta deve avere prefisso `VITE_`.

## Sessioni ed eventi

`office/codex.mjs` implementa JSON-RPC bidirezionale JSONL, handshake `initialize` → `initialized`, correlazione delle risposte, timeout, richieste server e disconnessione. `office/server.mjs` espone una API ristretta, non un proxy JSON-RPC arbitrario.

Operazioni: creazione, ripresa, lettura storico delle sole sessioni create dall’ufficio; `turn/start`; `turn/interrupt`; risposte a richieste effettive di approvazione comandi/file e domande `item/tool/requestUserInput`. Richieste server sconosciute, elicitazioni MCP e permessi più ampi non implementati vengono rifiutati, senza autorizzazione implicita.

Il monitor conserva gli eventi ufficiali `turn/*`, `item/*` e gli altri eventi osservati delle sessioni dell’ufficio. Chat, comandi, `commandActions`, output, cambiamenti file, strumenti MCP, risultati ed errori sono consultabili dai payload effettivi. Un comando che non espone file consultati non viene trasformato in un elenco di file inventato. Gli eventi `office/*` sono metadati del bridge, distinguibili dagli eventi Codex.

Il browser legge aggiornamenti ogni circa 800 ms e passa il cursore e l’ID di avvio del servizio; il timeout del controllo di connessione è 5 secondi. Il personaggio lavora solo durante un turno osservato, si ferma quando serve approvazione e scompare alla disconnessione. Non esistono personaggi per sessioni non collegate o tre personaggi per una singola pipeline.

La lista delle sessioni dell’ufficio si trova in `.office/threads.json`; il registro in `.office/events.jsonl`. Questi file sono esclusi da Git, rimangono locali e contengono conversazioni e risultati reali: valgono le autorizzazioni del profilo Windows dell’operatore. La vista live mostra gli ultimi 1.000 eventi, il registro gli ultimi 2.000; lo storico completo dei turni rimane consultabile tramite `thread/read` e il registro integrale rimane sul disco. I registri non sono cifrati dall’app e non hanno cancellazione automatica.

Le chat Codex desktop e le sessioni di lead generation già in esecuzione non vengono elencate, riprese, interrotte o seguite mediante scansione di transcript. Dopo un riavvio del servizio, le sessioni dell’ufficio restano offline finché l’operatore sceglie **Ricollega**.

## Skill e postazioni

`skills/list` scopre le tre skill globali esistenti. Le skill e `C:\Users\pietr\.codex\AGENTS.md` non vengono installate, copiate o modificate. Le tre postazioni usano sedie reali dell’ufficio; l’editor mantiene il controllo dell’arredamento.

Il selettore aggiunge un input ufficiale `{type: "skill", name, path}` al prossimo turno. Questo indica una **richiesta**, non dimostra l’esecuzione. La fase osservata viene indicata dopo una lettura riuscita del file esatto della skill: azione ufficiale `read`, oppure un singolo comando Windows letterale `Get-Content` completato con exit code 0. Il secondo caso è un’interpretazione conservativa del comando osservato, esplicitamente etichettata `completed_literal_get_content`.

Questa evidenza dimostra la lettura delle istruzioni, non il completamento della funzione o delle sue sottofasi commerciali. Se il protocollo non offre evidenza sufficiente, si mostra **fase non osservata**. Un solo personaggio può spostarsi fra le tre postazioni; una postazione occupata non viene assegnata una seconda volta.

## Google Sheets, solo lettura

Unico workbook: [Master Leads esistente](https://docs.google.com/spreadsheets/d/1Uuho6icG-4qfnV3jRoTFwXNUoo4wwEgoLfwWuZMZTBk/edit).

L’adattatore diretto attualmente implementato supporta un eventuale service account **già** autorizzato come Viewer. È opzionale: non occorre crearne uno per completare il resto dell’applicazione. Solo se già disponibile, `GOOGLE_APPLICATION_CREDENTIALS` indica un file conservato fuori dal repository. Non inserire credenziali nei sorgenti, nella UI, in Netlify o nel browser. Il riuso del connettore Codex esistente viene verificato prima di proporre un’altra autenticazione.

Il codice usa lo scope `spreadsheets.readonly` e la sola operazione `values:batchGet`, con ID fisso e intervalli fissi `A1:AZ10000` per Companies, Contacts, Opportunities, Campaign Queue e Research Log. Non esistono route di scrittura Sheets. La dashboard indica intervalli e ora di lettura; la tabella visualizza le prime 300 righe filtrate. Nessun dato viene sostituito con righe locali o dati di esempio.

Durante lo sviluppo non erano presenti queste credenziali opzionali. Sono stati verificati stato **unavailable**, assenza di righe sostitutive e comportamento del browser; **Google Sheets Live non è ancora collaudato**. Non è stata fatta alcuna modifica al Master Leads. Il connettore Google già autorizzato nella chat/app Codex non è ancora stato riutilizzato dal processo locale dedicato.

### Connettore esistente e alternative con il proprio account

La diagnostica `node office/connector-check.mjs` ha inizializzato un processo App Server dedicato e una sessione propria in sola lettura, senza avviare turni o modificare configurazioni. Le richieste ufficiali `mcpServerStatus/list` e `app/list` sono entrambe andate in timeout a 30 secondi. Non è stato possibile ottenere l’inventario operativo, chiamare il tool Google o dimostrare il riuso dal backend. Un timeout non dimostra che il connettore sia impossibile da usare: resta una verifica aperta, distinta dal suo funzionamento nella chat Codex. Non sono stati letti, esportati o copiati token del connettore.

Percorsi possibili, senza creare altri account Google:

1. **Riuso del connettore Codex:** prima scelta se il processo dedicato riesce a esporlo tramite i metodi ufficiali. Il bridge dovrebbe consentire soltanto i tool di lettura del Master fisso. Al momento non è implementato un inoltro non verificato né una copia delle credenziali desktop.
2. **OAuth Desktop con il proprio account Google:** alternativa consigliata se serve un backend indipendente. Richiede un client OAuth Desktop in un progetto Google Cloud esistente o dedicato, una sola autorizzazione browser con scope `spreadsheets.readonly` e token conservati nel profilo locale, fuori da Git. Nessun service account e nessuna nuova identità Google. La procedura ufficiale è il [quickstart Node.js Google Sheets](https://developers.google.com/workspace/sheets/api/quickstart/nodejs). Il flusso OAuth di login non è ancora implementato in questa versione.
3. **Esportazione manuale tramite il collegamento già autorizzato:** possibile soluzione transitoria senza nuova autenticazione, da presentare soltanto come snapshot con data di esportazione, mai come Sheets Live. Non è stata effettuata un’esportazione automatica in questo sviluppo.

Google indica l’uso standard della Sheets API senza costo aggiuntivo, con quote e possibili cambiamenti ai costi degli eccessi: vedere [limiti e prezzi ufficiali](https://developers.google.com/workspace/sheets/api/limits). Non sono stati attivati servizi a pagamento, nuovi account, nuovi progetti Cloud o nuove credenziali.

## Netlify

`netlify.toml` imposta base radice, Node 22, comando `npm run build:webview` e publish **`dist/webview`**. Netlify ospita soltanto HTML, JavaScript e asset. Nessuna Netlify Function avvia Codex; nessuna credenziale è richiesta per la build.

Per usare il sito pubblico sullo stesso computer del servizio, aggiungere la sua origine esatta a `CODEX_OFFICE_ORIGINS` prima di avviare il bridge. CORS, controllo Host, token Bearer e header per le richieste di rete locale proteggono l’accesso. La CSP limita la connessione del frontend al servizio `http://127.0.0.1:4318`. Non aprire porte del router o tunnel.

Il browser può comunque bloccare HTTP loopback da una pagina HTTPS o richiedere un’autorizzazione di rete locale: in quel caso si mostra **Disconnected** e resta utilizzabile l’indirizzo locale. La build è stata verificata; **non è stato eseguito né verificato un deploy nell’account Netlify**. Nessun workflow GitHub Actions è stato eseguito per queste verifiche; il push è su branch dedicato e non apre una PR.

## Verifiche ripetibili

```powershell
npm run build
npm run test:office
npm run test:webview
npm run test:package-contract
npm run test:office:live
npm run test:office:protocol
npm run test:office:browser
```

Le ultime tre prove usano Codex reale e l’account già autenticato. Creano sessioni tecniche proprie, non eseguono la pipeline commerciale e non usano dati simulati. Il controllo browser usa Edge headless già installato. Le sessioni tecniche possono apparire nello storico Codex dell’account. Per gli esiti effettivi del 28 ottobre 2026 e i limiti della suite originale vedere [verifica](virtual-office-verification.md).

La documentazione ufficiale consultata è [Codex App Server](https://learn.chatgpt.com/docs/app-server); i contratti sono stati confrontati anche con `codex app-server generate-ts` della versione locale. OpenAI qualifica App Server come sperimentale: questa implementazione locale collaudata non costituisce una garanzia di compatibilità futura o di supporto di produzione del protocollo.
