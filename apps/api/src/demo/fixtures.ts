// Static, obviously fictional data for the public demo. Every person and
// company here is invented: e-mails use the reserved example.com / .example
// domains, phones use the +48 555 range. Nothing is derived from real records.

export const DEMO_DOMAIN = 'opus-demo.example';

type Role = 'admin' | 'recruiter' | 'coordinator' | 'readonly';

export interface StaffFixture {
  key: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  isFreelancer?: boolean;
  publicSlug?: string;
  // Shared-guest accounts get DEMO_USER_PASSWORD; the rest get a random,
  // never-printed password so they exist only as data.
  canLogin: boolean;
}

// `email` of the `demo` entry is overridden by DEMO_USER_EMAIL at seed time.
export const STAFF: StaffFixture[] = [
  { key: 'demo', email: `demo@${DEMO_DOMAIN}`, firstName: 'Demo', lastName: 'Admin', role: 'admin', publicSlug: 'demo-admin', canLogin: true },
  { key: 'rec1', email: `recruiter@${DEMO_DOMAIN}`, firstName: 'Alicja', lastName: 'Nowicka', role: 'recruiter', publicSlug: 'alicja-nowicka', canLogin: true },
  { key: 'coord1', email: `coordinator@${DEMO_DOMAIN}`, firstName: 'Karolina', lastName: 'Wrona', role: 'coordinator', canLogin: true },
  { key: 'ro', email: `readonly@${DEMO_DOMAIN}`, firstName: 'Ewa', lastName: 'Sowa', role: 'readonly', canLogin: true },
  { key: 'rec2', email: `bartosz.zielinski@${DEMO_DOMAIN}`, firstName: 'Bartosz', lastName: 'Zieliński', role: 'recruiter', publicSlug: 'bartosz-zielinski', canLogin: false },
  { key: 'rec3', email: `oksana.melnyk@${DEMO_DOMAIN}`, firstName: 'Oksana', lastName: 'Melnyk', role: 'recruiter', publicSlug: 'oksana-melnyk', canLogin: false },
  { key: 'rec4', email: `taras.bondar@${DEMO_DOMAIN}`, firstName: 'Taras', lastName: 'Bondar', role: 'recruiter', isFreelancer: true, publicSlug: 'taras-bondar', canLogin: false },
  { key: 'coord2', email: `mykhailo.savchuk@${DEMO_DOMAIN}`, firstName: 'Mykhailo', lastName: 'Savchuk', role: 'coordinator', canLogin: false },
];

export interface ProjectFixture {
  name: string;
  headcountNeeded: number;
  startInDays: number; // relative to today; negative = already started
  isActive: boolean;
  notes: string | null;
}

// The first seven names match migration 0014, which inserts them on every
// fresh database; the seed upserts by name and fills in the details.
export const PROJECTS: ProjectFixture[] = [
  { name: 'Northwind Logistics Wrocław', headcountNeeded: 30, startInDays: -60, isActive: true, notes: 'Night shifts, forklift licence (UDT) preferred.' },
  { name: 'Contoso Foods Poznań', headcountNeeded: 28, startInDays: -30, isActive: true, notes: 'Food production line, sanitary booklet required.' },
  { name: 'Fabrikam Packaging Legnica', headcountNeeded: 16, startInDays: -14, isActive: true, notes: null },
  { name: 'Tailspin Parcel Hub Łódź', headcountNeeded: 30, startInDays: 7, isActive: true, notes: 'Peak season ramp-up.' },
  { name: 'Adventure Works Opole', headcountNeeded: 18, startInDays: 14, isActive: true, notes: 'Assembly, two-shift system.' },
  { name: 'Litware Cold Store Gliwice', headcountNeeded: 12, startInDays: -90, isActive: true, notes: 'Cold store (-25°C), thermal clothing provided.' },
  { name: 'Proseware Print Katowice', headcountNeeded: 20, startInDays: 30, isActive: true, notes: null },
  { name: 'Wingtip Seasonal Harvest', headcountNeeded: 0, startInDays: -200, isActive: false, notes: 'Closed season project.' },
];

export const NAMES = {
  plMale: ['Piotr', 'Marek', 'Tomasz', 'Krzysztof', 'Łukasz', 'Michał', 'Paweł', 'Jakub', 'Adam', 'Kamil'],
  plFemale: ['Anna', 'Katarzyna', 'Agnieszka', 'Joanna', 'Monika', 'Marta', 'Natalia', 'Zofia', 'Ewelina', 'Paulina'],
  plLastMale: ['Nowak', 'Kowalski', 'Wiśniewski', 'Wójcik', 'Kamiński', 'Lewandowski', 'Zając', 'Dąbrowski', 'Mazur', 'Krawczyk'],
  plLastFemale: ['Nowak', 'Kowalska', 'Wiśniewska', 'Wójcik', 'Kamińska', 'Lewandowska', 'Zając', 'Dąbrowska', 'Mazur', 'Krawczyk'],
  uaMale: ['Serhii', 'Oleksii', 'Andrii', 'Mykola', 'Vasyl', 'Ivan', 'Dmytro', 'Oleh', 'Ihor', 'Yurii'],
  uaFemale: ['Olena', 'Nataliia', 'Oksana', 'Iryna', 'Tetiana', 'Liudmyla', 'Svitlana', 'Yuliia', 'Mariia', 'Halyna'],
  uaLast: ['Ivanenko', 'Shevchenko', 'Bondarenko', 'Kovalenko', 'Tkachenko', 'Kravchenko', 'Lysenko', 'Melnyk', 'Hnatenko', 'Romanenko'],
};

// Codes below exist in status_lookups after migrations (see 0023/0033/0034/0048).
export const SOURCES: Array<[string, number]> = [
  ['facebook', 30], ['work_ua', 18], ['form_recruiter', 14], ['website', 10],
  ['flagma', 8], ['instagram', 7], ['referral', 9], ['unknown', 4],
];
export const UA_NATIONALITIES: Array<[string, number]> = [
  ['ua', 80], ['md', 7], ['bialoruskie', 6], ['gruzinskie', 7],
];
export const LEGAL_STATUSES = ['status_ukr', 'karta_pobytu', 'bezviz', 'viza', 'podacha_na_kp'];
export const POSITIONS = ['magazynier', 'magazynier_udt'];
export const DISMISSAL_REASONS = [
  'employee_resigned', 'found_other_job', 'contract_ended', 'returned_home',
  'absenteeism', 'low_performance', 'health_issues', 'other',
];

export const CANCEL_NOTES = [
  'Stopped answering the phone after the interview.',
  'Found a job closer to home.',
  'Visa application was rejected.',
  'Did not accept the night-shift schedule.',
  'Client closed the position before arrival.',
];
export const BLACKLIST_NOTES = [
  'No-show on the first day twice.',
  'Broke the housing rules (demo note).',
];
export const NOTES = [
  'Needs accommodation from day one.',
  'Can start immediately.',
  'Prefers day shifts only.',
  'Has a UDT forklift certificate.',
  'Speaks Polish at A2 level.',
  'Travels together with a friend — keep them on the same project.',
];
export const EXPERIENCE = [
  '2 years in a logistics warehouse (picking, packing).',
  'Forklift operator, 3 years.',
  'Production line worker in food industry.',
  'No formal experience, motivated to learn.',
  'Courier and parcel sorting, 1 year.',
];
export const COMMENTS = [
  'Called — confirmed arrival date.',
  'Sent the document checklist via messenger.',
  'Documents received, waiting for the medical check.',
  'Coordinator confirmed a bed in our housing.',
  'Asked to move to the day shift next month.',
  'First week feedback from the client: very good.',
  'Reminder: residence card expires soon.',
];
export const TASKS = [
  'Call back about the start date',
  'Check the medical certificate',
  'Book a bed in the housing',
  'Send the contract draft',
  'Confirm the bus ticket',
  'Collect the timesheet for the month',
  'Follow up on the residence-card application',
];
