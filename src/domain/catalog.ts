// The analysis list: seeding, print headings, change log and validation, ported from the old app.

import type { AnalysisItem, CatalogCategory } from '../data/schemas';
import { SEED_ANALYSES } from './catalogSeed';
import { toText } from './text';

export interface CatalogShape {
  categories: CatalogCategory[];
}

export interface CatalogChange {
  target: string;
  field: string;
  from: string;
  to: string;
}

/** Print heading for a category name, as the old app derived it. */
export function legacyGroupLabel(categoryName: unknown): string {
  const name = toText(categoryName);
  if (name.startsWith('Biokimi')) return 'Analizat Biokimike';
  if (name.startsWith('Hematologji')) return 'Analizat Hematologjike';
  if (name.startsWith('Hormonale')) return 'Analizat Hormonale';
  if (name.startsWith('Urine') || name.startsWith('Urina')) return 'Analizat Urinare';
  if (name.startsWith('Tumor')) return 'Tumor markerët';
  if (name.startsWith('Kuagulogrami')) return 'Analizat e koagulimit';
  if (name.startsWith('Virusale')) return 'Analizat virusale';
  if (name.startsWith('Imunologjike')) return 'Analizat imunologjike';
  if (name.startsWith('Reumatologjike') || name.startsWith('Specifike')) return 'Analizat specifike';
  if (name.startsWith('Toksikologjike')) return 'Analizat toksikologjike';
  if (name.startsWith('Mikrobiologjike')) return 'Analizat mikrobiologjike';
  if (name.startsWith('Alergjike')) return 'Analizat alergjike';
  return 'Analiza të tjera';
}

/** Trims names and normalizes line endings, as before every save. */
export function normalizeCategories(categories: CatalogCategory[]): CatalogCategory[] {
  return categories.map(category => ({
    id: String(category.id),
    name: String(category.name ?? '').trim(),
    printGroup: String(category.printGroup ?? '').trim(),
    bulkAdd: Boolean(category.bulkAdd),
    active: category.active !== false,
    analyses: (category.analyses ?? []).map(analysis => ({
      id: String(analysis.id),
      name: String(analysis.name ?? '').trim(),
      unit: String(analysis.unit ?? '').trim(),
      reference: String(analysis.reference ?? '').replace(/\r\n?/g, '\n').trim(),
      active: analysis.active !== false
    }))
  }));
}

/** The first list, from the built-in seed. Hormone ranges get one line per range. */
export function buildSeedCategories(newId: () => string = () => crypto.randomUUID()): CatalogCategory[] {
  return normalizeCategories(Object.entries(SEED_ANALYSES).map(([name, rows]) => ({
    id: newId(),
    name,
    printGroup: legacyGroupLabel(name),
    bulkAdd: name === 'Urine' || name === 'Hematologji',
    active: true,
    analyses: rows
      .filter(row => String(row[0] ?? '').trim())
      .map(([analysisName, unit, reference]) => ({
        id: newId(),
        name: analysisName,
        unit,
        reference: name.startsWith('Hormonale') ? String(reference ?? '').replace(/;\s*/g, '\n') : reference,
        active: true
      }))
  })));
}

export function countAnalyses(categories: CatalogCategory[]): number {
  return categories.reduce((total, category) => total + category.analyses.length, 0);
}

/** A report row for an analysis picked from the list; it keeps its own copy of unit and range. */
export function catalogAnalysisItem(category: CatalogCategory, analysis: CatalogCategory['analyses'][number]): AnalysisItem {
  return {
    parameter: analysis.name,
    result: '',
    unit: analysis.unit,
    reference: analysis.reference,
    category: category.name,
    printGroup: category.printGroup || legacyGroupLabel(category.name)
  };
}

/** Print heading for a report row: stored heading, current list, then the seed list. */
export function printGroupFor(item: Pick<AnalysisItem, 'parameter' | 'category' | 'printGroup'>, categories: CatalogCategory[] = []): string {
  if (item.printGroup) return item.printGroup;
  const category = (item.category && categories.find(c => c.name === item.category))
    || categories.find(c => c.analyses.some(a => a.name === item.parameter));
  if (category?.printGroup) return category.printGroup;
  const seedCategory = item.category
    || Object.entries(SEED_ANALYSES).find(([, rows]) => rows.some(row => row[0] === item.parameter))?.[0]
    || '';
  return legacyGroupLabel(seedCategory);
}

function change(target: string, field: string, from: unknown = '', to: unknown = ''): CatalogChange {
  return { target, field, from: toText(from), to: toText(to) };
}

/** Every difference between two lists, worded for the change log. */
export function diffCatalog(before: CatalogShape, after: CatalogShape): CatalogChange[] {
  const changes: CatalogChange[] = [];
  const yesNo = (value: boolean) => (value ? 'Po' : 'Jo');
  const beforeCategories = new Map(before.categories.map(c => [c.id, c]));
  const beforeAnalyses = new Map<string, { analysis: CatalogCategory['analyses'][number]; category: CatalogCategory }>();
  const afterAnalysisIds = new Set<string>();
  for (const c of before.categories) for (const a of c.analyses) beforeAnalyses.set(a.id, { analysis: a, category: c });

  for (const c of after.categories) {
    const old = beforeCategories.get(c.id);
    if (!old) changes.push(change(c.name, 'Kategori e re', '', c.printGroup ? `Titulli në raport: ${c.printGroup}` : ''));
    else {
      if (old.name !== c.name) changes.push(change(old.name, 'Emri i kategorisë', old.name, c.name));
      if (old.printGroup !== c.printGroup) changes.push(change(c.name, 'Titulli në raport', old.printGroup, c.printGroup));
      if (old.active !== c.active) changes.push(change(c.name, 'Shfaqet në listë', yesNo(old.active), yesNo(c.active)));
      if (old.bulkAdd !== c.bulkAdd) changes.push(change(c.name, 'Butoni «Shto të gjitha»', yesNo(old.bulkAdd), yesNo(c.bulkAdd)));
    }
    for (const a of c.analyses) {
      afterAnalysisIds.add(a.id);
      const target = `${c.name} › ${a.name || '(pa emër)'}`;
      const previous = beforeAnalyses.get(a.id);
      if (!previous) {
        changes.push(change(target, 'Analizë e re', '', [a.unit, a.reference].filter(Boolean).join(' | ')));
        continue;
      }
      const was = previous.analysis;
      if (previous.category.id !== c.id) changes.push(change(target, 'Kategoria', previous.category.name, c.name));
      if (was.name !== a.name) changes.push(change(target, 'Emri', was.name, a.name));
      if (was.unit !== a.unit) changes.push(change(target, 'Njësia', was.unit, a.unit));
      if (was.reference !== a.reference) changes.push(change(target, 'Vlera referente', was.reference, a.reference));
      if (was.active !== a.active) changes.push(change(target, 'Shfaqet në listë', yesNo(was.active), yesNo(a.active)));
    }
    if (old) {
      const kept = c.analyses.filter(a => beforeAnalyses.get(a.id)?.category.id === c.id).map(a => a.id);
      const keptSet = new Set(kept);
      const previousOrder = old.analyses.filter(a => keptSet.has(a.id)).map(a => a.id);
      if (kept.join() !== previousOrder.join()) changes.push(change(c.name, 'Renditja e analizave', '', 'u ndryshua'));
    }
  }
  for (const [id, { analysis, category }] of beforeAnalyses) {
    if (!afterAnalysisIds.has(id)) changes.push(change(`${category.name} › ${analysis.name}`, 'U hoq nga lista'));
  }
  const afterCategoryIds = new Set(after.categories.map(c => c.id));
  for (const c of before.categories) if (!afterCategoryIds.has(c.id)) changes.push(change(c.name, 'Kategoria u hoq'));
  const keptCategories = after.categories.filter(c => beforeCategories.has(c.id)).map(c => c.id);
  const keptCategorySet = new Set(keptCategories);
  const previousCategoryOrder = before.categories.filter(c => keptCategorySet.has(c.id)).map(c => c.id);
  if (keptCategories.join() !== previousCategoryOrder.join()) changes.push(change('Kategoritë', 'Renditja', '', 'u ndryshua'));
  return changes;
}

/** Problems that block saving the list, in Albanian. */
export function validateCatalog(value: CatalogShape): string[] {
  const errors: string[] = [];
  const key = (text: string) => String(text).trim().toLocaleLowerCase('sq');
  const categoryNames = new Set<string>();
  if (!value.categories.length) errors.push('Lista duhet të ketë të paktën një kategori.');
  for (const c of value.categories) {
    if (!c.name) errors.push('Një kategori nuk ka emër.');
    else if (categoryNames.has(key(c.name))) errors.push(`Kategoria «${c.name}» ekziston dy herë.`);
    categoryNames.add(key(c.name));
    const analysisNames = new Set<string>();
    for (const a of c.analyses) {
      if (!a.name) {
        errors.push(`Te «${c.name || '(pa emër)'}» ka një analizë pa emër.`);
        continue;
      }
      if (analysisNames.has(key(a.name))) errors.push(`«${a.name}» është dy herë te «${c.name}».`);
      analysisNames.add(key(a.name));
    }
  }
  return [...new Set(errors)];
}
