/**
 * VendorTable - Responsive vendor data display
 * 
 * Mobile layout (≤768px):
 * - Card-based layout, one vendor per card
 * - Each card shows: Vendor name + Plan pill, Views | Unique | Clicks, Placements
 * - CTR hidden under 600px
 * - No horizontal scroll
 * 
 * Desktop layout:
 * - Traditional table with sortable columns
 * - Full click breakdown (website/instagram)
 * - CTR column visible
 */

import VendorMetadataBadges, { PlanPill, PlacementBadges } from './VendorMetadataBadges';
import { featureFlags } from '../config/features';

interface VendorData {
  name: string;
  websiteClicks: number;
  instagramClicks: number;
  totalClicks: number;
  views: number | null;
  uniqueViews: number | null;
  ctr: number | null;
  plan?: string;
  placementsActive?: string[];
  metaStatus?: 'ok' | 'missing' | 'mismatch';
}

type SortColumn = 'views' | 'uniqueViews' | 'websiteClicks' | 'instagramClicks' | 'totalClicks' | 'ctr';
type SortDirection = 'asc' | 'desc';

interface VendorTableProps {
  data: VendorData[];
  loading: boolean;
  selectedVendor: string | null;
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  opportunityFlags: Map<string, boolean>;
  onVendorClick: (vendorName: string) => void;
  onSort: (column: SortColumn) => void;
}

const formatCTR = (ctr: number | null, views: number | null): string => {
  if (ctr === null || views === null || views < 25) return '—';
  return `${ctr.toFixed(1)}%`;
};

export default function VendorTable({
  data,
  loading,
  selectedVendor,
  sortColumn,
  sortDirection,
  opportunityFlags,
  onVendorClick,
  onSort,
}: VendorTableProps) {
  // Sort data
  const sortedData = [...data].sort((a, b) => {
    const aValue = a[sortColumn];
    const bValue = b[sortColumn];
    if (aValue === null && bValue === null) return 0;
    if (aValue === null) return sortDirection === 'asc' ? -1 : 1;
    if (bValue === null) return sortDirection === 'asc' ? 1 : -1;
    return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
  });

  const SortIcon = ({ column }: { column: SortColumn }) => {
    if (sortColumn !== column) return null;
    return <span className="ml-1 text-neutral-500">{sortDirection === 'asc' ? '↑' : '↓'}</span>;
  };

  return (
    <div className="border border-neutral-200 mb-8">
      {data.length === 0 && !loading ? (
        <div className="px-6 py-12 text-center text-sm text-neutral-400">No data to display</div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full" role="table">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50">
                  <th scope="col" rowSpan={2} className="text-left px-6 py-3 text-xs font-medium text-neutral-600 uppercase tracking-wider align-bottom">Vendor</th>
                  <th scope="col" rowSpan={2} className="text-right px-6 py-3 text-xs font-medium text-neutral-600 uppercase tracking-wider cursor-pointer hover:bg-neutral-100 align-bottom" onClick={() => onSort('views')}>
                    <div className="flex items-center justify-end">Views<SortIcon column="views" /></div>
                  </th>
                  <th scope="col" rowSpan={2} className="text-right px-6 py-3 text-xs font-medium text-neutral-600 uppercase tracking-wider cursor-pointer hover:bg-neutral-100 align-bottom" onClick={() => onSort('uniqueViews')}>
                    <div className="flex items-center justify-end">Unique<SortIcon column="uniqueViews" /></div>
                  </th>
                  <th scope="colgroup" colSpan={2} className="text-center px-6 py-2 text-xs font-medium text-neutral-600 uppercase tracking-wider border-b border-neutral-200">Outbound Clicks</th>
                  <th scope="col" rowSpan={2} className="text-right px-6 py-3 text-xs font-medium text-neutral-600 uppercase tracking-wider cursor-pointer hover:bg-neutral-100 align-bottom" onClick={() => onSort('ctr')}>
                    <div className="flex items-center justify-end">CTR<SortIcon column="ctr" /></div>
                  </th>
                </tr>
                <tr className="border-b border-neutral-200 bg-neutral-50">
                  <th scope="col" className="text-right px-6 py-2 text-xs font-medium text-neutral-500 uppercase tracking-wider cursor-pointer hover:bg-neutral-100" onClick={() => onSort('websiteClicks')}>
                    <div className="flex items-center justify-end">Website<SortIcon column="websiteClicks" /></div>
                  </th>
                  <th scope="col" className="text-right px-6 py-2 text-xs font-medium text-neutral-500 uppercase tracking-wider cursor-pointer hover:bg-neutral-100" onClick={() => onSort('instagramClicks')}>
                    <div className="flex items-center justify-end">Instagram<SortIcon column="instagramClicks" /></div>
                  </th>
                </tr>
              </thead>
              <tbody className={loading ? 'opacity-40' : ''}>
                {sortedData.length === 0 && !loading && (
                  <tr><td colSpan={6} className="px-6 py-12 text-center text-sm text-neutral-600">No data for this property and date range</td></tr>
                )}
                {sortedData.map((vendor) => {
                  const isSelected = selectedVendor === vendor.name;
                  return (
                    <tr
                      key={vendor.name}
                      className={`border-b border-neutral-100 transition-colors cursor-pointer hover:bg-neutral-50 ${isSelected ? 'bg-neutral-100' : ''} ${vendor.metaStatus === 'missing' ? 'bg-red-50/30' : ''}`}
                      onClick={() => onVendorClick(vendor.name)}
                    >
                      <th scope="row" className="px-6 py-3 text-sm text-neutral-900 text-left font-normal">
                        <div className="flex items-center gap-2">
                          <span>{vendor.name}</span>
                          <VendorMetadataBadges
                            plan={vendor.plan}
                            placementsActive={vendor.placementsActive}
                            metaStatus={vendor.metaStatus}
                            compact={true}
                          />
                          {featureFlags.opportunityDetection && opportunityFlags.get(vendor.name) && (
                            <span 
                              className="text-amber-500 cursor-help" 
                              title="High traffic, below-average conversion"
                            >
                              ⚠
                            </span>
                          )}
                        </div>
                      </th>
                      <td className="px-6 py-3 text-sm text-neutral-700 text-right tabular-nums">
                        {vendor.views !== null ? vendor.views.toLocaleString() : '—'}
                      </td>
                      <td className="px-6 py-3 text-sm text-neutral-700 text-right tabular-nums">
                        {vendor.uniqueViews !== null ? vendor.uniqueViews.toLocaleString() : '—'}
                      </td>
                      <td className="px-6 py-3 text-sm text-neutral-700 text-right tabular-nums">
                        {vendor.websiteClicks.toLocaleString()}
                      </td>
                      <td className="px-6 py-3 text-sm text-neutral-700 text-right tabular-nums">
                        {vendor.instagramClicks.toLocaleString()}
                      </td>
                      <td className="px-6 py-3 text-sm text-neutral-700 text-right tabular-nums">
                        {formatCTR(vendor.ctr, vendor.views)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {sortedData.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-neutral-300 bg-neutral-50 font-semibold">
                    <th scope="row" className="px-6 py-3 text-sm text-neutral-900 text-left">Total</th>
                    <td className="px-6 py-3 text-sm text-neutral-900 text-right tabular-nums">{sortedData.reduce((sum, v) => sum + (v.views ?? 0), 0).toLocaleString()}</td>
                    <td className="px-6 py-3 text-sm text-neutral-900 text-right tabular-nums">{sortedData.reduce((sum, v) => sum + (v.uniqueViews ?? 0), 0).toLocaleString()}</td>
                    <td className="px-6 py-3 text-sm text-neutral-900 text-right tabular-nums">{sortedData.reduce((sum, v) => sum + v.websiteClicks, 0).toLocaleString()}</td>
                    <td className="px-6 py-3 text-sm text-neutral-900 text-right tabular-nums">{sortedData.reduce((sum, v) => sum + v.instagramClicks, 0).toLocaleString()}</td>
                    <td className="px-6 py-3 text-sm text-neutral-700 text-right tabular-nums">—</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Mobile Cards */}
          <div className={`md:hidden ${loading ? 'opacity-40' : ''}`}>
            {/* Mobile sort controls */}
            <div className="px-4 py-3 bg-neutral-50 border-b border-neutral-200 flex items-center justify-between">
              <span className="text-xs text-neutral-500 uppercase tracking-wider">
                {sortedData.length} vendor{sortedData.length !== 1 ? 's' : ''}
              </span>
              <select
                value={sortColumn}
                onChange={(e) => onSort(e.target.value as SortColumn)}
                className="text-xs border border-neutral-300 rounded px-2 py-1 bg-white"
              >
                <option value="views">Sort by Views</option>
                <option value="uniqueViews">Sort by Unique</option>
                <option value="totalClicks">Sort by Clicks</option>
                <option value="ctr">Sort by CTR</option>
              </select>
            </div>
            
            {/* Vendor cards */}
            <div className="divide-y divide-neutral-100">
              {sortedData.map((vendor) => {
                const isSelected = selectedVendor === vendor.name;
                return (
                  <div
                    key={vendor.name}
                    className={`p-4 cursor-pointer transition-colors ${
                      isSelected ? 'bg-neutral-100' : 'hover:bg-neutral-50'
                    } ${vendor.metaStatus === 'missing' ? 'bg-red-50/30' : ''}`}
                    onClick={() => onVendorClick(vendor.name)}
                  >
                    {/* Header: Vendor name + Plan pill */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-neutral-900">{vendor.name}</span>
                        <PlanPill plan={vendor.plan} />
                        {featureFlags.opportunityDetection && opportunityFlags.get(vendor.name) && (
                          <span className="text-amber-500 text-sm">⚠</span>
                        )}
                      </div>
                      {vendor.metaStatus && vendor.metaStatus !== 'ok' && (
                        <span className="text-amber-500 text-xs">
                          {vendor.metaStatus === 'missing' ? '⚠ Missing' : '⚠ Mismatch'}
                        </span>
                      )}
                    </div>
                    
                    {/* Stats: Views | Unique | Clicks */}
                    <div className="grid grid-cols-3 gap-4 text-center mb-3">
                      <div>
                        <div className="text-lg font-light text-neutral-900 tabular-nums">
                          {vendor.views !== null ? vendor.views.toLocaleString() : '—'}
                        </div>
                        <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Views</div>
                      </div>
                      <div>
                        <div className="text-lg font-light text-neutral-900 tabular-nums">
                          {vendor.uniqueViews !== null ? vendor.uniqueViews.toLocaleString() : '—'}
                        </div>
                        <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Unique</div>
                      </div>
                      <div>
                        <div className="text-lg font-light text-neutral-900 tabular-nums">
                          {vendor.totalClicks.toLocaleString()}
                        </div>
                        <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Clicks</div>
                      </div>
                    </div>
                    
                    {/* Placements row */}
                    {vendor.placementsActive && vendor.placementsActive.length > 0 && (
                      <div className="pt-3 border-t border-neutral-100">
                        <PlacementBadges placements={vendor.placementsActive} maxVisible={4} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            
            {/* Mobile totals */}
            {sortedData.length > 0 && (
              <div className="p-4 bg-neutral-50 border-t-2 border-neutral-300">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-lg font-semibold text-neutral-900 tabular-nums">
                      {sortedData.reduce((sum, v) => sum + (v.views ?? 0), 0).toLocaleString()}
                    </div>
                    <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Total Views</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-neutral-900 tabular-nums">
                      {sortedData.reduce((sum, v) => sum + (v.uniqueViews ?? 0), 0).toLocaleString()}
                    </div>
                    <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Total Unique</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-neutral-900 tabular-nums">
                      {sortedData.reduce((sum, v) => sum + v.totalClicks, 0).toLocaleString()}
                    </div>
                    <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Total Clicks</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
