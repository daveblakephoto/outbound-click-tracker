/**
 * VendorMetadataBadges - Display vendor plan and placement badges
 * 
 * Fully enum-driven from schema. All pills, badges, and labels are
 * generated dynamically from schema allowlists with graceful fallback
 * for unknown values.
 */

import { useSchema } from '../contexts/SchemaContext';
import { getPlanDisplayConfig, getPlacementDisplayConfig } from '../services/schemaService';

interface VendorMetadataBadgesProps {
  plan?: string;
  placementsActive?: string[];
  metaStatus?: 'ok' | 'missing' | 'mismatch';
  compact?: boolean;
}

export default function VendorMetadataBadges({
  plan,
  placementsActive,
  metaStatus,
  compact = false,
}: VendorMetadataBadgesProps) {
  const { schema } = useSchema();
  
  // Get plan config dynamically from schema
  const planConfig = plan ? getPlanDisplayConfig(plan, schema) : null;
  
  return (
    <div className={`flex items-center gap-2 ${compact ? 'flex-wrap' : ''}`}>
      {/* Plan pill - dynamically rendered */}
      {planConfig && plan && plan !== 'unknown' && (
        <span 
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${planConfig.bgColor} ${planConfig.color}`}
          title={`Billing plan: ${plan}${!planConfig.isKnown ? ' (unknown to schema)' : ''}`}
        >
          {planConfig.label}
          {!planConfig.isKnown && (
            <span className="ml-1 text-[10px] opacity-60">?</span>
          )}
        </span>
      )}
      
      {/* Placement badges - dynamically rendered from schema */}
      {placementsActive && placementsActive.length > 0 && (
        <div className="flex items-center gap-1">
          {placementsActive.slice(0, compact ? 2 : 4).map(placement => {
            const placementConfig = getPlacementDisplayConfig(placement, schema);
            return (
              <span
                key={placement}
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${placementConfig.bgColor} ${placementConfig.color} border ${placementConfig.borderColor}`}
                title={`Active placement: ${placement}${!placementConfig.isKnown ? ' (unknown to schema)' : ''}`}
              >
                {placementConfig.label}
                {!placementConfig.isKnown && (
                  <span className="ml-0.5 opacity-60">?</span>
                )}
              </span>
            );
          })}
          {compact && placementsActive.length > 2 && (
            <span 
              className="text-[10px] text-neutral-500"
              title={placementsActive.slice(2).join(', ')}
            >
              +{placementsActive.length - 2}
            </span>
          )}
        </div>
      )}
      
      {/* metaStatus indicator */}
      {metaStatus && metaStatus !== 'ok' && (
        <span
          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
            metaStatus === 'missing' 
              ? 'bg-red-50 text-red-600 border border-red-200'
              : 'bg-amber-50 text-amber-600 border border-amber-200'
          }`}
          title={metaStatus === 'missing' ? 'Vendor data missing' : 'Data mismatch detected'}
        >
          {metaStatus === 'missing' ? '⚠ Missing' : '⚠ Mismatch'}
        </span>
      )}
    </div>
  );
}

/**
 * Inline plan pill for table rows
 * Dynamically generates config from schema
 */
export function PlanPill({ plan }: { plan?: string }) {
  const { schema } = useSchema();
  
  if (!plan || plan === 'unknown') return null;
  
  const config = getPlanDisplayConfig(plan, schema);
  
  return (
    <span 
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${config.bgColor} ${config.color}`}
      title={!config.isKnown ? `Unknown plan: ${plan}` : undefined}
    >
      {config.label}
      {!config.isKnown && (
        <span className="ml-0.5 opacity-60">?</span>
      )}
    </span>
  );
}

/**
 * Placement badge list component
 * Renders all active placements with schema-driven styling
 */
export function PlacementBadges({ 
  placements, 
  maxVisible = 4 
}: { 
  placements?: string[]; 
  maxVisible?: number;
}) {
  const { schema } = useSchema();
  
  if (!placements || placements.length === 0) return null;
  
  const visiblePlacements = placements.slice(0, maxVisible);
  const hiddenCount = placements.length - maxVisible;
  
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {visiblePlacements.map(placement => {
        const config = getPlacementDisplayConfig(placement, schema);
        return (
          <span
            key={placement}
            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${config.bgColor} ${config.color} border ${config.borderColor}`}
            title={`Active placement: ${placement}`}
          >
            {config.label}
            {!config.isKnown && <span className="ml-0.5 opacity-60">?</span>}
          </span>
        );
      })}
      {hiddenCount > 0 && (
        <span 
          className="text-[10px] text-neutral-500 cursor-help"
          title={placements.slice(maxVisible).join(', ')}
        >
          +{hiddenCount}
        </span>
      )}
    </div>
  );
}
