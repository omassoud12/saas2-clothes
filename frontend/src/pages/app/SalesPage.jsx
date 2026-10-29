import { MockSalesScreen } from '../../features/sales/MockSalesScreen.jsx'
import { supabase } from '../../lib/supabase.js'

export function SalesPage({ profile }) {
  return <MockSalesScreen
    supabase={supabase}
    role={profile?.user?.role}
    currency={profile?.account?.baseCurrency || 'USD'}
  />
}
