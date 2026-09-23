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

// ─── Дашборды (аналитика) ───

/** Вилка: min/p25/median/p75/max/avg — общая форма для всех разрезов ниже. */
export interface ForkStats { count: number; min: number; p25: number; median: number; p75: number; max: number; avg: number }
export interface RegionStat extends ForkStats { region: string }
export interface TrustStat extends ForkStats { trust: string }
export interface SourceStat extends ForkStats { source: string }
export interface ScheduleStat extends ForkStats { schedule: string }
export interface GradeStat extends ForkStats { grade: string }

export interface CompanyStat {
  company: string; unit: string; dir: string; pFrom: number; pTo: number; avg: number;
  hourly: boolean; hourFrom: number; hourTo: number; cur: string; payPer: string;
  bonHas: string; bonSize: string; bonType: string; bonPer: string;
  bonuses: Bonus[]; varPay: VarPay; total: number | null; benefits: string[]; note: string;
}

/** Одна должность в «Зарплатных вилках»: вилка рынка + гэп к Фаровону + совокупный доход. */
export interface PositionStat extends ForkStats {
  pos: string; count: number; withSalaryCount: number;
  bonCompanies: number; bonQuantified: number; totalSampleCount: number; bonTopPer: string;
  totalMedian: number; forkSpreadPct: number;
  ourFrom: number; ourTo: number; ourMid: number; gapPct: number | null;
  companies: CompanyStat[];
}

export interface UnitProgress { unitsTotal: number; unitsDone: number; compTotal: number; compDone: number; surveysTotal: number; pct: number }
export interface HrbpProgress extends UnitProgress { hrbp: string }
export interface DirProgress extends UnitProgress { dir: string }

export interface TopBenefit { name: string; count: number; pct: number }
export interface TopCompetitor { company: string; count: number }
export interface BonusStats { hasBonus: number; noBonus: number; unknown: number; types: Record<string, number>; periods: Record<string, number> }

export interface DashboardSummary {
  totalDivisions: number; completedDivisions: number; divCompletionPct: number;
  totalCompetitorLinks: number; checkedCompetitorLinks: number; compCompletionPct: number;
  totalSurveyRecords: number; recordsWithSalary: number; positionsCount: number;
  companiesInSurvey: number; unmappedRecords: number;
  salaryMedian: number; salaryP25: number; salaryP75: number;
}

export interface DashboardPeriod { name: string; state: string; from: string; to: string; by: string; at: string }
export interface DashboardPeriodOption { id: number; name: string; fromDate: string; toDate: string; at: string }

export interface DashboardResponse {
  ok: true;
  summary: DashboardSummary;
  hrbpProgress: HrbpProgress[];
  dirProgress: DirProgress[];
  dirHrbp: Record<string, string[]>;
  regions: string[];
  regionStats: RegionStat[];
  trustStats: TrustStat[];
  sourceStats: SourceStat[];
  scheduleStats: ScheduleStat[];
  gradeStats: GradeStat[];
  positions: PositionStat[];
  topBenefits: TopBenefit[];
  bonuses: BonusStats;
  topCompetitors: TopCompetitor[];
  currencies: Record<string, number>;
  period: DashboardPeriod;
  periodsList: DashboardPeriodOption[];
  viewingPeriodId: number | null;
  scoped: boolean;
}

/** Фильтры дашборда = параметры адреса (как у RegistryFilters). */
export interface DashboardFilters {
  period?: number | null;
  dir?: string; hrbp?: string; region?: string; search?: string;
}

// ─── Бенчмаркинг (только чтение — сравнение по должности) ───

export interface PercentileStats { count: number; min: number; p10: number; p25: number; p50: number; p75: number; p90: number; max: number; avg: number }

export interface BenchmarkSourceResult {
  sourceKey: string; sourceTitle: string; sourceKind: string; isLicensed: boolean;
  dataAsOf?: string; hasData: boolean; stats: PercentileStats | null;
  gapPercent: number | null; gapAmount: number | null;
  weight: number; share: number; compaRatio: number | null;
}

export interface BenchmarkInternal {
  sourceKey: 'internal'; sourceTitle: string;
  observationsCount: number; stats: PercentileStats;
  gapPercent: number | null; gapAmount: number | null;
  weight: number; share: number; compaRatio: number | null;
}

export interface BenchmarkCompareResult {
  position: { id: number; name: string; ourPayFrom: number; ourPayTo: number; ourMid: number };
  internal: BenchmarkInternal;
  external: BenchmarkSourceResult[];
  summary: {
    sourcesCount: number; compositeMedian: number;
    compositeGapPercent: number | null; compositeGapAmount: number | null; compaRatio: number | null;
  };
}

export interface BenchmarkGap { positionId: number; positionName: string; ourMid: number; marketMedian: number; gapPercent: number; gapAmount: number }
export interface BenchmarkSummaryWidgets { totalPositions: number; mappedPositions: number; coveragePercent: number; belowMarket: BenchmarkGap[]; aboveMarket: BenchmarkGap[] }

// ─── Координация для HR BP ───

export interface CoordinationUnit {
  unit: string; dir: string; hrbp: string; resp: string; head: string;
  positionsTotal: number; positionsDecided: number;
  state: 'не начато' | 'в процессе' | 'полностью';
  lastActivityAt: string;
}

export interface CoordinationPerson {
  login: string; fio: string; units: string[];
  positionsTotal: number; positionsDecided: number;
  lastLoginAt: string; hasTelegram: boolean;
}

export interface CoordinationFeedItem {
  unit: string; dir: string; company: string; posOur: string; by: string; at: string;
}

export interface CoordinationResponse {
  ok: true;
  units: CoordinationUnit[];
  people: CoordinationPerson[];
  feed: CoordinationFeedItem[];
}

export interface RemindResponse { ok: true; sent: number; skipped: number }

// ─── Оценка должностей (грейдирование) ───

export interface GradingFactor { code: string; title: string; help: string; options: string[]; examples: string[] }
export interface GradingLevel { grade: number; from: number; name: string; label: string }

export interface GradingFactorsResponse {
  ok: true;
  criteria: GradingFactor[];
  weights: number[];
  maxGrade: number;
  grades: GradingLevel[];
  riskFactors: GradingFactor[];
  riskLevels: { status: string; label: string; max: number; recommendation: string }[];
  overrideDirs?: string[];
}

export interface GradingBlock { key: string; label: string; sort: number; position_count: number; evaluated_count: number }

export interface GradingPositionUnit { unit: string; staffCount: number }

export interface GradingSubmission { factor_1: number; factor_2: number; factor_3: number; factor_4: number; factor_5: number; factor_6: number; factor_7: number; notes: string }

export interface GradingPosition {
  job_title: string; unit_count: number; staff_count: number;
  evaluation_id: number | null;
  factor_1: number | null; factor_2: number | null; factor_3: number | null; factor_4: number | null;
  factor_5: number | null; factor_6: number | null; factor_7: number | null;
  weighted_score: number | null; grade_level: number | null; evaluated_by: string | null; notes: string | null; updated_at: string | null;
  submitted_count: number;
  units: GradingPositionUnit[];
  committee_size?: number;
  my_submission?: GradingSubmission | null;
}

export interface GradingPositionsResponse {
  ok: true;
  block: { key: string; label: string };
  committeeSize: number;
  isCommitteeMember: boolean;
  factorCount: number;
  rows: GradingPosition[];
}

export interface GradingEvaluateResponse {
  ok: true;
  message: string;
  weightedScore?: number;
  gradeLevel?: number;
  pending?: boolean;
  finalized?: boolean;
  submittedCount?: number;
  committeeSize?: number;
}

export interface GradingStatsResponse { ok: true; total: number; rows: { block_key: string; grade_level: number; n: number }[] }

// ─── Администрирование: настройка грейдирования ───

export type GradingFactorScope = 'position' | 'risk';
export interface SaveFactorPayload {
  scope: GradingFactorScope; idx: number; dir: string; title: string; help: string; options: string[]; examples: string[];
}
export interface ResetFactorPayload { scope: GradingFactorScope; idx: number; dir: string }

export interface AdminGradingBlock { key: string; label: string; sort: number; pair_count: number }
export interface AdminGradingBlocksResponse { ok: true; rows: AdminGradingBlock[] }

export interface AdminBlockPosition { unit: string; position: string; staff_count: number }
export interface AdminBlockPositionsResponse { ok: true; rows: AdminBlockPosition[]; total: number }

export interface CommitteeMember { login: string; fio: string | null; role: string | null }
export interface CommitteeResponse { ok: true; rows: CommitteeMember[] }

export interface PendingCommitteeJob { job_title: string; submitted_count: number }
export interface CommitteePendingResponse { ok: true; committeeSize: number; rows: PendingCommitteeJob[] }
export interface OkMessageResponse { ok: true; message: string }

// ─── Риски незаменимости ключевого персонала ───

export interface KeyRisk {
  id: number; unit: string; employee_fio: string; job_title: string;
  bus_factor: number; replacement_time: number; knowledge_monopoly: number; financial_risk: number;
  total_risk_score: number; risk_status: 'standard' | 'attention' | 'critical';
  action_plan: string; evaluator_fio: string; updated_at: string;
}

export interface KeyRiskLevel { status: string; label: string; max: number }
export interface KeyRisksListResponse { ok: true; levels: KeyRiskLevel[]; rows: KeyRisk[] }

export interface UnitEmployee { fio: string; position: string }
export interface UnitEmployeesResponse { ok: true; rows: UnitEmployee[] }

export interface HeatmapRow { dir: string; standard: number; attention: number; critical: number; total: number }
export interface HeatmapResponse { ok: true; rows: HeatmapRow[] }

export interface RiskEvaluateResponse { ok: true; totalScore: number; status: string; statusLabel: string; actionPlan: string; message: string }

// ─── Администрирование: пользователи ───

export interface AdminUser {
  id: number; login: string; fio: string; role: Role; phone: string; position: string;
  units: string[]; active: boolean; lastIn: string; hasTelegram: boolean; hasPassword: boolean;
}
export interface AdminUsersResponse { ok: true; users: AdminUser[] }

export interface ArchivedUser {
  id: number; login: string; fio: string; role: Role; phone: string; units: string[]; archivedAt: string;
}
export interface ArchivedUsersResponse { ok: true; users: ArchivedUser[] }

export interface SaveUserPayload {
  login?: string; fio: string; role: string; phone: string; position: string; units: string[]; active: boolean;
}
export interface SaveUserResponse { ok: true; login: string; message: string }
export interface ResetPasswordResponse { ok: true; login: string; delivered: boolean }

// ─── Администрирование: оргструктура ───

export interface Division {
  id: number; num: number | null; dir: string; unit: string; level: string | null;
  head: string; resp: string; hrbp: string; cnt: number | null; note: string;
  group_key: string | null; region: string | null; org_role: string | null;
  is_survey_target: number; is_hidden: number; parent_unit: string | null;
}
export interface DivisionsResponse { ok: true; divisions: Division[]; groupSuggestions: unknown[] }

export interface SaveDivisionPayload {
  unit: string; dir?: string; head?: string; resp?: string; hrbp?: string; note?: string;
  group?: string; region?: string; org_role?: string; is_survey_target?: number;
}
export interface CreateDivisionPayload { unit: string; dir?: string; head?: string; resp?: string; hrbp?: string; region?: string; note?: string }
export interface CreateDivisionResponse { ok: true; division: Division; message: string }
export interface MoveDivisionPayload { unit: string; targetDir: string; parentUnit?: string | null; cascadeCompetitors?: boolean }
export interface MoveDivisionResponse { ok: true; message: string; unit: string; newDir: string; newParentUnit: string | null; competitorsUpdated: number }
export interface BatchAssignPayload { dir: string; roleType: 'head' | 'hrbp' | 'resp'; personName: string }
export interface BatchAssignResponse { ok: true; message: string; affectedDivisions: number }

// ─── Администрирование: справочник сотрудников ───

export interface StaffRecord { id: number; unit: string; fio: string; position: string }
export interface StaffDirectoryResponse { ok: true; items: StaffRecord[]; importedAt: string | null }
export interface SaveStaffPayload { id?: number; unit: string; fio: string; position: string }
export interface SaveStaffResponse { ok: true; id: number | null }

export interface StaffImportSkippedRow { row: number; reason: string }
export interface StaffImportUnmatchedUnit { unit: string; count: number }
export interface StaffImportReport {
  rowsInFile: number; rowsPrepared: number; rowsSkipped: number; skippedRows: StaffImportSkippedRow[];
  units: number; unmatchedUnits: StaffImportUnmatchedUnit[]; unmatchedCount: number;
}
export interface StaffImportDryRunResponse { ok: true; dryRun: true; report: StaffImportReport }
export interface StaffImportCommitResponse { ok: true; message: string }

