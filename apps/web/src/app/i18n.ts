import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import plCommon from '../locales/pl/common.json';
import plAuth from '../locales/pl/auth.json';
import plNav from '../locales/pl/nav.json';
import plErrors from '../locales/pl/errors.json';
import plCandidates from '../locales/pl/candidates.json';
import plDashboard from '../locales/pl/dashboard.json';
import plAdmin from '../locales/pl/admin.json';
import plOperations from '../locales/pl/operations.json';
import plCommunications from '../locales/pl/communications.json';
import plEmployers from '../locales/pl/employers.json';
import plDuplicates from '../locales/pl/duplicates.json';
import plDocuments from '../locales/pl/documents.json';
import plTasks from '../locales/pl/tasks.json';
import plFailedCandidates from '../locales/pl/failed-candidates.json';
import plProjects from '../locales/pl/projects.json';
import plApply from '../locales/pl/apply.json';

import uaCommon from '../locales/ua/common.json';
import uaAuth from '../locales/ua/auth.json';
import uaNav from '../locales/ua/nav.json';
import uaErrors from '../locales/ua/errors.json';
import uaCandidates from '../locales/ua/candidates.json';
import uaDashboard from '../locales/ua/dashboard.json';
import uaAdmin from '../locales/ua/admin.json';
import uaOperations from '../locales/ua/operations.json';
import uaCommunications from '../locales/ua/communications.json';
import uaEmployers from '../locales/ua/employers.json';
import uaDuplicates from '../locales/ua/duplicates.json';
import uaDocuments from '../locales/ua/documents.json';
import uaTasks from '../locales/ua/tasks.json';
import uaFailedCandidates from '../locales/ua/failed-candidates.json';
import uaProjects from '../locales/ua/projects.json';
import uaApply from '../locales/ua/apply.json';

// RU + EN are partial locales — they exist only to localise the public
// /apply/:slug form. Candidates filling that form can pick any of UA/PL/RU/EN
// regardless of the rest of the CRM staying PL/UA. For namespaces other than
// `apply`, i18next falls back to the PL bundle (configured below).
import ruApply from '../locales/ru/apply.json';
import enApply from '../locales/en/apply.json';

// Note: Ukrainian's ISO 639-1 code is `uk`, not `ua`. We keep `ua` as our
// internal locale key for consistency with project docs (FAZA 0–4 use "UA"),
// but ALSO register `uk` as an alias so navigator.language === 'uk' or 'uk-UA'
// resolves to the Ukrainian resources instead of falling back to Polish.
const uaResources = {
  common: uaCommon,
  auth: uaAuth,
  nav: uaNav,
  errors: uaErrors,
  candidates: uaCandidates,
  dashboard: uaDashboard,
  admin: uaAdmin,
  operations: uaOperations,
  communications: uaCommunications,
  employers: uaEmployers,
  duplicates: uaDuplicates,
  documents: uaDocuments,
  tasks: uaTasks,
  'failed-candidates': uaFailedCandidates,
  projects: uaProjects,
  apply: uaApply,
};

void i18n.use(LanguageDetector).use(initReactI18next).init({
  fallbackLng: 'pl',
  supportedLngs: ['pl', 'ua', 'uk', 'ru', 'en'],
  ns: ['common', 'auth', 'nav', 'errors', 'candidates', 'dashboard', 'admin', 'operations', 'communications', 'employers', 'duplicates', 'documents', 'tasks', 'failed-candidates', 'projects', 'apply'],
  defaultNS: 'common',
  resources: {
    pl: { common: plCommon, auth: plAuth, nav: plNav, errors: plErrors, candidates: plCandidates, dashboard: plDashboard, admin: plAdmin, operations: plOperations, communications: plCommunications, employers: plEmployers, duplicates: plDuplicates, documents: plDocuments, tasks: plTasks, 'failed-candidates': plFailedCandidates, projects: plProjects, apply: plApply },
    ua: uaResources,
    uk: uaResources,
    // Partial locales — only the `apply` namespace is localised. The rest of
    // the CRM stays PL/UA, so picking RU/EN here ONLY affects the public
    // application form.
    ru: { apply: ruApply },
    en: { apply: enApply },
  },
  interpolation: { escapeValue: false },
});

export default i18n;
