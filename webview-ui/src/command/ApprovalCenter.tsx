import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { Approval, OfficeThread } from './client';

export function ApprovalCenter({
  requests,
  threads,
  busy,
  error,
  respond,
}: {
  requests: Approval[];
  threads: OfficeThread[];
  busy: boolean;
  error?: string;
  respond: (request: Approval, payload: Record<string, unknown>) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [minimized, setMinimized] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const request = requests[0];
  const key = request ? String(request.id) : '';
  const thread = threads.find((row) => row.id === request?.params.threadId);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (key && minimized !== key && !element.open) element.showModal();
    if ((!key || minimized === key) && element.open) element.close();
  }, [key, minimized]);
  useEffect(() => {
    const element = dialog.current;
    return () => {
      if (element?.open) element.close();
    };
  }, []);
  return createPortal(
    <div className="command-center approval-portal">
      {!!requests.length && (
        <button
          className="approval-alert"
          onClick={() => {
            setMinimized(null);
            if (dialog.current && !dialog.current.open) dialog.current.showModal();
          }}
        >
          <strong>
            {requests.length}{' '}
            {requests.length === 1 ? 'decisione richiesta' : 'decisioni richieste'}
          </strong>
          <span>{thread?.label || 'Codex'} · Apri permessi</span>
        </button>
      )}
      <dialog
        ref={dialog}
        className="approval-dialog"
        aria-labelledby="approval-title"
        onCancel={(event) => event.preventDefault()}
      >
        {request && (
          <section className="approval" key={key}>
            <header className="approval-heading">
              <div>
                <small>CODEX ATTENDE UNA TUA DECISIONE</small>
                <h2 id="approval-title">
                  {request.params.questions ? 'Risposta richiesta' : 'Permesso richiesto'}
                </h2>
              </div>
              <button
                onClick={() => {
                  setMinimized(key);
                  dialog.current?.close();
                }}
              >
                Riduci
              </button>
            </header>
            <p className="approval-session">
              {thread?.label || 'Codex'} · sessione {request.params.threadId} · {requests.length} in
              attesa
            </p>
            <div className="approval-content">
              {request.params.reason && (
                <div className="approval-reason">
                  <strong>Motivo della richiesta</strong>
                  <p>{request.params.reason}</p>
                </div>
              )}
              {request.params.command && (
                <div>
                  <strong>Comando proposto</strong>
                  <pre className="approval-command">{request.params.command}</pre>
                </div>
              )}
              {!request.params.questions && !request.params.command && (
                <p>
                  Codex richiede il permesso per una modifica ai file. Leggi il contesto e il
                  payload ufficiale.
                </p>
              )}
              {request.params.questions?.map((question) => (
                <fieldset key={question.id}>
                  <legend>{question.question}</legend>
                  {question.options?.map((option) => (
                    <button
                      className={answers[`${key}:${question.id}`] === option.label ? 'current' : ''}
                      key={option.label}
                      onClick={() =>
                        setAnswers((previous) => ({
                          ...previous,
                          [`${key}:${question.id}`]: option.label,
                        }))
                      }
                    >
                      <strong>{option.label}</strong>
                      <span>{option.description}</span>
                    </button>
                  ))}
                  <textarea
                    aria-label={question.question}
                    value={answers[`${key}:${question.id}`] || ''}
                    onChange={(event) =>
                      setAnswers((previous) => ({
                        ...previous,
                        [`${key}:${question.id}`]: event.target.value,
                      }))
                    }
                    placeholder="La tua risposta"
                  />
                </fieldset>
              ))}
              <details>
                <summary>Dettagli tecnici ufficiali · {request.method}</summary>
                <pre>{JSON.stringify(request.params, null, 2)}</pre>
              </details>
            </div>
            <footer className="approval-actions">
              <p>
                La richiesta resta in attesa finché scegli. Nessun permesso viene concesso
                automaticamente.
              </p>
              {error && (
                <p className="command-error" role="alert">
                  {error}
                </p>
              )}
              {request.params.questions ? (
                <button
                  className="primary"
                  disabled={
                    busy ||
                    request.params.questions.some(
                      (question) => !answers[`${key}:${question.id}`]?.trim(),
                    )
                  }
                  onClick={() =>
                    respond(request, {
                      answers: Object.fromEntries(
                        request.params.questions!.map((question) => [
                          question.id,
                          answers[`${key}:${question.id}`],
                        ]),
                      ),
                    })
                  }
                >
                  Invia risposta
                </button>
              ) : (
                <div className="actions">
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => respond(request, { decision: 'accept' })}
                  >
                    Approva questa richiesta
                  </button>
                  <button disabled={busy} onClick={() => respond(request, { decision: 'decline' })}>
                    Rifiuta
                  </button>
                  <button disabled={busy} onClick={() => respond(request, { decision: 'cancel' })}>
                    Annulla
                  </button>
                </div>
              )}
            </footer>
          </section>
        )}
      </dialog>
    </div>,
    document.body,
  );
}
