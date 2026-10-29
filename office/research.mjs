export function researchBrief(value = {}) {
  const count = value.count ?? 10;
  const cap = value.cap ?? 60;
  const quality = value.quality ?? 'selective';
  const output = value.output ?? 'sheets';
  if (!Number.isInteger(count) || count < 1 || count > 30)
    throw new Error('Target aziende: da 1 a 30');
  if (!Number.isInteger(cap) || cap < count || cap > 100)
    throw new Error('Limite candidati: dal target fino a 100');
  if (
    !['selective', 'exploratory'].includes(quality) ||
    !['sheets', 'offline', 'chat'].includes(output)
  )
    throw new Error('Modalità ricerca non valida');
  const text = (key, fallback) => {
    const result = value[key] ?? fallback;
    if (typeof result !== 'string' || result.length > 500)
      throw new Error('Brief non valido: ' + key);
    return result;
  };
  return {
    count,
    cap,
    quality,
    output,
    area: text('area', 'NYC: Queens e Brooklyn'),
    sectors: text(
      'sectors',
      'Property manager indipendenti, contractor locali e piccoli studi di progettazione',
    ),
    exclusions: text(
      'exclusions',
      'Lead broker, conglomerati, franchising senza autonomia locale e aziende già presenti o soppresse',
    ),
  };
}

export function researchInstructions(input) {
  const brief = researchBrief(input);
  return (
    `\nImpostazioni operative dell'operatore (applicale soltanto a incarichi di ricerca/qualificazione, non a domande tecniche): ${JSON.stringify(brief)}.\n` +
    `La quantità è un obiettivo, non una quota da riempire. Preferisci meno lead pertinenti e documentati a una lista di soli indirizzi email. Riporta candidati scartati e motivo. Per ogni azienda distingui identità/località, pubblicazione del contatto, segnali operativi datati e possibile incarico circoscritto. Non inventare dimensioni, problemi, budget o probabilità d'acquisto. Non usare un portfolio storico come prova di carico attuale.\n` +
    (brief.quality === 'selective'
      ? `Profilo selettivo: cerca realtà indipendenti compatibili con una consulenza circoscritta; se la dimensione non è pubblica, dichiarala ignota. Nella Skill 2 usa i pesi ufficiali senza gonfiare i componenti: ogni punto positivo deve avere evidenza del criterio, zero se assente. Se manca evidenza di fattibilità di un primo incarico (project_feasibility_score=0), raccomanda research_more e non un passaggio automatico alla Skill 3. Non creare righe Campaign Queue solo per raggiungere il target; indica quali aziende restano da approfondire. Non cambiare retroattivamente le righe esistenti senza una richiesta di revisione.\n`
      : `Profilo esplorativo: raccogli identità e contatti attendibili, lasciando espliciti i limiti di qualificazione; un contatto pubblicato non prova un'opportunità commerciale.\n`) +
    (brief.output === 'sheets'
      ? `Destinazione: Master Google Sheet, chat solo riepilogo. Prima della ricerca controlla il connettore reale della sessione e leggi il Master live per dedupe/soppressioni. Se non accessibile, fermati PRIMA di cercare nuove aziende e segnala il blocco; non trasformare automaticamente l'incarico in ricerca offline. Per aggiornamenti autorizzati usa il connettore, verifica le righe dopo scrittura e riporta intervalli, conteggi e ID del run. Non dichiarare synced da un CSV o da una tua affermazione.\n`
      : brief.output === 'offline'
        ? `Destinazione scelta esplicitamente: staging locale in .office/prospecting/. Mantieni pending_sync e non scrivere sul Master; lo snapshot non garantisce dedupe live. Chat solo riepilogo dei file reali.\n`
        : `Destinazione scelta: sola consultazione in chat. Non eseguire scritture sul Master o modificare liste commerciali per questo incarico.\n`)
  );
}
