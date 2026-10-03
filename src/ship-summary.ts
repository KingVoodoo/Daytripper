export interface ActiveShip {
  ship_name?: string; name?: string; type_name?: string | null;
  ship_type_id?: number; updated_at?: number; is_stale?: boolean; scope_missing?: boolean;
}

export function shipSummary(ship: ActiveShip | null, permitted: boolean) {
  if (!permitted || ship?.scope_missing) return {label:'Ship scope unavailable', state:'Authorize ship access in WOKAuth to show this field.', updatedAt:null};
  const name=ship?.ship_name?.trim() || ship?.name?.trim();
  const hull=ship?.type_name?.trim() || (ship?.ship_type_id ? `Type ${ship.ship_type_id}` : '');
  const label=name && hull && name!==hull ? `${name} · ${hull}` : name || hull;
  if (!label) return {label:'Not cached by WOKAuth',state:'Waiting for a successful server ship update.',updatedAt:null};
  const timestamp=ship?.updated_at;
  const updatedAt=typeof timestamp==='number' && timestamp>0 && Number.isFinite(new Date(timestamp).getTime()) ? timestamp : null;
  return {label,state:ship?.is_stale ? 'Stale ship data · last known ship' : 'Last reported ship',updatedAt};
}
