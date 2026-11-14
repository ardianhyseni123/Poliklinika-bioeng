import type { Hixhame } from '../../data/schemas';
import { BODY_POSITIONS, CUP_COUNTS, HIXHAME_SERVICES, LEECH_COUNTS, type GuidancePhase, type GuidanceService } from '../../domain/specialties';

/** The form's view of the hixhame services; `custom` holds a number typed instead of a button. */
export interface HixhameForm {
  services: string[];
  cups: string;
  cupsCustom: string;
  cupPositions: string[];
  cupOther: string;
  leeches: string;
  leechesCustom: string;
  leechPositions: string[];
  leechOther: string;
}

export function hixhameFormOf(data: Hixhame | null | undefined): HixhameForm {
  const split = (count: string | undefined, choices: string[]) =>
    count && !choices.includes(count) ? { choice: '', custom: count } : { choice: count ?? '', custom: '' };
  const cups = split(data?.cups, CUP_COUNTS);
  const leeches = split(data?.leeches, LEECH_COUNTS);
  const known = (positions: string[] | undefined) => (positions ?? []).filter(item => BODY_POSITIONS.includes(item));
  const other = (positions: string[] | undefined) => (positions ?? []).find(item => !BODY_POSITIONS.includes(item)) ?? '';
  return {
    services: data?.services ?? [],
    cups: cups.choice,
    cupsCustom: cups.custom,
    cupPositions: known(data?.cupPositions),
    cupOther: other(data?.cupPositions),
    leeches: leeches.choice,
    leechesCustom: leeches.custom,
    leechPositions: known(data?.leechPositions),
    leechOther: other(data?.leechPositions)
  };
}

export function hixhameOf(form: HixhameForm): Hixhame {
  return {
    services: form.services,
    cups: form.cupsCustom.trim() || form.cups,
    cupPositions: [...form.cupPositions, form.cupOther.trim()].filter(Boolean),
    leeches: form.leechesCustom.trim() || form.leeches,
    leechPositions: [...form.leechPositions, form.leechOther.trim()].filter(Boolean)
  };
}

function toggle(list: string[], value: string, on: boolean): string[] {
  return on ? [...list.filter(item => item !== value), value] : list.filter(item => item !== value);
}

interface Props {
  value: HixhameForm;
  onChange: (next: HixhameForm) => void;
  onGuidance: (service: GuidanceService, phase: GuidancePhase) => void;
}

export function HixhamePanel({ value, onChange, onGuidance }: Props) {
  const set = (patch: Partial<HixhameForm>) => onChange({ ...value, ...patch });

  const procedure = (kind: 'cups' | 'leeches') => {
    const cups = kind === 'cups';
    const counts = cups ? CUP_COUNTS : LEECH_COUNTS;
    const unit = cups ? 'kupa' : 'ushujza';
    const positionsKey = cups ? 'cupPositions' : 'leechPositions';
    const otherKey = cups ? 'cupOther' : 'leechOther';
    const customKey = cups ? 'cupsCustom' : 'leechesCustom';
    return (
      <div>
        <h4>{cups ? 'Hixhame — kupa' : 'Hirudoterapi — ushujza mjekësore'}</h4>
        <div className="choice-buttons">
          {counts.map(count => (
            <button
              key={count}
              type="button"
              className={value[kind] === count ? 'selected' : undefined}
              onClick={() => set({ [kind]: value[kind] === count ? '' : count })}
            >
              {count} {unit}
            </button>
          ))}
        </div>
        <label>
          Numër tjetër (opsional)
          <input type="number" min={1} step={1} inputMode="numeric" value={value[customKey]} onChange={event => set({ [customKey]: event.target.value })} />
        </label>
        <strong>Pozitat</strong>
        <div className="checks compact">
          {BODY_POSITIONS.map(position => (
            <label key={position}>
              <input type="checkbox" checked={value[positionsKey].includes(position)} onChange={event => set({ [positionsKey]: toggle(value[positionsKey], position, event.target.checked) })} />
              {position}
            </label>
          ))}
        </div>
        <label>Pozitë tjetër<input value={value[otherKey]} onChange={event => set({ [otherKey]: event.target.value })} /></label>
      </div>
    );
  };

  return (
    <section className="service-card" data-testid="hixhame-panel">
      <h3>Shërbimet e Hixhames</h3>
      <p className="muted">Zgjidh shërbimet dhe detajet e kryera. Numri dhe pozitat ruhen në raport.</p>
      <div className="checks">
        {HIXHAME_SERVICES.map(service => (
          <label key={service}>
            <input type="checkbox" checked={value.services.includes(service)} onChange={event => set({ services: toggle(value.services, service, event.target.checked) })} />
            {service}
          </label>
        ))}
      </div>
      <div className="procedure-grid">
        {procedure('cups')}
        {procedure('leeches')}
      </div>
      <div className="guide-actions">
        <h4>Këshilla për pacientin</h4>
        <p className="muted">Përgatit fletën, ruaje me “Printo / Ruaj si PDF”, pastaj bashkëngjite manualisht në WhatsApp.</p>
        <button className="secondary" type="button" onClick={() => onGuidance('Hixhame', 'para')}>PDF: Para Hixhames</button>
        <button className="secondary" type="button" onClick={() => onGuidance('Hixhame', 'pas')}>PDF: Pas Hixhames</button>
        <button className="secondary" type="button" onClick={() => onGuidance('Hirudoterapi', 'para')}>PDF: Para Hirudoterapisë</button>
        <button className="secondary" type="button" onClick={() => onGuidance('Hirudoterapi', 'pas')}>PDF: Pas Hirudoterapisë</button>
      </div>
    </section>
  );
}
