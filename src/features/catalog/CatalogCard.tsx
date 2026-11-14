// «Analizat dhe vlerat referente»: the laboratory edits the analysis list on a draft, sees
// every change before saving, and saves it as one new revision with a change-log entry.

import { useEffect, useMemo, useState } from 'react';
import { useData } from '../../data/DataProvider';
import { CatalogConflictError, saveCatalog } from '../../data/catalog';
import { errorCode } from '../../data/journal';
import type { CatalogCategory } from '../../data/schemas';
import { diffCatalog, legacyGroupLabel, normalizeCategories, validateCatalog } from '../../domain/catalog';
import { referenceSupportsFlag } from '../../domain/reference';
import { formatDateTime, textRows, toText } from '../../domain/text';
import { useWorkspace } from '../workspace/Workspace';

type Analysis = CatalogCategory['analyses'][number];

function categoryLabel(category: CatalogCategory): string {
  return `${category.name || '(pa emër)'}${category.active ? '' : ' — e fshehur'} (${category.analyses.length})`;
}

export function CatalogCard() {
  const { ctx } = useData();
  const { data, say } = useWorkspace();
  const stored = data.storedCatalog;
  const storedRevision = stored?.revision ?? 0;
  const [draft, setDraft] = useState<CatalogCategory[] | null>(null);
  const [base, setBase] = useState<{ revision: number; categories: CatalogCategory[] } | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  const view = draft ?? data.categories;
  const changes = useMemo(() => (draft && base ? diffCatalog(base, { categories: draft }) : []), [draft, base]);
  const stale = Boolean(draft && base && base.revision !== storedRevision);
  const selected = view.find(category => category.id === selectedId) ?? view[0];
  const baseIds = useMemo(() => new Set((base?.categories ?? data.categories).flatMap(c => c.analyses.map(a => a.id))), [base, data.categories]);

  // Leaving the page with unsaved changes asks first.
  useEffect(() => {
    if (!changes.length) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changes.length]);

  /** Applies an edit to a copy of the draft, starting the draft on first edit. */
  function edit(change: (categories: CatalogCategory[]) => void) {
    const working = structuredClone(draft ?? data.categories);
    if (!draft) setBase({ revision: storedRevision, categories: data.categories });
    change(working);
    setDraft(working);
  }

  function editAnalysis(id: string, change: (analysis: Analysis, category: CatalogCategory, index: number, all: CatalogCategory[]) => void) {
    edit(all => {
      for (const category of all) {
        const index = category.analyses.findIndex(analysis => analysis.id === id);
        if (index >= 0) {
          change(category.analyses[index]!, category, index, all);
          return;
        }
      }
    });
  }

  function editCategory(change: (category: CatalogCategory, all: CatalogCategory[]) => void) {
    if (!selected) return;
    edit(all => {
      const category = all.find(item => item.id === selected.id);
      if (category) change(category, all);
    });
  }

  function addCategory() {
    const name = String(window.prompt('Emri i kategorisë së re:') ?? '').trim();
    if (!name) return;
    if (view.some(category => category.name.trim().toLocaleLowerCase('sq') === name.toLocaleLowerCase('sq'))) {
      say(`Kategoria «${name}» ekziston.`, true);
      return;
    }
    const legacy = legacyGroupLabel(name);
    const category: CatalogCategory = { id: crypto.randomUUID(), name, printGroup: legacy === 'Analiza të tjera' ? name : legacy, bulkAdd: false, active: true, analyses: [] };
    edit(all => { all.push(category); });
    setSelectedId(category.id);
    setSearch('');
    say(`Kategoria «${name}» u shtua. Shto analizat dhe pastaj ruaj ndryshimet.`);
  }

  function addAnalysis() {
    if (!selected) {
      say('Zgjidh fillimisht kategorinë.', true);
      return;
    }
    editCategory(category => { category.analyses.push({ id: crypto.randomUUID(), name: '', unit: '', reference: '', active: true }); });
    setSearch('');
  }

  function discard() {
    if (changes.length && !window.confirm('Të anulohen të gjitha ndryshimet e paruajtura te lista e analizave?')) return;
    setDraft(null);
    setBase(null);
    setNotice(null);
    say('Ndryshimet e paruajtura u anuluan.');
  }

  async function save() {
    if (!draft || !base || saving) return;
    const categories = normalizeCategories(draft);
    const errors = validateCatalog({ categories });
    if (errors.length) {
      setNotice({ text: errors.slice(0, 4).join(' '), error: true });
      say('Lista nuk u ruajt. Rregullo gabimet e shënuara.', true);
      return;
    }
    const diff = diffCatalog(base, { categories });
    if (!diff.length) {
      setDraft(null);
      setBase(null);
      say('Nuk ka ndryshime për t’u ruajtur.');
      return;
    }
    setSaving(true);
    try {
      const saved = await saveCatalog(ctx, categories, base.revision, diff);
      setDraft(null);
      setBase(null);
      setNotice(null);
      say(`Lista e analizave u ruajt (versioni ${saved.revision}, ${diff.length} ndryshime). Vlen për analizat që shtohen tani e tutje.`);
    } catch (error) {
      console.error(error);
      const code = errorCode(error);
      setNotice({
        error: true,
        text: error instanceof CatalogConflictError
          ? 'Lista u ndryshua në një pajisje tjetër ndërkohë. Ndryshimet tuaja nuk u ruajtën: kliko «Anulo ndryshimet» dhe bëji përsëri mbi versionin e ri.'
          : ['unavailable', 'failed-precondition', 'deadline-exceeded'].includes(code)
            ? 'Nuk ka lidhje me internetin. Lista ruhet vetëm me lidhje; provo përsëri kur të ketë internet.'
            : 'Lista nuk u ruajt. Provo përsëri.'
      });
      say('Lista e analizave nuk u ruajt.', true);
    } finally {
      setSaving(false);
    }
  }

  const term = search.trim().toLocaleLowerCase('sq');
  const rows = term
    ? view.flatMap(category => category.analyses.filter(a => a.name.toLocaleLowerCase('sq').includes(term)).map(analysis => ({ category, analysis })))
    : (selected?.analyses ?? []).map(analysis => ({ category: selected!, analysis }));

  return (
    <section className="card no-print" data-testid="catalog-card">
      <h2>Analizat dhe vlerat referente</h2>
      <p className="muted">
        Këtu ndryshohen emrat, njësitë dhe vlerat referente të analizave, p.sh. kur ndërrohen reagensët. Ndryshimet vlejnë për analizat që shtohen
        në raporte pasi të ruhen; raportet ekzistuese nuk ndryshojnë.
      </p>
      <p className="muted">
        {stored
          ? `Versioni ${stored.revision} · ruajtur më ${formatDateTime(stored.updatedAt)}${stored.updatedBy ? ` nga ${stored.updatedBy}` : ''}.`
          : 'Lista fillestare ende nuk është ruajtur në databazë; ruhet automatikisht kur laboratori është në linjë.'}
      </p>
      {stale && (
        <div className="sync-notice local" role="alert">
          Lista u ndryshua në një pajisje tjetër (versioni {storedRevision}). Ndryshimet tuaja të paruajtura nuk mund të ruhen mbi të: kliko «Anulo ndryshimet» dhe bëji përsëri.
        </div>
      )}
      <details>
        <summary>Hap listën e analizave</summary>
        <div className="row" style={{ marginTop: 12 }}>
          <label className="grow">
            Kategoria
            <select value={selected?.id ?? ''} onChange={event => setSelectedId(event.target.value)}>
              {view.map(category => <option key={category.id} value={category.id}>{categoryLabel(category)}</option>)}
            </select>
          </label>
          <label className="grow">Kërko në të gjitha kategoritë<input type="search" placeholder="p.sh. TSH ose Glukoza" value={search} onChange={event => setSearch(event.target.value)} /></label>
        </div>
        {selected && (
          <details style={{ marginTop: 10 }}>
            <summary>Cilësimet e kategorisë</summary>
            <div className="grid" style={{ marginTop: 10 }}>
              <label>Emri i kategorisë<input value={selected.name} onChange={event => editCategory(c => { c.name = event.target.value; })} /></label>
              <label>Titulli në raportin e printuar<input placeholder="p.sh. Analizat Biokimike" value={selected.printGroup} onChange={event => editCategory(c => { c.printGroup = event.target.value; })} /></label>
            </div>
            <div className="row">
              <label className="inline-check"><input type="checkbox" checked={selected.active} onChange={event => editCategory(c => { c.active = event.target.checked; })} />Shfaqe në listën e analizave</label>
              <label className="inline-check"><input type="checkbox" checked={selected.bulkAdd} onChange={event => editCategory(c => { c.bulkAdd = event.target.checked; })} />Butoni «Shto të gjitha»</label>
            </div>
            <div className="row">
              <button type="button" className="secondary" onClick={() => editCategory((c, all) => { const i = all.indexOf(c); if (i > 0) [all[i - 1], all[i]] = [c, all[i - 1]!]; })}>↑ Lëvize lart</button>
              <button type="button" className="secondary" onClick={() => editCategory((c, all) => { const i = all.indexOf(c); if (i < all.length - 1) [all[i + 1], all[i]] = [c, all[i + 1]!]; })}>↓ Lëvize poshtë</button>
              <button type="button" className="secondary" onClick={addCategory}>+ Kategori e re</button>
            </div>
          </details>
        )}
        <div className="table-scroll">
          <table className="catalog-table">
            <thead><tr><th>Analiza</th><th>Njësia</th><th>Vlera referente</th><th>Shënjimi H/L</th><th>Kategoria</th><th>Në listë</th><th>Renditja</th></tr></thead>
            <tbody>
              {!rows.length && <tr><td colSpan={7} className="muted">{term ? 'Asnjë analizë nuk përputhet me kërkimin.' : 'Kjo kategori nuk ka ende analiza.'}</td></tr>}
              {rows.map(({ category, analysis }, index) => (
                <tr key={analysis.id} className={analysis.active ? undefined : 'catalog-inactive'}>
                  <td><input aria-label="Emri i analizës" placeholder="Emri i analizës" value={analysis.name} onChange={event => editAnalysis(analysis.id, a => { a.name = event.target.value; })} /></td>
                  <td><input aria-label="Njësia" placeholder="p.sh. mmol/L" value={analysis.unit} onChange={event => editAnalysis(analysis.id, a => { a.unit = event.target.value; })} /></td>
                  <td><textarea aria-label="Vlera referente" placeholder="p.sh. 3.3 - 6.1" rows={textRows(analysis.reference)} value={analysis.reference} onChange={event => editAnalysis(analysis.id, a => { a.reference = event.target.value; })} /></td>
                  <td>{referenceSupportsFlag(analysis.reference)
                    ? <span className="flag-auto" title="Rezultati shënohet automatikisht H (i lartë) ose L (i ulët)">Automatik</span>
                    : <span className="muted" title="Kjo vlerë printohet ashtu siç është shkruar, pa shënjim automatik H/L">—</span>}</td>
                  <td>
                    <select aria-label="Kategoria" value={category.id} onChange={event => editAnalysis(analysis.id, (a, from, i, all) => {
                      const target = all.find(c => c.id === event.target.value);
                      if (!target || target === from) return;
                      from.analyses.splice(i, 1);
                      target.analyses.push(a);
                    })}>
                      {view.map(c => <option key={c.id} value={c.id}>{c.name || '(pa emër)'}</option>)}
                    </select>
                  </td>
                  <td><input type="checkbox" aria-label="Shfaqet në listën e analizave" checked={analysis.active} onChange={event => editAnalysis(analysis.id, a => { a.active = event.target.checked; })} /></td>
                  <td className="nowrap">
                    {!term && (
                      <>
                        <button type="button" className="secondary" title="Lëvize lart" disabled={index === 0}
                          onClick={() => editAnalysis(analysis.id, (a, c, i) => { [c.analyses[i - 1], c.analyses[i]] = [a, c.analyses[i - 1]!]; })}>↑</button>
                        <button type="button" className="secondary" title="Lëvize poshtë" disabled={index === rows.length - 1}
                          onClick={() => editAnalysis(analysis.id, (a, c, i) => { [c.analyses[i + 1], c.analyses[i]] = [a, c.analyses[i + 1]!]; })}>↓</button>
                      </>
                    )}
                    {!baseIds.has(analysis.id) && (
                      <button type="button" className="danger" title="Hiqe analizën e re" onClick={() => editAnalysis(analysis.id, (_a, c, i) => { c.analyses.splice(i, 1); })}>Hiq</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {notice && <div className={`sync-notice${notice.error ? ' local' : ''}`} role="alert" style={{ marginTop: 10 }}>{notice.text}</div>}
        <div className="row">
          <button type="button" className="secondary" onClick={addAnalysis}>+ Analizë e re në këtë kategori</button>
          <span className="grow" />
          <span className="muted" data-testid="catalog-dirty">{saving ? 'Duke ruajtur…' : changes.length ? `${changes.length} ndryshime të paruajtura` : ''}</span>
          <button type="button" className="secondary" disabled={saving || !draft} onClick={discard}>Anulo ndryshimet</button>
          <button type="button" disabled={saving || !changes.length} onClick={() => void save()}>Ruaj ndryshimet</button>
        </div>
        <p className="muted">
          «Shënjimi H/L» tregon nëse rezultati shënohet automatikisht si i lartë (H) ose i ulët (L). Kjo funksionon për vlera si «3.3 - 6.1», «&lt;40» ose «&gt;5»;
          vlerat në disa rreshta ose sipas gjinisë dhe moshës printohen ashtu siç janë shkruar.
        </p>
        <details>
          <summary>Historiku i ndryshimeve</summary>
          <div className="muted">
            {!data.catalogHistory.items.length && 'Ende nuk ka ndryshime të regjistruara.'}
            {[...data.catalogHistory.items].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50).map(entry => (
              <div key={entry.id} className="catalog-history-entry">
                <strong>{formatDateTime(entry.at)}</strong> · {entry.by || '—'} · versioni {entry.revision}
                <ul>
                  {entry.changes.slice(0, 40).map((change, index) => {
                    const short = (value: unknown) => toText(value).replace(/\n+/g, ' / ');
                    return (
                      <li key={index}>
                        {change.target} — {change.field}{change.from || change.to ? `: ${short(change.from) || '—'} → ${short(change.to) || '—'}` : ''}
                      </li>
                    );
                  })}
                  {entry.changes.length > 40 && <li>… dhe {entry.changes.length - 40} ndryshime të tjera</li>}
                </ul>
              </div>
            ))}
          </div>
        </details>
      </details>
    </section>
  );
}
