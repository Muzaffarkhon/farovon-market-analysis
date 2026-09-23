/**
 * Типы ответов сервера. Сняты вручную с контроллеров:
 *   authController.getUserPayload / resume, surveyController.mapSurveyRow,
 *   adminController.getRoleCapabilities / getUserCapabilities.
 * Лишние поля ответов здесь не описаны намеренно — типы фиксируют то, чем
 * пользуется новый клиент.
 */
export type Role = 'admin' | 'cb' | 'hrbp' | 'dir_head' | 'head' | 'user';

export interface Bonus { type: string; size: string; per: string }

export interface Survey {
  id: string; unit: string; company: string; posOur: string; posTheir: string; grade: string;
  payFrom: string | number; payTo: string | number; cur: string; payPer: string;
  bonuses: Bonus[]; bonHas: string; bonSize: string; bonType: string; bonPer: string;
  schedule: string; benefits: string[]; extra: string; note: string; source: string; trust: string; by: string; at: string;
}

export interface Unit { unit: string; dir: string; group: string; total: number; done: number; surveys: number; note: string }
export interface Period { id: number | null; name: string; state: string }
export interface PeriodGrant { periodId: number; periodName: string; expiresAt: string }

export interface Ref {
  schedules: string[]; bonusTypes: string[]; bonusPeriods: string[]; sources: string[]; trust: string[];
}
export interface BenefitGroup { category: string; items: string[] }

export interface SessionUser {
  id: number; login: string; fio: string; role: Role; units: string[]; capabilities: string[];
  onboarded: boolean; hasTelegram: boolean;
}

export interface SessionData {
  user: SessionUser;
  appVersion: string;
  period: Period;
  myPeriodGrants: PeriodGrant[];
  mustChangePassword: boolean;
  needsUnitPick: boolean;
  units: Unit[];
  allUnits: { unit: string; dir: string; group_key: string }[];
  companies: { name: string; seg: string; region: string }[];
  positionsByUnit: Record<string, string[]>;
  companiesByGroup: Record<string, string[]>;
  benefits: BenefitGroup[];
  ref: Ref;
}

export interface OkResponse { ok: true }
export interface ResumeResponse { ok: true; data: SessionData }
export interface ForPeriodResponse { ok: true; surveys: Survey[]; progress: { decided: number; total: number } }
export interface SelectionsResponse { ok: true; selections: Record<string, string[]>; noComparison: string[] }
export interface SaveDetailsResponse { ok: true; units?: string[] }
export interface AddCompanyResponse { ok: true; name: string; list: string[] }
export interface NoComparisonResponse { ok: true; units: string[] }

export interface Capability { id: string; resource: string; resourceLabel: string; label: string }
export interface RoleInfo { key: string; label: string; is_protected: boolean; is_admin: boolean; users: number; note: string }
export interface RoleMatrixResponse { ok: true; capabilities: Capability[]; matrix: Record<string, string[]>; roles: RoleInfo[] }

export interface Grant {
  userLogin: string; userFio: string; userRole: Role; capability: string; effect: 'grant' | 'deny';
  grantedBy: string; grantedAt: string; expiresAt: string | null;
}
export interface UserCapabilitiesResponse {
  ok: true; capabilities: Capability[];
  users: { login: string; fio: string; role: Role; active: boolean }[];
  grants: Grant[]; roleCapabilities: Record<string, string[]>; roleLabels: Record<string, string>;
}

/** Черновик записи в форме: всё строками/массивами, как вводит пользователь. */
export interface SurveyDraft {
  id?: string;
  company: string; posOur: string; posTheir?: string; grade?: string;
  payFrom: string; payTo: string; cur: string; payPer: string;
  bonHas: string; bonuses: Bonus[];
  schedule: string; benefits: string[]; extra: string;
  source: string; trust: string; note: string;
}

// ─── Реестр собранных данных ───

/** Свёртка переменной части для колонки «Переменная часть» (считает сервер). */
export interface VarPay { has: boolean; label: string; monthly: number | null }

export interface RegistryRow {
  id: string; date: string; by: string;
  dir: string; hrbp: string; unit: string; region: string;
  company: string; posOur: string; posTheir: string; grade: string;
  payFrom: number; payTo: number; cur: string; payPer: string;
  bonHas: string; bonuses: Bonus[]; varPay: VarPay; totalMonthly: number | null;
  benefits: string[]; extra: string; schedule: string;
  source: string; trust: string; note: string;
}

export interface RegistryFacets {
  dirs: string[]; hrbps: string[]; regions: string[]; units: string[]; companies: string[];
  sources: string[]; trusts: string[]; schedules: string[]; currencies: string[]; grades: string[];
}

export interface RegistryResponse {
  ok: true;
  rows: RegistryRow[];
  total: number; totalAll: number; unmapped: number;
  page: number; pages: number; perPage: number;
  facets: RegistryFacets;
  scoped: boolean;
  period: { id: number; name: string } | null;
}

/** Ключи фильтров реестра = имена параметров в адресе. */
export interface RegistryFilters {
  period?: number | null;
  search?: string;
  dir?: string; hrbp?: string; region?: string; unit?: string; company?: string;
  posOur?: string; source?: string; trust?: string; schedule?: string; cur?: string; grade?: string;
  onlyUnmapped?: boolean; withPayOnly?: boolean;
  sort?: string; order?: 'asc' | 'desc';
  page?: number; perPage?: number;
}
