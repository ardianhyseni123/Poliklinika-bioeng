// Albanian UI text in one place.

export const sq = {
  appTitle: 'POLIKLINIKA & LABORATORI BIOENG',
  appSubtitle: 'Menaxhimi i ndarë i raporteve klinike',
  logoAlt: 'Logo Bioeng',
  login: {
    title: 'Hyrje në sistem',
    hint: 'Përdor llogarinë tënde të laboratorit ose të specialistit.',
    email: 'Email',
    password: 'Fjalëkalimi',
    submit: 'Hyr',
    submitting: 'Duke hyrë…',
    missingFields: 'Shkruaj emailin dhe fjalëkalimin.',
    wrongCredentials: 'Emaili ose fjalëkalimi nuk është i saktë.',
    tooManyAttempts: 'Shumë përpjekje të gabuara. Provo përsëri pas pak minutash.',
    disabled: 'Kjo llogari është çaktivizuar në Firebase. Kontakto administratorin.',
    offline: 'Nuk ka lidhje me internetin. Hyrja kërkon lidhje.',
    failed: 'Hyrja dështoi. Provo përsëri.'
  },
  session: {
    loading: 'Duke u ngarkuar…',
    role: (label: string) => `Roli: ${label}`,
    logout: 'Dil',
    noProfile: 'Kjo llogari nuk ka rol në aplikacion. Administratori duhet t’ia caktojë rolin te faqja «Përdoruesit».',
    inactive: 'Kjo llogari është çaktivizuar në aplikacion. Kontakto administratorin.',
    pendingWrites:
      'Ka ndryshime që ende nuk janë dërguar në server. Lidhu me internetin dhe prit derisa të dërgohen para se të dalësh, përndryshe mbeten vetëm në këtë kompjuter.',
    welcome: (name: string) => `Mirë se erdhët, ${name}.`
  },
  sync: {
    online: 'Në linjë',
    sending: (count: number) => `Duke dërguar ${count} ${count === 1 ? 'ndryshim' : 'ndryshime'}…`,
    offline: (count: number) =>
      `Pa lidhje — ndryshimet ruhen në këtë kompjuter dhe dërgohen kur të kthehet lidhja${count ? ` (${count} në pritje)` : ''}.`,
    emulators: 'Mjedis testimi lokal (emulator) — jo të dhëna reale',
    refusedTitle: (count: number) => `${count} ${count === 1 ? 'ndryshim nuk u pranua' : 'ndryshime nuk u pranuan'} nga serveri`,
    refusedHint: 'Përmbajtja është ruajtur në këtë kompjuter. Kopjoje dhe fute përsëri, ose njofto administratorin.',
    reason: (code: string) =>
      ({
        'permission-denied': 'nuk ka leje',
        'not-on-server': 'nuk arriti në server',
        'deleted-on-server': 'raporti ishte fshirë ndërkohë',
        'changed-on-server': 'raporti ishte ndryshuar ndërkohë'
      })[code] ?? code,
    copy: 'Kopjo përmbajtjen',
    dismiss: 'E kam ruajtur'
  },
  rescue: {
    title: 'U rikthyen ndryshime nga versioni i vjetër',
    attachmentsTitle: 'U sollën dokumentet e versionit të vjetër',
    summary: (r: { found: number; reports: number; patients: number; conflicts: number; deletions: number; unrestored: number; attachments: number }) => {
      const n = (count: number, one: string, many: string) => (count ? `${count} ${count === 1 ? one : many}` : '');
      return [
        n(r.found, 'ndryshim ishte ruajtur vetëm në këtë kompjuter.', 'ndryshime ishin ruajtur vetëm në këtë kompjuter.'),
        n(r.reports, 'raport u ngarkua.', 'raporte u ngarkuan.'),
        n(r.patients, 'pacient u ngarkua.', 'pacientë u ngarkuan.'),
        n(r.deletions, 'fshirje u krye.', 'fshirje u kryen.'),
        n(r.conflicts,
          'raport ishte ndryshuar edhe diku tjetër: të dy versionet u ruajtën, zgjidh cilin të mbash.',
          'raporte ishin ndryshuar edhe diku tjetër: të dy versionet u ruajtën, zgjidh cilin të mbash.'),
        n(r.unrestored,
          'nuk mund të ngarkohej: shih listën e ndryshimeve të papranuara.',
          'nuk mund të ngarkoheshin: shih listën e ndryshimeve të papranuara.'),
        n(r.attachments, 'bashkëngjitje u ruajt në këtë kompjuter.', 'bashkëngjitje u ruajtën në këtë kompjuter.')
      ].filter(Boolean).join(' ');
    },
    ok: 'Në rregull'
  }
} as const;
