// Demo content that is not a person: employer inquiries, message templates and
// internal documents. All companies are fictional; e-mails use example.com.

export const INQUIRIES = [
  { companyName: 'Blue Yonder Freight Sp. z o.o.', contactPerson: 'Marta Lis', email: 'hr@blueyonder.example.com', phone: '+48 555 900 101', message: 'We need 10 warehouse workers for a new site near Wrocław from next month.', status: 'new' as const, source: 'web' as const },
  { companyName: 'Coho Vineyard Logistics', contactPerson: 'Jan Kurek', email: 'jan.kurek@coho.example.com', phone: '+48 555 900 102', message: 'Seasonal staff for packing, 3 months, accommodation needed.', status: 'contacted' as const, source: 'web' as const },
  { companyName: 'Trey Research Electronics', contactPerson: 'Iwona Bąk', email: 'iwona.bak@treyresearch.example.com', phone: '+48 555 900 103', message: 'Assembly line, 2 shifts, 6 people.', status: 'accepted' as const, source: 'manual' as const },
  { companyName: 'Fourth Coffee Roastery', contactPerson: 'Olaf Mróz', email: 'olaf@fourthcoffee.example.com', phone: '+48 555 900 104', message: 'Looking for 2 people for the packing department.', status: 'rejected' as const, source: 'web' as const },
  { companyName: 'Southridge Video Distribution', contactPerson: 'Daria Sikora', email: 'daria.sikora@southridge.example.com', phone: '+48 555 900 105', message: 'Peak season support in December, around 20 people.', status: 'new' as const, source: 'web' as const },
];

export const TEMPLATES = [
  {
    name: 'Job offer — warehouse (PL)',
    channel: 'email' as const,
    subject: 'Oferta pracy w magazynie',
    body: '<p>Dzień dobry {{firstName}},</p><p>mamy dla Ciebie ofertę pracy w magazynie. Odpowiedz na tę wiadomość, jeśli jesteś zainteresowany(-a).</p><p>Zespół OPUS HR (demo)</p>',
    variables: ['firstName'],
  },
  {
    name: 'Documents checklist (UA)',
    channel: 'email' as const,
    subject: 'Список документів',
    body: '<p>Вітаємо, {{firstName}}!</p><p>Щоб розпочати роботу, підготуйте, будь ласка: паспорт, PESEL, медичну довідку.</p>',
    variables: ['firstName'],
  },
  {
    name: 'Start-day reminder (SMS)',
    channel: 'sms' as const,
    subject: null,
    body: 'Przypominamy: start pracy jutro o 6:00. Do zobaczenia! OPUS HR (demo)',
    variables: [],
  },
];

export const DOCUMENTS = [
  {
    slug: 'demo-crm-rules',
    title: 'CRM usage rules (demo)',
    category: 'regulamin' as const,
    requiresAcceptance: true,
    contentMd: [
      '# CRM usage rules',
      '',
      'This is a **demo document** shown to every user on first login until accepted.',
      '',
      '1. Enter candidate data only with a recorded processing basis (RODO / GDPR).',
      '2. Never copy personal data out of the CRM into private notes or messengers.',
      '3. Every change is written to the audit log.',
    ].join('\n'),
  },
  {
    slug: 'demo-gdpr-procedure',
    title: 'Right-to-be-forgotten procedure (demo)',
    category: 'rodo' as const,
    requiresAcceptance: false,
    contentMd: [
      '# Right-to-be-forgotten procedure',
      '',
      '- A request can arrive by e-mail, phone or the withdrawal link in any message.',
      '- An admin anonymises the candidate from the candidate card (RODO tab).',
      '- Personal fields are replaced, the audit entry records only boolean flags.',
    ].join('\n'),
  },
];
