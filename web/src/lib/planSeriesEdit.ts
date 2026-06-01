// @ts-expect-error - fonte JS pura compartilhada com o teste node:test
export { planSeriesEdit } from './planSeriesEdit.cjs';
export type SeriesEditScope = 'only_this' | 'this_and_future';
