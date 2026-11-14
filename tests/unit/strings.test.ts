import { expect, test } from 'vitest';
import { sq } from '../../src/strings/sq';

const none = { found: 0, reports: 0, patients: 0, conflicts: 0, deletions: 0, unrestored: 0, attachments: 0 };

test('the rescue summary uses Albanian singular and plural forms', () => {
  expect(sq.rescue.summary({ ...none, found: 2, reports: 1, patients: 1 }))
    .toBe('2 ndryshime ishin ruajtur vetëm në këtë kompjuter. 1 raport u ngarkua. 1 pacient u ngarkua.');
  expect(sq.rescue.summary({ ...none, found: 1, conflicts: 1 }))
    .toBe('1 ndryshim ishte ruajtur vetëm në këtë kompjuter. 1 raport ishte ndryshuar edhe diku tjetër: të dy versionet u ruajtën, zgjidh cilin të mbash.');
  expect(sq.rescue.summary({ ...none, found: 3, reports: 3 })).toContain('3 raporte u ngarkuan.');
});
