import { useEffect, useState } from 'react';
import { useJournalState, useOptionalData } from '../../data/DataProvider';
import { sq } from '../../strings/sq';

/** Online/offline state and the changes still waiting for the server. */
export function SyncIndicator() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const data = useOptionalData();
  const { pending } = useJournalState(data?.journal);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (!online) return <p className="sync-notice no-print" role="status" data-testid="sync-state">{sq.sync.offline(pending.length)}</p>;
  return (
    <span className="muted" data-testid="sync-state">
      ● {pending.length ? sq.sync.sending(pending.length) : sq.sync.online}
    </span>
  );
}

/** Writes the server refused; their content is kept until someone has dealt with them. */
export function RefusedWrites() {
  const data = useOptionalData();
  const { failed } = useJournalState(data?.journal);
  if (!data || !failed.length) return null;

  async function copy(content: unknown) {
    await navigator.clipboard.writeText(JSON.stringify(content, null, 2)).catch(() => undefined);
  }

  return (
    <section className="card warning no-print" role="alert" data-testid="refused-writes">
      <strong>{sq.sync.refusedTitle(failed.length)}</strong>
      <p className="muted">{sq.sync.refusedHint}</p>
      <ul>
        {failed.map(entry => (
          <li key={entry.id}>
            {entry.label} <span className="muted">({sq.sync.reason(entry.error ?? '')})</span>{' '}
            <button type="button" className="secondary" onClick={() => void copy(entry.content)}>{sq.sync.copy}</button>
            <button type="button" className="secondary" onClick={() => void data.journal.dismiss(entry.id)}>{sq.sync.dismiss}</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Tells the person what was recovered from the old app on this computer. */
export function RescueNotice() {
  const data = useOptionalData();
  const [hidden, setHidden] = useState(false);
  const rescue = data?.rescue;
  if (!rescue || hidden || rescue.status !== 'done' || (rescue.found === 0 && rescue.attachments === 0)) return null;
  return (
    <section className="card no-print" role="status" data-testid="rescue-notice">
      <strong>{rescue.found ? sq.rescue.title : sq.rescue.attachmentsTitle}</strong>
      <p>{sq.rescue.summary(rescue)}</p>
      <button type="button" className="secondary" onClick={() => setHidden(true)}>{sq.rescue.ok}</button>
    </section>
  );
}
