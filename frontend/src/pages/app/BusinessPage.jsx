import BusinessDaily from '../../features/business/pages/BusinessDaily.jsx'
import '../../features/business/styles/business.css'

// The owner's Business reports (Daily, Weekly, Monthly, Yearly). The module is in English, left to right,
// for now: its texts are not translated yet.
export function BusinessPage() {
  return <div className="business-page" dir="ltr" lang="en"><BusinessDaily /></div>
}
