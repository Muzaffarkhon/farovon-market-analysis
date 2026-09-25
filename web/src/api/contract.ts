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
  needsAssignment: boolean;
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
export interface ChangeNameResponse { ok: true; message: string; data: SessionData }
export interface SetUnitsResponse { ok: true; data: SessionData }
export interface LiveSignatureResponse { ok: true; sig: string; version: string }
export interface TelegramBotInfoResponse { ok: true; username: string | null }
export interface TelegramLinkResponse { ok: true; deepLink: string; expiresInMinutes: number }
export interface ForPeriodResponse { ok: true; surveys: Survey[]; progress: { decided: number; total: number } }
export interface SelectionsResponse { ok: true; selections: Record<string, string[]>; noComparison: string[] }
export interface SaveDetailsResponse { ok: true; units?: string[] }
export interface AddCompanyResponse { ok: true; name: string; list: string[] }
export interface NoComparisonResponse { ok: true; units: string[] }

export interface Capability { id: string; resource: string; resourceLabel: string; label: string }
export interface RoleInfo { key: string; label: string; is_protected: boolean; is_admin: boolean; structural: boolean; users: number; note: string }
export interface RoleMatrixResponse { ok: true; capabilities: Capability[]; matrix: Record<string, string[]>; roles: RoleInfo[] }
export interface CreateRoleResponse { ok: true; key: string; label: string }
export interface RenameRoleResponse { ok: true; key: string; label: string }

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
  recordSource: 'manual' | 'import';
}

export interface RegistryFacets {
  dirs: string[]; hrbps: string[]; regions: string[]; units: string[]; companies: string[];
  sources: string[]; trusts: string[]; schedules: string[]; currencies: string[]; grades: string[];
  recordSources: string[];
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
  recordSource?: string;
  onlyUnmapped?: boolean; withPayOnly?: boolean; withExtraOnly?: boolean;
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
  has_reset_backup?: boolean;
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

export interface AdminBlockPosition { unit: string; position: string; staff_count: number; has_reset_backup: boolean }
export interface AdminBlockPositionsResponse { ok: true; rows: AdminBlockPosition[]; total: number }

export interface CommitteeMember { login: string; fio: string | null; role: string | null }
export interface CommitteeResponse { ok: true; rows: CommitteeMember[] }

export interface PendingCommitteeJob { job_title: string; submitted_count: number }
export interface CommitteePendingResponse { ok: true; committeeSize: number; rows: PendingCommitteeJob[] }
export interface OkMessageResponse { ok: true; message: string }

export interface CommitteeSubmissionRow {
  evaluator_login: string; evaluator_fio: string;
  factor_1: number; factor_2: number; factor_3: number; factor_4: number; factor_5: number; factor_6: number; factor_7: number;
  weighted_score: number; notes: string | null; submitted_at: string;
}
export interface CommitteeBreakdownResponse {
  ok: true;
  submissions: CommitteeSubmissionRow[];
  final: { weighted_score: number; grade_level: number | null; factor_1: number; factor_2: number; factor_3: number; factor_4: number; factor_5: number; factor_6: number; factor_7: number; evaluated_by: string } | null;
  finalized: boolean;
  committeeSize: number;
}

// ─── Администрирование: бенчмаркинг ───

export interface BenchmarkSource {
  key: string; title: string; kind: string; is_licensed: number; default_currency: string; notes: string; weight: number; hidden: number;
}
export interface BenchmarkSourcesResponse { ok: true; sources: BenchmarkSource[] }
export interface CreateSourcePayload { key: string; title: string; kind: string; isLicensed: boolean; defaultCurrency: string; notes: string }
export interface UpdateSourcePayload { key: string; title?: string; kind?: string; defaultCurrency?: string; isLicensed?: boolean; notes?: string; hidden?: boolean }
export interface SourceResponse { ok: true; source: BenchmarkSource }
export interface SourceWeightsResponse { ok: true; weights: Record<string, number> }

export interface BenchmarkDataset {
  id: number; source_key: string; source_title: string; title: string; report_date: string | null; data_as_of: string | null;
  currency: string; uploaded_by: string; state: string; row_count: number; uploaded_at: string;
}
export interface DatasetsResponse { ok: true; datasets: BenchmarkDataset[] }

export interface SourcePosition { id: number; source_key: string; code: string | null; label: string; family: string | null; mapped_count: number }
export interface SourcePositionsResponse { ok: true; positions: SourcePosition[] }

export interface PositionMapping {
  id: number; confidence: string; note: string; mapped_by: string; mapped_at: string;
  dict_position_id: number; dict_position_name: string; our_pay_from: number | null; our_pay_to: number | null;
  source_position_id: number; source_key: string; source_code: string | null; source_label: string; source_title: string; is_licensed: number;
}
export interface MappingsResponse { ok: true; mappings: PositionMapping[] }
export interface SaveMappingPayload { dictPositionId: number; sourcePositionId: number; confidence?: string; note?: string }

export interface MappingSuggestion {
  sourcePosition: { id: number; label: string; code: string | null; family: string | null };
  suggestedDictPosition: { id: number; name: string };
  score?: number;
}
export interface SuggestMappingsResponse { ok: true; suggestions: MappingSuggestion[] }

export interface FxRateResponse { ok: true; rate: number; date: string; currencies: string[] }
export interface XlsxSheetsResponse { ok: true; sheets: string[] }
export interface XlsxGridResponse { ok: true; rows: string[][] }

export type BenchmarkImportMode = 'percentiles' | 'raw';
export interface BenchmarkColumnMap {
  posLabel?: number; code?: number; region?: number; grade?: number; industry?: number;
  p25?: number; p50?: number; p75?: number; p10?: number; p90?: number; min?: number; max?: number; avg?: number; sampleN?: number;
  value?: number; payFrom?: number; company?: number;
}
export interface BenchmarkImportRequest {
  sourceKey: string; text: string; mode: BenchmarkImportMode; columnMap: BenchmarkColumnMap;
  currency: string; reportDate: string; dataAsOf: string; title: string; fxRate?: number;
}
export interface BenchmarkImportPreviewRow {
  line: number; label: string; code: string; region: string; grade: string;
  p25?: number; p50?: number; p75?: number; p25Tjs?: number; p50Tjs?: number; p75Tjs?: number; sampleN?: number;
  value?: number; valueTjs?: number; currency: string;
}
export interface BenchmarkImportReport {
  source: { key: string; title: string; isLicensed: boolean };
  headers: string[]; totalLines: number; validRows: number;
  newPositionsCount: number; newPositionsList: string[];
  preview: BenchmarkImportPreviewRow[];
  errors: { line: number; message: string }[]; warnings: { line: number; message: string }[];
}
export interface DryRunImportResponse { ok: true; report: BenchmarkImportReport }
export interface CommitImportResponse { ok: true; result: { datasetId: number; datasetTitle: string; insertedRowsCount: number }; message: string }

// ─── Администрирование: периоды сбора ───

export interface PeriodRow {
  id: number; name: string; state: string; isActive: number;
  fromDate: string | null; toDate: string | null; updatedAt: string | null; updatedBy: string | null; surveysCount: number;
}
export interface PeriodGrantRow {
  userLogin: string; userFio: string; periodId: number; periodName: string; grantedBy: string; grantedAt: string; expiresAt: string;
}
export interface PeriodGrantsResponse { ok: true; grants: PeriodGrantRow[]; periods: PeriodRow[] }

export type PeriodAction = 'close' | 'reopen' | 'new' | 'edit' | 'activate';
export interface SetPeriodPayload { action: PeriodAction; name?: string; from?: string; to?: string; state?: string; id?: number }
export interface SetPeriodResponse { ok: true; period: DashboardPeriod; already?: boolean }

export interface PeriodGrantUser { login: string; fio: string; active: boolean }
export interface PeriodGrantUsersResponse { ok: true; users: PeriodGrantUser[] }

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
export interface AdjacentGroupSuggestion { key: string; dir: string; units: { unit: string; region: string }[] }
export interface DivisionsResponse { ok: true; divisions: Division[]; groupSuggestions: AdjacentGroupSuggestion[] }

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
export interface ApplyAdjacentGroupPayload { key: string; units: string[]; force?: boolean }
export interface ApplyAdjacentGroupResponse { ok: true; key: string; applied: number }
export interface ClearAdjacentGroupPayload { key: string }
export interface ClearAdjacentGroupResponse { ok: true; key: string; cleared: number }

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

// ─── Администрирование: справочники (компании/должности/сегменты/регионы) ───

export type DictKind = 'companies' | 'positions' | 'segments' | 'regions';

export interface DictCompanyItem { name: string; code: string; segment: string; region: string; dirs: string[]; used: number }
export interface DictPositionItem { id: number; name: string; code: string; dirs: string[]; payFrom: number; payTo: number; units: number; used: number }
export interface DictSimpleItem { name: string; used: number }
export type DictItem = DictCompanyItem | DictPositionItem | DictSimpleItem;
export interface DictListResponse { ok: true; kind: DictKind; items: DictItem[]; dirs: string[] }

export interface SaveDictPayload {
  prev: string; name: string; segment?: string; region?: string; dirs?: string[]; payFrom?: number; payTo?: number;
}
export interface SaveDictResponse { ok: true; name: string }
export interface DictUsageResponse { ok: true; name: string; total: number; parts: string[] }
export interface DictDeleteResponse { ok: true; removed: string; total: number; parts: string[] }

export interface CompanyUsageRow { name: string; competitors: number; surveys: number; total: number; inDictionary: boolean; segment: string; region: string }
export interface PositionUsageRow { name: string; surveys: number; selections: number; unitPositions: number; total: number; inDictionary: boolean; dirs: string; code: string }
export interface CompanyUsageResponse { ok: true; companies: CompanyUsageRow[] }
export interface PositionUsageResponse { ok: true; positions: PositionUsageRow[] }

export interface SimilarNamePair { a: string; b: string; ratio: number; reason: string; aInfo: Record<string, string>; bInfo: Record<string, string> }
export interface SimilarNamesResponse { ok: true; kind: DictKind; pairs: SimilarNamePair[] }

export interface MergeResponse { ok: true; message: string }

// ─── Администрирование: обслуживание и статус данных ───

export interface DataStatus {
  divisions: number | null; divisionsWithCode: number | null; staffPairs: number | null; staffUnits: number | null;
  positions: number | null; companies: number | null; companiesWithDirs: number | null; companiesWithCode: number | null;
  competitors: number | null; competitorUnits: number | null; surveys: number | null;
}
export interface DataStatusResponse { ok: true; status: DataStatus }

export interface LockGroup { owner: string; comps: number; survs: number; role: string }
export interface LocksResponse { ok: true; locks: LockGroup[] }

export interface SurveyImportSkippedRow { row: number; reason: string }
export interface SurveyCellIssue { row: number; column: string; value: string; rule: string; message: string }
export interface SurveyDuplicate { row: number; sid: string; unit: string; company: string; pos_their: string; pay_from: number }
export interface SurveyImportReport {
  rowsInFile: number; rowsPrepared: number; rowsSkipped: number; skippedRows: SurveyImportSkippedRow[];
  companies: number; companiesNew: number; positions: number; positionsNew: number;
  units: number; unitsList: string[]; unitsNew: string[]; unitsUnassigned: number; unitsViaPosition: number;
  managers: number; managersUnknown: number;
  posOurMatched: number; posOurSentinel: number;
  cellIssues: number; issuesByRule: Record<string, number>; suspiciousHourly: number;
  duplicatesInDb: number; duplicatesInFile: number;
}
export interface SurveyImportDryRunResponse {
  ok: true; dryRun: true; report: SurveyImportReport;
  cellIssues: SurveyCellIssue[]; duplicates: SurveyDuplicate[]; skippedRows: SurveyImportSkippedRow[];
}
export interface SurveyImportCommitResponse {
  ok: true; dryRun: false; inserted: number; updated: number; skippedDup: number;
  newUnits: number; newCompanies: number; newPositions: number; message: string; report: SurveyImportReport;
}

// ─── Администрирование: рассылка через Telegram ───

export interface BroadcastRecipientCandidate { id: number; login: string; fio: string; role: Role; units: string[] }
export interface BroadcastRecipientsResponse { ok: true; rows: BroadcastRecipientCandidate[]; totalActive: number }

export interface BroadcastListItem {
  id: number; author_login: string; body: string; with_button: number;
  total: number; sent: number; failed: number; created_at: string;
}
export interface BroadcastListResponse { ok: true; rows: BroadcastListItem[] }

export interface BroadcastRecipientStatus { fio: string; status: 'sent' | 'failed'; sent_at: string }
export interface BroadcastDetailsResponse { ok: true; broadcast: BroadcastListItem; recipients: BroadcastRecipientStatus[] }

export interface SendBroadcastPayload { body: string; withButton: boolean; userIds: number[] }
export interface SendBroadcastResponse { ok: true; id: number; total: number; sent: number; failed: number }

// ─── Администрирование: журнал аудита ───

export interface AuditLogEntry { id: number; dt: string; login: string; action: string; detail: string; ip: string }
export interface AuditLogResponse { ok: true; logs: AuditLogEntry[] }

// ─── Пересмотр заработной платы ───
// docs/superpowers/specs/2026-09-22-comp-review-design.md (согласовано 22.09.2026)

export type CompRequestType = 'planned' | 'probation_end' | 'counter_offer' | 'unique_case';
export type CompReasonCode = 'promotion' | 'probation_end' | 'market_adjustment' | 'retention' | 'alignment' | 'unique_case';
export type CompRequestStatus = 'draft' | 'cb_review' | 'hrd_review' | 'committee' | 'payroll' | 'closed';
export type CompEmployeeStatus = 'active' | 'rejected_hrd' | 'rejected_committee' | 'committee_meeting' | 'approved_awaiting_payroll' | 'done';
export type CompVoteMode = 'open' | 'closed';

export interface CompOption { code: string; label: string }
export interface CompReasonsResponse { ok: true; requestTypes: CompOption[]; reasons: CompOption[] }
export interface CompVariablePayKindsResponse { ok: true; kinds: string[] }

export interface CompEmployeeOption { id: number; unit: string; fio: string; position: string; lastReviewDate: string | null; currentSalary: number | null }
export interface CompEmployeesResponse { ok: true; rows: CompEmployeeOption[] }
export interface CompPositionsResponse { ok: true; rows: string[] }
export interface CompHrBpOption { login: string; fio: string }
export interface CompHrBpResponse { ok: true; rows: CompHrBpOption[] }

export interface CompVariablePay { id: number; kind: string; amount: number; amountType: 'sum' | 'percent'; period: string; isProposed: boolean }
export interface CompVote { voterLogin: string; vote: 'for' | 'against' | 'meeting' | null; comment: string | null; votedAt: string }

export interface CompRequestEmployee {
  id: number; requestId: number; staffId: number | null; fio: string; unit: string; position: string; newPosition: string;
  hrBpLogin: string;
  hireDate: string | null; probationStartDate: string | null; probationEndDate: string | null;
  lastReviewDate: string | null; currentSalary: number | null; proposedSalary: number; growthPercent: number | null;
  gradePayFrom: number | null; gradePayTo: number | null; vilkaBefore: number | null; vilkaAfter: number | null;
  gradingScore: number | null; gradingLevel: number | null;
  marketMin: number | null; marketMedian: number | null; marketMax: number | null; compaRatio: number | null;
  reasonCode: CompReasonCode; reasonText: string; isException: boolean;
  status: CompEmployeeStatus; decidedAt: string | null; payrollEnteredAt: string | null; payrollEnteredBy: string | null;
  payrollComment: string; payrollEffectiveDate: string | null;
  variablePay: CompVariablePay[]; votes: CompVote[];
}

export interface CompActivityEntry { id: number; employeeFio: string | null; actorLogin: string; action: string; comment: string; createdAt: string }

export interface CompRequest {
  id: number; initiatorLogin: string; unit: string; requestType: CompRequestType;
  effectiveDate: string | null; basisDocument: string; comment: string; status: CompRequestStatus;
  committeeSize: number; createdAt: string; updatedAt: string;
  employees: CompRequestEmployee[]; activity: CompActivityEntry[];
}
export interface CompRequestListItem {
  id: number; initiatorLogin: string; unit: string; requestType: CompRequestType;
  effectiveDate: string | null; basisDocument: string; comment: string; status: CompRequestStatus;
  committeeSize: number; createdAt: string; updatedAt: string;
}
export interface CompRequestResponse { ok: true; request: CompRequest }
export interface CompRequestsResponse { ok: true; rows: CompRequestListItem[] }

export interface CreateDraftPayload { unit?: string; requestType: CompRequestType; effectiveDate?: string; basisDocument?: string; comment?: string }
export type UpdateHeaderPayload = Partial<CreateDraftPayload>
export interface AddEmployeePayload {
  fio: string; unit: string; position?: string; newPosition?: string; hrBpLogin?: string; staffId?: number;
  proposedSalary: number; reasonCode: CompReasonCode; reasonText?: string;
  hireDate?: string; probationStartDate?: string; probationEndDate?: string;
}
export interface UpdateEmployeePayload {
  proposedSalary?: number; reasonCode?: CompReasonCode; reasonText?: string; newPosition?: string; hrBpLogin?: string;
  hireDate?: string; probationStartDate?: string; probationEndDate?: string;
}
export interface AddVariablePayPayload { kind: string; amount: number; amountType: 'sum' | 'percent'; period?: string; isProposed?: boolean }

export interface CompMyAccessResponse {
  ok: true; canSubmit: boolean; canReviewCb: boolean; canApproveHrd: boolean; canVoteCap: boolean;
  canPayroll: boolean; isAdmin: boolean; isCommitteeMember: boolean;
}
export interface CompCommitteeResponse { ok: true; rows: string[] }
export interface CompSettings { voteMode: CompVoteMode }
export interface CompSettingsResponse { ok: true; settings: CompSettings }
export interface CompRemindResponse { ok: true; remindedCount: number }

export interface CompAttachment { id: number; fileName: string; mimeType: string | null; sizeBytes: number | null; createdAt: string }
export interface CompAttachmentsResponse { ok: true; rows: CompAttachment[] }
export interface CompAttachTokenResponse { ok: true; deepLink: string; expiresInMinutes: number; remaining: number }

// ─── Чат поддержки ───

export type SupportSource = 'telegram' | 'web';
export type SupportStatus = 'open' | 'closed';

export interface SupportMessage {
  id: number; thread_id: number; direction: 'in' | 'out'; body: string;
  author_login: string | null; read_at: string | null; read_at_user: string | null; created_at: string;
}

export interface SupportThreadListItem {
  id: number; telegram_chat_id: string; phone: string | null; status: SupportStatus;
  source: SupportSource; topic: string | null; archived_at: string | null;
  last_message_at: string; created_at: string; linked_fio: string | null;
  last_body: string | null; last_direction: 'in' | 'out' | null; unread_count: number;
  matched_in_message_only?: boolean;
}
export interface SupportThreadsResponse { ok: true; rows: SupportThreadListItem[] }

export interface SupportThread extends SupportThreadListItem { user_id: number | null }
export interface SupportThreadResponse { ok: true; thread: SupportThread; messages: SupportMessage[] }

export interface SupportFilters {
  q?: string; status?: 'open' | 'closed'; reply?: 'pending'; login?: 'missing'; unread?: 'yes'; archived?: 'yes';
}

export interface SupportQuickReply { id: number; text: string; audience: 'admin' | 'guest'; answer: string | null }
export interface SupportQuickRepliesResponse { ok: true; rows: SupportQuickReply[] }
export interface SaveQuickReplyPayload { id?: number; text: string; audience: 'admin' | 'guest'; answer?: string }

export interface SupportFaqItem { id: number; question: string; answer: string }
export interface SupportFaqResponse { ok: true; rows: SupportFaqItem[] }
export interface SaveFaqPayload { id?: number; question: string; answer: string }

export interface LinkEmployeeResponse { ok: true; message: string }

// «Моя поддержка» — экран сотрудника
export interface MySupportThreadListItem {
  id: number; topic: string | null; status: SupportStatus; last_message_at: string; created_at: string;
  last_body: string | null; last_direction: 'in' | 'out' | null; unread_count: number;
}
export interface MySupportThreadsResponse { ok: true; rows: MySupportThreadListItem[] }
export interface MySupportThreadResponse { ok: true; thread: SupportThread; messages: SupportMessage[] }
export interface MySupportStartResponse { ok: true; id: number }
export interface MySupportUnreadResponse { ok: true; count: number }
export interface AdminSupportUnreadResponse { ok: true; count: number }

