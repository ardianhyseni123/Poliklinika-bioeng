// Diagnosis templates of Gastroenterologji and Urologji, copied verbatim from the V28 single-file
// app (new/bioeng-raporte-v28-pacientet-sipas-specialistit.html). Generated; edit with care.
// Applying a template ticks its diagnosis and exams and appends its recommendations to the
// therapy; the doctor can change all of it before saving. The template itself is not stored.

export interface DiagnosisTemplate {
  /** Also the diagnosis checkbox of the specialty. */
  name: string;
  /** Suggested exams; each one is in the specialty's exam list. */
  exams: string[];
  therapy: string;
}

export const GASTRO_TEMPLATES: DiagnosisTemplate[] = [
  {
    name: 'Sëmundja e refluksit gastroezofagal (GERD) — K21',
    exams: ['Gastroskopi (EGDS)', 'Testi i H. pylori (antigjen në feces)', 'Hemogram'],
    therapy: 'Rekomandime: ngrehja e kokës së shtratit, darka të paktën 3 orë para gjumit, shmangia e ushqimeve të yndyrshme, pikante, kafesë, alkoolit dhe duhanit, ulja e peshës trupore te pacientët mbipeshë. Kontroll pas 4–8 javësh për vlerësimin e përgjigjes.'
  },
  {
    name: 'Gastrit kronik — K29.5',
    exams: ['Gastroskopi (EGDS)', 'Testi i H. pylori (antigjen në feces)', 'Hemogram'],
    therapy: 'Rekomandime: ushqim i rregullt në vakte të vogla, shmangia e ushqimeve irrituese, alkoolit, duhanit dhe antiinflamatorëve josteroidë pa këshillë mjekësore. Kontroll pas përfundimit të terapisë.'
  },
  {
    name: 'Infeksion me Helicobacter pylori — B96.81',
    exams: ['Testi i H. pylori (antigjen në feces)', 'Gastroskopi (EGDS)'],
    therapy: 'Rekomandime: terapia eradikuese sipas protokollit të caktuar nga mjeku. Kontroll i eradikimit (antigjen në feces ose test frymëmarrjeje) jo më herët se 4 javë pas përfundimit të terapisë dhe 2 javë pa inhibitorë të pompës së protoneve.'
  },
  {
    name: 'Ulçerë peptike (gastrike / duodenale) — K25 / K26',
    exams: ['Gastroskopi (EGDS)', 'Testi i H. pylori (antigjen në feces)', 'Hemogram', 'Testi i gjakut okult në feces (FOB)'],
    therapy: 'Rekomandime: ndalimi i duhanit dhe alkoolit, shmangia e antiinflamatorëve josteroidë, ushqim i rregullt. Në rast të të vjellave me gjak, feces të zeza ose dhimbjeje të fortë, paraqitja urgjente në spital. Gastroskopi kontrolluese për ulçerat gastrike.'
  },
  {
    name: 'Dispepsi funksionale — K30',
    exams: ['Gastroskopi (EGDS)', 'Testi i H. pylori (antigjen në feces)', 'Ultrazë abdominale'],
    therapy: 'Rekomandime: vakte të vogla dhe të shpeshta, shmangia e ushqimeve që shkaktojnë ankesa, reduktimi i stresit, aktivitet fizik i rregullt. Kontroll në rast të shfaqjes së simptomave alarmuese (humbje peshe, disfagji, të vjella të përsëritura, anemi).'
  },
  {
    name: 'Sindroma e zorrës së irrituar (IBS) — K58',
    exams: ['Calprotectin në feces', 'Hemogram', 'Anti-tTG IgA (celiaki)', 'Parazitologji / koprokulturë në feces'],
    therapy: 'Rekomandime: ditar ushqimor për identifikimin e ushqimeve shkaktare, ushqim i pasur me fibra sipas tolerancës, hidratim i mjaftueshëm, aktivitet fizik, menaxhimi i stresit. Kontroll pas 4–6 javësh.'
  },
  {
    name: 'Kapsllëk funksional — K59.0',
    exams: ['Hemogram', 'Ultrazë abdominale'],
    therapy: 'Rekomandime: rritja e fibrave dhe e lëngjeve në ditë, aktivitet fizik, rutinë e rregullt e tualetit. Kolonoskopi nëse ka simptoma alarmuese (gjak në feces, humbje peshe, anemi, historik familjar i kancerit të kolonit).'
  },
  {
    name: 'Sëmundja inflamatore e zorrëve (Crohn / kolit ulceroz) — K50 / K51',
    exams: ['Calprotectin në feces', 'Kolonoskopi', 'Hemogram', 'CRP', 'Testi i gjakut okult në feces (FOB)'],
    therapy: 'Rekomandime: ndjekje e rregullt gastroenterologjike, ndalimi i duhanit (veçanërisht te sëmundja e Crohn-it), shmangia e antiinflamatorëve josteroidë. Terapia sipas aktivitetit të sëmundjes dhe gjykimit të mjekut.'
  },
  {
    name: 'Sëmundja celiake — K90.0',
    exams: ['Anti-tTG IgA (celiaki)', 'Hemogram', 'Gastroskopi (EGDS)'],
    therapy: 'Rekomandime: dieta e rreptë pa gluten gjatë gjithë jetës (pa grurë, thekër, elb), këshillim ushqimor, kontroll periodik i serologjisë dhe i hemogramit.'
  },
  {
    name: 'Steatozë hepatike (mëlçi e yndyrshme) — K76.0',
    exams: ['Ultrazë abdominale', 'Enzimat e mëlçisë (ALT, AST, GGT, ALP, bilirubina)', 'Profili lipidik dhe glukoza', 'Hemogram'],
    therapy: 'Rekomandime: ulja graduale e peshës trupore (5–10%), dietë mesdhetare, aktivitet fizik aerobik së paku 150 minuta në javë, shmangia e alkoolit, kontrolli i diabetit dhe i lipideve. Kontroll i enzimave dhe ultrazë pas 3–6 muajsh.'
  },
  {
    name: 'Hepatit kronik — K73',
    exams: ['Enzimat e mëlçisë (ALT, AST, GGT, ALP, bilirubina)', 'Markerët viralë të hepatitit (HBsAg, Anti-HCV)', 'Ultrazë abdominale', 'Hemogram'],
    therapy: 'Rekomandime: shmangia e plotë e alkoolit, shmangia e barnave hepatotoksike pa këshillë mjekësore, vaksinimi kundër hepatitit A dhe B kur është e nevojshme. Kontroll sipas etiologjisë dhe rezultateve.'
  },
  {
    name: 'Kolelitiazë (gurë në fshikëz të tëmthit) — K80',
    exams: ['Ultrazë abdominale', 'Enzimat e mëlçisë (ALT, AST, GGT, ALP, bilirubina)', 'Amilazë / Lipazë', 'Hemogram'],
    therapy: 'Rekomandime: dietë me pak yndyrë, shmangia e vakteve të rënda. Konsultë kirurgjikale për vlerësimin e kolecistektomisë. Paraqitje urgjente në rast të dhimbjes së fortë të zgjatur, etheve ose verdhëzës.'
  },
  {
    name: 'Pankreatit kronik — K86',
    exams: ['Amilazë / Lipazë', 'Ultrazë abdominale', 'CT / MRI abdominale', 'Hemogram'],
    therapy: 'Rekomandime: ndalimi i plotë i alkoolit dhe duhanit, dietë me pak yndyrë në vakte të vogla, kontroll i dhimbjes dhe i ushqyerjes. Kontroll periodik gastroenterologjik.'
  },
  {
    name: 'Hernie hiatale — K44',
    exams: ['Gastroskopi (EGDS)', 'Hemogram'],
    therapy: 'Rekomandime: vakte të vogla, shmangia e shtrirjes pas ngrënies, ngrehja e kokës së shtratit, shmangia e ngritjes së peshave të rënda dhe e shtrëngimit. Kontroll sipas simptomave.'
  },
  {
    name: 'Sëmundja divertikulare e kolonit — K57',
    exams: ['Kolonoskopi', 'Hemogram', 'CRP'],
    therapy: 'Rekomandime: ushqim i pasur me fibra, hidratim i mjaftueshëm, aktivitet fizik. Paraqitje urgjente në rast të dhimbjes së fortë në pjesën e poshtme të barkut me ethe.'
  },
  {
    name: 'Hemorroide — K64',
    exams: ['Hemogram', 'Kolonoskopi'],
    therapy: 'Rekomandime: fibra dhe lëngje të mjaftueshme, shmangia e shtrëngimit gjatë defekimit dhe e uljes së gjatë në tualet, higjienë lokale. Kolonoskopi nëse ka gjakderdhje të përsëritur ose mbi moshën 45 vjeç.'
  },
  {
    name: 'Gastroenterit akut — A09',
    exams: ['Hemogram', 'Parazitologji / koprokulturë në feces', 'Elektrolitet (Na, K, Cl)'],
    therapy: 'Rekomandime: rehidratim oral i mjaftueshëm, dietë e lehtë, shmangia e qumështit dhe e ushqimeve të yndyrshme gjatë ditëve të para. Paraqitje urgjente në rast të dehidrimit, gjakut në feces ose etheve të larta që vazhdojnë.'
  }
];

export const URO_TEMPLATES: DiagnosisTemplate[] = [
  {
    name: 'Hiperplazi beninje e prostatës (BPH) — N40',
    exams: ['Ultrazë e traktit urinar dhe e prostatës', 'PSA total / Free PSA', 'Urinë komplet (sediment)', 'Kreatininë, urea dhe eGFR', 'Uroflowmetri'],
    therapy: 'Rekomandime: reduktimi i lëngjeve në mbrëmje, shmangia e kafesë dhe alkoolit, urinim i rregullt pa vonesë, shmangia e ftohjes. Kontroll pas 3 muajsh me vlerësim të simptomave (IPSS). Paraqitje urgjente në rast të pamundësisë së urinimit.'
  },
  {
    name: 'Prostatit kronik — N41.1',
    exams: ['Urinë komplet (sediment)', 'Urinokulturë me antibiogram', 'PSA total / Free PSA', 'Ultrazë e traktit urinar dhe e prostatës'],
    therapy: 'Rekomandime: shmangia e uljes së gjatë dhe e ftohjes, aktivitet fizik i rregullt, hidratim i mjaftueshëm, shmangia e alkoolit dhe ushqimeve pikante. Kontroll pas përfundimit të terapisë.'
  },
  {
    name: 'Infeksion i traktit urinar — N39.0',
    exams: ['Urinë komplet (sediment)', 'Urinokulturë me antibiogram', 'Hemogram', 'CRP'],
    therapy: 'Rekomandime: konsumim i shtuar i lëngjeve (rreth 2 litra në ditë nëse nuk ka kundërindikim), urinim i shpeshtë dhe i plotë, higjienë intime. Terapia antibiotike sipas urinokulturës dhe gjykimit të mjekut. Kontroll i urinës pas përfundimit të terapisë.'
  },
  {
    name: 'Cistit akut — N30.0',
    exams: ['Urinë komplet (sediment)', 'Urinokulturë me antibiogram'],
    therapy: 'Rekomandime: lëngje të bollshme, shmangia e mbajtjes së urinës, higjienë intime, ngrohtësi lokale. Paraqitje në rast të etheve, dhimbjes në anën e shpinës ose gjakut në urinë.'
  },
  {
    name: 'Pielonefrit akut — N10',
    exams: ['Urinë komplet (sediment)', 'Urinokulturë me antibiogram', 'Hemogram', 'CRP', 'Kreatininë, urea dhe eGFR', 'Ultrazë e traktit urinar dhe e prostatës'],
    therapy: 'Rekomandime: pushim, hidratim i mjaftueshëm. Terapia sipas urinokulturës dhe gjykimit të mjekut. Shtrim në spital në rast të etheve të larta, të vjellave, dehidrimit ose përkeqësimit. Kontroll i urinës pas terapisë.'
  },
  {
    name: 'Nefrolitiazë (gurë në veshka) — N20',
    exams: ['Ultrazë e traktit urinar dhe e prostatës', 'Rtg i abdomenit (KUB)', 'CT urografi / CT abdominale', 'Urinë komplet (sediment)', 'Kreatininë, urea dhe eGFR'],
    therapy: 'Rekomandime: marrje e lëngjeve mbi 2.5 litra në ditë, kufizimi i kripës, moderim i proteinave shtazore, filtrimi i urinës nëse mjeku e kërkon. Paraqitje urgjente në rast të dhimbjes së fortë, etheve ose pamundësisë së urinimit.'
  },
  {
    name: 'Kolikë renale — N23',
    exams: ['Ultrazë e traktit urinar dhe e prostatës', 'Urinë komplet (sediment)', 'Rtg i abdomenit (KUB)', 'Kreatininë, urea dhe eGFR'],
    therapy: 'Rekomandime: hidratim, ngrohtësi lokale, filtrimi i urinës për kapjen e gurit. Paraqitje urgjente në rast të etheve, të vjellave të pandalshme ose pamundësisë së urinimit. Kontroll urologjik pas kalimit të episodit.'
  },
  {
    name: 'Hidronefrozë — N13',
    exams: ['Ultrazë e traktit urinar dhe e prostatës', 'Kreatininë, urea dhe eGFR', 'Urinë komplet (sediment)', 'CT urografi / CT abdominale'],
    therapy: 'Rekomandime: kontroll i shkakut të obstruksionit, ndjekje e rregullt e funksionit të veshkave. Kontroll i shpejtë urologjik dhe ultrazë përcjellëse.'
  },
  {
    name: 'Hematuri (gjak në urinë) — R31',
    exams: ['Urinë komplet (sediment)', 'Citologji urinare', 'Ultrazë e traktit urinar dhe e prostatës', 'Cistoskopi', 'CT urografi / CT abdominale'],
    therapy: 'Rekomandime: hematuria kërkon gjithmonë përcaktimin e shkakut dhe ekzaminim të plotë urologjik pa vonesë. Paraqitje urgjente në rast të mpiksjes së gjakut ose pamundësisë së urinimit.'
  },
  {
    name: 'Vlerë e ngritur e PSA — R97.2',
    exams: ['PSA total / Free PSA', 'Ultrazë e traktit urinar dhe e prostatës', 'Urinë komplet (sediment)'],
    therapy: 'Rekomandime: përsëritja e PSA pas 4–6 javësh, pa ejakulim, ciklizëm ose kateterizim 48 orë para marrjes së gjakut, dhe pas përjashtimit të infeksionit. Vlerësim i mëtejshëm urologjik (MRI e prostatës / biopsi) sipas gjykimit të mjekut.'
  },
  {
    name: 'Disfunksion erektil — N52',
    exams: ['Testosteron total', 'Profili lipidik dhe glukoza', 'Hemogram', 'Ultrazë e traktit urinar dhe e prostatës'],
    therapy: 'Rekomandime: ndalimi i duhanit, moderimi i alkoolit, aktivitet fizik, kontrolli i peshës, tensionit dhe diabetit, vlerësim i faktorëve psikologjikë. Terapia sipas gjykimit të mjekut. Kontroll pas 4–8 javësh.'
  },
  {
    name: 'Infertilitet mashkullor — N46',
    exams: ['Spermogram', 'Testosteron total', 'Ultrazë e testikujve', 'Hemogram'],
    therapy: 'Rekomandime: shmangia e duhanit, alkoolit dhe e ekspozimit ndaj nxehtësisë, mënyrë jetese e shëndetshme. Përsëritja e spermogramit pas 2–3 muajsh. Vlerësim i çiftit dhe konsultë sipas nevojës.'
  },
  {
    name: 'Varikocelë — I86.1',
    exams: ['Ultrazë e testikujve', 'Spermogram', 'Testosteron total'],
    therapy: 'Rekomandime: veshje mbështetëse, shmangia e ngritjes së peshave të rënda. Vlerësim për ndërhyrje kirurgjikale kur ka dhimbje, infertilitet ose atrofi testikulare. Kontroll me ultrazë sipas gjykimit të mjekut.'
  },
  {
    name: 'Hidrocelë — N43',
    exams: ['Ultrazë e testikujve'],
    therapy: 'Rekomandime: ndjekje klinike nëse nuk ka bezdi. Konsultë kirurgjikale kur është e madhe ose shkakton shqetësim. Paraqitje urgjente në rast të dhimbjes së fortë të menjëhershme të skrotumit.'
  },
  {
    name: 'Epididimit / orkit — N45',
    exams: ['Ultrazë e testikujve', 'Urinë komplet (sediment)', 'Urinokulturë me antibiogram', 'Hemogram', 'CRP'],
    therapy: 'Rekomandime: pushim, mbështetje e skrotumit, ftohje lokale. Terapia sipas gjykimit të mjekut dhe rezultateve. Paraqitje urgjente në rast të dhimbjes së menjëhershme të fortë (përjashtimi i përdredhjes së testikulit).'
  },
  {
    name: 'Fimozë / balanopostit — N47 / N48.1',
    exams: ['Urinë komplet (sediment)'],
    therapy: 'Rekomandime: higjienë lokale e butë, shmangia e irrituesve. Konsultë për zgjidhje kirurgjikale (qarkprerje) kur fimoza është e theksuar ose e përsëritur.'
  },
  {
    name: 'Fshikëz hiperaktive / inkontinencë urinare — N32.8 / N39.4',
    exams: ['Urinë komplet (sediment)', 'Urinokulturë me antibiogram', 'Ultrazë e traktit urinar dhe e prostatës', 'Uroflowmetri'],
    therapy: 'Rekomandime: ditar i urinimit, trajnim i fshikëzës, moderimi i kafesë dhe lëngjeve në mbrëmje, ushtrime të dyshemesë pelvike, kontrolli i peshës. Kontroll pas 4–6 javësh.'
  },
  {
    name: 'Cistë renale e thjeshtë — N28.1',
    exams: ['Ultrazë e traktit urinar dhe e prostatës', 'Kreatininë, urea dhe eGFR', 'Urinë komplet (sediment)'],
    therapy: 'Rekomandime: ndjekje me ultrazë çdo 6–12 muaj për cistat e thjeshta asimptomatike. Vlerësim shtesë (CT/MRI) nëse ka karakteristika të dyshimta.'
  }
];

/** Exam checklists of the specialties that have their own; the others use EXAMS. */
export const SPECIALTY_EXAMS = {
  Gastroenterologji: [
    'Gastroskopi (EGDS)',
    'Kolonoskopi',
    'Ultrazë abdominale',
    'CT / MRI abdominale',
    'Testi i H. pylori (antigjen në feces)',
    'Calprotectin në feces',
    'Testi i gjakut okult në feces (FOB)',
    'Parazitologji / koprokulturë në feces',
    'Anti-tTG IgA (celiaki)',
    'Enzimat e mëlçisë (ALT, AST, GGT, ALP, bilirubina)',
    'Markerët viralë të hepatitit (HBsAg, Anti-HCV)',
    'Amilazë / Lipazë',
    'Profili lipidik dhe glukoza',
    'Elektrolitet (Na, K, Cl)',
    'CRP',
    'Hemogram'
  ],
  Urologji: [
    'Ultrazë e traktit urinar dhe e prostatës',
    'Ultrazë e testikujve',
    'Urinë komplet (sediment)',
    'Urinokulturë me antibiogram',
    'PSA total / Free PSA',
    'Kreatininë, urea dhe eGFR',
    'Spermogram',
    'Testosteron total',
    'Uroflowmetri',
    'Cistoskopi',
    'Rtg i abdomenit (KUB)',
    'CT urografi / CT abdominale',
    'Citologji urinare',
    'Profili lipidik dhe glukoza',
    'CRP',
    'Hemogram'
  ]
};
