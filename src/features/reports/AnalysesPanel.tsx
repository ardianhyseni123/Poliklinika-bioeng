import { useState } from 'react';
import type { AnalysisItem, CatalogCategory } from '../../data/schemas';
import { catalogAnalysisItem } from '../../domain/catalog';
import { referenceFlag, type Flag } from '../../domain/reference';
import { textRows } from '../../domain/text';

export function FlagMark({ flag }: { flag: Flag }) {
  if (!flag) return null;
  return (
    <span className={`resultFlag ${flag === 'H' ? 'flag-high' : 'flag-low'}`} title={flag === 'H' ? 'Mbi vlerën referente' : 'Nën vlerën referente'}>
      {flag}
    </span>
  );
}

interface Props {
  categories: CatalogCategory[];
  analyses: AnalysisItem[];
  onChange: (next: AnalysisItem[]) => void;
  say: (message: string, error?: boolean) => void;
}

/** Lab results: pick analyses from the list (or add one outside it) and fill in the results. */
export function AnalysesPanel({ categories, analyses, onChange, say }: Props) {
  const visible = categories.filter(category => category.active);
  const [categoryId, setCategoryId] = useState(visible[0]?.id ?? '');
  const [manual, setManual] = useState({ parameter: '', unit: '', reference: '' });
  const category = visible.find(item => item.id === categoryId) ?? visible[0];
  const rows = (category?.analyses ?? []).filter(analysis => analysis.active);

  function add(items: AnalysisItem[]): number {
    const next = [...analyses];
    let added = 0;
    for (const item of items) {
      if (next.some(existing => existing.parameter === item.parameter)) continue;
      next.push(item);
      added += 1;
    }
    onChange(next);
    return added;
  }

  function addOne(analysisId: string) {
    const analysis = rows.find(item => item.id === analysisId);
    if (!category || !analysis) return;
    if (!add([catalogAnalysisItem(category, analysis)])) say(`Analiza “${analysis.name}” është tashmë në listë.`, true);
  }

  function addAll() {
    if (!category?.bulkAdd) return;
    const added = add(rows.map(analysis => catalogAnalysisItem(category, analysis)));
    say(added ? `${added} analiza nga «${category.name}» u shtuan në raport.` : `Të gjitha analizat nga «${category.name}» janë tashmë në raport.`);
  }

  function addManual() {
    const parameter = manual.parameter.trim();
    if (!parameter) {
      say('Shkruaj emrin e parametrit.', true);
      return;
    }
    if (!add([{ parameter, result: '', unit: manual.unit.trim(), reference: manual.reference.trim() }])) {
      say(`Analiza “${parameter}” është tashmë në listë.`, true);
      return;
    }
    setManual({ parameter: '', unit: '', reference: '' });
  }

  const update = (index: number, patch: Partial<AnalysisItem>) =>
    onChange(analyses.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  return (
    <div data-testid="analyses-panel">
      <h3>Analizat laboratorike</h3>
      <p className="muted">
        Zgjidh kategorinë. Lista qëndron e hapur: kliko një analizë për ta shtuar, pastaj kliko analizën tjetër që të shtohet edhe ajo.
        Njësia dhe vlera referente mund të ndryshohen këtu vetëm për këtë raport; për të gjitha raportet e reja ndryshoji te «Analizat dhe vlerat referente».
      </p>
      <div className="row">
        <label className="grow">
          Kategoria
          <select value={category?.id ?? ''} onChange={event => setCategoryId(event.target.value)}>
            {visible.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="grow">
          Analiza nga lista
          <select size={9} aria-label="Analiza nga lista" data-testid="analysis-picker" value="" onChange={event => addOne(event.target.value)}>
            <option value="" disabled>— Kliko analizën për ta shtuar —</option>
            {rows.map(analysis => <option key={analysis.id} value={analysis.id}>{analysis.name} — {analysis.unit || 'pa njësi'}</option>)}
          </select>
        </label>
        {category?.bulkAdd && rows.length > 0 && (
          <button type="button" className="secondary" onClick={addAll}>Shto të gjitha analizat: {category.name}</button>
        )}
      </div>
      <details>
        <summary>Shto analizë jashtë listës</summary>
        <div className="row">
          <label className="grow">Parametri<input placeholder="p.sh. Analizë e veçantë" value={manual.parameter} onChange={event => setManual({ ...manual, parameter: event.target.value })} /></label>
          <label className="grow">Njësia<input placeholder="mmol/L" value={manual.unit} onChange={event => setManual({ ...manual, unit: event.target.value })} /></label>
          <label className="grow">Vlera referente<input placeholder="3.3–6.1" value={manual.reference} onChange={event => setManual({ ...manual, reference: event.target.value })} /></label>
          <button type="button" onClick={addManual}>Shto analizën tjetër</button>
        </div>
      </details>
      <table>
        <thead><tr><th>Parametri</th><th>Rezultati i fituar</th><th>Njësia</th><th>Vlera referente</th><th>Veprimi</th></tr></thead>
        <tbody id="analysisRows">
          {analyses.map((item, index) => {
            const flag = referenceFlag(item.result, item.reference);
            return (
              <tr key={`${item.parameter}-${index}`}>
                <td>{item.parameter}</td>
                <td>
                  <input
                    inputMode="decimal"
                    placeholder="Shëno rezultatin"
                    aria-label={flag ? `Rezultat ${flag}` : `Rezultati: ${item.parameter}`}
                    value={item.result}
                    onChange={event => update(index, { result: event.target.value })}
                  />
                  <FlagMark flag={flag} />
                </td>
                <td><input placeholder="—" aria-label={`Njësia: ${item.parameter}`} value={item.unit} onChange={event => update(index, { unit: event.target.value })} /></td>
                <td>
                  <textarea rows={textRows(item.reference)} placeholder="—" aria-label={`Vlera referente: ${item.parameter}`} value={item.reference} onChange={event => update(index, { reference: event.target.value })} />
                </td>
                <td><button type="button" className="danger" onClick={() => onChange(analyses.filter((_, i) => i !== index))}>Hiq</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
