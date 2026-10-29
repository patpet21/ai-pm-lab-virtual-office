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

Aprire `http://127.0.0.1:4318` e inserire il token stampato nel terminale. Il token è generato casualmente a ogni avvio e rimane solo nella memoria del browser. Il servizio avvia un proprio processo `codex app-server --listen stdio:// --enable apps`; l’abilitazione apps vale solo per questo processo, senza modificare la configurazione globale. Codex non apre un listener Internet.

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

Il frontend Netlify e Vite contatta **4318**. Se servito direttamente da `127.0.0.1`, usa l’origine locale corrente, anche su una porta tecnica diversa. La CSP Netlify resta limitata a 4318. Nessuna variabile segreta deve avere prefisso `VITE_`.

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

### Agenti separati e agenzia

Il pannello **Agenzia e agenti** distingue il ruolo assegnato dalla fase realmente osservata. Ogni reparto espone descrizione, prompt leggibile/modificabile, sessioni, incarico, stato e ultimo evento osservato. Selezionare una sessione apre la sua chat; **+ Codex** nell’ufficio apre il pannello dell’agenzia.

- **Crea specialista:** crea una sessione reale dedicata al ruolo selezionato e carica un prompt d’esempio. Il lavoro inizia solo con **Invia a Codex**.
- **Crea team di 3 sessioni reali:** crea tre thread distinti Discovery, Intelligence e Campaign Readiness, associati allo stesso team. Gli incarichi indipendenti possono essere avviati separatamente; l’animazione resta idle fino a eventi reali di turno.
- **Passa risultato e avvia reparto:** dopo un turno completato, legge il risultato finale effettivo con `thread/read`, ne conserva thread/turno di provenienza e lo invia al reparto successivo. Sono ammessi solo Discovery → Intelligence → Readiness. Risultati mancanti, turni falliti o trasferimenti duplicati vengono respinti; ID e sync devono essere verificati sul Master prima di procedere. Il passaggio è esplicito, non uno scheduler o un follow-up.
- **Crea coordinatore:** crea una sola sessione con le tre skill, chiedendo la pipeline sequenziale con gli stessi company_id. La UI mostra un solo personaggio, non tre agenti indipendenti inventati.

I permessi delle nuove sessioni sono selezionabili: **Sola lettura** oppure **Operativo: scrittura nel workspace**. Nessun full access e nessuna modifica dei permessi globali. Gli aggiornamenti del Master richiesti dall’operatore sono consentiti solo entro le regole delle skill, con dedupe, soppressioni e verifica dopo scrittura; non rimane un divieto generico che bloccava anche le operazioni autorizzate dopo lo sviluppo.

### Permessi, chat e qualità della ricerca

Le richieste effettive aprono un dialogo nativo centrale, largo fino a 900 px e adattato al telefono. Mostra sessione, motivo, comando e payload ufficiale; i pulsanti restano separati dal contenuto scorrevole. **Riduci** lascia la richiesta pendente e mostra un richiamo fisso; Esc non concede permessi. I permessi non dipendono dalla visibilità del personaggio. Il controllo reale ha esercitato il rifiuto di un comando di sola lettura, non una scrittura approvata.

**Espandi chat** offre una vista dedicata. Modello e permessi delle nuove sessioni sono in un gruppo richiudibile. Negli specialisti la skill è vincolata al ruolo anche sul backend: una sessione Discovery non può ereditare accidentalmente il selettore Campaign. Il coordinatore mantiene le tre skill in ordine. Lo storico dei turni completati prevale sugli eventi streaming dello stesso turno anche quando App Server normalizza gli ID degli item.

**Brief e qualità** configura target, massimo candidati, area, settori, esclusioni, profilo selettivo/esplorativo e destinazione. I prompt d’esempio usano questo brief. La destinazione predefinita è il Master: prima della ricerca, le istruzioni chiedono lettura live per dedupe/soppressioni e arresto se il collegamento manca. Lo staging locale è una scelta esplicita con `pending_sync`; la consultazione in chat esclude scritture. Il brief viene inviato realmente nel turno, registrato localmente e trasmesso nell’handoff.

Il profilo selettivo richiede evidenze specifiche, scarti motivati e raccomanda ulteriore ricerca prima della coda se manca evidenza di un primo incarico circoscritto. Non modifica skill globali, pesi ufficiali o score storici. Queste sono istruzioni al modello, non una garanzia di qualità: non è stata lanciata una nuova ricerca commerciale durante questo aggiornamento. Il controllo nella dashboard è strutturale, basato sui valori caricati, e non certifica le fonti.

## Google Sheets, solo lettura

Unico workbook: [Master Leads esistente](https://docs.google.com/spreadsheets/d/1Uuho6icG-4qfnV3jRoTFwXNUoo4wwEgoLfwWuZMZTBk/edit).

Il percorso principale riusa il **connettore Codex già autorizzato**, attraverso il metodo ufficiale `mcpServer/tool/call`, server `codex_apps`, tool `google_drive.get_spreadsheet_metadata` e `google_drive.get_spreadsheet_range`. I nomi sono stati prima osservati negli eventi reali delle sessioni dell’ufficio e poi collaudati direttamente. Nessun nuovo account, login, client OAuth o file credenziali è necessario nell’ambiente verificato.

`office/google.mjs` crea un contesto tecnico proprio in sola lettura, senza avviare un turno del modello o un personaggio lavorativo. Verifica il Master e legge le cinque tab, con ID e intervalli fissi (prime 1000 righe, colonne dello schema). Il browser riceve soltanto i dati, mai credenziali o token Google. L’API locale non è un proxy MCP arbitrario e non espone scritture, login o operazioni amministrative. La tabella mostra le prime 300 righe filtrate. La prova reale del 29 ottobre ha letto **25 Companies, 25 Contacts, 10 Opportunities, 10 Campaign Queue e 2 Research Log** tramite l’API locale e il browser.

Le scritture dei task autorizzati rimangono operazioni di Codex, soggette a rilettura, dedupe, soppressioni e verifica dopo scrittura. La chat è il riepilogo, non il deposito sostitutivo. In **Attività e dettagli**, il riquadro **Operazioni reali sul Master** distingue le chiamate Google di lettura/scrittura effettivamente osservate. Una chiamata riuscita non viene automaticamente etichettata `synced`: serve verifica delle celle. Nei registri storici dell’ufficio sono presenti chiamate di scrittura e successive letture del Master; questo aggiornamento ha eseguito soltanto letture, senza ripetere scritture di prova sui dati reali.

Ogni lettura live riuscita aggiorna la copia privata `.office/master-snapshot.json`, esclusa da Git. Se il collegamento fallisce, viene mostrato l’errore e l’eventuale copia con **Snapshot verificato — non Live** e data. Senza accesso o snapshot lo stato è `unavailable`, senza righe sostitutive. Lo snapshot non abilita dedupe o scritture. Il contenuto privato non è incluso nella build Netlify. Rimane un adattatore opzionale per un service account Viewer già esistente (`GOOGLE_APPLICATION_CREDENTIALS`), non richiesto dal percorso Codex e non collaudato con credenziali reali.

### Connettore esistente e alternative con il proprio account

La diagnostica iniziale con `app/list` e `mcpServerStatus/list` è andata in timeout, anche con apps abilitate per il solo processo. **Non era una prova dell’assenza di accesso Google**: la chiamata diretta, con i tool identificati dagli eventi reali, ha poi funzionato. **Verifica connettori locali** controlla ora la lettura dei metadati del Master stesso, senza dedurla da un inventario o dal testo del modello. `node office/google-live-check.mjs` collauda l’API locale e tutte le cinque tab. Nessun token del connettore viene letto, esportato o copiato.

Percorsi possibili, senza creare altri account Google:

1. **Riuso del connettore Codex:** percorso implementato e verificato in lettura nell’ambiente locale; nessuna nuova autenticazione richiesta.
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
npm run test:office:agency
node office/google-live-check.mjs
```

Le prove live, protocol, browser, agency e Google usano Codex reale e l’account già autenticato. Creano sessioni tecniche proprie, non eseguono la pipeline commerciale e non usano dati simulati. Le prove aggiornate browser/agency/Google richiedono l’accesso autorizzato al Master e non lo modificano; lo snapshot dell’operatore non viene copiato nei dati dei test. Il browser usa Edge headless già installato. Le sessioni tecniche possono apparire nello storico Codex dell’account. Le porte tecniche sono separate da 4318. Per gli esiti effettivi e i limiti della suite originale vedere [verifica](virtual-office-verification.md).

La documentazione ufficiale consultata è [Codex App Server](https://learn.chatgpt.com/docs/app-server); i contratti sono stati confrontati anche con `codex app-server generate-ts` della versione locale. OpenAI qualifica App Server come sperimentale: questa implementazione locale collaudata non costituisce una garanzia di compatibilità futura o di supporto di produzione del protocollo.
