import { describe, expect, test } from 'vitest';
import { SEED_ANALYSES } from '../../src/domain/catalogSeed';
import { buildSeedCategories, catalogAnalysisItem, diffCatalog, legacyGroupLabel, printGroupFor, validateCatalog } from '../../src/domain/catalog';
import { referenceFlag, referenceSupportsFlag } from '../../src/domain/reference';
import { financeSummary, paymentProblem, paymentSummaries } from '../../src/domain/payments';
import { normalizePhone, whatsappUrl } from '../../src/domain/notify';
import { groupAnalyses, printedClinician, signaturesFor } from '../../src/domain/print';
import { buildBackupPayload } from '../../src/domain/backup';
import { normalizeSearch, textRows } from '../../src/domain/text';
import type { Payment } from '../../src/data/schemas';

describe('analysis list (ported from the old app)', () => {
  const seed = buildSeedCategories();

  test('is seeded from the built-in list without losing rows or print headings', () => {
    const builtIn = Object.values(SEED_ANALYSES).flat().length;
    expect(builtIn).toBe(344);
    expect(seed.reduce((total, category) => total + category.analyses.length, 0)).toBe(builtIn);
    expect(validateCatalog({ categories: seed })).toEqual([]);
    const ids = seed.flatMap(category => [category.id, ...category.analyses.map(item => item.id)]);
    expect(new Set(ids).size).toBe(ids.length);

    const viral = seed.find(category => category.name === 'Virusale e zgjeruar')!.analyses.map(item => item.name);
    expect(viral).toEqual(expect.arrayContaining(['Anti HIV 1/2', 'Anti-HBs']));
    for (const category of seed.filter(item => item.name.startsWith('Hormonale'))) {
      expect(category.analyses.every(item => !item.reference.includes(';'))).toBe(true);
    }
    expect(seed.filter(item => item.bulkAdd).map(item => item.name)).toEqual(['Hematologji', 'Urine']);
    const heading = (name: string) => seed.find(category => category.name === name)!.printGroup;
    expect(heading('Biokimi e zgjeruar')).toBe('Analizat Biokimike');
    expect(heading('Urina - sediment dhe 24h')).toBe('Analizat Urinare');
    expect(heading('Kontrolla Specialistike')).toBe('Analiza të tjera');
  });

  test('every change is logged with its old and new value', () => {
    const edited = structuredClone(seed);
    const chemistry = edited.find(category => category.name === 'Biokimi')!;
    chemistry.analyses[0]!.reference = '3.9 - 5.8';
    chemistry.analyses[1]!.unit = 'mg/dL';
    edited.find(category => category.name === 'Hematologji')!.analyses.push(chemistry.analyses.splice(2, 1)[0]!);
    chemistry.analyses[3]!.active = false;
    chemistry.analyses.push({ id: 'new-analysis', name: 'Analizë e re', unit: 'U/L', reference: '<10', active: true });

    const changes = diffCatalog({ categories: seed }, { categories: edited });
    const reference = changes.find(change => change.field === 'Vlera referente');
    expect(reference).toMatchObject({ from: '3.3-6.1', to: '3.9 - 5.8' });
    for (const field of ['Njësia', 'Kategoria', 'Shfaqet në listë', 'Analizë e re']) {
      expect(changes.some(change => change.field === field)).toBe(true);
    }
    expect(diffCatalog({ categories: seed }, { categories: structuredClone(seed) })).toEqual([]);

    chemistry.analyses.push({ ...chemistry.analyses[0]!, id: 'duplicate' });
    expect(validateCatalog({ categories: edited }).join(' ')).toMatch(/dy herë/);
  });

  test('report rows keep their own unit, range and print heading', () => {
    const chemistry = seed.find(category => category.name === 'Biokimi')!;
    const item = catalogAnalysisItem(chemistry, chemistry.analyses[0]!);
    expect(item).toMatchObject({ category: 'Biokimi', printGroup: 'Analizat Biokimike', result: '' });
    expect(printGroupFor({ parameter: 'Analizë e panjohur', printGroup: 'Titull i ruajtur' })).toBe('Titull i ruajtur');
    expect(printGroupFor({ parameter: 'Analizë e panjohur', category: 'Virusale' })).toBe('Analizat virusale');
    expect(printGroupFor({ parameter: 'Glukoza esull' })).toBe('Analizat Biokimike');
    expect(legacyGroupLabel('Mikrobiologjike')).toBe('Analizat mikrobiologjike');
  });
});

describe('H/L flags', () => {
  test('reference formats that can be flagged', () => {
    for (const reference of ['3.3 - 6.1', '0.55 - 4.78', '<40', '> 5']) expect(referenceSupportsFlag(reference)).toBe(true);
    for (const reference of ['Negativ', 'M: 1 - 2; F: 3 - 4', '']) expect(referenceSupportsFlag(reference)).toBe(false);
  });

  test('results are marked high or low', () => {
    expect(referenceFlag('7.2', '3.3-6.1')).toBe('H');
    expect(referenceFlag('2,9', '3.3 – 6.1')).toBe('L');
    expect(referenceFlag('5', '3.3-6.1')).toBe('');
    expect(referenceFlag('45', '<40')).toBe('H');
    expect(referenceFlag('3', '>5')).toBe('L');
    expect(referenceFlag('pozitiv', '3.3-6.1')).toBe('');
    expect(referenceFlag('10', 'Meshkujt: 1-5')).toBe('');
  });
});

describe('payments', () => {
  const pay = (overrides: Partial<Payment>): Payment => ({
    id: crypto.randomUUID(), patientId: 'p', patientName: 'P', amount: 0, status: 'PAID', paymentDate: '2026-11-14', note: '',
    recordedAt: '2026-11-14T10:00:00Z', recordedBy: 'lab', reportId: 'r1', reportLabel: '', reportTotal: 30, ...overrides
  });

  test('partial payments add up per report', () => {
    const summary = paymentSummaries([pay({ amount: 10 }), pay({ amount: 15, recordedAt: '2026-11-14T11:00:00Z' })]).get('r1')!;
    expect(summary).toMatchObject({ total: 30, paid: 25, remaining: 5, status: 'UNPAID', billingDate: '2026-11-14' });
    const settled = paymentSummaries([pay({ amount: 10 }), pay({ amount: 20, recordedAt: '2026-11-14T11:00:00Z' })]).get('r1')!;
    expect(settled.status).toBe('PAID');
  });

  test('a payment may not exceed what is left', () => {
    expect(paymentProblem({ total: 30, amount: 10, status: 'PAID', alreadyPaid: 25 })).toMatch(/më e madhe/);
    expect(paymentProblem({ total: 0, amount: 10, status: 'PAID', alreadyPaid: 0 })).toMatch(/vlerën totale/);
    expect(paymentProblem({ total: 30, amount: 0, status: 'PAID', alreadyPaid: 0 })).toMatch(/pagesën e vlefshme/);
    expect(paymentProblem({ total: 30, amount: 0, status: 'UNPAID', alreadyPaid: 0 })).toBeNull();
  });

  test('day, week, month and year totals', () => {
    const records = [
      pay({ amount: 10, reportId: 'a', paymentDate: '2026-11-14' }),
      pay({ amount: 30, reportId: 'b', paymentDate: '2026-11-10' }),
      pay({ amount: 20, reportId: 'c', paymentDate: '2026-10-02', reportTotal: 50 })
    ];
    const totals = financeSummary(records, new Date(2026, 10, 14));
    expect(totals.day).toEqual({ billed: 30, paid: 10, remaining: 20 });
    expect(totals.week).toEqual({ billed: 60, paid: 40, remaining: 20 }); // week starts Monday 2026-11-09
    expect(totals.month).toEqual(totals.week);
    expect(totals.year).toEqual({ billed: 110, paid: 60, remaining: 50 });
  });
});

describe('printing and notifications', () => {
  test('neurology reports always print the fixed neurologist; others print the stored clinician', () => {
    expect(printedClinician({ specialty: 'Neurologji', clinician: 'Someone', clinicianTitle: 'X' }).name).toBe('Dr. Nezir Demiolli');
    expect(printedClinician({ specialty: 'Kardiologji', clinician: 'Dr. K', clinicianTitle: '' })).toEqual({ name: 'Dr. K', title: 'Kardiologji' });
    expect(signaturesFor({ type: 'laboratory', specialty: 'Laborator', clinician: '', clinicianTitle: '' })[0]?.name).toBe('Dr. Mamudije Luma');
    expect(signaturesFor({ type: 'specialist', specialty: 'Hixhame', clinician: '', clinicianTitle: '' })[0]?.name).toBe('Bsc. Lumnije Hyseni');
    expect(signaturesFor({ type: 'specialist', specialty: 'Kardiologji', clinician: 'Dr. K', clinicianTitle: 'T' })[0]).toBeNull();
  });

  test('lab rows are grouped under their headings in entry order, with flags', () => {
    const groups = groupAnalyses([
      { parameter: 'Glukoza esull', result: '7.2', unit: 'mmol/L', reference: '3.3-6.1' },
      { parameter: 'HGB Hemoglobina', result: '102', unit: 'g/L', reference: '115 - 165', printGroup: 'Analizat Hematologjike' },
      { parameter: 'Urea', result: '5', unit: 'mmol/L', reference: '1.7-8.3' }
    ]);
    expect(groups.map(group => [group.label, group.rows.map(row => `${row.item.parameter}:${row.flag}`)])).toEqual([
      ['Analizat Biokimike', ['Glukoza esull:H', 'Urea:']],
      ['Analizat Hematologjike', ['HGB Hemoglobina:L']]
    ]);
  });

  test('phone numbers and message links', () => {
    expect(normalizePhone('044 123 456')).toBe('38344123456');
    expect(normalizePhone('+38344123456')).toBe('38344123456');
    expect(whatsappUrl('', 'x')).toBeNull();
    expect(whatsappUrl('044123456', 'Përshëndetje')).toBe('https://web.whatsapp.com/send?phone=38344123456&text=P%C3%ABrsh%C3%ABndetje');
  });
});

describe('text and backup', () => {
  test('search ignores case, accents and spacing', () => {
    expect(normalizeSearch('Ëndrit Shabani')).toBe('endritshabani');
    expect(normalizeSearch('044-123 456')).toBe('044123456');
    expect(textRows('a\nb')).toBe(2);
  });

  test('the backup keeps the old format and leaves out deleted reports', () => {
    const report = { id: 'r1', lastVersionId: 'v1' } as never;
    const deleted = { id: 'r2', _deleted: true } as never;
    const backup = buildBackupPayload({
      patients: [], reports: [report, deleted], appointments: [], payments: [], audit: [],
      attachments: [{ id: 'a1', reportId: 'r1', name: 'x.pdf', type: 'application/pdf', size: 1, uploadedAt: '', data: 'data:' },
        { id: 'a2', reportId: 'r2', name: 'y.pdf', type: 'application/pdf', size: 1, uploadedAt: '', data: 'data:' }],
      analysisCatalog: null, catalogHistory: []
    }, '2026-11-14T00:00:00.000Z');
    expect(backup).toMatchObject({ format: 'bioeng-clinical-backup', version: 2 });
    expect(backup.reports).toEqual([{ id: 'r1' }]);
    expect(backup.attachments.map(item => item.id)).toEqual(['a1']);
  });
});
