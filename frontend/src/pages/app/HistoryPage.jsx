import { SalesHistory } from '../../features/sales/SalesHistory.jsx'
import { supabase } from '../../lib/supabase.js'

export function HistoryPage({ profile }) {
  return <SalesHistory
    supabase={supabase}
    role={profile?.user?.role}
    currency={profile?.account?.baseCurrency || 'USD'}
    storeName={profile?.account?.name || ''}
  />
}
