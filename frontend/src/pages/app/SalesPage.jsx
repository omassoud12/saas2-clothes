import { MockSalesScreen } from '../../features/sales/MockSalesScreen.jsx'
import { supabase } from '../../lib/supabase.js'

export function SalesPage({ profile }) {
  const accountId = profile?.account?.id || profile?.user?.accountId
  const userId = profile?.user?.id
  return <MockSalesScreen
    supabase={supabase}
    role={profile?.user?.role}
    currency={profile?.account?.baseCurrency || 'USD'}
    storageScope={accountId && userId ? `${accountId}:${userId}` : ''}
  />
}
