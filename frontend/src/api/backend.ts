/** Read-only analytics contracts; no mock responses or direct data-file access. */
import { apiGet, ApiError, cleanFilters } from './client'
import type { ApiResponse, GlobalFilters, PerformanceClass, User } from './types'
export type Row = Record<string, unknown>
export interface List { items: Row[]; count?: number; source?: string }
export const NA = Number.NaN
export const num = (row: Row, key: string): number => typeof row[key] === 'number' && Number.isFinite(row[key]) ? row[key] as number : NA
export const str = (row: Row, key: string, fallback = ''): string => typeof row[key] === 'string' ? row[key] as string : fallback
export const sum = (rows: Row[], key: string): number => rows.reduce((a,r) => a + num(r,key), 0)
export const ratio = (a: number,b: number): number => Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? a/b : NA
export const group = (rows: Row[], key: string): [string,Row[]][] => [...rows.reduce((m,r) => {
  const value = str(r,key); m.set(value,[...(m.get(value) ?? []),r]); return m
},new Map<string,Row[]>())]
export const query = (params: Record<string,string | number | undefined>) => {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k,v]) => { if(v !== undefined && v !== '' && v !== 'all') q.set(k,String(v)) })
  return q.size ? '?' + q : ''
}
export function scope(filters: GlobalFilters, allowed: (keyof GlobalFilters)[] = []) {
  const unsupported = Object.keys(cleanFilters(filters)).filter(k => !allowed.includes(k as keyof GlobalFilters))
  if (unsupported.length) throw new ApiError('Data unavailable for these filters: ' + unsupported.join(', ') + '. This analysis covers the stored historical period. Reset these filters to view it.',422,'no_data','')
}
export function envelope<T>(data: T, note: string): ApiResponse<T> { return {data,meta:{pipeline:'spark',note}} }
export function performance(value: string): PerformanceClass {
  const key = value.toLowerCase().replaceAll(' ','_')
  return ['profit_driver','volume_driver','hidden_opportunity','low_performer'].includes(key) ? key as PerformanceClass : 'unclassified'
}
export function mapUser(row: Row): User {
  const role = str(row,'role') === 'administrator' ? 'admin' : str(row,'role')
  if (!['admin','analyst','restaurant_manager','regional_manager'].includes(role)) throw new ApiError('Unsupported account role.',403,'forbidden','/api/auth/session')
  return {id:String(row.user_id),name:str(row,'email'),email:str(row,'email'),role:role as User['role'],outletScope:row.restaurant_id ? [str(row,'restaurant_id')] : undefined}
}
export interface Report { report: string; generated_at: string; records: number; source: string; items: Row[] }
export async function completeReport(dataset: string): Promise<Report> {
  const report = await apiGet<Report>('/api/reports/' + dataset)
  if (report.records > 5000) throw new ApiError('The existing API cannot return this full dataset. Aggregate totals are unavailable.',422,'no_data','/api/reports/' + dataset)
  if(report.records > report.items.length) {
    const full = await apiGet<List>('/api/export/' + dataset + '?format=json&limit=5000')
    report.items = full.items
  }
  if(report.items.length !== report.records) throw new ApiError('The backend returned a partial dataset; totals are unavailable.',422,'no_data','/api/reports/' + dataset)
  return report
}
export async function menuRows(filters: GlobalFilters = {}): Promise<Row[]> {
  scope(filters,['category','performanceClass','priceMin','priceMax','ratingMin'])
  const result = await apiGet<List>('/api/intelligence/menu?limit=1000')
  if (result.count !== undefined && result.count !== result.items.length) throw new ApiError('Menu response is incomplete.',422,'no_data','/api/intelligence/menu')
  if (filters.ratingMin !== undefined) throw new ApiError('Item-level ratings are unavailable. Reset the rating filter.',422,'no_data','/api/intelligence/menu')
  return result.items.filter(r => (!filters.category || str(r,'category_id') === filters.category || str(r,'category_name') === filters.category)
    && (!filters.performanceClass || performance(str(r,'performance_class')) === filters.performanceClass)
    && (filters.priceMin === undefined || num(r,'base_price') >= filters.priceMin)
    && (filters.priceMax === undefined || num(r,'base_price') <= filters.priceMax))
}
